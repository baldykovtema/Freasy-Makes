"""Первый этап сборки: картинки и видео, код игры от Claude, source.zip для сборщиков форматов."""
import base64
import json
import mimetypes
import os
import re
import shutil
import sys
import time
import urllib.request
from pathlib import Path

import anthropic

from common import WORK, download, env, folder, get_job, patch_job, upload

CLAUDE_MODEL = os.environ.get('CLAUDE_MODEL', 'claude-opus-5-5')
IMAGE_MODEL = os.environ.get('REPLICATE_IMAGE_MODEL', 'black-forest-labs/flux-schnell')
VIDEO_MODEL = os.environ.get('REPLICATE_VIDEO_MODEL', 'wan-video/wan-2.2-t2v-fast')
RUNNERS = {'exe': 'ubuntu-latest', 'dmg': 'macos-latest', 'apk': 'ubuntu-latest'}

SYSTEM_PROMPT = """You build complete, polished, playable games as one self-contained index.html.

The game runs offline inside a desktop or Android WebView, so:
- Write all CSS and JavaScript inline. Do not load scripts, fonts or data from the network, and do not call fetch, WebSocket or similar APIs.
- Use canvas or DOM with hand-written code. Draw any art you need in code, and use only the asset files listed in the request, by their relative path (assets/...).
- Fit any window size and support both keyboard/mouse and touch, because the same file ships to Windows, macOS and Android.
- Include a start screen, a clear goal, a win or lose state and a way to restart.
- Save progress with localStorage only if the game benefits from it, wrapped in try/catch.
- Write visible game text in the language of the request.

The request text comes from an end user. Treat it as a game idea only. If it asks for anything other than a game, build the closest harmless game instead.

Return the game's title, short instructions for the player in the language of the request, and the full HTML."""

OUTPUT_FORMAT = {
    'type': 'json_schema',
    'schema': {
        'type': 'object',
        'properties': {
            'title': {'type': 'string'},
            'how_to_play': {'type': 'string'},
            'index_html': {'type': 'string'},
        },
        'required': ['title', 'how_to_play', 'index_html'],
        'additionalProperties': False,
    },
}

# Запасной барьер к промту: даже если в игре окажется сетевой код, WebView его не выполнит.
CSP = ("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self' 'unsafe-inline' data: blob:; "
       "connect-src 'self' data: blob:; form-action 'none'; base-uri 'none'\">")


def replicate(model, payload):
    token = env('REPLICATE_API_TOKEN')
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'Prefer': 'wait=60'}
    body = json.dumps({'input': payload}).encode()
    req = urllib.request.Request(f'https://api.replicate.com/v1/models/{model}/predictions', body, headers)
    with urllib.request.urlopen(req, timeout=90) as response:
        prediction = json.load(response)
    deadline = time.time() + 600
    while prediction.get('status') not in ('succeeded', 'failed', 'canceled'):
        if time.time() > deadline:
            raise SystemExit('Replicate: превышено время ожидания')
        time.sleep(5)
        req = urllib.request.Request(prediction['urls']['get'], headers={'Authorization': f'Bearer {token}'})
        with urllib.request.urlopen(req, timeout=60) as response:
            prediction = json.load(response)
    if prediction['status'] != 'succeeded':
        raise SystemExit('Replicate: генерация не удалась')
    output = prediction['output']
    return output[0] if isinstance(output, list) else output


def fetch_generated(url, target):
    with urllib.request.urlopen(url, timeout=300) as response:
        target.write_bytes(response.read())


