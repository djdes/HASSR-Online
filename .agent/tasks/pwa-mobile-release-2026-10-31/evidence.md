# Evidence: PWA и приложения iPhone/Android 1.1.0, подготовка публикации

Спека: [spec.md](spec.md). Проверено на коде ветки `claude/serene-mccarthy-rhrl3e` 31.10.2026.
Сырые результаты — в `raw/` (картинки `*.png` по правилам репозитория не коммитятся, лежат локально).

## Стенд
- PostgreSQL 16 локально (`wesetup_e2e`), `prisma db push`, `prisma/seed.ts`, демо-компания «Кафе «Демо»» —
  `e2e/shots-seed.ts` (14 дней истории, сид на 13:30 МСК) и `e2e/shots-claims.ts` (задачи смены и уведомления).
- Сайт: `next dev` на 3021 под libfaketime (сдвиг на 13:30 МСК — середина смены), браузер с тем же временем
  (`context.clock.install`). Android SDK 36 + build-tools 35/36, JDK 21, Gradle 8.14.3 (зеркало Maven Central
  локально из-за 429 у repo.maven.apache.org; в репозиторий не попадает).

## AC1. Версия 1.1.0 и зависимости — PASS
- `mobile/package.json` → `1.1.0`; `@capacitor/app` 8.1.2, `@capacitor/share` 8.0.3, `@capacitor/status-bar` 8.0.4,
  lock пересобран `npm install`. Core/cli/android/ios 8.5.2, filesystem 8.1.3, firebase 8.5.2 оставлены — причины в
  `mobile/README.md` (таблица «Версии»).
- `npx cap sync android` → `capacitor.config.json`: `WeSetupApp/1.1.0 (android)`, `https://wesetup.ru/mini?src=app`,
  cleartext false, allowNavigation `wesetup.ru, www.wesetup.ru`.
- APK: `package: name='ru.wesetup.app' versionCode='1' versionName='1.1.0'` (`raw/android-debug-build.txt`).

## AC2. Ссылки в приложение — PASS
- `APP_LINK_PATHS` + `/invite/*`, `/pair/*`, `/q/*`, `/qj/*`; AndroidManifest — `android:path` для `/mini` и
  `/delete-account`, `pathPrefix` со слешем для разделов.
- `src/lib/app-links.test.ts`: 6/6; на старом манифесте 2 новых теста падают (проверено подстановкой файла из HEAD).
- В собранном APK (aapt2 xmltree): `/mini /mini/ /journals/ /join/ /invite/ /pair/ /q/ /qj/ /journal-fill/
  /equipment-fill/ /room-fill/ /task-fill/ /delete-account`.
- Стенд: `/.well-known/apple-app-site-association` (APPLE_TEAM_ID=ABCDE12345) отдаёт те же 13 путей.

## AC3. Выпуск без сюрпризов — PASS
- `npm run test:release`: 13/13 (8 — проверка перед выпуском, 5 — материалы магазинов), `raw/mobile-test-release.txt`.
- Без Firebase release-сборка остановлена Gradle-проверкой с понятной причиной (`raw/android-release-blocked-without-firebase.txt`).
- С одноразовым ключом и тестовым Firebase: `bundleRelease assembleRelease` → «Проверка перед выпуском пройдена»,
  apksigner (v2) OK, jarsigner «jar verified», aapt2 `ru.wesetup.app 1.1.0 (7)`, паспорт с SHA-256
  (`raw/android-release-dry-run*.{txt,json}`).
- Шаг «Пробный выпуск с одноразовым ключом» из `mobile-check.yml` выполнен локально как есть: OK, сборка 43
  (`raw/android-ci-dry-run-step-local.txt`).
- `mobile-release.yml`: сначала список недостающих секретов, значения не выводятся; исправлен путь Codex
  `../../scripts/release-manifest.mjs` → `../scripts/…` (из `mobile/android` указывал в корень репозитория);
  проверка версии/пакета в APK и IPA. YAML разобран (`yaml.safe_load`), Fastfile — `ruby -c` Syntax OK.
