import Cocoa
import WebKit
import Network

final class LocalServer {
    let listener: NWListener
    let root: URL
    let queue = DispatchQueue(label: "com.freasymakes.assets")
    init(root: URL) throws {
        self.root = root.resolvingSymlinksInPath()
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: __PORT__)
        listener = try NWListener(using: parameters)
    }
    func start(ready: @escaping (Result<URL, Error>) -> Void) {
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready: DispatchQueue.main.async { ready(.success(URL(string: "http://127.0.0.1:__PORT__/index.html")!)) }
            case .failed(let error): DispatchQueue.main.async { ready(.failure(error)) }
            default: break
            }
        }
        listener.newConnectionHandler = { connection in
            connection.start(queue: self.queue)
            self.receive(connection, accumulated: Data())
        }
        listener.start(queue: queue)
    }
    func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { data, _, complete, error in
            var request = accumulated
            if let data = data { request.append(data) }
            if request.range(of: Data("\r\n\r\n".utf8)) != nil { self.respond(connection, request: request) }
            else if error != nil || complete || request.count > 32768 { connection.cancel() }
            else { self.receive(connection, accumulated: request) }
        }
    }
    func respond(_ connection: NWConnection, request: Data) {
        let lines = String(decoding: request, as: UTF8.self).components(separatedBy: "\r\n")
        let parts = lines[0].split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" || parts[0] == "HEAD" else { connection.cancel(); return }
        let path = String(parts[1]).components(separatedBy: "?")[0].removingPercentEncoding ?? ""
        var file = root.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        var directory: ObjCBool = false
        if FileManager.default.fileExists(atPath: file.path, isDirectory: &directory), directory.boolValue { file.appendPathComponent("index.html") }
        let safe = file.path.hasPrefix(root.path + "/")
        let bytes = safe ? try? Data(contentsOf: file) : nil
        var body = bytes ?? Data("Not Found".utf8)
        let types = ["html":"text/html; charset=utf-8", "js":"application/javascript; charset=utf-8", "css":"text/css; charset=utf-8", "svg":"image/svg+xml", "png":"image/png", "jpg":"image/jpeg", "jpeg":"image/jpeg", "webp":"image/webp", "gif":"image/gif", "mp4":"video/mp4", "webm":"video/webm", "json":"application/json", "mp3":"audio/mpeg", "wav":"audio/wav"]
        var status = bytes == nil ? "404 Not Found" : "200 OK"
        var rangeHeader = ""
        if let bytes = bytes, !bytes.isEmpty, let line = lines.first(where: { $0.lowercased().hasPrefix("range: bytes=") }) {
            let bounds = line.dropFirst("range: bytes=".count).split(separator: "-", omittingEmptySubsequences: false)
            if bounds.count == 2, let start = Int(bounds[0].trimmingCharacters(in: .whitespaces)), start < bytes.count {
                let end = min(Int(bounds[1].trimmingCharacters(in: .whitespaces)) ?? bytes.count - 1, bytes.count - 1)
                if end >= start {
                    body = bytes.subdata(in: start..<(end + 1))
                    status = "206 Partial Content"
                    rangeHeader = "Content-Range: bytes \(start)-\(end)/\(bytes.count)\r\n"
                }
            }
        }
        let header = "HTTP/1.1 \(status)\r\nContent-Type: \(types[file.pathExtension.lowercased()] ?? "application/octet-stream")\r\nContent-Length: \(body.count)\r\nAccept-Ranges: bytes\r\n\(rangeHeader)Cache-Control: no-cache\r\nConnection: close\r\n\r\n"
        var response = Data(header.utf8)
        if parts[0] != "HEAD" { response.append(body) }
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var server: LocalServer!
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appItem = NSMenuItem(); menu.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "О __APP_NAME_SWIFT__", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Завершить __APP_NAME_SWIFT__", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem(); menu.addItem(editItem); let edit = NSMenu(title: "Правка"); editItem.submenu = edit
        for (title, action, key) in [("Отменить", "undo:", "z"), ("Вырезать", "cut:", "x"), ("Копировать", "copy:", "c"), ("Вставить", "paste:", "v"), ("Выбрать всё", "selectAll:", "a")] { edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key) }
        let navigationItem = NSMenuItem(); menu.addItem(navigationItem); let navigation = NSMenu(title: "Навигация"); navigationItem.submenu = navigation
        navigation.addItem(withTitle: "Назад", action: #selector(back), keyEquivalent: "[").target = self
        navigation.addItem(withTitle: "На главную", action: #selector(home), keyEquivalent: "h").target = self
        NSApp.mainMenu = menu
        let config = WKWebViewConfiguration()
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self; web.uiDelegate = self; web.allowsBackForwardNavigationGestures = true
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "__APP_NAME_SWIFT__"; window.minSize = NSSize(width: 800, height: 560)
        window.contentView = web; window.center(); window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        do {
            server = try LocalServer(root: Bundle.main.resourceURL!.appendingPathComponent("www"))
            server.start { result in
                switch result { case .success(let url):
                    // Bundled resources must update with the app, independently of old PWA caches.
                    let cacheTypes: Set<String> = [WKWebsiteDataTypeServiceWorkerRegistrations, WKWebsiteDataTypeFetchCache, WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache]
                    self.web.configuration.websiteDataStore.removeData(ofTypes: cacheTypes, modifiedSince: Date.distantPast) {
                        self.web.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
                    }
                case .failure(let error): self.showError(error) }
            }
        } catch { showError(error) }
    }
    func showError(_ error: Error) { let alert = NSAlert(); alert.messageText = "Не удалось запустить __APP_NAME_SWIFT__"; alert.informativeText = error.localizedDescription; alert.runModal(); NSApp.terminate(nil) }
    @objc func back() { if web.canGoBack { web.goBack() } }
    @objc func home() { web.load(URLRequest(url: URL(string: "http://127.0.0.1:__PORT__/index.html")!)) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.host == "127.0.0.1", url.port == __PORT__ { decisionHandler(.allow) }
        else { if ["https", "http", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }; decisionHandler(.cancel) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) { let alert = NSAlert(); alert.messageText = message; alert.runModal(); completionHandler() }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) { let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "Да"); alert.addButton(withTitle: "Нет"); completionHandler(alert.runModal() == .alertFirstButtonReturn) }
}
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
