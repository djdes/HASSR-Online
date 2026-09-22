# Локальное тестирование Telegram-бота и мини-аппа

> Автоматически создано 2026-04-22. Этот файл описывает, как тестировать бота и мини-апп на локалке без пуша в прод.

## Текущее состояние туннелей

| Сервис | URL | Статус |
|--------|-----|--------|
| Localtunnel (WebApp) | `https://empty-keys-flow.loca.lt` | ✅ Работает |
| Dev-сервер (локально) | `http://localhost:3000` | ✅ Работает |
| Telegram webhook | — | ❌ Не устанавливается (см. ниже) |

---

## Архитектура

```
┌─────────────┐      HTTPS       ┌──────────────────┐      HTTP      ┌─────────────┐
│  Telegram   │ ───────────────► │  Localtunnel     │ ─────────────► │  localhost  │
│  (пользователь)│                │  (loca.lt)       │                │  :3000      │
└─────────────┘                  └──────────────────┘                └─────────────┘
                                        ▲
                                        │
                                   WebApp URL:
                    https://fuzzy-ads-poke.loca.lt/mini
```

### Ключевые файлы
- `src/app/mini/page.tsx` — страница мини-аппа
- `src/lib/bot/bot-app.ts` — Grammy bot singleton (webhook)
- `src/lib/bot/handlers/start.ts` — обработчик `/start`, отдаёт кнопку WebApp
- `src/app/api/telegram/webhook/route.ts` — webhook endpoint (`POST /api/telegram/webhook`)
- `scripts/bot-polling-local.ts` — скрипт для локального polling (если webhook не работает)
- `.env.local` — переопределения для локального тестирования

### Env-переменные
```
TELEGRAM_BOT_TOKEN=<токен из @BotFather, только в .env>
TELEGRAM_WEBHOOK_SECRET=<случайная строка, только в .env>
MINI_APP_BASE_URL=https://fuzzy-ads-poke.loca.lt/mini   # <-- задаётся в .env.local
NEXTAUTH_URL=http://localhost:3000
```

---

## Быстрый старт для тестирования

### 1. Убедись, что dev-сервер запущен
```powershell
npm run dev
# Должен быть на http://localhost:3000
```

### 2. Запусти туннель (если не запущен)
```powershell
# Вариант A: localtunnel (уже установлен глобально)
npx localtunnel --port 3000
# Выдаст URL: https://something.loca.lt

# Вариант B: cloudflared (если localtunnel не стабилен)
.\cloudflared.exe tunnel --url http://localhost:3000
# Выдаст URL: https://something.trycloudflare.com
```

### 3. Обнови `.env.local`
```env
MINI_APP_BASE_URL=https://empty-keys-flow.loca.lt/mini
NEXTAUTH_URL=http://localhost:3000
```

Перезапусти dev-сервер (`Ctrl+C` → `npm run dev`).

### 4. Пройди капчу localtunnel (один раз за сессию)
Открой туннельный URL в браузере: `https://<твой-туннель>.loca.lt`
Localtunnel покажет страницу с кнопкой — нажми её, чтобы активировать туннель.

### 5. Открой мини-апп в Telegram
Есть два способа:

**Способ A — через бота (если webhook/polling работает):**
Напиши боту `/start` → он пришлёт кнопку «Открыть» → жми.

**Способ B — напрямую через WebApp URL (если бот не настроен):**
В Telegram открой `@botfather` → выбери своего бота → `Menu button` → `Configure menu button` → вставь URL `https://<твой-туннель>.loca.lt/mini`. Теперь внизу чата с ботом будет кнопка меню.

---

## 🔴 Диагноз: почему webhook и polling не работают локально

### Проблема 1: Продакшен бот блокирует всё

`scripts/telegram-poller.ts` — это long-polling daemon, который крутится на продакшене через **PM2** (`haccp-telegram-poller`). Он постоянно держит `getUpdates` открытым.

**Проверка:**
```powershell
$token = $env:TELEGRAM_BOT_TOKEN  # из .env, в репозиторий не класть
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getUpdates?offset=-1&limit=1&timeout=5"
# Вернёт: 409 Conflict: terminated by other getUpdates request
```

Это значит, что пока продакшен бот жив:
- ❌ Локальный polling запустить **нельзя** (409 Conflict)
- ❌ Webhook установить **нельзя** (setWebhook возвращает ok:true, но Telegram не применяет его, пока активен polling)

