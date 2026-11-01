#!/usr/bin/env python3
"""Выдаёт заказчику готовую игру или сайт: кладёт файл и инструкцию в Supabase и отмечает заказ готовым.

  python3 tools/deliver_game.py НОМЕР_ЗАКАЗА игра.exe --title "Кот и рыба" --rules "Стрелки: бег, пробел: прыжок"
  python3 tools/deliver_game.py НОМЕР_ЗАКАЗА --refuse "Не можем сделать такую игру"

Если у заказа два формата, укажи оба файла сразу.
Ключ берётся из SUPABASE_SERVICE_ROLE_KEY или через Supabase CLI после `supabase login`.
"""
import argparse
import json
import os
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://ywqxrbmgmvpbeytxjkpi.supabase.co')
PROJECT_REF = 'ywqxrbmgmvpbeytxjkpi'
CLI = Path.home() / '.local/bin/supabase'
MAX_FILE_BYTES = 50 * 1024 * 1024
CONTENT_TYPES = {
    'exe': 'application/octet-stream',
    'dmg': 'application/x-apple-diskimage',
    'apk': 'application/vnd.android.package-archive',
    'zip': 'application/zip',
}
STEPS = {
    'exe': """ЗАПУСК НА WINDOWS
1. Скачай файл {name} и дважды нажми на него.
2. Если появилось окно «Windows защитила ваш компьютер», нажми «Подробнее», затем «Выполнить в любом случае». Окно появляется потому, что у игры нет платной цифровой подписи.""",
    'dmg': """ЗАПУСК НА macOS
1. Дважды нажми на файл {name}.
2. В открывшемся окне перетащи игру в папку Applications («Программы»).
3. Открой игру из папки «Программы». macOS может сказать, что не может проверить разработчика: так бывает с играми без заверения Apple.
4. Открой «Системные настройки → Конфиденциальность и безопасность», прокрути вниз и нажми «Всё равно открыть».""",
    'apk': """ЗАПУСК НА ANDROID
1. Скачай файл {name} на телефон и нажми на него в уведомлении или в папке «Загрузки».
2. Если телефон спросит, разреши установку из этого источника (браузера или файлового менеджера).
3. Если Google Play Защита предупредит о неизвестном приложении, выбери «Всё равно установить».
4. Нажми «Открыть» или найди игру на главном экране.
Файл APK работает только на Android. На iPhone он не установится.""",
    'zip': """КАК ОТКРЫТЬ САЙТ
1. Скачай файл {name} и распакуй архив.
2. Открой файл index.html двойным нажатием: сайт откроется в браузере.
3. Чтобы сайт был доступен всем, загрузи содержимое архива на хостинг, например на GitHub Pages или Netlify.""",
}


def service_key():
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if key:
        return key
    result = subprocess.run([str(CLI), 'projects', 'api-keys', '--project-ref', PROJECT_REF, '-o', 'json'],
                            capture_output=True, text=True)
    if result.returncode:
        raise SystemExit('Нет ключа Supabase: выполни `~/.local/bin/supabase login`')
    return next(item['api_key'] for item in json.loads(result.stdout) if item.get('name') == 'service_role')


def call(key, path, data=None, headers=None, method=None):
    merged = {'apikey': key, 'Authorization': f'Bearer {key}', **(headers or {})}
    req = urllib.request.Request(f'{SUPABASE_URL}{path}', data, merged, method=method)
    try:
        with urllib.request.urlopen(req, timeout=600) as response:
            return response.read()
    except urllib.error.HTTPError as failure:
        raise SystemExit(f'Supabase ответил {failure.code}: {failure.read().decode(errors="replace")[:300]}')


def get_job(key, job_id):
    rows = json.loads(call(key, f'/rest/v1/jobs?id=eq.{job_id}&select=id,user_id,status,formats'))
    if not rows:
        raise SystemExit('Заказ не найден')
    return rows[0]


def update_job(key, job_id, fields):
    call(key, f'/rest/v1/jobs?id=eq.{job_id}', json.dumps({**fields, 'updated_at': 'now()'}).encode(),
         {'Content-Type': 'application/json'}, 'PATCH')


def upload(key, path, body, content_type):
    quoted = urllib.parse.quote(path, safe='/')
    call(key, f'/storage/v1/object/games/{quoted}', body, {'Content-Type': content_type, 'x-upsert': 'true'}, 'POST')


def file_name(title, job_id, format_name):
    slug = re.sub(r'[^A-Za-z0-9]+', '-', title or '').strip('-')[:40]
    return f'{slug or "Game"}-{job_id[:8]}.{format_name}'


def how_to_run(title, rules, format_name, name):
    steps = STEPS[format_name].format(name=name)
    if format_name == 'zip':
        notes = f'\n\nО САЙТЕ\n{rules}' if rules else ''
        return f"{title or 'Твой сайт'}\n\n{steps}{notes}\n\nСайт сделан на Freasy Makes: https://baldykovtema.github.io/Freasy-Makes/\n"
    return f"{title or 'Твоя игра'}\n\n{steps}\n\nКАК ИГРАТЬ\n{rules or 'Подсказки есть в самой игре.'}\n\nИгра сделана на Freasy Makes: https://baldykovtema.github.io/Freasy-Makes/\n"


def main():
    parser = argparse.ArgumentParser(description='Выдать заказчику готовую игру')
    parser.add_argument('job_id')
    parser.add_argument('files', nargs='*', type=Path)
    parser.add_argument('--title', default='')
    parser.add_argument('--rules', default='', help='Как играть или что на сайте, попадёт в инструкцию')
    parser.add_argument('--refuse', help='Отказать в заказе с этой причиной')
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f-]{36}', args.job_id):
        raise SystemExit('Неверный номер заказа')

    key = service_key()
    job = get_job(key, args.job_id)
    if job['status'] != 'queued':
        raise SystemExit(f"Заказ в статусе {job['status']}, выдавать можно только оплаченный заказ в очереди")
    if args.refuse:
        update_job(key, job['id'], {'status': 'failed', 'error': args.refuse})
        print('Заказ отклонён')
        return

    by_format = {path.suffix.lstrip('.').lower(): path for path in args.files}
    if set(by_format) != set(job['formats']):
        raise SystemExit(f"Нужны файлы форматов: {', '.join(job['formats'])}")
    for path in by_format.values():
        if path.stat().st_size > MAX_FILE_BYTES:
            raise SystemExit(f'{path.name} больше 50 МБ: это предел файла в Supabase')

    artifacts = []
    for format_name, path in by_format.items():
        name = file_name(args.title, job['id'], format_name)
        prefix = f"{job['user_id']}/{job['id']}/{format_name}"
        # Ключи в Storage только латиницей, русское имя инструкция получает при скачивании на сайте.
        upload(key, f'{prefix}/how-to-run.txt', how_to_run(args.title, args.rules, format_name, name).encode(), 'text/plain; charset=utf-8')
        upload(key, f'{prefix}/{name}', path.read_bytes(), CONTENT_TYPES[format_name])
        artifacts.append({'format': format_name, 'file': f'{prefix}/{name}', 'file_name': name, 'guide': f'{prefix}/how-to-run.txt'})

    update_job(key, job['id'], {'status': 'done', 'title': args.title[:80] or None, 'how_to_play': args.rules[:2000] or None, 'artifacts': artifacts})
    print('Готово: файл и инструкция появились у заказчика в разделе «Мои заказы»')


if __name__ == '__main__':
    main()
