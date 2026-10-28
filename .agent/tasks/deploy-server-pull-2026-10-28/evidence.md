# Evidence — деплой: сервер сам скачивает коммит

## Замеры (2026-10-28)

- #43 (`7c227c04`): 4 попытки, все отменены на «Upload tarball via SCP»
  через 15 мин. Лог попытки 3: `scp file to server.` в 17:39:23, дальше
  тишина до `The operation was canceled.` в 17:53:44.
- Удачная выгрузка #42 (попытка 3): SCP 16:18:20 → 16:22:10, ~4 мин на
  deploy.tar 94 МБ.
- Сервер ← codeload.github.com, tar.gz коммита `7c227c04` (286 МБ):
  33 с (8,7 МБ/с), 38,5 с (7,4 МБ/с), 11,6 с (24,7 МБ/с). Соседняя сессия
  в 17:56 UTC намерила ~0,9 МБ/с, отсюда лимит curl 330 с и обрыв при
  скорости ниже 100 КБ/с дольше 45 с.
- На сервере остались 3 зависших `scp -t` и недокачанные `*.tar.gz` в
  `/var/www/wesetupru/data` от сорванных попыток (не трогал).

## Критерии

| AC | Результат | Доказательство |
|---|---|---|
| AC1 | PASS | `deploy-scripts.test.ts` «в архиве код со всеми маршрутами журналов…»: в архиве только `package.json`, `public/logo.svg`, `src/app/(dashboard)/journals/page.tsx`, `src/app/api/journals/route.ts`. Список исключений перенесён из deploy.yml в `scripts/deploy-tarball.sh` без изменений. |
| AC2 | PASS | Тест «отпечаток не зависит от дат файлов и .build-time…»: другие даты и `.build-time` дают тот же отпечаток, другое содержимое или путь — другой. Тест «архив без файлов — ошибка». Файл: 16/16. |
| AC3 | PASS | `7c227c04` локально (F:): codeload tar.gz → `deploy-tarball.sh` → отпечаток `000f480a19b7589c5c8e9610de8aa39e84fe9d16b8c2df73e50d383f4236ef76`, 4434 файла. Checkout того же коммита (`core.autocrlf=false`) → тот же отпечаток, 4434 файла. |
| AC4 | PASS | deploy.yml: SCP `if: steps.pull.outcome != 'success'`; повтор SCP по `steps.scp.outcome == 'failure'`, как раньше (пропущенный SCP — `skipped`, повтор не идёт). YAML разбирается, шаги по порядку: … Prepare (retry) → Server downloads the commit from GitHub → Upload tarball via SCP → retry. |
| AC5 | ждёт деплоя | Проверяется на первом прогоне после слияния. |

Прогнать серверную часть до слияния не удалось: запись на сервер вне
деплоя (даже во временную папку) не разрешена в этой сессии. Поэтому шаг
сервера с `continue-on-error`, и при любом сбое работает прежний SCP.

## Команды

- `node --import tsx --test src/lib/deploy-scripts.test.ts` — 16 pass, 0 fail.
- `npm run typecheck` — 0 ошибок.
- `verify-worktree.cjs D:/wt/qr-point-uv` — checked 11611, corrupted 0, missing 0.
