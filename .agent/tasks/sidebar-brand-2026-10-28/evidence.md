# Шапка меню: логотип, краткое название и ИНН — доказательства

Проверка — на локальной базе `wesetup_brand` (127.0.0.1:5432, не прод), dev-сервер на 3025,
Playwright (Chromium 1243). Сценарий — `raw/e2e.mjs`, итог — `raw/shots/e2e-result.json` (17/17 PASS).

| AC | Статус | Чем подтверждено |
|----|--------|------------------|
| AC1 | PASS | `1-owner-no-logo.png`, `2-owner-logo-uploaded.png`: блок по центру (отклонение осей 0.00 px без логотипа и с ним), логотип 215×54 (≤ 80 px), название 14px, «ИНН 7701234567» серым `tabular-nums`; `organization-brand.test.ts` — без ИНН строки нет |
| AC2 | PASS | `src/lib/sidebar-org-identity.test.ts`: порядок ЕГРЮЛ → «Название для журналов» → название компании; ИНН из организации или снимка, только 10/12 цифр; снимок другого ИНН не берётся |
| AC3 | PASS | e2e: заглушка + «Загрузить логотип» → выбор файла → логотип на месте заглушки без перезагрузки, кнопки нет, уведомление «…Сменить его можно в «Настройки и оформление → Фирменный стиль»» |
| AC4 | PASS | e2e: после перезагрузки логотип и нет кнопки; в «Фирменном стиле» — «Заменить» и удаление (`3-branding-page.png`), после удаления в меню снова заглушка и кнопка; юнит-тест: с логотипом нет `data-logo-upload` и `input[type=file]` |
| AC5 | PASS | e2e под заведующей (`head_chef`): заглушка без кнопки (`6-head-no-logo.png`); юнит-тест `canEditBranding: false` |
| AC6 | PASS | e2e: лист меню на телефоне 390 px (`4-phone-sheet.png`, без прокрутки вбок) и лист «Меню раздела» в оболочке Mini App (`ws-shell=mini`, `5-mini-sheet.png`) — тот же блок |
| AC7 | PASS | ru/en/uz ключи `navigation.shell.{uploadLogo,uploadLogoHint,logoUploading,logoUploaded,logoFailed,inn}`; `npm run i18n:check` 95/95; `npm run typecheck` exit 0; `npx eslint` по изменённым файлам — 0 замечаний; новые тесты 13/13; `npm run test:gate` — pass=5027, fail=0 |
| AC8 | PASS | `whats-new-notes.ts` — пункт про логотип и ИНН первым в «Главная и меню по эскизам»; строка «Шапка меню…» в локальном `CLAUDE.md` (не в git); доставка — PR в `master` |

Тёмная тема — `7-dark-no-logo.png`: плитка, кнопка и текст перекрашиваются правилами `app-theme.css`.

Замечание по Mini App: в консоли оболочки вне Telegram есть предупреждение о гидратации
`<html style="--tg-viewport-height…">` — его ставит скрипт Telegram WebApp до React; к правке
не относится (лист меню при закрытии не рендерится на сервере).