- Gradle-проверка через `providers.exec` (без устаревшего `project.exec`).

## AC4. Манифест приватности iOS — PASS (проверка в собранном приложении — в CI)
- `PrivacyInfo.xcprivacy`: `NSPrivacyTracking=false`, FileTimestamp `C617.1`; plist разобран plistlib.
- `project.pbxproj`: PBXFileReference, PBXBuildFile, группа App, фаза Resources; id без коллизий.
- `mobile-check.yml` (iOS) проверяет файл в `App.app` после сборки для симулятора — см. запуск CI ниже.

## AC5. Сборки — PASS (локально), CI — см. ниже
- Локально: `assembleDebug` BUILD SUCCESSFUL; release dry-run BUILD SUCCESSFUL.
- «Проверка приложений» на ветке: запуск и итог добавлены в раздел «CI» после пуша.

## AC6–AC9. PWA — PASS
- Иконки из `mobile/scripts/brand-mark.mjs` (рефакторинг `make-assets.mjs` дал побайтно те же `mobile/assets/*`):
  `app-192/512` (скруглённые), `app-maskable-192/512` (без альфы, знак внутри зоны 40 %), `apple-icon.png` 180 без
  альфы, `push-badge.png` (силуэт), ярлыки, 13 заставок iPhone (268 КБ), 3 скриншота окна установки (WebP 720×1280).
- `src/lib/manifest.test.ts` + `pwa-manifest-localization.test.ts`: 15/15 — файлы есть, размеры = заявленным,
  maskable без альфы, apple-icon без альфы, en/uz отличаются от ru только текстами, SW использует
  `NOTIFICATION_ICON`/`NOTIFICATION_BADGE`, у каждой заставки размер = media-запрос × DPR.
- Стенд, `/mini/login`: 13 `<link rel="apple-touch-startup-image">`, `apple-mobile-web-app-capable` и
  `mobile-web-app-capable`, `apple-touch-icon` 180; `/icons/*` 200 image/png с `max-age=86400`.
- Экран «Нет связи» (HTML из `mini-sw.js`) отрисован в Chromium 390×844 — тёмно-синий, как у приложений;
  «Повторить» перезагружает страницу. `service-worker-scope.test.ts` зелёный (один `skipWaiting` по сообщению).

## AC10. Скриншоты магазинов — PASS
- `e2e/shots-take.mts`: iOS 6× 1320×2868, Android 6× 1080×1920, PNG RGB без альфы; кадр «Все разделы» заменён на
  «Сегодня» руководителя (первой в разделах — карточка «Подписки», лишний повод для вопросов Apple 3.1.1).
- `docs/mobile/asset-manifest.json` пересобран; тест сверяет SHA-256, размеры, тип PNG, количество.

## AC11. Тексты и инструкция — PASS
- `store-listing.md` → 1.1.0; `listing-values.json` собирается скриптом; лимиты: ключевые слова 99/100 байт,
  описание 1510/4000, «Что нового» 286/500, краткое описание GP 76/80.
- `PUBLISHING.md` переписан на 31.10.2026; согласованы `mobile/README.md`, `docs/PWA.md`, `00`, `06`, `07`, `08`,
  `09`, `11`, `secrets.md` (имя репозитория `djdes/HASSR-Online`, пример минимальной версии 1.1.0).

## AC12. Проверки репозитория — PASS
- `npm run typecheck` — EXIT 0 (`raw/typecheck.txt`; первый запуск был убит OOM из-за параллельной сборки, повтор отдельно).
- `npm run test:gate` — pass=5302, fail=0 (`raw/test-gate.txt`).
- `npm run build` (`NEXT_DIST_DIR=.next-prodcheck`) — Compiled successfully, EXIT 0 (`raw/next-build.txt`).
- ESLint по изменённым TS — 0 ошибок.

## AC13–AC14 — после слияния
Проверяются на master после деплоя и запуска «Выпуска приложений»; итог — в отчёте задачи и PR.

## Что тест сайта меняет вне задачи
`npm run test:gate` перезаписывает PDF в `.agent/tasks/english-version-1375e736/raw/` — в коммит не включены.
