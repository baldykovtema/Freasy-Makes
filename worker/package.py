"""Сборка формата: `prepare <format>` готовит проект, `deliver <format>` отправляет файл и инструкцию на сайт."""
import hashlib
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from common import MAX_FILE_BYTES, ROOT, WORK, download, folder, get_job, upload

OUTPUTS = {
    'exe': ('windows/dist/game/game-win_x64.exe', 'application/octet-stream'),
    'dmg': ('macos/Game.dmg', 'application/x-apple-diskimage'),
    'apk': ('android/app/build/outputs/apk/debug/app-debug.apk', 'application/vnd.android.package-archive'),
}
TEXT_FILES = {'.swift', '.plist', '.json', '.gradle', '.xml'}


def placeholders(job):
    title = job.get('title') or 'Game'
    digest = hashlib.sha256(job['id'].encode()).hexdigest()
    return {
        '__APP_NAME_XML__': escape(title, {'"': '&quot;'}),
        '__APP_NAME_SWIFT__': title.replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' '),
        '__APP_NAME_JSON__': json.dumps(title, ensure_ascii=False)[1:-1],
        '__APP_ID__': f'com.freasymakes.g{digest[:12]}',
        # Свой постоянный порт у каждой игры: две игры не мешают друг другу, а сохранения не теряются.
        '__PORT__': str(40000 + int(digest[:4], 16) % 20000),
    }


def prepare(format_name):
    job = get_job()
    source = WORK / 'source.zip'
    download('games', f'{folder(job)}/source.zip', source)
    template = {'exe': 'windows', 'dmg': 'macos', 'apk': 'android'}[format_name]
    project = WORK / template
    shutil.rmtree(project, ignore_errors=True)
    shutil.copytree(ROOT / 'templates' / template, project)
    values = placeholders(job)
    for file in project.rglob('*'):
        if file.is_file() and file.suffix in TEXT_FILES:
            text = file.read_text(encoding='utf-8')
            for key, value in values.items():
                text = text.replace(key, value)
            file.write_text(text, encoding='utf-8')
    with zipfile.ZipFile(source) as archive:
        archive.extractall(project / 'www')
    print(project)


def file_name(job, format_name):
    slug = re.sub(r'[^A-Za-z0-9]+', '-', job.get('title') or '').strip('-')[:40]
    return f"{slug or 'Game'}-{job['id'][:8]}.{format_name}"


def how_to_run(job, format_name, name):
    steps = {
        'exe': f"""ЗАПУСК НА WINDOWS 10/11
1. Скачай файл {name} и дважды нажми на него. Устанавливать ничего не нужно.
2. Если появилось окно «Windows защитила ваш компьютер», нажми «Подробнее», затем «Выполнить в любом случае». Окно появляется потому, что у игры нет платной цифровой подписи.
3. Если игра не открылась, установи Microsoft Edge WebView2 Runtime с сайта microsoft.com (на Windows 11 он уже есть) и запусти файл снова.""",
        'dmg': f"""ЗАПУСК НА macOS 13 И НОВЕЕ
1. Дважды нажми на файл {name}.
2. В открывшемся окне перетащи игру в папку Applications («Программы»).
3. Открой игру из папки «Программы». macOS скажет, что не может проверить разработчика: так бывает с играми без заверения Apple.
4. Открой «Системные настройки → Конфиденциальность и безопасность», прокрути вниз и нажми «Всё равно открыть».""",
        'apk': f"""ЗАПУСК НА ANDROID 6 И НОВЕЕ
1. Скачай файл {name} на телефон и нажми на него в уведомлении или в папке «Загрузки».
2. Если телефон спросит, разреши установку из этого источника (браузера или файлового менеджера).
3. Если Google Play Защита предупредит о неизвестном приложении, выбери «Всё равно установить».
4. Нажми «Открыть» или найди игру на главном экране.
Файл APK работает только на Android. На iPhone он не установится.""",
    }[format_name]
    rules = (job.get('how_to_play') or '').strip()
    title = job.get('title') or 'Игра'
    return f"{title}\n\n{steps}\n\nКАК ИГРАТЬ\n{rules or 'Подсказки есть на стартовом экране игры.'}\n\nИгра сделана на Freasy Makes: https://baldykovtema.github.io/Freasy-Makes/\n"


def deliver(format_name):
    job = get_job()
    relative, content_type = OUTPUTS[format_name]
    built = WORK / relative
    if built.stat().st_size > MAX_FILE_BYTES:
        raise SystemExit('Файл игры больше 50 МБ')
    name = file_name(job, format_name)
    guide = WORK / 'how-to-run.txt'
    guide.write_text(how_to_run(job, format_name, name), encoding='utf-8')
    # Ключи в Supabase Storage только латиницей, русское имя файл получает при скачивании на сайте.
    upload('games', f'{folder(job)}/{format_name}/how-to-run.txt', guide, 'text/plain; charset=utf-8')
    upload('games', f'{folder(job)}/{format_name}/{name}', built, content_type)


if __name__ == '__main__':
    {'prepare': prepare, 'deliver': deliver}[sys.argv[1]](sys.argv[2])
