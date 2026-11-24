# Evidence: office-objects-favorites-2026-11-23

Проверено 2026-11-24 на локальном стенде (PostgreSQL 16, `next dev`, Chromium Playwright) против кода ветки
`claude/amazing-bohr-s3zvbx` после слияния свежего master (`84711ac24`, #313 и #315). Данные стенда
(`raw/stand-seed.ts`): организация с офисом и тремя объектами («Цех
пищевых продуктов», «Кафе на Мира», «Склад»), журналы по объектам включены; владелец без мест, директор в офисе,
заведующая и повара на объектах, официант без места; по холодильнику в цехе каждого объекта; два документа
журналов, привязанных к офису, один из них — с холодильником, которого нет в справочнике (как на скриншоте 1
владельца). Скриншоты — `raw/screens/*.png` (в git не попадают: `.agent/**/*.png` в `.gitignore`), замеры —
`raw/ui-check-*.json`.

## Проверки

| Проверка | Результат | Файл |
| --- | --- | --- |
| `npm run typecheck` | PASS (exit 0) | `raw/typecheck.txt` |
| `npm run test:gate` (схема меняется — полный прогон) | GATE_RESULT | `raw/test-gate.txt` |
| Хук перед коммитом слияния с master (полный прогон) | PASS — 7298 проверок, 0 падений | — |
| `npm run i18n:check` (вместе с новым тестом master «тексты без жаргона») | PASS — 103 из 103 | `raw/i18n-check.txt` |
| eslint по 64 изменённым файлам | 1 ошибка и 4 предупреждения — те же, что на master в тех же двух файлах (`journals/[code]/page.tsx` `<a href="/settings/journals">`, неиспользуемые импорты в `api/journal-documents/route.ts`); новых нет | `raw/eslint.txt`, `raw/eslint-baseline.txt` |
| `npm run borderless`, `npm run palette:neutral` | пересобраны после каждой части и после слияния | `src/app/borderless.css`, `src/app/neutral-palette.css` |
| Разовый перенос журналов офиса на стенде | dry-run → перенос → повтор пропущен | `raw/office-journals-migration.txt` |

## Критерии приёмки

AC_SECTION

## Независимое ревью

REVIEW_SECTION

## Вердикт

VERDICT_SECTION
