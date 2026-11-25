# CI-смоук на Next 16.2.12: «quick-setup-result» не дождался итога — причина и исправление

## Что упало

PR djdes/HASSR-Online#337, прогон 45555959514 (коммит c4be8954b), «Browser smoke (new features)»:
`FAIL crash locator.waitFor: Timeout 120000ms exceeded — waiting for getByTestId('quick-setup-result') to be visible`.
В логе приложения: `POST /api/settings/onboarding-template 200`, затем `GET /settings/onboarding-template 200` (обновление).

## Причина (ошибка продукта, была и раньше)

1. Первая «Настройка за 3 минуты» заводит объект «Основная точка» и открывает офис (`openOrganizationOffice`), а он
   ставит `perLocationJournals = true`. У организации два места → точки включаются (`resolveActiveBuilding`).
2. Область данных `cabinetScopeKeys(...).data` меняется с `user@org` на `user@org/<офис>/organization`.
   `SectionFrame` ставит её в `key` обёртки страницы — после `router.refresh()` страница монтируется заново.
3. Итог «Кабинет настроен» жил только в `useState` мастера: новая страница начинала с шага 1.

Стенд (production-сборка c4be8954b, `probe-before-fix.txt`): итог виден ~0,25–0,5 с, затем снова выбор вида
деятельности (`final: result=false, kinds=true`). В Next 16.1.7 dev-обновление приходило медленнее, и смоук успевал
прочитать итог до перемонтирования; в 16.2 оно быстрее — CI это поймал.

## Исправление (7a61af49a)

- `formatQuickSetupDone` / `parseQuickSetupDone` (`src/lib/onboarding-templates.ts`, тесты в
  `onboarding-templates.test.ts`): итог в адресе `?done=должности.зоны.оборудование`.
- Мастер после «Применить»: `setResult`, `router.replace(…?done=…)`, потом `router.refresh()`; страница передаёт
  `initialResult` из адреса — новая страница сразу рисует итог. «Настроить заново» убирает `?done`.

## Проверка

- `next dev` из worktree на 7a61af49a, три свежие организации: итог остаётся (`final: result=true, kinds=false`),
  оба RSC-запроса — с `?done=8.7.6`.
- CI на 7a61af49a (прогон 45559363374): «Browser smoke (new features)» — success, «E2E scenarios» — success.
- Полный браузерный смоук на сервере с исправлением — `smoke-fixed-run{1,2,3}.txt`.
