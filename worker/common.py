"""Доступ к Supabase из GitHub Actions. Репозиторий публичный, логи тоже: промты и email не печатаем."""
import json
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORK = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'freasy'
MAX_FILE_BYTES = 50 * 1024 * 1024


def env(name):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f'Не задана переменная {name}')
    return value


def request(url, data=None, headers=None, method=None, timeout=120):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()


def supabase(path, data=None, headers=None, method=None):
    key = env('SUPABASE_SERVICE_ROLE_KEY')
    merged = {'apikey': key, 'Authorization': f'Bearer {key}', **(headers or {})}
    return request(f"{env('SUPABASE_URL')}{path}", data, merged, method)


def job_id():
    value = env('JOB_ID')
    if not re.fullmatch(r'[0-9a-f-]{36}', value):
        raise SystemExit('Неверный id заказа')
    return value


def get_job():
    rows = json.loads(supabase(f'/rest/v1/jobs?id=eq.{job_id()}&select=*'))
    if not rows:
        raise SystemExit('Заказ не найден')
    return rows[0]


def patch_job(**fields):
    fields['updated_at'] = 'now()'
    supabase(f'/rest/v1/jobs?id=eq.{job_id()}', json.dumps(fields).encode(),
             {'Content-Type': 'application/json'}, 'PATCH')


def storage_path(path):
    return urllib.parse.quote(path, safe='/')


def download(bucket, path, target):
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    Path(target).write_bytes(supabase(f'/storage/v1/object/{bucket}/{storage_path(path)}'))


def upload(bucket, path, source, content_type):
    supabase(f'/storage/v1/object/{bucket}/{storage_path(path)}', Path(source).read_bytes(),
             {'Content-Type': content_type, 'x-upsert': 'true'}, 'POST')


def list_folder(bucket, prefix):
    body = json.dumps({'prefix': prefix, 'limit': 100}).encode()
    return [item['name'] for item in json.loads(supabase(f'/storage/v1/object/list/{bucket}', body, {'Content-Type': 'application/json'}, 'POST'))]


def folder(job):
    return f"{job['user_id']}/{job['id']}"
