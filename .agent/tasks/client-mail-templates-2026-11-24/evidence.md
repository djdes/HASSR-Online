# Evidence — client-mail-templates-2026-11-24

Ветка `claude/quirky-allen-cx37we`, база — `origin/master` 362b3ebf2.

## AC1. Вложения в «Письмах клиенту»
- `src/components/root/client-emails.tsx`: кнопка «Выбрать файлы» и перетаскивание, проверка `mailAttachmentError` (те же правила, что раздел «Письма»), список с удалением, multipart `content` + `files` при отправке.
- `src/app/api/root/organizations/[id]/emails/route.ts`: `readMailRequest` (JSON и multipart), ошибки `MailAttachmentError` → 400/413, `sendClientEmail(..., attachments)`.
- Тест `src/lib/client-email-routes.test.ts`: multipart с `КП.pdf` доходит до отправки (`КП.pdf:3`), `run.exe` → 400; прежние проверки guard/404/400/409/аудит/идемпотентность зелёные.
- Живая проверка (локальная БД, Playwright): письмо по шаблону «Тарифы» с `Тарифы.pdf` → строка `ClientEmail` и строка журнала с `attachmentsJson=[{"filename":"Тарифы.pdf","size":13,...}]` (SMTP примера недоступен — статус failed, как и ожидается). Скриншот `raw/compose-template-attachment.png`.

## AC2. Шаблоны
- 17 шаблонов в 4 группах: `src/lib/client-email-templates.ts`, тексты `rootOrganizationManagement.mail.templates` в ru/en/uz.
- Цены — с сервера: `src/lib/client-email-templates.server.ts` (`readPlanPricing`, `readServices`, видео и PDF через `narratedVideoFor` / `presentationPdfFor`).
- Тест `src/lib/client-email-templates.test.ts`: каждый шаблон на ru/en/uz собирается без `{…}`, с обращением по имени, тема в одну строку; ссылки на `presentation-extended-ru.mp4` и `wesetup-presentation.pdf`; строки тарифов и услуг с текущими ценами; склонение «21 день».
- Живая проверка: шаблон «Тарифы» подставил цены из БД (Стандарт 2 990 / 1 990, Премиум 4 990 / 3 990, ВИП 12 990 / 8 990), обращение «Здравствуйте, Анна Смирнова!». Скриншоты `raw/templates-menu.png`, `raw/compose-template-attachment.png`.

## AC3. Явный предпросмотр
- Окно «Так клиент увидит письмо»: конверт От/Кому/Тема/Вложения, «Компьютер / Телефон», «Изменить», «Отправить письмо»; правка формы сбрасывает предпросмотр (`onChange={edited}`).
- Письмо: ссылки кликабельны, длинные адреса переносятся (`messageHtml`), тест в `client-email-templates.test.ts` (экранирование, `javascript:` не ссылка).
- Скриншоты `raw/preview-desktop.png`, `raw/preview-phone.png` (на телефоне текст переносится, ширина 390 px).

## AC4. Прокрутка в карточке клиента
- `ScrollList` (видимая полоса): лента «Переписки» `max-h-[min(70vh,760px)]`, история писем `max-h-[min(60vh,560px)]`, сотрудники `max-h-[min(65vh,620px)]`; оплаты — `overflow-auto` c `max-h-[min(60vh,560px)]` и закреплённой шапкой таблицы. Фильтры и заголовки — вне прокрутки. Скриншот `raw/conversations-site-mail-scroll.png`.

## AC5. Журнал исходящих писем
- Модель `OutgoingEmail` (`prisma/schema.prisma`, новая таблица + FK на Organization с каскадом — аддитивно, `apply-safe-schema` пропускает).
- Запись: `sendEmail` (общая почта, `logOutgoingEmail`) и `sendStaffEmail` (личная почта; при запасном пути итог пишет общая почта). Перехват и отсутствие SMTP — без записи.
- `sensitive: true` у писем с кодом/паролем/ссылкой входа: подтверждение почты, приглашения (2), пароль после регистрации, смена пароля, сброс пароля, вход по ссылке, личный QR-вход. В остальных — ссылки без query и токенов (`redactOutgoingEmailText`).
- Уборка через 365 дней: `/api/cron/purge-audit-log` (`outgoingEmailDeleted`).
- Тесты: `src/lib/outgoing-email.test.ts` (5), `src/lib/email-outgoing-journal.test.ts` (3: текст + организация + Message-ID, сброс пароля без текста, failed и перехват), `src/lib/client-email.server.test.ts` (+2: личная почта пишет журнал; неудача — failed c Message-ID карточки).

## AC6. «Переписки»
- `loadClientConversations`: + `OutgoingEmail` и `ClientEmail` по организации или почтам людей клиента, + рассылки (`MailingRecipient`, не тестовые), дедупликация по Message-ID (CRM, письма карточки `<client-email-<id>@wesetup.ru>`), фильтр «Письма сайта», «Сайт · автоматически», «Рассылка», вложения, скрытый текст.
- Тест `src/lib/client-conversations.test.ts` (+1): порядок, дубли из журнала скрыты, запросы по организации и почтам.
- Живая проверка на локальной БД: после отправки из карточки «Тарифы WeSetup» в ленте одна запись (`client-email`, с вложением), хотя строки есть и в `ClientEmail`, и в `OutgoingEmail`.

## AC7. Расширенная видеопрезентация на главной
- Отрендерена из `origin/feat/video-extended` (`scripts/landing-video/render.ts`, Remotion 4.0.528): `presentation-extended-ru.mp4` 1920×1080 H.264 + AAC, 115,5 с, 14,85 МБ; постер `.jpg`; субтитры `.vtt`. Кадр `raw/extended-video-frame-75s.jpg`.
- `narrated-video.ts`: у общепита первой идёт `presentation-extended`, затем прежние ролики. Тест `narrated-video.test.ts` (настоящая главная отдаёт расширенную версию с постером и субтитрами, файл < 20 МБ). PDF `wesetup-presentation.pdf` (16 слайдов, «Полная») остаётся рядом.

## AC8. Переводы и проверки
- `npm run i18n:types` — `--check` чистый; `catalog-validation.test.ts` зелёный (ключи и ICU-аргументы совпадают в ru/en/uz).
- `npm run typecheck` — без ошибок.
- `borderless.test.ts`, `one-accent.test.ts`, `neutral-palette.test.ts` — зелёные (сгенерированные CSS пересобраны).
- Полный гейт: см. `evidence.json` / `raw/gate.txt`.
