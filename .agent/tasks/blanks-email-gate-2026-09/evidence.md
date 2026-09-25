# Evidence — шаблоны журналов после email, копирайт и QR на /qb

Спека: `spec.md` (frozen 2026-09-25). Ветка `feat/blanks-gate-2026-09-25`, своя БД `wesetup_wt_blanks`,
dev-сервер `:3043` (`NEXT_DIST_DIR=.next-e2e`, `NEXTAUTH_URL=http://localhost:3043`), SMTP пуст —
письма только в dev-логе. Итог: **AC1–AC5 — PASS**.

## Что сделано (коротко)

| Часть | Файлы |
|---|---|
| Общие константы/адреса (клиент+сервер): текст галки, копирайт, пути, запомненная почта | `src/lib/blank-download.ts` |
| Подписанная ссылка на файл (HMAC-SHA256, 7 дней, почта+цель+формат) и ответ «без токена» (браузер → 307 на страницу, иначе 403) | `src/lib/blank-download-token.ts` |
| QR-токен `/qb/<токен>`: AES-256-GCM `{почта, журнал, момент}`, компактный base32, влезает в QR 13 мм (≤ 41 модуль) | `src/lib/blank-qr-token.ts` |
| Лимиты: 30/час на адрес, 50/сутки на почту, писем 10/сутки на почту | `src/lib/blank-download-limits.ts` |
| Разбор запроса, каталог целей и форматов | `src/lib/blank-download-targets.ts` |
| `POST /api/public/blank-download` — согласие в LegalConsent, детали в AuditLog, письмо (after), ссылка | `src/app/api/public/blank-download/route.ts` |
| Роуты файлов: inline публично; вложение только по `?t=`; копирайт+QR в PDF/Word | `src/app/api/journal-samples/[code]/pdf|docx/route.ts`, `.../paper/[id]/pdf/route.ts` |
| Бумажный бланк: необязательный QR-штамп тем же механизмом (кабинет без изменений) | `src/lib/paper-journal-pdf.ts` |
| Word: подвал с копирайтом, подписью и QR (повторяется на каждой странице) | `src/lib/document-docx.ts` |
| Письмо со ссылками | `src/lib/email.ts` (`buildBlankDownloadEmail`, `sendBlankDownloadEmail`) |
| Окно «Куда прислать шаблон?» + быстрый путь по запомненной почте | `src/components/public/blank-download.tsx` |
| Кнопки на публичных страницах | `/blanki`, `/journals-info/[code]`, `landing/sample-gallery`, `landing/demo-journal-widget`, `landing/seo-journal-landing` (7 SEO-лендингов) |
| Страница QR | `src/app/qb/[token]/page.tsx` |
| Регистрация: `source=blank` + код журнала → место формы `blank:<код>`, плашка «журнал откроется сразу после регистрации» (подстановка `?email=` и `?next=` уже была) | `src/app/(auth)/register/register-client.tsx` |
| /root: «Скачивания шаблонов» в группе «Деньги и продажи»; из общего Audit log такие записи убраны | `src/app/root/blank-downloads/page.tsx`, `src/components/root/root-nav.tsx`, `src/app/root/audit/page.tsx` |

Кабинет не тронут: `/settings/journals` качает через `/api/settings/journals/paper/<id>/pdf` (как было),
дашборд и `journals-browser` берут только `*.webp`-превью. Схема БД и зависимости не менялись.

## AC1 — скачивание только после email и согласия; встроенный просмотр публичный; прямой URL без токена файл не отдаёт — PASS

