#!/bin/bash
# Сборка из "FreasyGames dmg/build.sh": универсальный .app на WKWebView без заверения Apple.
set -euo pipefail
cd "$1"
mkdir -p build/arm64 build/x86_64 Game.app/Contents/MacOS Game.app/Contents/Resources
for arch in arm64 x86_64; do
    xcrun swiftc main.swift -O -target "$arch-apple-macos13.0" -module-cache-path "$PWD/build/module-cache" -o "build/$arch/Game" -framework Cocoa -framework WebKit -framework Network
done
lipo -create build/arm64/Game build/x86_64/Game -output Game.app/Contents/MacOS/Game
cp Info.plist Game.app/Contents/Info.plist
ditto www Game.app/Contents/Resources/www
codesign --force --sign - Game.app
codesign --verify --deep --strict Game.app
mkdir -p build/dmg
ditto Game.app build/dmg/Game.app
ln -sfn /Applications build/dmg/Applications
hdiutil create -volname Game -srcfolder build/dmg -ov -format UDZO Game.dmg
hdiutil verify Game.dmg
