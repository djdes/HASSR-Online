# Problems (verification 2026-11-12)

## AC7 — `npm run typecheck` не зелёный из-за ошибки, которой до этой задачи уже был красен master

```
src/app/api/root/gogetlinks/plans/route.ts(109,42): error TS2353: Object literal may only specify known
properties, and 'windowDays' does not exist in type 'Date'.
```

- Та же единственная ошибка — на чистом `origin/master` e28d552b (`raw/typecheck-master-baseline.txt`); в
  GitHub Actions шаг «Type-check» красный в запусках 2294–2296 (#214, #217, #218), деплой при этом проходит.
- Источник — коммит b9b1f2df9 «feat(seo): … prepare full 35-day slot horizon» (не эта задача): вызов
  `prepareUpcomingPlannedSlots({ windowDays: 35 })` при сигнатуре `(now: Date = new Date(), horizonDays = 7)`.
  Во время работы `now.getUTCFullYear` — не функция, фоновая подготовка слотов после сохранения плана падает и
  глушится `.catch(console.warn)`.
- Наименьшее исправление — `prepareUpcomingPlannedSlots(new Date(), 35)`. Оно включает то, что задумал автор:
  при сохранении плана GoGetLinks начнут готовиться черновики статей на 35 дней вперёд (задания
  `wesetup_ggl_article` в очередь AI). Это изменение поведения чужого SEO-модуля и объёма AI-заданий, к смене
  организации отношения не имеет — в эту задачу не включено, решение за владельцем.
- Изменения этой задачи новых ошибок типов не добавляют (`raw/typecheck.txt` — та же одна строка).

## Исправлено попутно (было красным на master, мешало полному прогону)

`src/lib/navigation-localization.test.ts` падал на чистом master: русские подписи-запаски в
`src/lib/route-titles.ts` не догнали переименование «точка» → «торговая точка» из #218 («Точки и помещения»,
«Настройка точек» при «Торговые точки и помещения», «Настройка торговых точек» в `ru.json`). Подписи
выровнены со словарём; тест зелёный.
