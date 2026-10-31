# Freasy Makes

Сайт заявок на игры. Человек заполняет форму, заявка приходит автору на почту, автор делает игру вручную и выдаёт файл с инструкцией на сайте.

Адрес: https://baldykovtema.github.io/Freasy-Makes/

## Как устроено

- **Сайт** (`index.html`, `app.js`, `api.js`, `currency.js`, `styles.css`) работает на GitHub Pages.
- **Supabase** отвечает за аккаунты, заказы и хранение файлов. Функция `create-job` проверяет заказ, `payment-webhook` принимает оплату от Lemon Squeezy.
- **Письма** отправляет Resend: бесплатная заявка уходит сразу, платная после оплаты.
- Лимиты и цены планов лежат в одном файле: `supabase/functions/_shared/plans.js`.

## Как выдать готовую игру

Номер заказа есть в письме с заявкой.

```bash
python3 tools/deliver_game.py НОМЕР_ЗАКАЗА игра.exe --title "Название" --rules "Как играть"
```

Файл появится у заказчика в разделе «Мои игры» вместе с `КАК_ЗАПУСТИТЬ.txt`. Если у заказа два формата, укажи оба файла. Предел одного файла 50 МБ.

Отказать в заказе:

```bash
python3 tools/deliver_game.py НОМЕР_ЗАКАЗА --refuse "Причина"
```

## Что настроить

### 1. Supabase

1. В **SQL Editor** выполни `supabase/migrations/0001_init.sql`.
2. В **Authentication → URL Configuration** добавь `https://baldykovtema.github.io/Freasy-Makes/` в Redirect URLs. Site URL не меняй: проект общий с PVZ.

Project URL и anon key уже вписаны в `config.js`.

### 2. Письма

Зарегистрируйся на [resend.com](https://resend.com) с той же почтой, куда должны приходить заявки, и создай API-ключ. Без своего домена Resend отправляет письма только на эту почту.

### 3. Функции Supabase

```bash
~/.local/bin/supabase login
```

```bash
~/.local/bin/supabase functions deploy create-job --project-ref ywqxrbmgmvpbeytxjkpi
```

```bash
~/.local/bin/supabase functions deploy payment-webhook --no-verify-jwt --project-ref ywqxrbmgmvpbeytxjkpi
```

```bash
~/.local/bin/supabase secrets set --project-ref ywqxrbmgmvpbeytxjkpi ORDER_EMAIL=... RESEND_API_KEY=...
```

### 4. Оплата

Создай товар в [Lemon Squeezy](https://lemonsqueezy.com) и вебхук на `https://ywqxrbmgmvpbeytxjkpi.supabase.co/functions/v1/payment-webhook` с событием `order_created`. Затем добавь секреты:

```bash
~/.local/bin/supabase secrets set --project-ref ywqxrbmgmvpbeytxjkpi LEMONSQUEEZY_API_KEY=... LEMONSQUEEZY_STORE_ID=... LEMONSQUEEZY_VARIANT_ID=... LEMONSQUEEZY_WEBHOOK_SECRET=...
```

## Важно

- Не вставляй `service_role` и другие секреты в `config.js`: этот файл публичный.
- Файлы игр не удаляются сами, а бесплатный Supabase хранит 1 ГБ.
