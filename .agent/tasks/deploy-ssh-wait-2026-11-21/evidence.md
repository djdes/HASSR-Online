# Evidence — deploy-ssh-wait-2026-11-21

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 | PASS | `scripts/wait-for-port.sh`: `ATTEMPTS` по умолчанию 20 → окно 20×10 + 19×15 = 485 с (было 185 с). Новый тест «по умолчанию ждёт порт 8–10 минут» сначала падал (`окно ожидания 185 с`), после правки — зелёный; `deploy-scripts.test.ts` 17/17 (`raw/red-green.txt`, `raw/deploy-scripts-test.txt`). |
| AC2 | PASS | `npm run typecheck` — без ошибок; `npm run test:changed` — 1 файл, pass=17 fail=0; eslint по тесту и `bash -n` по скрипту — чисто. |
| AC3 | PASS | #284 влит как `6c90210`; выкат «Deploy to production» #2384 (run 44896785508) — success: «Wait for SSH» ответил с 1-й попытки, сервер скачал коммит за 33 с, сборка 6 мин, шаг 3/3 (рестарт, прогрев, проверка) — success, гейт (typecheck + тесты) — success. `/api/health` → `buildSha 6c90210` с 11:05:46 UTC, держится (11:06, 11:06, 11:09). `6c90210` содержит #283 (`git merge-base --is-ancestor 3114684 6c90210`), в нём новый шаблон писем (`ws-title`). Главная на новой сборке: печать по нажатию — 4 анимации на 390/393 px (4 из 4 загрузок с догрузившимися скриптами), строка согласия — одна строка (16 px) на 390 и 430 px (`raw/after-deploy.txt`). |

Причина падения выката #2383 и замеры связи — `raw/deploy-2383-wait-log.txt`, `raw/connectivity-probe.txt`.
