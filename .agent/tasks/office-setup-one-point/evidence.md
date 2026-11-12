# Evidence — office-setup-one-point

- AC1 PASS — `officeSetupState` (src/lib/office-setup.ts) → `create` при ≥1 точке без деления; страница office/page.tsx показывает «Выделите офис» в состоянии `create`, «Сначала добавьте торговую точку» в `noPoints`.
- AC2 PASS — POST /api/settings/office: 400 «Сначала добавьте торговую точку» без точек; создаёт офис при его отсутствии; включает `perLocationJournals`, если выключено (и для уже существующего офиса). При офисе + 1 точке в шапке 2 здания → LocationSwitcher (`buildings.length >= 2`) показывается.
- AC3 PASS — три пункта `create.split/switcher/existing` под описанием, только когда деление ещё выключено.
- AC4 PASS — ru/en/uz обновлены, `npm run i18n:types` перегенерировал message-contract.d.ts.
- AC5 PASS — src/lib/office-setup.test.ts 5/5; `npm run test:changed` 63 файла, pass=259 fail=0. `npm run typecheck`: одна ошибка в src/app/api/root/gogetlinks/plans/route.ts — файл не тронут, ошибка есть на origin/master.
