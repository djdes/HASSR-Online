# Evidence: objects-spheres-feedback-2026-11-23

Проверка — на текущем коде ветки `claude/confident-ptolemy-4pzpk3` (база master `6f95d7c6a`).

## Команды

| Проверка | Результат | Файл |
|---|---|---|
| `npm run typecheck` | EXIT=0 | raw/typecheck.txt |
| `npm run test:gate` (схема → полный прогон) | pass=7279, fail=0 | raw/test-gate.txt |
| Тесты задачи + затронутые наборы (14 файлов) | 140/140 | raw/task-tests.txt |
| `npm run i18n:check` | 101/101 | raw/i18n-check.txt |
| ESLint по изменённым файлам | новых ошибок нет; 2 ошибки `react/no-children-prop` и 5 предупреждений — уже на master | — |
| Браузер (локальная БД, `next dev`, Chromium) | см. ниже | raw/ui-check.json, raw/ui-popup.json, raw/ui-db-climate.txt |

## По критериям

- **AC1** — PASS. `/settings/buildings` и `/settings/buildings/[id]` грузят `climateNorms`; `roomEditorInitial` их передаёт; окно шлёт `climateNorms` только если получило (`climateLoaded`). Браузер: «Офис» выкл → вкл → Сохранить → перезагрузка → переключатель `aria-checked=true` (раньше сбрасывался). Тесты `climate-room-membership.test.ts`.
- **AC2** — PASS. `PATCH /api/settings/rooms/[id]` при смене вкл/выкл зовёт `syncRoomClimateDocuments` → `planClimateRoomMembership`. БД после включения: строки документа климата `["Склад Бакалея", "Офис"]` (raw/ui-db-climate.txt). Выключение убирает строку без замеров, с замерами и последнюю — оставляет (тест).
- **AC3** — PASS. `climateSeedRooms` в обоих местах засева (`journal-documents` POST, `journal-default-configs`); тест.
- **AC4** — PASS. Переключатели в заголовках «Кто проверяет» и «Климат», QR и нормы скрыты при выкл (браузер: `qrHiddenWhenOff: true`, `verifierBlock: true`); выключенный «Кто проверяет» сохраняет `[]`.
- **AC5** — PASS. `object-categories.ts` + тесты (4 сферы, подписи ru/en/uz, отображение старых сфер, `resolveSphereForCategory`).
- **AC6** — PASS. `Building.sphere String?` (только добавление); POST/PATCH объектов принимают `sphere`; офису не ставится.
- **AC7** — PASS. Мастер объекта: 4 карточки, обязательно (браузер: 4 `[data-object-category]`); шаг «Объекты» мастера первого входа — выбор у строки, обязателен для новых; на «Объектах» чип сферы (браузер: `food` / «Общепит ХАССП») и правка; на странице объекта — строка и выбор в окне правки.
- **AC8** — PASS. `planObjectCategoryJournals` + `applyObjectCategoryJournals` (тесты планировщика; лимит журналов тарифа соблюдается — при отказе набор не трогаем, `journalsLimited` в ответе и тост).
- **AC9** — PASS. Поле сферы убрано из анкеты, регистрации и окна «Новая организация»; `/api/profile/complete` без сферы не меняет `type` и журналы; живой гид обновлён; уведомление продажам без строки «Сфера».
- **AC10** — PASS. «Настройка журналов» и «Реквизиты»: только 4 сферы (браузер: опции «Общепит ХАССП…Спорт и рекреация»); «Обязательные» = `mergedRulesFor(organizationRuleSpheres(...))`.
- **AC11** — PASS. `DashboardSection collapsible={false}`: `<section data-section-fixed>`, без стрелки и `data-storage-key` (браузер: `SECTION`, `chevron: false`; тест).
- **AC12** — PASS. `/root/feedback`: чаты слева, обращения справа (браузер 1440px: x=52 и x=732, одна высота); список чатов `max-h-[45vh]`/`xl:max-h-[calc(100vh-14rem)]`, ветка — строкой; якоря `#report-…`/`#chat-…` + `FeedbackHashFocus`; последние 50 реплик.
- **AC13** — PASS. `alertSupportStaffAboutReport` (4 источника обращений) и `alertSupportStaffAboutChat` → колокольчик (браузер: «Новое обращение в поддержку», ссылка `/root/feedback#report-…`) и всплывашка (браузер: тост «Новое обращение · ошибка» с «Открыть»/«Клиент» и в админке, и в кабинете — raw/ui-popup.json).
- **AC14** — PASS. `ClientLinks`: «Карточка клиента», «Войти в кабинет» (кому разрешено), «Позвонить», «Написать на почту» — у обращений и веток (браузер).
- **AC15** — PASS. Окно ответа: «Кому: Анна Руководитель · почта · телефон · организация» и цитата обращения; чат: «Кому», «В ответ на: «…»» по умолчанию последнее сообщение клиента, «Ответить» у сообщения; `SupportMessage.replyToId`, цитата в админке и виджетах кабинета/сайта.
- **AC16** — PASS. Вложения + Ctrl+V + перетаскивание в «Ответить» и «Написать организации»; `FeedbackReport.replyAttachments` и доставка ссылками (тест текста Telegram/письма); `useGlobalImagePaste` в виджетах кабинета и сайта (вне полей ввода; тест фильтра).
- **AC17** — PASS. `articles.ts`: без поварских примеров (тест), регистрация без сферы, «Объекты» — мастер, 4 сферы, смена сферы, меню, помещения и климат.
- **AC18** — PASS. Браузер: «Объекты · Сотрудники · Помещения · Оборудование · Журналы · Программа производственного контроля · QR-плакаты · Справочник продукции/услуг · Онлайн-принтер · Общий планшет»; тесты `app-nav`, `nav-layout`.
- **AC19** — PASS. ru/en/uz вместе, `message-contract.d.ts` пересобран, `borderless.css` и `neutral-palette.css` пересобраны; typecheck и полный гейт зелёные.