### Проблема 2: Webhook "не приживается"

Даже после `logOut` + `deleteWebhook` + `setWebhook` — `getWebhookInfo` показывает `"url":""`.

Возможные причины:
1. **Telegram API rate limit** — мы сделали ~20 вызовов setWebhook за 10 минут. Лимит: ~1 раз в минуту. Нужно подождать 10-15 минут между попытками.
2. **Рассинхронизация edge-серверов** — webhook установился на одном edge, но `getWebhookInfo` читает с другого.
3. **Бот "застрял" в состоянии polling** — продакшен poller постоянно переподключается, и webhook не успевает активироваться.

---

## ✅ Решения

### Решение A: Тестировать мини-апп без бота (рекомендуется)

Просто открой мини-апп напрямую через Telegram, минуя бота:

1. Напиши `@BotFather`
2. Выбери своего бота → `Menu button` → `Configure menu button`
3. Вставь URL: `https://dark-lies-roll.loca.lt/mini`
4. В чате с ботом появится кнопка меню внизу — жми её

**Плюсы:** не нужно трогать продакшен бота.
**Минусы:** не протестируешь `/start` и кнопку WebApp из сообщения бота.

### Решение B: Временно остановить продакшен бота

Если нужно протестировать `/start` и полный флоу:

```powershell
# На продакшен сервере (через SSH):
pm2 stop haccp-telegram-poller

# Локально запусти polling:
npx tsx scripts/bot-polling-local.ts

# Тестируй...

# После тестирования на продакшене:
pm2 start haccp-telegram-poller
```

### Решение C: Дождаться, когда rate limit сбросится, и установить webhook

Если продакшен бот временно упадёт/остановится:

```powershell
$token = $env:TELEGRAM_BOT_TOKEN  # из .env, в репозиторий не класть
$webhookUrl = "https://dark-lies-roll.loca.lt/api/telegram/webhook"
$secret = "haccp-telegram-webhook-2026"

# Подожди 10-15 минут после последнего setWebhook!
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/setWebhook?url=$webhookUrl&secret_token=$secret"

# Проверь:
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getWebhookInfo"
# Должно показать: url: "https://dark-lies-roll.loca.lt/api/telegram/webhook"
```

---

## 🧹 После тестирования (обязательно!)

1. **Удали `.env.local`** — чтобы не мешал продакшену:
   ```powershell
   Remove-Item .env.local
   ```

2. **Удали webhook** (если устанавливал):
   ```powershell
   $token = $env:TELEGRAM_BOT_TOKEN  # из .env, в репозиторий не класть
   Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/deleteWebhook" -Method Post
   ```

3. **Останови туннель** — `Ctrl+C` в окне с localtunnel/cloudflared.

4. **Останови polling-скрипт** — `Ctrl+C` в окне с ботом.

5. **Перезапусти продакшен бота** (если останавливал):
   ```powershell
   pm2 start haccp-telegram-poller
   ```

---

## После тестирования (обязательно!)

1. **Удали `.env.local`** — чтобы не мешал продакшену:
   ```powershell
   Remove-Item .env.local
   ```

2. **Удали webhook** (если устанавливал):
   ```powershell
   $token = $env:TELEGRAM_BOT_TOKEN  # из .env, в репозиторий не класть
   Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/deleteWebhook" -Method Post
   ```

3. **Останови туннель** — `Ctrl+C` в окне с localtunnel/cloudflared.

4. **Останови polling-скрипт** — `Ctrl+C` в окне с ботом.

---

## Полезные команды PowerShell

```powershell
# Проверить, что dev-сервер отвечает
Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing

# Проверить, что туннель отвечает
Invoke-WebRequest -Uri "https://fuzzy-ads-poke.loca.lt" -UseBasicParsing

# Установить webhook
$token = $env:TELEGRAM_BOT_TOKEN  # из .env, в репозиторий не класть
$webhookUrl = "https://<твой-туннель>.loca.lt/api/telegram/webhook"
$secret = "haccp-telegram-webhook-2026"
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/setWebhook?url=$webhookUrl&secret_token=$secret"

# Проверить webhook info
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getWebhookInfo"

# Найти процессы бота
Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like "*bot*" }

# Убить localtunnel
Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like "*localtunnel*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```
