# Evidence — docs-plain-legal-2026-11-09

| AC | Статус | Подтверждение |
|----|--------|---------------|
| AC1 | PASS | `src/lib/contracts/template.ts`; `contracts.test.ts` (11 разделов, ссылки на пункты, «100 % предоплаты», «действует до «29» октября 2027 г.»); текст — `raw/out/contract.txt`; листы — `raw/out/contract-1.png`, `contract-4.png` |
| AC2 | PASS | `src/lib/contracts/sections-2026-10-29.ts`; тест «a contract issued with the previous template keeps its own text» |
| AC3 | PASS | `src/lib/invoices/pdf.ts`; `invoices/pdf.test.ts` (1 лист, оба ИНН, сумма прописью, основание); `raw/out/invoice-1.png` |
| AC4 | PASS | `src/lib/proposal/design.ts`, `content.ts`, `src/lib/invoices/build.ts`; тест «деловой текст: без рекламных оборотов»; `raw/out/kp-standard-1.png`, `kp-premium-1.png` |
| AC5 | PASS | `npm run typecheck` — без ошибок; `npm run test:gate` — pass=5912, fail=0; `npm run i18n:check` — 97/97 |

Попутно: `test:gate` на ветке падал на тесте `no-blank-word` из-за четырёх строк в
`src/content/journal-info.ts`, `journal-seo.ts` (и их копий в `ru.json`), пришедших из master.
Слово заменено на «журнал» / «форму», `i18n:types` перегенерирован.

Образцы пересобираются: `npx tsx .agent/tasks/docs-plain-legal-2026-11-09/raw/render.ts`.