## После слияния с master #313 (`42b4fac1d`, коммит слияния `476620012`)

Конфликты: `organization-info-form.tsx` (список «Основная сфера» — компонент `Select` из master, в нём четыре сферы и подсказка «Сфера не выбрана»), `kb/articles.ts` («Умный подбор для всех журналов» из master + нейтральная формулировка), `borderless.css` / `neutral-palette.css` / `message-contract.d.ts` — пересобраны скриптами.

| Проверка | Результат | Файл |
|---|---|---|
| `npm run typecheck` | EXIT=0 | raw/merge-typecheck.txt |
| Тесты задачи + новые тесты master (`plain-language`, `select-frame`, `header-profile-footer`, `equipment-type-fields`) — 16 файлов | 143/143 | raw/merge-targeted-tests.txt |
| `npm run i18n:check` | 103/103 | raw/merge-i18n-check.txt |
| pre-commit коммита слияния (эскалация до полного прогона) | pass=7294, fail=0 | raw/merge-pre-commit-full.txt |
| Браузер: «Реквизиты», «Объекты», главная, `/root/feedback` | всё на месте, ошибок страницы нет | raw/merge-ui-check.json |

Браузер после слияния: «Основная сфера» — `Select` master (нативного списка нет), в списке 4 сферы, у организации со сферой «other» — «Сфера не выбрана», выбор «Общепит ХАССП» показывается в поле; меню «Объектов» в нужном порядке; чип сферы объекта; климат «Офиса» остался включён; «Обязательные журналы» — `SECTION` без стрелки; `/root/feedback` — колонки x=52 и x=732.

## Отличия от спеки (детали реализации, критерии не меняют)

- Вложения ответа — столбец `FeedbackReport.replyAttachments` (в спеке — `responseAttachments`): короче имя — `prisma format` не выравнивает модель заново, дифф схемы 12 строк.
- `SupportMessage.replyToId` — без внешнего ключа (в спеке «+ связь»): цитата ищется в переписке ветки, чужой id сервер не сохраняет; так же без перестройки модели.
- Колокольчик о чате теперь у всей команды поддержки (`platform.support.chat`) вместо прежнего `support.message` только руководству платформы; push в приложение оставлен.
- Всплывашка по обращениям из Telegram-бота: поллер бота — отдельный процесс, живое событие до вкладок не доходит; колокольчик (БД) работает.

## Развёртывание

`prisma db push` (apply-safe-schema): три nullable-столбца — `Building.sphere`, `FeedbackReport.replyAttachments`, `SupportMessage.replyToId`. Переменные окружения не меняются.