E2E (`e2e-blanks.ts`, протокол `raw/e2e.json`, 42/42 PASS; основной журнал сценария — журнал здоровья, см. «Доработка»):
- `/journals-info/health_check` (1440): «PDF» → окно «Куда прислать шаблон?»; без галки — «Отметьте согласие — без него шаблон не отправить», файл не качается; с галкой — файл скачан по `/api/journal-samples/health_check/pdf?t=…` (`evidence/01-journal-modal-1440.png`, `02-journal-done-1440.png`).
- Второй шаблон (Word) — без окна: POST ушёл с той же почтой `{"remembered":true,"consentVersion":"2026-09-22"}`, внизу плашка «…скачивается. Копия — на …» (`03-remembered-notice-1440.png`).
- Окно email через ту же кнопку на `/blanki` (390, `05-blanki-modal-390.png`), в галерее образцов главной и на SEO-лендинге `/zhurnal-zdorovya`.
- Встроенный просмотр: `GET …/health_check/pdf?inline=1` → 200, `Content-Disposition: inline`, `Cache-Control: public, max-age=86400, s-maxage=86400` (кеш не сломан; на `03-…png` виден сам встроенный PDF).
- Прямой URL без токена: не браузер → **403** `{"error":"Шаблон скачивается после ввода email на странице журнала.","page":"/journals-info/health_check?download=pdf"}`; браузер → **307** `Location: /journals-info/health_check?download=docx`; подделанный токен → 403.
- Старая ссылка в браузере (390): `/api/journal-samples/cleaning/pdf` → `/journals-info/cleaning` с уже открытым окном, `?download` убран из адреса (`04-redirect-modal-390.png`). Бумажный бланк `/api/journal-samples/paper/ot_intro/pdf` → `/blanki` с окном этого бланка.
- Юнит: `src/app/api/journal-samples/journal-samples-gate.test.ts` (5 тестов: inline публичный с кешем, 307/403 без токена, вложение по токену `private, no-store`, токен другого журнала/формата не подходит, протухший → `&expired=1`, Word без токена, бумажный бланк).

## AC2 — согласие и скачивание в LegalConsent; лимиты; письмо со ссылками — PASS

- LegalConsent (из БД после e2e, `raw/e2e.json → consents`): 2 записи на почту e2e (PDF и Word), `source: "blank-download"`, `version: "2026-09-22"`, `statementText: "Даю согласие на обработку персональных данных и ознакомлен с политикой конфиденциальности"` (дословно текст галки, ссылки на `/consent` и `/privacy`), `ipAddress`, `userAgent`, `userId: null`.
- Журнал и формат (в LegalConsent полей нет, схему не меняем) — AuditLog платформы: `{"code":"health_check","title":"Журнал здоровья","format":"pdf"|"docx"}`, `entityId` = id согласия.
- Лимиты (e2e через API): адрес `203.0.113.102` — 30×200, 31-й → **429**, `Retry-After: 3598`, «Слишком много скачиваний с этого адреса. Попробуйте через час»; одна почта с 51 адреса — 50×200, 51-й → **429**, `Retry-After: 86397`; писем на эту почту за 51 скачивание — ровно **10** (лимит писем). Юнит `blank-download.test.ts` проверяет то же на свежем лимитере (и что отказ по почте не съедает лимит адреса).
- Письмо (dev-лог, `raw/e2e.json → emailLog`): `Subject: Шаблон «Журнал здоровья» — WeSetup`, тело с кнопкой и адресом `…/api/journal-samples/health_check/pdf?t=…`, ссылка на страницу журнала, «Вести журнал в WeSetup» → регистрация с почтой и `source=blank`. Юнит `blank-download-email.test.ts` проверяет ссылки, второй формат и экранирование.

## AC3 — копирайт и QR на каждой странице без перекрытий; Word — копирайт и QR — PASS

- Проверка всех образцов (`check-blank-qr.ts` — логика `journal-pdf-qr-2026-09/check-qr-overlap.ts`: растр 200 dpi, проба без штампа, модули против `QRCode.create`) + текст страницы + **независимое декодирование OpenCV**:
  - почта в токене (худший случай — 39 символов, самый плотный QR): **50/50 OK** (45 образцов + 5 бумажных бланков), **68 страниц**: тёмных пикселей в зоне QR+подписи до штампа — 0, расхождений модулей — 0, 41 модуль, копирайт и «Заполнять с телефона —» в тексте каждой страницы, OpenCV читает ровно адрес на всех 68 (`raw/check-blank-qr-all-email.json`);
  - без почты (как во встроенном просмотре): **50/50 OK**, 68 страниц, 37 модулей (`raw/check-blank-qr-all-noemail.json`).
  - Блок стоит в нижнем углу вровень с таблицей везде, кроме двух образцов: `uv_lamp_runtime` (и раньше, со старой подписью, стоял выше) и `health_check` — подпись с копирайтом на 9 мм шире, место справа от примечания внизу листа кончилось, блок встал в свободный верхний правый угол (без наложений).
  - Кадры угла: `evidence/pdf-corner-sample_hygiene.png`, `…_cold_equipment_control.png`, `…_med_books.png`, `pdf-corner-paper_ot_intro.png`.
