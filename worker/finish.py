"""Последний этап: заказ готов, только если у каждого формата есть и игра, и инструкция."""
from common import folder, get_job, list_folder, patch_job


def main():
    job = get_job()
    if job['status'] in ('done', 'failed'):
        return
    artifacts = []
    for format_name in job['formats']:
        prefix = f'{folder(job)}/{format_name}'
        names = list_folder('games', prefix)
        game = next((name for name in names if name.endswith(f'.{format_name}')), None)
        if not game or 'how-to-run.txt' not in names:
            patch_job(status='failed', error='Не удалось собрать игру')
            return
        artifacts.append({
            'format': format_name,
            'file': f'{prefix}/{game}',
            'file_name': game,
            'guide': f'{prefix}/how-to-run.txt',
        })
    patch_job(status='done', artifacts=artifacts)


if __name__ == '__main__':
    main()
