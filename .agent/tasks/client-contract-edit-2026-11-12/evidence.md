# Evidence — client-contract-edit-2026-11-12

| AC | Status | Proof |
|----|--------|-------|
| AC1 | PASS | `contracts/blank/route.ts` (GET, `requireRoot`, `?format=pdf|docx`), `buildBlankContractSnapshot`; test «blank contract: …» (no draft mark, number/date lines, client lines, PDF+DOCX render); card buttons `contract-blank-pdf` / `contract-blank-docx`. Rendered PDF checked visually (4 pages, buyer column lines only). |
| AC2 | PASS | `preview/route.ts` takes `?format=docx`, `requireInn: false`; issue keeps `requireInn` default `true` (`issueClientContract`). Card: «Проект PDF» + «Проект Word», enabled without INN. |
| AC3 | PASS | `buyer-form.ts` `applyBuyerInput` / `buyerKindFromInput`; zod `buyer` object; `buildContractSnapshot` applies form buyer; template prints buyer bank; test «client requisites from the form …». Card block `contract-buyer-requisites`, checklist recomputed from the form. |
| AC4 | PASS | `ContractTextEditor` (edit / remove / add / reset); `params.customSections` stored in snapshot (`issueClientContract` writes `draft.params`), read back by `readCustomSections`; `buildContractDocument` uses it → issued PDF/DOCX re-render with it. Test «custom text: …». |
| AC5 | PASS | `optionalRow` for phone (both sides), actual address only if different; tests assert no empty phone row and every row non-empty. |
| AC6 | PASS | ru/en/uz + `npm run i18n:types`; `npm run typecheck` clean except pre-existing unrelated `src/app/api/root/gogetlinks/plans/route.ts(109)`; `npm run test:changed` 64 files pass=272 fail=0; eslint clean. |