- Скачанный в e2e PDF: QR (OpenCV) → `http://localhost:3043/qb/<токен>`, токен расшифрован в почту e2e и `health_check`.
- Word: подвал = подпись + строка копирайта + QR 18 мм. Юнит `blank-qr-token.test.ts`: `footerReference` в разделе, копирайт и подпись в `word/footer*.xml`, PNG в подвале побайтно равен `QRCode.toBuffer(url)`. E2E: скачанный .docx → LibreOffice → PDF → OpenCV → `/qb/<токен>` с той же почтой (`evidence/docx-footer.png`).
- Юнит `blank-qr-token.test.ts`: на каждой странице PDF образца и бумажного бланка есть копирайт и подпись; бумажный бланк кабинета (без `qr`) — без копирайта.

## AC4 — /qb/<токен> — PASS

- Новая почта: «Заполняйте этот журнал с телефона», карточка журнала, три пункта (QR → форма, облако + PDF, напоминания), «Зарегистрироваться» (`06-qb-new-390.png`) → `/register?email=<почта>&source=blank&journal=health_check&next=/journals/health_check?from=qb`, почта подставлена, плашка «“Журнал здоровья” откроется сразу после регистрации» (`07-register-prefilled-390.png`) → после регистрации открыт `/journals/health_check` уже включённым (`08-journal-after-register-390.png` — первая подсказка журнала, `08b-health-journal-enabled-390.png` — сам журнал: «Включён», «Документ ещё не создан»).
- Та же QR после регистрации (почта уже есть): «Войдите — и этот журнал откроется для заполнения» (`09-qb-existing-1440.png`) → `/login?email=<почта>&next=/journals/health_check?from=qb` → вход паролем из письма → открыт `/journals/health_check` (`10-journal-after-login-1440.png`). Уже вошли — «Открыть журнал».
- Битый/чужой токен: «Журналы СанПиН и ХАССП — с телефона» без почты и журнала, кнопка → `/register?source=blank` (`11-qb-broken-390.png`).
- Юнит: шифрование/целостность токена (изменённый символ, обрезка, чужой секрет → null; регистр не важен), все 50 целей распознаются однозначно, длинная почта (>39 симв.) → QR без почты, но с журналом.

## AC5 — проверки — PASS

- `npm run typecheck` — exit 0.
- `npm test` — **2274 pass / 0 fail** (до задачи 2238; новых тестов 36: `blank-download.test.ts` 8, `blank-download-token.test.ts` 6, `blank-qr-token.test.ts` 9, `blank-download-email.test.ts` 2, `journal-samples-gate.test.ts` 5, `blank-signup.test.ts` 6; плюс проверка подписи `journal.enable` в `audit-labels.test.ts`). `route-slug-collisions.test.ts` проходит с `/qb/[token]` и `/api/settings/journals/[code]/enable`.
- ESLint по изменённым файлам — 0 ошибок, 0 предупреждений.
- E2E на своей базе — 42/42 PASS, скриншоты 390 и 1440 (`evidence/01…16`); `/root/blank-downloads` — `12-root-downloads-1440.png`, `13-root-downloads-390.png` (на телефоне — карточки).
- Dev-сервер остановлен, `.next-e2e` удалена, `tsconfig.json` возвращён.

## Замечания и открытые вопросы

1. **Юридически:** `/consent` описывает согласие «при регистрации, оформлении заказа или отправке обращения», цели — сервис и уведомления. Скачивание шаблона и звонки/письма продаж там не названы; для рекламных писем нужно отдельное согласие (38-ФЗ, ст. 18). Текст галки и документы не менял — решение за владельцем/юристом.
2. Журнал и формат лежат в AuditLog платформы (в LegalConsent нет полей, схему не меняли). Хранится 365 дней, как весь аудит.
3. Почта в QR — до 39 символов на wesetup.ru (плотность QR 13 мм); длиннее — QR без почты, /qb покажет заглушку без подстановки.
4. Превью `public/journal-samples/*.webp` не перегенерированы (в углу старая подпись QR) — при желании `scripts/render-journal-sample-thumbs.ts`.
5. ~~Журнал после регистрации с QR мог быть выключен~~ — решено доработкой (см. ниже).
7. В dev у шапки кабинета предупреждение гидрации (`PartnerHint` в `src/components/layout/*`, не трогал) — к задаче не относится, но из-за оверлея Next страница кабинета не «затихает» для `networkidle` в e2e.
6. `/prikazy` («Скачать бланк» приказов) — не шаблоны журналов, не трогал.

