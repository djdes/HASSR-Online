# Доказательства — ссылка проверяющего на одну точку (2026-11-01)

| AC | Изменение | Проверка |
|---|---|---|
| AC1 | `src/lib/inspector-point.ts` `resolveInspectorIssuePoint`; `inspector-point.server.ts` (точки организации, точка из шапки, `pointScope`); `api/settings/inspector-tokens` POST (QR и разовая ссылка) | `inspector-point.test.ts`: по умолчанию, выбор точки, руководитель точки (403 на чужую и на всю организацию), точки выключены |
| AC2 | GET — `loadCabinetInspectorData(org, { pointScope })` (`inspectorTokensWhere`, действия только по видимым ссылкам); DELETE — `inspectorTokenVisible` | тест «список и отзыв ссылок» |
| AC3 | `inspector-access.ts` (`buildingId`, точка, набор журналов точки, `findInspectorDocument` → `inspectorDocumentVisible`); `inspector-journals.ts`, `inspector/[token]/[code]/page.tsx` (`inspectorDocumentWhere`, `inspectorEntryWhere`); чек-листы по назначению (`checklistAssignmentAtPoint`) и медкнижки (`staffAtBuildingWhere`) в `inspector-portal-extras.server.ts`; подпись точки на портале, в журнале и в сводке PDF (точка входит в контрольный код) | тест «портал»; листы и PDF документов идут через `guardInspectorDocumentRequest` → `findInspectorDocument` |
| AC4 | `/inspection`: QR на `resolveInspectorIssuePointForSession`, подпись `qrScopePoint` / `qrScopeOrganization`, `canIssue` руководству, включая руководителя точки | typecheck |
| AC5 | `point-scope.ts`: убраны `/settings/inspector-portal` и `/api/settings/inspector-tokens` из company-only; клиент портала — `ScopePill`, подсказка `issueTarget*`; ключи i18n ru/en/uz + `message-contract.d.ts` | `point-scope.test.ts`, `app-nav.test.ts`, `settings-cards.test.ts`, i18n catalog-тесты |
| AC6 | `inspector-sheet/[id]`: `inspectorTokenVisible` + строка «Точка: …» | typecheck |
| AC7 | `api/certificate`: руководителю точки — `findOrCreateOrgInspectorQr(org, user, точка)` | typecheck |
| AC8 | — | тесты: 91 + 33 + 30 (после слияния master #98) — все зелёные; `npm run typecheck` — 0 ошибок; verify-worktree — 0 испорченных |

Не делал: живой прогон на e2e-базе (dev-серверы запрещены правилами группы).
