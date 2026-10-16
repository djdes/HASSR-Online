# Evidence: ИИ-ассистенты и API (MCP + REST v1)

Среда проверки: worktree `D:/wt/ai-mcp-api` (ветка `feat/ai-mcp-api` от `origin/master` c4dc64ee), локальная база `wesetup_wt_aimcp` (схема + `prisma/seed.ts`), dev-сервер `next dev --webpack -p 3011`. Turbopack-dev в этой копии не отдавал вложенные маршруты `/api/*/*` (404 и для давно существующих `/api/auth/login`, `/api/external/healthz`) — проблема окружения; прод собирается `next build --webpack`, под webpack всё работает.

| AC | Результат | Чем подтверждено |
|---|---|---|
| AC1 | PASS | `raw/ui-check.log`: ключ создан (wsk_, 47 символов), во всех 4 вкладках сниппеты содержат ключ, после перезагрузки полный ключ не виден, отзыв через ConfirmDialog уменьшил список 3 → 2; скриншоты `raw/settings-api-1280-created.png`, `raw/settings-api-revoke-dialog.png` |
| AC2 | PASS | `key-admin.db.test.ts`: в БД `tokenHash = sha256(secret)`, строка не содержит секрет; `listOrgApiKeys` без `secret`/`tokenHash` |
| AC3 | PASS | `mcp/handle-message.test.ts` (18 тестов обеих эпох), `raw/protocol-checks.txt`: легаси initialize → 2025-06-18; 2026-07-28 tools/call → `resultType: complete`; server/discover; без ключа 401 + WWW-Authenticate; GET 405; чужой Origin 403 |
| AC4 | PASS | `tools/tools.db.test.ts` (10): выключенные журналы скрыты, чужие документы 404, закрытый документ и журнал-конфиг → 422, дубль сотрудника 409; `auth.db.test.ts` (8): архив/понижение/уход из организации → 403; `handle-message.test.ts`: ключ read видит 4 инструмента, запись → isError |
| AC5 | PASS | `rest/router.test.ts`, `rest/openapi.test.ts`; `raw/protocol-checks.txt`: openapi 3.1.0, `GET /api/v1/journals` → ok, `POST /documents/{id}/cells` → 200, повтор с тем же `Idempotency-Key` → `idempotent-replayed: true`, `DELETE /employees` → 405 |
| AC6 | PASS | `raw/protocol-checks.txt` (конец): `public_api.call | fill_journal_cells | rest | Мой ИИ-ассистент`, `api_key.created`, `api_key.revoked`; повтор по Idempotency-Key второй строки аудита не дал; подписи в `src/lib/audit-labels.ts` |
| AC7 | PASS | `raw/protocol-checks.txt`: 125 вызовов → 115×200 + 10×429 (вместе с вызовами Inspector — ровно 120 за минуту), `retry-after: 14` |
| AC8 | PASS | `raw/protocol-checks.txt`: старый ключ организации → `/api/external/summary` ok:true; тот же ключ в MCP → 401 «Это ключ интеграций для /api/external…» |
| AC9 | PASS | карточка `settings_api` последняя в группе connections (`src/lib/settings-cards.ts`), `app-nav.test.ts` и `no-settings-hub-links.test.ts` зелёные; 360 px — горизонтальный выход 0 px (`raw/ui-check.log`, `raw/settings-api-360.png`); тексты в ru/en/uz, `npm run i18n:check` 82/82 |
| AC10 | PASS | официальный MCP Inspector (`npx @modelcontextprotocol/inspector --cli`, Streamable HTTP, ссылка с ключом): `raw/inspector-tools-list.json` — 6 инструментов, `raw/inspector-list-journals.json`, `raw/inspector-fill-cells.json` — «Заполнено ячеек: 1» |
| AC11 | PASS | `src/lib/whats-new-notes.ts` — категория «Интеграции» первой; `src/app/developers/page.tsx` — разделы «ИИ-ассистенты (MCP)» и «REST API v1» |
| AC12 | PASS | `npm run typecheck` 0 ошибок; ESLint 0 ошибок (3 предупреждения `any` в тестах); pre-commit test:gate 3890/3890; тесты задачи с базой 83/83 |

Не проверено в этой сессии: подключение в ChatGPT и claude.ai (нужны аккаунты владельца) и проверка на проде после выкладки — см. отчёт.