## Доработка (после ревью): журнал из QR открывается включённым

Запрос координатора: человек, зарегистрировавшийся по QR шаблона, попадает в ЭТОТ журнал готовым к заполнению;
существующим организациям — понятная кнопка «Включить журнал» одним нажатием (только с правами на набор журналов),
молча их не менять; включение — в лог и AuditLog.

| Что | Где |
|---|---|
| Регистрация `source=blank&journal=<код>`: страница шлёт `blankJournal`, сервер берёт только коды каталога и убирает этот журнал из выключенных у НОВОЙ организации — в том числе журнал здоровья; остальным новым организациям дефолт прежний | `src/app/(auth)/register/register-client.tsx`, `src/app/api/auth/instant-register/route.ts`, `src/lib/blank-signup.ts` |
| AuditLog новой организации в той же транзакции: `journal.enable`, `{journalCode, via: "blank-qr-signup"}`, автор — новый пользователь; строка в логе сервера `[instant-register] journal enabled for blank QR signup` | `instant-register/route.ts` |
| Экран «Этот журнал отключён»: для руководителя — кнопка «Включить журнал» (одно нажатие, без подтверждения) и «Весь набор журналов»; для сотрудника — только статус и «Включить его может руководитель…»; с `?from=qb` — строка «Вы открыли его по QR со скачанного шаблона» | `src/app/(dashboard)/journals/[code]/page.tsx`, `src/components/journals/journal-enable-button.tsx` |
| `POST /api/settings/journals/<код>/enable` — права как у «Набора журналов» (`hasFullWorkspaceAccess`, иначе 403), убирает из выключенных ровно этот журнал, пишет AuditLog `journal.enable` `{journalCode, via: "blank-qr" \| "journal-page"}` и лог сервера | `src/app/api/settings/journals/[code]/enable/route.ts` |
| Ссылки из /qb (вход, регистрация, «Открыть журнал») ведут на `/journals/<код>?from=qb` | `src/lib/blank-download.ts` (`blankCabinetPath`) |
| Подписи в журнале действий организации: «Журнал включён», способ — «регистрация по QR со скачанного шаблона» / ««Включить журнал» после QR…» / «кнопка «Включить журнал»» | `src/lib/audit-labels.ts`, `src/app/root/audit/page.tsx` |

Проверки доработки:
- Юнит `src/lib/blank-signup.test.ts` (6): код журнала из тела — только каталог (бумажный бланк, мусор → ничего не включают); регистрация по QR журнала здоровья → он включён, остальной набор = дефолт; обычная регистрация → журнал здоровья выключен, как раньше; журнал, включённый по умолчанию, → без изменений и без записи в аудит; любой журнал каталога включается, и анкета (`api/profile/complete` пересчитывает только «нетронутый» список) его не выключит; запись аудита читается по-русски.
- E2E (`raw/e2e.json`, проверки `follow-up:`):
  - новая почта → QR журнала здоровья → регистрация → `/journals/health_check?from=qb`, экрана «отключён» нет; в БД у новой организации `health_check` не в выключенных, `cleaning`/`general_cleaning` выключены (дефолт), `hygiene` включён; AuditLog организации — одна запись `journal.enable` `{journalCode:"health_check", via:"blank-qr-signup"}` от нового пользователя (`08-…`, `08b-health-journal-enabled-390.png`);
  - та же почта, QR журнала уборки (у организации выключен) → «Войдите» → вход → `/journals/cleaning?from=qb`: экран «Этот журнал отключён» с «Вы открыли его по QR со скачанного шаблона» и кнопкой «Включить журнал», организация до нажатия не изменена (`14-journal-disabled-from-qr-1440.png`) → одно нажатие → журнал открыт, в БД `cleaning` включён, AuditLog `{journalCode:"cleaning", via:"blank-qr"}` (`15-journal-enabled-1440.png`);
  - сотрудник (повар) той же организации на `/journals/general_cleaning?from=qb`: кнопки нет, «Включить его может руководитель…», `POST …/general_cleaning/enable` → **403**, журнал остался выключен (`16-journal-disabled-staff-390.png`).
- `npm run typecheck` — exit 0; `npm test` — 2274 pass / 0 fail; ESLint по изменённым файлам — 0 ошибок (одно старое предупреждение `redirect` не используется в `journals/[code]/page.tsx` — было до правки).