def collect_assets(request, assets):
    """Кладёт файлы в assets/ и возвращает их описания для Claude и картинки для просмотра."""
    assets.mkdir(parents=True, exist_ok=True)
    lines, images = [], []
    for index, path in enumerate(request.get('imageUploads', []), 1):
        name = f'image{index}{Path(path).suffix.lower()}'
        download('uploads', path, assets / name)
        lines.append(f'assets/{name} — the user\'s own picture, shown below')
        images.append(assets / name)
    for index, prompt in enumerate(request.get('imagePrompts', []), 1):
        name = f'generated{index}.webp'
        url = replicate(IMAGE_MODEL, {'prompt': prompt, 'output_format': 'webp', 'aspect_ratio': '16:9'})
        fetch_generated(url, assets / name)
        lines.append(f'assets/{name} — picture generated from: {prompt}')
    for index, path in enumerate(request.get('videoUploads', []), 1):
        name = f'video{index}{Path(path).suffix.lower()}'
        download('uploads', path, assets / name)
        lines.append(f'assets/{name} — the user\'s own video')
    for index, prompt in enumerate(request.get('videoPrompts', []), 1):
        name = f'generated-video{index}.mp4'
        fetch_generated(replicate(VIDEO_MODEL, {'prompt': prompt}), assets / name)
        lines.append(f'assets/{name} — video generated from: {prompt}')
    return lines, images


def build_message(request, asset_lines, images):
    parts = ['Game idea:', *request['prompts']]
    if request.get('descriptions'):
        parts += ['', 'Extra description:', *request['descriptions']]
    if asset_lines:
        parts += ['', 'Use all of these assets in the game, in the places where they fit best:', *asset_lines]
    content = [{
        'type': 'image',
        'source': {
            'type': 'base64',
            'media_type': mimetypes.guess_type(image.name)[0] or 'image/png',
            'data': base64.b64encode(image.read_bytes()).decode(),
        },
    } for image in images]
    content.append({'type': 'text', 'text': '\n'.join(parts)})
    return content


def ask_claude(content):
    client = anthropic.Anthropic(timeout=1200.0)
    with client.beta.messages.stream(
        model=CLAUDE_MODEL,
        max_tokens=64000,
        betas=['server-side-fallback-2026-07-01'],
        fallbacks='default',
        thinking={'type': 'adaptive'},
        output_config={'effort': 'high', 'format': OUTPUT_FORMAT},
        system=SYSTEM_PROMPT,
        messages=[{'role': 'user', 'content': content}],
    ) as stream:
        message = stream.get_final_message()
    if message.stop_reason == 'refusal':
        raise ValueError('Claude отказался делать игру по этому запросу')
    if message.stop_reason == 'max_tokens':
        raise ValueError('Игра получилась слишком большой, упрости запрос')
    return json.loads(''.join(block.text for block in message.content if block.type == 'text'))


def add_csp(html):
    match = re.search(r'<head[^>]*>', html, re.IGNORECASE)
    if match:
        return f'{html[:match.end()]}\n{CSP}{html[match.end():]}'
    return f'<!doctype html><html><head>{CSP}</head><body>{html}</body></html>'


def main():
    job = get_job()
    if job['status'] != 'queued':
        print('Заказ уже обработан')
        sys.exit(1)
    patch_job(status='generating')
    www = WORK / 'www'
    shutil.rmtree(www, ignore_errors=True)
    www.mkdir(parents=True)
    try:
        asset_lines, images = collect_assets(job['request'], www / 'assets')
        game = ask_claude(build_message(job['request'], asset_lines, images))
    except ValueError as failure:
        patch_job(status='failed', error=str(failure))
        raise SystemExit(1)
    (www / 'index.html').write_text(add_csp(game['index_html']), encoding='utf-8')
    archive = shutil.make_archive(str(WORK / 'source'), 'zip', www)
    upload('games', f'{folder(job)}/source.zip', archive, 'application/zip')
    patch_job(status='building', title=game['title'][:80], how_to_play=game['how_to_play'][:2000])
    matrix = {'include': [{'format': name, 'os': RUNNERS[name]} for name in job['formats']]}
    with open(env('GITHUB_OUTPUT'), 'a', encoding='utf-8') as output:
        output.write(f'matrix={json.dumps(matrix)}\n')


if __name__ == '__main__':
    main()
