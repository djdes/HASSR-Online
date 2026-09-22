# Telegram-бот на wesetup.ru — как запустить

## Что сейчас работает

- ✅ Бот зарегистрирован: [@wesetupbot](https://t.me/wesetupbot), токен в `.env`
- ✅ Webhook endpoint живёт на https://wesetup.ru/api/notifications/telegram
- ✅ Deep-link flow (страница `/settings/notifications` → кнопка «Привязать»)
- ✅ `sendTelegramMessage` с ретраем на 429 и логированием в `TelegramLog`
- ✅ Триггеры: ACL grant, compliance digest (cron), expiry digest (cron)
- ✅ Админ-логи `/root/telegram-logs`
- ❌ **Сервер (РФ) не может достучаться до api.telegram.org** — RKN блокирует

Вся логика готова, остался один шаг — пустить исходящий трафик через прокси.

## Шаг 1 — Cloudflare Worker (3 минуты, бесплатно)

1. Заведи аккаунт https://dash.cloudflare.com/sign-up (если нет)
2. Слева выбери **Workers & Pages** → **Create** → **Create Worker**
3. Назови воркер, например `wesetup-tg`
4. В редактор вставь:
   ```javascript
   export default {
     async fetch(request) {
       const url = new URL(request.url);
       url.protocol = "https:";
       url.hostname = "api.telegram.org";
       url.port = "";
       return fetch(url.toString(), {
         method: request.method,
         headers: request.headers,
         body: request.body,
       });
     },
   };
   ```
5. **Deploy** → скопируй URL (будет вида `https://wesetup-tg.ИМЯ.workers.dev`)
6. Проверь, что работает: открой `https://wesetup-tg.ИМЯ.workers.dev/bot<TOKEN>/getMe` — должен вернуть JSON с описанием бота

## Шаг 2 — пропиши URL в прод `.env`

Подключись по SSH и добавь одну строку:

```bash
ssh wesetupru@wesetup.ru
cd /var/www/wesetupru/data/www/wesetup.ru/app
echo 'TELEGRAM_API_ROOT=https://wesetup-tg.ТВОЁ_ИМЯ.workers.dev' >> .env
pm2 restart haccp-online --update-env
```

Или пришли мне URL воркера — пропишу сам за 30 секунд.

## Шаг 3 — зарегистрировать webhook на Telegram

Из любого места с выходом в интернет (свой ноут / телефон / Cloudflare Worker):

```bash
# прямо с сервера через прокси уже доступно:
curl "https://wesetup-tg.ТВОЁ_ИМЯ.workers.dev/bot<TOKEN>/setWebhook?url=https://wesetup.ru/api/notifications/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

`<TOKEN>` = значение `TELEGRAM_BOT_TOKEN` из .env.
`<TELEGRAM_WEBHOOK_SECRET>` — значение из .env (в репозиторий не класть).

Ответ должен быть `{"ok":true,"result":true,"description":"Webhook was set"}`.

## Шаг 4 — проверить вживую

1. Зайди на https://wesetup.ru/login как обычный сотрудник (или создай компанию через /register)
2. Открой https://wesetup.ru/settings/notifications
3. Клик **«Привязать Telegram»** → откроется @wesetupbot с командой `/start <токен>`
4. Нажми **Start** в Telegram → бот ответит «Аккаунт привязан»
5. Теперь любой триггер шлёт уведомление:
   - Owner заходит на `/settings/users/<твой_id>/access` → отмечает журнал → **Сохранить** → в Telegram приходит «Вам назначены журналы: ...»

## Как это будет выглядеть для реального сотрудника

1. Owner в `/settings/users` нажимает **«Пригласить»** (без пароля)
2. Сотруднику на email приходит ссылка `https://wesetup.ru/invite/<токен>`
3. Клик → страница с полем «Пароль» → ставит → автоматически входит
4. В хедере кнопка «Уведомления» → `/settings/notifications`
5. Кнопка **«Привязать Telegram»** → открывается бот → Start → готово
6. Owner назначает журналы → сотрудник получает в Telegram:
   > 🔔 Вам назначены журналы:
   > • Гигиенический журнал
   > • Бланк контроля температуры и влажности

## Troubleshooting

| Проблема | Что смотреть |
|----------|--------------|
| Worker вернул 404 на /bot.../getMe | Проверь URL воркера, токен, что код воркера корректен |
| setWebhook вернул { "ok": false } | Проверь что `secret_token` совпадает с TELEGRAM_WEBHOOK_SECRET в .env |
| `/start <токен>` отвечает «Токен истёк» | Link-token действует 15 мин; сгенерируй новый в `/settings/notifications` |
| Уведомление не приходит | `/root/telegram-logs` — там строка с `status=failed` покажет ошибку |

## Альтернативы Cloudflare Worker

- **Собственный VPS вне РФ** — каpaster/caddy с reverse_proxy на api.telegram.org
- **Render / fly.io / Railway** — любой PaaS вне РФ с 5-строчным node-proxy
- **Уже готовый публичный gateway** (не рекомендую — утечка токена): https://github.com/GrammyJS/proxy

Cloudflare Worker — самый простой и бесплатный (100k запросов/день хватит с запасом).
