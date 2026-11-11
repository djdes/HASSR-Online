# Evidence

- AC1: `src/lib/app-nav.ts` (`NavSection.badge`, `productionControl.badge = "pro"`, пробрасывается в пункт родителя), `src/lib/nav-layout.ts` (badge у ссылок панели), `src/components/layout/section-top-menu.tsx` (метка у пункта с панелью, в панели и в «Ещё»), `src/lib/settings-cards.ts` + `settings-card-grid.tsx` (`pro: true` → `NavBadge`). PASS (код; тесты app-nav/nav-layout/settings-cards зелёные).
- AC2: `headerPointHidden` больше не прячет переключатель по `PLACE_FILTER_PATHS`; тест `header-point.test.ts` обновлён. PASS.
- AC3: страницы передают `headerPointId: viewedPointId(buildingContext)`. PASS (код).
- AC4: `pointSyncAction` — `kind: "place"`; `hrefAfterPointSwitch({hasPlaceParam})` возвращает путь без `?place`. Новые тесты в `point-section-sync.test.ts`. PASS.
- AC5: `point-switch-toast.tsx` (`showPointSwitchToast`), используется в `location-switcher.tsx` и `point-section-sync.tsx`. PASS (код).
- AC6: `<Toaster offset={{top:84}} mobileOffset={{top:128}} className="… dashboard-toaster">` + CSS в `globals.css`. PASS (код; живой прогон не делался — нет БД в окружении).
- AC7: typecheck — единственная ошибка в `src/app/api/root/gogetlinks/plans/route.ts` (не тронут, пришла из master); test:changed — 15 файлов, 169 pass, 0 fail. PASS.
