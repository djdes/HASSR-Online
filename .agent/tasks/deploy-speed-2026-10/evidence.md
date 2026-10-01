# Evidence — deploy-speed-2026-10

## AC1 — сиды закрывают пул

Проба на проде (только `SELECT 1`, без записи), та же цепочка, что в сидах
(`pg.Pool` → `PrismaPg` → `$queryRaw` → `$disconnect`):

```
no-end: 10383 ms until exit
end: 790 ms until exit
```

`await pool.end()` добавлен после `$disconnect()` в 8 сидов, которые в логе
деплоя 36856042048 шли по 11–12 с: `seed.ts`, `seed-job-positions.ts`,
`seed-articles.ts`, `seed-demo-screenshots.ts`, `seed-mirror-rooms-to-areas.ts`,
`seed-cleanup-default-positions.ts`, `seed-cleaning-unification.ts`,
`scripts/disable-broken-tf-integrations.ts`. Все быстрые сиды (1–2 с) уже
вызывали `pool.end()` или `process.exit`. PASS.

## AC2 — шарды тестов

`node --import tsx --test --test-reporter=tap --test-shard=i/4 "src/**/*.test.ts"`:

| Шард | tests | fail |
|---|---|---|
| 1/4 | 850 | 0 |
| 2/4 | 714 | 0 |
| 3/4 | 767 | 0 |
| 4/4 | 947 | 0 |
| сумма | 3278 | = полный прогон (3278) |

`TEST_SHARD=3/4 bash scripts/test-with-baseline.sh` → `pass=767, fail=0`.
Без `TEST_SHARD` скрипт вызывает прежний `npm run test:ci` (pre-commit тот же).
Флаг после шаблона файлов node игнорирует (проверено: `npm run test:ci --
--test-shard=2/40` прогнал все 3278) — поэтому скрипт ставит его перед шаблоном.
PASS.

## AC3 — параллельные job'ы

Разбор `deploy.yml` (js-yaml):

```
[gate] matrix={"check":["typecheck","1/4","2/4","3/4","4/4"]}
   - Type-check (if: matrix.check == 'typecheck')
   - Tests (baseline gate) (if: matrix.check != 'typecheck') TEST_SHARD=${{ matrix.check }}
[upload] needs=[] — checkout, tar, mkdir APP_DIR, scp
[deploy] needs=["gate","upload"] — шаги 1/3, 2/3, 3/3 на сервере
[notify-failure] needs=["gate","upload","deploy"] if=failure()
```

Выгрузка не меняет сервер: только `mkdir -p` и `deploy.tar`. Копия `.env`
перенесена в шаг 1/3 прямо перед `tar xf` (ранняя копия затёрла бы правку
`.env`, сделанную за время гейта). `.env` в git не отслеживается — в архиве
его нет. PASS.

## AC4 — уведомление о падении

Отдельный job `notify-failure`, `needs: [gate, upload, deploy]`, `if: failure()`:
срабатывает при падении любого предка, в том числе гейта (раньше шаг жил
внутри одного job'а; после разделения внутри `deploy` он бы не выполнился —
при упавшем гейте `deploy` пропускается целиком). PASS.

## AC5 — реальный деплой

Ожидает прогона после пуша.
