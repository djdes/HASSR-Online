# Evidence — `setup-helper-no-auth-2026-11`

## Сводка приёмки (Acceptance Criteria)

| AC | Описание | Статус | Подтверждение |
|----|----------|--------|---------------|
| **AC1** | Полное отсутствие авторизации: `MainActivity` и `PrintActivity` открываются сразу на чистой установке; удалены `LoginActivity`, `SessionStore`, `KeystoreCipher`, `TokenCipher`, `SyncManager`, `Outbox`, `HelperEvents`, `BrandingStore`, пункты меню «Отправить на сайт» и «Выйти» | `PASS` | `mobile/setup-helper/app/src/main/java/ru/wesetup/helper/MainActivity.java`, `PrintActivity.java`, `HelperApp.java`, `ScreensTest.java`, `raw/emulator-main.png`, `raw/emulator-print.png` |
| **AC2** | Локальная подпись этикеток (`LabelProfileStore`) и автономная работа: карточка «Автономный режим · всё хранится на устройстве», диалог «Подпись на этикетках» (`org.name`, `org.site`, `user.name` в `SharedPreferences`), подстановка в `PrintJobs.baseValues`, все 12 шаблонов рендерятся Canvas, история печати и поиск Bluetooth работают офлайн | `PASS` | `LabelProfileStore.java`, `dialog_label_profile.xml`, `PrintJobs.java`, `LabelProfileStoreTest.java`, `PrintHistoryTest.java`, `ScreensTest.java` |
| **AC3** | Готовность варианта `play` и материалов Google Play: итоговый манифест `playRelease` без `INTERNET`, `ACCESS_NETWORK_STATE`, `REQUEST_INSTALL_PACKAGES`, `UPDATE_PACKAGES_WITHOUT_USER_ACTION`, `RECEIVE_BOOT_COMPLETED`, `LoginActivity`, `UpdateJobService`, `UpdateStatusReceiver`; обновлены `store/google-play/*`, скриншоты `1-start.png`..`4-history.png` и публичная политика `/setup-helper/privacy` | `PASS` | `mobile/setup-helper/app/src/play/AndroidManifest.xml`, `PlayFlavorTest.java`, `raw/playRelease-AndroidManifest.xml`, `mobile/setup-helper/store/google-play/`, `src/app/setup-helper/privacy/page.tsx`, `src/app/setup-helper/privacy/page.test.ts` (3/3 PASS) |
| **AC4** | Версия `1.5.0` (`versionCode = 8`), сборка и тесты Gradle (`:core:test`, `:app:testSiteDebugUnitTest`, `:app:testPlayDebugUnitTest`, `assembleSiteDebug`, `assemblePlayDebug`, `assembleSiteRelease`, `bundlePlayRelease`), проверки репозитория (`npm run typecheck`, `npm run test:gate`), развёрнутый и запущенный Android-эмулятор на `D:\android-dev` с установленным APK и живыми скриншотами `adb` | `PASS` | `raw/build-artifacts.json`, `raw/typecheck.txt` (`EXIT 0`), `raw/test-gate.txt` (`pass=5618, fail=0`), `raw/emulator-adb-proof.txt`, `raw/emulator-main.png`, `raw/emulator-print.png` |

## Собранные артефакты Android (`1.5.0`, `versionCode = 8`)

- `mobile/setup-helper/app/build/outputs/apk/play/debug/app-play-debug.apk` — `6 619 386` байт, SHA-256 `17e8c00855a525f74f3a09bad465d7567b1e9f9e0df32a473de9a5a47f9b9696`
- `mobile/setup-helper/app/build/outputs/apk/site/debug/app-site-debug.apk` — `6 621 042` байт, SHA-256 `c1429b9df3a959863ef2482b5f069503acb960e6de17ccc503d54de6ca8ad7c7`
- `mobile/setup-helper/app/build/outputs/apk/site/release/app-site-release.apk` — `1 980 186` байт, SHA-256 `722619d4364efb4e4cef40173284a0ecf3ad595c96b6d2957549e4d3fd78b08c`
- `mobile/setup-helper/app/build/outputs/bundle/playRelease/app-play-release.aab` — `2 660 493` байт, SHA-256 `d2d0534b76074ccd7a146e7daf9a4f0ae37201d0d66733dc82f98c675e60682c`

## Результаты прогона команд

- **Gradle (`:core:test :app:testSiteDebugUnitTest :app:testPlayDebugUnitTest assembleSiteDebug assemblePlayDebug assembleSiteRelease bundlePlayRelease`)**: `BUILD SUCCESSFUL` (`179 actionable tasks`, `EXIT 0`, `raw/build-artifacts.json`, `raw/playRelease-AndroidManifest.xml`)
- **Целевые тесты сайта (`privacy/page.test.ts` + `api/setup-helper/version/route.test.ts`)**: `pass=3, fail=0`
- **`npm run typecheck`**: `EXIT 0` (`raw/typecheck.txt`)
- **`npm run test:gate`**: `=== Test stats: pass=5618, fail=0 ===` (`EXIT 0`, `raw/test-gate.txt`)
- **Живой запуск в Android-эмуляторе (`D:\android-dev`, AVD `wesetup_test`, `emulator-5554`)**: `Performing Streamed Install -> Success`, открыты и сняты по `adb screencap` экраны `ru.wesetup.helper/.MainActivity` (`raw/emulator-main.png`) и `ru.wesetup.helper/.PrintActivity` (`raw/emulator-print.png`)
