# Evidence — деплой на прод только из master (24.10.2026)

- Ветка: `claude/friendly-pasteur-n489ly`.
- Коммиты: `5623f0f5` (спецификация, зафиксирована до реализации), `845bdee1`
  (реализация), затем этот коммит (evidence).
- Свежая проверка: все проверки заново на `845bdee1`, файлы `raw/verify-*.txt`.
  Повторить: `bash checks/rollback-check-sim.sh` и
  `bash checks/deploy-sh-guard-sim.sh` из корня репозитория.

## Итог

**Не PASS целиком.** AC1 ждёт ручного удаления ветки (см. `problems.md`).
Остальные критерии — PASS. У AC7 одна оговорка: actionlint не запускался.

## По критериям

### AC1 — BLOCKED

- 4 коммита ветки сохранены: `raw/codex-mobile-first-release-2026-10/`.
  Там 4 патча и README с tip `6c9bae94`, base `ff81de23` и командой
  восстановления через `git am`.
- Перед удалением сверено, что tip на GitHub не менялся.
- `git push origin --delete codex/mobile-first-release-2026-10` вернул HTTP
  403: прокси этой сессии пускает push только в её рабочую ветку
  (`raw/branch-delete.txt`).
- Ветка на месте: `raw/verify-remote-branches.txt`.

### AC2 — PASS

- Job `reject-non-master`: `if: github.ref != 'refs/heads/master'`, `exit 1` с
  причиной.
- У `gate`, `upload` и `deploy` стоит `if: github.ref == 'refs/heads/master'`.
  У `notify-failure` в `needs` только они, поэтому на пропущенных job'ах он
  молчит.
- Очередь: для master — `production-deploy`, для остальных —
  `production-deploy-rejected-<run_id>`.
- Подтверждено разбором YAML: `raw/verify-yaml.txt`.

### AC3 — PASS

- Шаг «Не откатывать прод на старый коммит» — первый в `deploy`, до любого
  SSH-шага.
- Имитация на тексте шага из YAML (поддельные `curl` и `gh`, `bash -e`):
  12/12 сценариев (`raw/verify-rollback-check.txt`):
  - отказ — при Re-run старого коммита, когда на проде более новый коммит из
    master;
  - пропуск — при коммите новее прода, том же коммите, переписанном назад
    master, сборке не из master, ошибке GitHub API, недоступном сайте или 429,
    сборке `dev`, HTML вместо JSON.
- Настоящий `/api/build-info` разбирается в полный SHA:
  `raw/live-build-info.txt`.

### AC4 — PASS

`scripts/deploy.sh --dry-run` во временном репозитории с локальным origin,
8/8 сценариев (`raw/verify-deploy-sh-guard.txt`):

- отказ — изменённый файл, неотслеживаемый файл, неотправленный коммит,
  отставание от origin/master;
- деплой — чистая копия, остатки `.build-sha`/`.build-time` от прошлого
  запуска, detached `git worktree`, недоступный origin (с предупреждением).

### AC5 — PASS

Правила:

- `AGENTS.md` → «Production deploy rules (master only)» и строка Trigger;
- `.cursorrules`;
- `docs/THREAD_WESETUP.md`, п. 4 «Правил деплоя»: раньше там стояло «`npx next
  build` руками на проде»;
- `docs/SESSION_HANDOFF.md`, «Деплой».

`deploy-remote.sh` удалён.

### AC6 — PASS

- Секреты, пароли и SSH-доступ в правке не затронуты; добавлен только
  `github.token` для compare API.
- Push-триггер на master и `workflow_dispatch` на месте.
- SSH-шаги 1–3 на сервере побайтно те же: `raw/verify-unchanged.txt`.

### AC7 — PASS с оговоркой

- YAML разбирается, структура проверена утверждениями.
- Обе имитации проходят.
- `scripts/check-secrets.sh` чист на каждом коммите.
- actionlint не запускался: в этой сессии запрещено скачивать и запускать
  внешний бинарник.
- Проверить синтаксис настоящим парсером GitHub ручным запуском на рабочей
  ветке тоже не удалось: интеграции отказано в `workflow_dispatch` (403).

## Ограничения

- **Проверки работают только в прогонах, созданных после слияния в master.**
  Не защищены:
  - Re-run прогонов, созданных до слияния: их можно перезапускать 30 дней;
  - «Run workflow» на ветках со старым `deploy.yml` —
    `codex/mobile-first-release-2026-10`, `mobile-e2e-android`,
    `mobile-e2e-ios`. У всех трёх там `prisma db push --accept-data-loss`.
    Эти ветки нужно удалить.
- **Ручные выкладки по SSH в обход `scripts/deploy.sh` технически не
  ограничены.** Доступы по просьбе владельца не менялись, их ограничивает
  только правило.
