# План: тип рассылки «КП» (волна 2)

Ветка `feat/mailing-2026-09-29` поверх `integ/kp-mailing-2026-09-29` (e6e1d9d2). Рабочая копия `d:/wt/mailing`,
база `wesetup_wt_mailing`, порт 3193, сухая отправка в `d:/wt/tmp-mailing2/outbox`.

## 1. Точка расширения — доработки (обратно совместимы)
Файлы: `src/lib/mailing/templates.ts`, `queue.ts`, `store.server.ts`, `campaigns.server.ts`,
`src/app/root/mailing/compose-tab.tsx`, тест `queue.test.ts`.
- `validate` → `Result | Promise<Result>`; `validated()` в `campaigns.server.ts` — `await`.
- `prepare(campaign: { id; title; payload }, recipients: MailingPrepareRecipient[])`, где у получателя `personal`.
  `store.campaignsToPrepare` отдаёт `title`, `store.prepareRecipients` — только «в очереди» и с `payload`.
- `MailingRecipientContext.mode` (`live` | `test` | `preview`) — `buildRecipientContext(r, appUrl, { track, mode })`.
- `RenderedMailing.notes` — предпросмотр (плашка над каналами), тест себе (результат + плашка в письме/Telegram).
- Логи: `[mailing] campaign=… prepared personal=N`, `[mailing] test notes …`.

## 2. Тип «КП»
- `src/lib/promo/valid-days.ts` — `promoEndsAfterDays(now, days)`, `PROMO_VALID_DAYS_MAX = 90` (чистый, + тест).
- `src/lib/mailing/kinds/kp-shared.ts` — `KpPayload`, `defaultKpPayload()`, `coerceKpPayload()`,
  `checkKpPayload()` (синхронная часть проверки), подписи; чистый — его читает форма.
- `src/lib/mailing/kinds/kp.ts` — `createKpTemplate(deps)` + `kpTemplate`:
  - `validate` — форма + для `existing` код из базы (действует, не персональный);
  - `prepare` — `createPersonalPromoCodes` для получателей без кода: пользователи → код организации, контакты →
    `unlocked`; `note: Рассылка «<название>»`, `campaignId`; вернуть `{ promoCode, promoEndsAt }`;
  - `render` — сфера `ctx.sphere ?? defaultSphere`, промокод (personal → `ctx.personal`, existing → кэш
    `readPromoForOffer`, предпросмотр/тест → пример `suggestPersonalCode`), контекст КП из кэша (60 с),
    `buildProposalContent` + `renderProposalEmailHtml` (как `renderProposalEmail`), PDF по галочке, тексты каналов;
  - логи `[mailing] kp …`.
- `src/lib/mailing/kinds/index.ts` — строка `registerMailingTemplate(kpTemplate)`.
- `src/components/mailing/fields/kp.tsx` — сфера по умолчанию с подсказкой, радио промокода с полями
  (коды для «выбрать» — `GET /api/root/promo-codes`, только действующие общие), «Вложить PDF», ссылка на
  ROOT → «Коммерческие предложения».

## 3. КП: срок кода «навсегда»
- `src/lib/proposal/content.ts` — пояснение «Промокод X действует до D: при оплате до этого дня скидка остаётся навсегда»
  (только `lifetime` + `endsAt`). Тесты: `content.test.ts`, `pdf.test.ts` (все сферы, длинное название, код навсегда
  со сроком + акция — один лист).

## 4. Генератор КП
- `POST /api/root/proposals/personal-code` (ROOT): `{ companyName, sphere, value, validDays }` →
  `createPersonalPromoCodes([{ key, email: null, companyName, unlocked: true }], { kind: "percent", value,
  lifetime: true, endsAt, note: "Генератор КП" })`, аудит `promo.create` (`source: kp-generator`), лог `[kp]`/`[promo]`.
- `src/lib/proposal/root.server.ts` — `proposalPromoOption(row)` (подпись варианта для списка).
- `proposals-client.tsx` — кнопка + поля «−N %» и «дней»; созданный код добавляется в список и выбирается → форма,
  предпросмотр и PDF с ним.

## 5. Проверки
- Юнит: `src/lib/mailing/kinds/kp.test.ts` (validate; prepare: пользователи/контакты/идемпотентность/existing/none;
  render: письмо с кодом, отпиской, `/r/`-ссылками, вложение по галочке, каналы, пример в предпросмотре, live без
  кода — ошибка), `kinds-consistency.test.ts` (КП зарегистрирован, поля есть), `queue.test.ts` (title/personal в
  prepare, пометки теста), `valid-days.test.ts`.
- `npm run typecheck`, `npm test` (gate).
- E2E `.agent/tasks/mailing-kp/e2e/` (выхлоп в `d:/wt/tmp-mailing2/e2e-out`): посев (кафе-пользователь, контакты
  детсад и отель) → форма «КП» (скрин 1280/390) → предпросмотр с пометкой примера (скрин) → запуск → cron → 3 письма
  в папке (своя сфера и код, `/r/`, отписка, заголовки) → коды в базе и в ROOT «Промокоды» (скрин 1280/390) →
  клик по кнопке письма → `/promo/<CODE>?s=` → регистрация со сферой → тариф и `/order` с кодом (без оплаты) →
  генератор: «Создать персональный код» → код в форме, в предпросмотре письма и в PDF (текст PDF через pdf.js) →
  письмо 375/600 (скрины). `evidence.md` + скрины в `.agent/tasks/mailing-kp/evidence/`.

## Коммиты
1. spec + plan; 2. точка расширения; 3. тип «КП» + форма; 4. КП: срок кода; 5. генератор; 6. e2e + evidence.
Перед каждым — `bash C:/wt/_orch/verify-worktree.sh d:/wt/mailing`, коммит конкретных путей, без `--no-verify`.
