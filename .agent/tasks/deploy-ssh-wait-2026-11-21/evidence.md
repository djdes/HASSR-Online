# Evidence — deploy-ssh-wait-2026-11-21

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 | PASS | `scripts/wait-for-port.sh`: `ATTEMPTS` по умолчанию 20 → окно 20×10 + 19×15 = 485 с (было 185 с). Новый тест «по умолчанию ждёт порт 8–10 минут» сначала падал (`окно ожидания 185 с`), после правки — зелёный; `deploy-scripts.test.ts` 17/17 (`raw/red-green.txt`, `raw/deploy-scripts-test.txt`). |
| AC2 | PASS | `npm run typecheck` — без ошибок; `npm run test:changed` — 1 файл, pass=17 fail=0; eslint по тесту и `bash -n` по скрипту — чисто. |
| AC3 | PENDING | Проверяется после влития: выкат master и `/api/health` → новый `buildSha`. |

Причина падения выката #2383 и замеры связи — `raw/deploy-2383-wait-log.txt`, `raw/connectivity-probe.txt`.
