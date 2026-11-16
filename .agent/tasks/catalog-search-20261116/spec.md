# Frozen spec

Request: «Добавь поиск по бланкам на странице Главная - Журналы - Бланки и на все остальные такие же страницы».

Scope: public grouped catalogs /blanki, /journals-info, /prikazy. Dashboard journal browser already has search. Other content and detail pages are outside scope.

AC1: Each scoped catalog has a labeled search field that filters immediately by title, code, description and regulatory text available for each item.
AC2: Matching ignores case, leading/trailing/repeated whitespace and ё/е; all query words must match. Empty query restores all items in original order.
AC3: Empty groups disappear, counts reflect visible items, zero results show a message and a reset action. Search and reset are keyboard accessible and fit mobile width.
AC4: Server-rendered catalog links, download actions, metadata, FAQ and existing sorting are preserved. No database/API changes.
AC5: Focused behavior checks, lint, typecheck and test:gate pass against current code; fresh verification and evidence are recorded here.

Implementation: shared client catalog accepts server-rendered item content and searchable text; existing server pages retain data preparation and card markup.
Verification: matching edge cases, server rendering of all three catalog integrations, focused ESLint, typecheck, test:gate; review final diff and rerun focused checks in fresh verification. No delegation.
