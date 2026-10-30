# Evidence — договор оказания услуг из ROOT-карточки (2026-10-29)

Ветка `feat/client-contract-2026-10-29`, worktree `F:\wt\contract`. Локальная база
`wesetup_contract` (127.0.0.1:5432, копия `wesetup_memos`); прод-туннель 5433 не использовался.

## Критерии

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 шаблон | PASS | `src/lib/contracts/template.ts`, `CONTRACT_TEMPLATE_VERSION = "2026-10-29"`, 16 разделов (см. ниже), пометка «черновик для юриста» в шапке модуля; тест «every clause and section reference…» проверяет все ссылки «п. X.Y» / «разд. N» |
| AC2 заполнение | PASS | `contracts.test.ts`: юрлицо (капслок ЕГРЮЛ → «генеральный директор Иванова Анна Сергеевна»), ИП (ИНН 12 цифр, ОГРНИП, без КПП, «Индивидуальный предприниматель»), ИП по доверенности, ИП без снимка ЕГРЮЛ (не подставляется название кафе), пустые поля → линии `____`; проверка отсутствия `undefined/null/NaN/{{`/двойных пробелов/пустых скобок; сумм в тексте нет |
| AC3 модель | PASS | `prisma/schema.prisma` `ClientContract` (+ `Organization.clientContracts`), `prisma db push` локально OK; номер в транзакции с повтором на P2002; E2E выдал WS-2026/0001…0003 подряд |
| AC4 рендер | PASS | `render.server.ts` → `renderClientContractPdf(contractId)` / `renderClientContractDocx(contractId)`; PDF 7 листов, «Стр. N из M», реквизиты двумя колонками, факсимиле и печать (тестовые PNG) на подписи Исполнителя — `raw/out/e2e-org-one-WS-2026-0001-p7.png`; DOCX открыт LibreOffice → 7 листов, `raw/out/docx-pdf/contract-sample-p1.png` |
| AC5 кит | PASS | `src/lib/brand-docs/pdf-kit.ts` (+ `phone.ts`, `assets/wordmark-gradient.png` 15 КБ, `assets/icon-nfc.png` 2 КБ); `pdf-kit.test.ts`: шапка и подвал на каждом листе, все блоки рисуются, Manrope встроен |
| AC6 API | PASS | `src/app/api/root/organizations/[id]/contracts/**`: GET/POST, `preview`, `[contractId]/pdf|docx|send|void`, `legal-refresh`; везде `requireRoot()`, zod; `recordAuditLog` на issue/send/send_failed/void; аннулированный → 409 (E2E `voidedSend`) |
| AC7 письмо | PASS | `send.server.ts` `sendClientContractEmail`; без SMTP → 503 `not_configured`, статус не меняется (E2E `send`) |
| AC8 получатели | PASS | тест «recipient suggestions…»: служебные `*.staff.local`/`*.local.haccp` отброшены, дубли без учёта регистра, почты ЕГРЮЛ в конце; в диалоге ЕГРЮЛ-адреса не отмечены по умолчанию |
| AC9 UI | PASS | `src/components/root/client-contract-card.tsx` + `client-contract-section.tsx`; в `page.tsx` один импорт и один элемент; скриншоты `raw/out/e2e-org-one-issued.png`, `e2e-org-one-send-dialog.png`, `e2e-org-none-card.png`; i18n `rootClientContract` ru/en/uz |
| AC10 тесты | PASS | `node --import tsx --test src/lib/contracts/contracts.test.ts src/lib/brand-docs/pdf-kit.test.ts` → 15 pass, 0 fail |
| AC11 E2E | PASS | `raw/e2e-contract.cjs` для `org-one` (ООО) и `org-none` (ИП): карточка видна, проект PDF не трогает базу, выпуск, PDF содержит 5018215599 и ИНН клиента, отправка → 503 с понятным текстом, аннулирование скрывает «Отправить» |
| AC12 проверки | см. ниже | |

## Команды

- `npx prisma db push` (локальная база) — in sync.
- `node --import tsx --test src/lib/contracts/contracts.test.ts src/lib/brand-docs/pdf-kit.test.ts` — 15/15.
- `npm run i18n:check` — 97 pass, 0 fail.
- `npx eslint src/lib/contracts src/lib/brand-docs src/components/root/client-contract-*.tsx "src/app/api/root/organizations/[id]/contracts" "src/app/root/organizations/[id]/page.tsx"` — чисто.
- `npm run typecheck` — exit 0 (первый прогон нашёл тип в `docx.ts` — исправлено).
- `npm run test:gate` — pass=5105, fail=4, из них «новых» три:
  - `actual organization page retains ROOT gate…` — падал из-за моей вставки: тест грузит `page.tsx` с фиксированным списком моков, а новая секция тянула серверные модули. Добавлен мок `@/components/root/client-contract-section` → тест 6/6.
  - `prewarm-routes.sh` (`src/lib/deploy-scripts.test.ts`) — скрипт и тест не тронуты; 60+ вызовов curl упираются в 30-секундный таймаут на этой машине и падают и отдельно. Окружение, не регрессия.
  - `тип файла — по содержимому…` (`inspector/[token]/visits`) — отдельно проходит 7/7; под нагрузкой полного прогона — таймаут.
- Сгенерированные гейтом PDF в `.agent/tasks/english-version-*/raw` откатаны.

## Не проверено

- Реальная доставка письма (SMTP локально не настроен) и «Обновить из ЕГРЮЛ» с настоящим DaData-ключом (без ключа маршрут честно отвечает 503).
- Юридическая вычитка текста договора — нужна юристу.
