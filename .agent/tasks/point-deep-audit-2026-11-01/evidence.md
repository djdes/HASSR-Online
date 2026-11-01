# Доказательства — детальный аудит изоляции точек (2026-11-01)

| AC | Где | Проверка |
|---|---|---|
| AC1 | PR #88 (`c748e1a7`) | спека/доказательства `.agent/tasks/point-notify-2026-11-01/`; 121/121 тестов группы |
| AC2 | PR #89 (`0f45223c`) | `.agent/tasks/point-jset-2026-11-01/` |
| AC3 | PR #90 (`ee2b64c6`) | `.agent/tasks/point-integr-2026-11-01/` |
| AC4 | PR #91 (`69e755be`) | `.agent/tasks/point-docs-2026-11-01/`; тест обходит все маршруты `journal-documents/[id]/**` |
| AC5 | PR #92 (`fbca75de`) | `.agent/tasks/point-people-2026-11-01/` |
| AC6 | PR #93 (`586069bf`) | `.agent/tasks/point-objects-2026-11-01/` |
| AC7 | PR #94 (`53225fdf`) | `.agent/tasks/point-bots-2026-11-01/` |
| AC8 | PR #95 (`6a453324`) | `.agent/tasks/journal-org-settings-2026-11-01/` |
| AC9 | ветка-сборка всех восьми PR (дерево совпало с master после слияния: `git diff` 0 строк) | см. ниже |
| AC10 | этот PR | `whats-new-*` тесты 28/28 |

## AC9 — сборка всех PR

- `npm run typecheck` — 0 ошибок.
- `scripts/test-with-baseline.sh` (TEST_CONCURRENCY=8): pass 5450, fail 1 —
  `message argument types are generated from the current source catalog`. Падает и
  на чистом master `1a92d768` в этой Windows-копии: `scripts/i18n-types.mjs --check`
  сравнивает файл побайтно, а рабочая копия хранит его с CRLF. На CI (Linux) master
  проходит (шесть последних деплоев success); каталоги сообщений ни один PR не менял.
- Живая проверка: dev-сервер сборки на отдельной копии e2e-базы `wesetup_ptinteg`
  (офис + точки А и Б, по холодильнику на точку, руководитель точки А) —
  `raw/fixture.ts`, `raw/http-check.mjs` → `raw/http-check.txt`: **ALL PASS 43**:
  - 19 страниц кабинета и 6 API у владельца отвечают 200;
  - `/api/equipment`: «Вся организация» — оба холодильника, точка А — только свой;
  - повар А: свой документ 200, документ точки Б — 404 в API и «не найдено» на
    странице (без названия и людей точки Б — `raw/peek-foreign-page.mjs`);
  - руководитель точки А: правка/удаление холодильника точки Б, увольнение повара
    точки Б, «удалить все документы», права, журнал действий — 403; документ точки Б — 404;
  - «Распределение» гигиены: настройка записана своей организации
    (`OrganizationJournalSetting`), общий шаблон не изменился.
