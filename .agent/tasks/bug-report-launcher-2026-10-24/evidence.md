# Evidence: быстрый репорт о проблеме («жучок»)

Проверка на локальной базе (PostgreSQL 16, `next dev`), Playwright Chromium:
ПК 1440×900 и iPhone 13. Скрипты: `raw/e2e.js`, `raw/timing.js`.

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 | PASS | `src/app/(dashboard)/layout.tsx` монтирует `BugReportLauncher` для всех авторизованных; ярлык `fixed right-0 top-[58%]`, `print:hidden`, `aria-label`, портал в `document.body`. Скрины `raw/*-1-page-with-tab.png` (ярлык у правого края). |
| AC2 | PASS | `raw/desktop-captured.jpg`, `raw/mobile-captured.jpg` — снимок видимой области после прокрутки: липкие шапка и сайдбар на месте, ярлыка в снимке нет. Превью «Скриншот страницы» с кнопкой «Убрать скриншот» — `raw/*-2-form.png`. При ошибке снимка/загрузки — подсказка «прикрепите файл вручную». Время снимка (dev): ~2–3 с на обоих экранах (до оптимизации было 29 с на телефоне). |
| AC3 | PASS | ПК — окно (`raw/desktop-2-form.png`), телефон — лист снизу (`raw/mobile-2-form.png`). |
| AC4 | PASS | e2e прикрепляет `extra.txt` через кнопку-скрепку (чип в форме), текст вводится; кнопка заблокирована, пока текст < 3 символов или идёт загрузка. Ctrl+V — `useAttachmentUploads.handlePaste` на поле. |
| AC5 | PASS | e2e: `POST /api/feedback` 200, `pageUrl` = `http://localhost:3000/journals`; колонка `FeedbackReport.pageUrl` в INSERT; страница в письме админу и Telegram (`raw/email-dev-log.txt`, `raw/telegram-log.txt`). Хост клиента отбрасывается — `normalizeReportPagePath` + тесты. |
| AC6 | PASS | Ответ `{"ok":true,"ticket":"9X2JR7","emailed":true}`; письмо автору «Обращение 9X2JR7 принято — WeSetup» (`raw/email-dev-log.txt`); тост «Обращение 9X2JR7 принято…» (`raw/mobile-3-after-submit.png`). |
| AC7 | PASS | `raw/telegram-log.txt`: текст с тикетом → `sendPhoto` скриншота с подписью (тикет, текст, страница) → `sendDocument` прочих файлов. Статус failed только из-за фиктивного токена бота в тесте (401). Лимит подписи 1024 — unit-тест. |
| AC8 | PASS | Ключи `bugReport`, `email.feedbackReceived`, `email.feedbackAdmin.pageLabel/ticketLabel` в ru/en/uz; `npm run i18n:check` — pass 95 / fail 0. |
| AC9 | PASS | `npm run typecheck` exit 0; `npm run test:gate` pass=4709 fail=0; `src/lib/bug-report.test.ts` (5 тестов). ESLint по изменённым файлам чистый. |

Не проверено вживую: реальная доставка SMTP и Telegram (в окружении нет ключей) — проверены
содержимое писем/сообщений и вызовы API (`sendPhoto`/`sendDocument`).
