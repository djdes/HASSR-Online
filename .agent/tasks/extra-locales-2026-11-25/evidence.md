# Evidence
- AC1: src/i18n/locales.ts; тест src/i18n/extra-locales.test.ts, shell-polish-round2.test.ts (список переключателя).
- AC2/AC3: scripts/i18n-seed-locales.ts; вывод сборки: tg/hy/ky/de 3375 из 26314 строк (13%), fr 3373; pricing 15/15 у всех.
- AC4: messages/translated/{tg,hy,ky,de,fr}.json — 26 пространств имён (navigation, common, auth, layoutUi, language, landing,
  landingComponents, publicChrome, publicNavigation, homePage, errorSurface, loadingSurfaces, pwaManifest, publicOg,
  notifications, sharedUi, journalForm, dashboardUi, miniUi, miniHome, miniToday, journals, publicUi, staffPages, moreUi, miniSections).
- AC5: src/i18n/site-locale.ts `indexedLocalesForPath`, src/app/sitemap.ts.
- AC6: baseLocale() в document-pdf.ts, *-pdf-presentation.ts, journal-pdf-copy.ts, journals-info, journal-samples docx.
- AC7: typecheck — 0 ошибок; src/i18n/*.test.ts 106/106; test:changed (полный прогон, >25 файлов) — 0 новых падений.
- AC8/AC9 (2026-11-26): src/i18n/extra-locales.test.ts 4/4; src/i18n/*.test.ts 107/107; confirm/errors после i18n:types без изменений;
  typecheck 0 ошибок; test:changed — 3 падения, красные и на master, починены здесь же
  (borderless.css / neutral-palette.css пересобраны штатными командами; journal-entry-source.test.ts — часы зафиксированы на дату теста).
