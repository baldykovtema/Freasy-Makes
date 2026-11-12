# Freasy Makes

Сайт заявок на игры и сайты. Человек заполняет форму, заявка приходит автору на почту, автор делает заказ вручную и выдаёт файл с инструкцией на сайте.

Адрес: https://baldykovtema.github.io/Freasy-Makes/

## Как устроено

- **Сайт** (`index.html`, `app.js`, `api.js`, `currency.js`, `styles.css`) работает на GitHub Pages.
- **Supabase** отвечает за аккаунты, заказы и хранение файлов. Функция `create-job` проверяет заказ, `payment-webhook` принимает оплату от Gumroad.
- **Письма** отправляет Resend: бесплатная заявка уходит сразу, платная после оплаты.
- Лимиты и цены планов лежат в одном файле: `supabase/functions/_shared/plans.js`.

## Заявки

Все заявки видны на странице `#/orders`: ссылка **Заявки** появляется только у аккаунта из таблицы `admins`. Письма остаются уведомлением.

## Как выдать готовую игру

Номер заказа есть на странице заявок и в письме.

```bash
python3 tools/deliver_game.py НОМЕР_ЗАКАЗА игра.exe --title "Название" --rules "Как играть"
```

Файл появится у заказчика в разделе «Мои заказы» вместе с `КАК_ЗАПУСТИТЬ.txt`. Если у заказа два формата, укажи оба файла. Заказ сайта выдаётся архивом `.zip` с `index.html` внутри. Предел одного файла 50 МБ.

Отказать в заказе:

```bash
python3 tools/deliver_game.py НОМЕР_ЗАКАЗА --refuse "Причина"
```

## Что настроить

### 1. Supabase

1. В **SQL Editor** выполни файлы из `supabase/migrations/` по порядку.
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

### 4. Оплата (Gumroad)

Магазин: https://chezyxa.gumroad.com, товары `freasy-makes-pro` и `freasy-makes-max` (адреса товаров записаны в `supabase/functions/_shared/plans.js`, поле `gumroad`). Цену покупатель платит ту, что стоит в Gumroad.

1. Gumroad → Settings → Advanced → **Ping endpoint**: `https://ywqxrbmgmvpbeytxjkpi.supabase.co/functions/v1/payment-webhook`.
2. Там же → Applications → создай приложение → **Generate access token** и сохрани его:

```bash
~/.local/bin/supabase secrets set --project-ref ywqxrbmgmvpbeytxjkpi GUMROAD_ACCESS_TOKEN=...
```

Кнопка «Оплатить» ведёт на товар Gumroad с номером заказа в ссылке (`?job_id=`). После покупки Gumroad присылает Ping, функция перепроверяет покупку через Gumroad API (товар, возвраты) и переводит заказ в «В работе». Одна покупка оплачивает только один заказ. Покупателю после оплаты выдаётся PDF из `gumroad/`.

## Важно

- Не вставляй `service_role` и другие секреты в `config.js`: этот файл публичный.
- Файлы игр не удаляются сами, а бесплатный Supabase хранит 1 ГБ.
