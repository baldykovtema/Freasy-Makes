# Freasy Makes

Сайт, где человек описывает игру, а Claude делает её и отдаёт файл `.exe`, `.dmg` или `.apk` вместе с инструкцией по запуску.

Адрес: https://baldykovtema.github.io/Freasy-Makes/

## Как устроено

- **Сайт** (`index.html`, `app.js`, `api.js`, `currency.js`, `styles.css`) работает на GitHub Pages.
- **Supabase** отвечает за аккаунты, заказы и хранение файлов. Функция `create-job` проверяет заказ и запускает сборку или оплату, `payment-webhook` принимает оплату от Lemon Squeezy.
- **GitHub Actions** (`.github/workflows/build-game.yml`, папка `worker/`) делает картинки и видео через Replicate, игру через Claude, собирает файлы и кладёт их в Supabase.
- Лимиты и цены планов лежат в одном файле: `supabase/functions/_shared/plans.js`.

## Что настроить

Все команды запускаются из папки проекта.

### 1. Supabase

1. Создай проект на [supabase.com](https://supabase.com).
2. В **SQL Editor** выполни `supabase/migrations/0001_init.sql`.
3. В **Authentication → URL Configuration** укажи Site URL `https://baldykovtema.github.io/Freasy-Makes/`.
4. Впиши Project URL и anon key в `config.js`.

### 2. Ключи сервисов

| Сервис | Что получить |
| --- | --- |
| [Anthropic Console](https://console.anthropic.com) | API-ключ `ANTHROPIC_API_KEY` |
| [Replicate](https://replicate.com) | токен `REPLICATE_API_TOKEN` |
| [Lemon Squeezy](https://lemonsqueezy.com) | API-ключ, Store ID, Variant ID любого товара, секрет вебхука |
| GitHub | fine-grained токен на репозиторий Freasy-Makes с правом **Contents: Read and write** |

В Lemon Squeezy создай вебхук на `https://<проект>.supabase.co/functions/v1/payment-webhook` с событием `order_created`.

### 3. Функции Supabase

```bash
brew install supabase/tap/supabase
```

```bash
supabase login
```

```bash
supabase link --project-ref <id-проекта>
```

```bash
supabase functions deploy create-job
```

```bash
supabase functions deploy payment-webhook --no-verify-jwt
```

```bash
supabase secrets set GITHUB_REPO=baldykovtema/Freasy-Makes GITHUB_DISPATCH_TOKEN=... LEMONSQUEEZY_API_KEY=... LEMONSQUEEZY_STORE_ID=... LEMONSQUEEZY_VARIANT_ID=... LEMONSQUEEZY_WEBHOOK_SECRET=...
```

### 4. Секреты GitHub

В **Settings → Secrets and variables → Actions** добавь `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` и `REPLICATE_API_TOKEN`.

## Важно

- Репозиторий публичный, поэтому логи Actions видны всем. `worker/` печатает только id заказа, промты в логи не попадают.
- Не вставляй `service_role` и другие секреты в `config.js`: этот файл публичный.
- Файлы игр не удаляются сами, а бесплатный Supabase хранит 1 ГБ.
