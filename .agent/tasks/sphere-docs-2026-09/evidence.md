# Evidence: сферы, журналы, приказы, чек-листы (часть B, задачи B1 и B2)

Ветка `feat/sphere-docs`, worktree `C:/wt/ws-b`, база `wesetup_wt_b`. B1 — коммит `4cfa6a42` (доказательства AC-B1–B3 по данным взяты из его отчёта и прогонов `shots/01–06`, `seed*.log`). B2 — этот коммит.

## Прогон B2 (браузер)

Сервер `next dev -p 3032`, запущен из `c:/wt/ws-b` с `NEXT_DIST_DIR=.next-sphere-docs`. Браузер: playwright-core, Chromium без окна. Скрипт: `e2e/b2-e2e.mjs`, перед каждым прогоном `e2e/make-fitness-user.ts` создаёт новую организацию сферы fitness с тем же `defaultDisabledCodesFor('fitness')`, что пишет анкета. Результаты по пунктам лежат в `shots/b2-results.json`, лог — в `shots/b2-run.log`, состояние базы после прогона — в `e2e/b2-db-check.json`.

| Проверка | Итог | Что увидели |
|---|---|---|
| settings-required-enabled | PASS | pest_control, pool_water_control, hygiene, cold_equipment_control включены |
| settings-recommended-disabled | PASS | cleaning, general_cleaning, disinfectant_usage, uv_lamp_runtime выключены |
| settings-basis-condition | PASS | на карточке бассейна показаны основание и условие «нужен, если в клубе есть бассейн или ванны» |
| settings-required-off-warning | PASS | после выключения pest_control на карточке появляется «Обязателен для вашей сферы — включите»; нажатие на надпись включает журнал обратно (`b2-02`) |
| order-return-progress | PASS | `/orders/sanitary-responsible?from=onboarding` → «Сохранить в реестр» → возврат на `/settings/onboarding`, счётчик приказов 0/4 → 1/4 |
| checklist-fill-defaults | PASS | у журнала воды в бассейне было «Пусто», после «Заполнить типовыми» стало «7 пунктов»; в базе 7 строк `JournalChecklistItem`, в `AuditLog` запись `checklist.fill_defaults` |
| checklists-reviewed | PASS | после «Чек-листы проверены» записан `checklistsReviewedAt`, в журнале аудита есть `onboarding.checklists_reviewed` |
| documents-phase-closed | PASS | все 4 обязательных приказа оформлены, этап 4 «Документы» показывает «ГОТОВО 5/5» |
| quickstart-card-step | PASS | карточка на дашборде: было 14 %, стало 29 % (добавился 7-й шаг «Приказы и чек-листы») |
| public-fitness | PASS | на `/dlya-fitnes-centra` есть журнал воды с условием, приказ о дезинфекции, чек-листы и бумажные журналы; служебных пометок для юриста нет |
| public-education | PASS | на `/dlya-detskogo-sada` есть журнал суточных проб, приказ о суточных пробах и основание «Спрашивают при проверках» |
| industries-grid | PASS | на главной есть ссылки на `/dlya-fitnes-centra` |
| sitemap | PASS | `/sitemap.xml` содержит `/dlya-fitnes-centra` |
| mobile-390-no-hscroll | PASS | лишняя ширина 0 px на onboarding, settings/journals, orders, dlya-fitnes-centra, dlya-detskogo-sada |

Скриншоты: `shots/b2-01…b2-08` (ширина 1440) и `shots/b2-m1…b2-m5` (ширина 390).

## Критерии приёмки

- **AC-B1** (6 журналов, реестры, /journals-info, выключены у существующих организаций) — PASS. Это доказано в B1: `shots/01–06`, логи `seed-disable-run1/2.log`. В B2 добавлены недостающие картинки-образцы `public/journal-samples/<code>.{png,webp}` для 6 новых журналов. Раньше `/settings/journals` получал 404 на `pool_water_control.webp`.
- **AC-B2** (сфера fitness) — PASS. У новой организации fitness обязательные журналы включены, рекомендуемые выключены (проверено в браузере). Выбор сферы в анкете и подсказку по ОКВЭД проверял B1 (тест `org-lookup-map.test.ts`).
- **AC-B3** (приказы и чек-листы у каждой сферы, тесты согласованности) — PASS. Тесты `sphere-journal-rules.test.ts` и `checklist-defaults.test.ts`, в последний добавлена проверка лимитов редактора (200 и 500 символов). Новый `sphere-public-content.test.ts` проверяет, что у каждой сферы страница получает то же, что записано в правилах.
- **AC-B4** (фаза «Документы») — PASS. В браузере: оформление приказа с возвратом, «Заполнить типовыми», «Чек-листы проверены», этап закрывается, карточка на дашборде учитывает шаг. Юнит-тест `onboarding-documents.test.ts` покрывает случаи: без сферы, часть приказов оформлена, все приказы и отметка, все приказы без отметки.
- **AC-B5** (страницы `/dlya-*` из правил, `/dlya-fitnes-centra`, сетка, sitemap) — PASS. Проверено в браузере и тестами. Ручного списка `journals` в `niches.ts` больше нет, FAQ тоже строится из правил сферы. `route-slug-collisions.test.ts` проходит.
- **AC-B6** («35 журналов» не зашито; typecheck, тесты, build) — typecheck PASS, тесты PASS (2106 из 2106), build PASS (`NEXT_DIST_DIR=.next-sphere-build npm run build`, exit=0, маршрут `/dlya-fitnes-centra` есть в списке, лог — `e2e/b2-build.log`). Про «35 журналов» — см. B1.
