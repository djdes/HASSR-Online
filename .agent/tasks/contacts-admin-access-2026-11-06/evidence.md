# Доказательства — контакты с визитки, admin@, оповещение о доступе к панели

Проверено 06.11.2026 в облачной сессии: локальный PostgreSQL 16 (`wesetup_test`, схема `prisma db push`),
`next dev` на порту 3005, Playwright (Chromium). SMTP и Telegram локально не настроены — письмо пишется в лог,
попытка Telegram пишется в `TelegramLog` со статусом `failed`.

| AC | Итог | Как проверено |
|---|---|---|
| AC1 | PASS | `src/lib/company-contacts.ts`; `company-contacts.test.ts`: `CONTACT_PHONE/MOBILE/EMAIL`, `SUPPORT_EMAIL`, `HOME_PHONES`, vCard — один источник. |
| AC2 | PASS | `raw/site-check.json`: подвал `/oferta` — `tel:+74951096543`, `tel:+79253058077`, `mailto:admin@wesetup.ru`; реквизиты `/oferta` и `/privacy` — «Телефоны: +7 (495) 109-65-43, +7 (925) 305-80-77 · admin@wesetup.ru»; `634-16-12` на странице нет. `raw/footer-requisites.png`, `raw/oferta-requisites.png`, `raw/privacy-requisites.png`. |
| AC3 | PASS | `raw/contact-dialog-mobile.png` (390 px, без горизонтальной прокрутки): крупно 495, ниже «+7 (925) 305-80-77 · Мобильный», почта admin@. Главная кабинета (`raw/home-check.txt`): «Телефон +7 (495) 109-65-43», «Мобильный +7 (925) 305-80-77»; у партнёра — его `supportPhone` (код не менялся по смыслу). |
| AC4 | PASS | `grep -rn support@wesetup` по `src public prisma scripts docs/mobile mobile/setup-helper/store docs/partners-30-announcement.md` — только строки-проверки в новом тесте; i18n ru/en/uz, `security.txt`, List-Unsubscribe — admin@ (тест `company-contacts.test.ts`). |
| AC5 | PASS | `platform-access-notice.test.ts`: только новые разделы, тема/тело/Telegram, экранирование; `setPlatformSections` вызывает оповещение, снятие не оповещает (`addedPlatformSections` → []). Письмо — `raw/notice-email.png`, Telegram — `raw/notice-telegram.txt`. Ссылка из письма `/api/me/platform-panel` для alexey ведёт в `/root`, `/api/root/team` (только владелец) — 404 (`raw/panel-link-check.txt`). |
| AC6 | PASS | `raw/seed-run.log`: `--dry-run` ничего не пишет; прогон выдаёт 11 разделов «от Владелец Платформы», письмо на alexey@wesetup.ru, повтор — «already done». `raw/seed-db-state.txt`: `platformSections` = все 11, `platformGrantedById` = владелец, `AuditLog platform.access.grant`, маркер `once:platform-admin:alexey:v1`, `TelegramLog kind=platform.access.granted chatId=100500`. Деплой: шаг после `seed-articles.ts`, `timeout 180 … || echo "[warn] …"`. |
| AC7 | PASS | `raw/typecheck.log` exit 0; `raw/test-gate.log` pass=5752 fail=0; `raw/i18n-check.log` 97/0; `raw/eslint.log` — 0 ошибок (1 старое предупреждение в `billing-transition-gate.tsx:202`, строка не менялась); `raw/targeted-tests.log` 77/0. |

Не проверено здесь: реальная доставка письма и Telegram на проде (нет прод-SMTP/бота в сессии) и наличие
alexey@wesetup.ru в прод-базе — это покажет строка `[platform-admin] …` в логе деплоя.
