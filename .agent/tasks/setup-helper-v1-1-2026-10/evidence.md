# Доказательства: «Сетап помощник» 1.1 (25.10.2026)

Спецификация: `spec.md`. Всё ниже — результаты команд на финальном коде
(контейнер Linux, JDK 21, Android SDK 36, Node 22, PostgreSQL 16).

## Сводка по критериям

| AC | Итог | Чем подтверждено |
|---|---|---|
| AC1 Поиск принтера | PASS | `PrinterNames.score(name, deviceClass)`: Imaging/Printer — 75, Imaging — 60, бренды этикеточных принтеров, «POS» только словом (`PrinterNamesTest`). `FoundDevice.visibleByDefault()` — имя, сопряжение или класс принтера. `DeviceScanner`: 40 с, классический поиск перезапускается по `ACTION_DISCOVERY_FINISHED` (до 3 кругов), `startDiscovery()==false` — до 3 повторов через 1,5 с, BLE — через `ScanThrottle` (не чаще раза в 6 с, ≤4 за 30 с; `ScanThrottleTest`), уже идущий BLE не перезапускается. Класс устройства — из `EXTRA_CLASS`. `ScreensTest`: безымянный принтер из `ACTION_FOUND` с классом 0x0680 виден с пометкой, наушники — под «Показать все устройства (ещё 1)»; после 40 с без принтера — карточка помощи, «Настройки Bluetooth» открывает `ACTION_BLUETOOTH_SETTINGS`, «Искать снова» прячет её. Ошибки: `PrinterConnector.ConnectFailure` — «не дал сопрячься» / «не отвечает», в диалоге ошибки — кнопка «Настройки Bluetooth». |
| AC2 Шаблоны производства | PASS | 8 шаблонов (`21-semi-finished` … `28-reject`) в assets и в APK (`raw/apk-verify.txt`). Поле-текст с `options` (выпадающий список с ручным вводом, `field_text_options.xml`), дата с `dateOnly`; разбор проверяет варианты по типу поля (`TemplateParserTest`: порядок шаблонов, умолчания из вариантов, 4 новых отказа). `LabelPreviewTest` — каждый шаблон помещается на 58×40, 58×30, 40×30 с нарочно длинными значениями; `ScreensTest` — Android Canvas, поля «Приёмки сырья»: дата без времени, хранение — список с ручным вводом. |
| AC3 Сервер: версия | PASS | `resources/setup-helper/version.json` (номер 2, 1.1.0, SHA-256, размер, дата, заметки); `GET /api/setup-helper/version` без входа, `no-cache`, `downloadUrl` с `?v=2`; без файла — 503. `parseReleaseManifest`, `compareAppVersions` — `setup-helper.test.ts` (15 тестов); `version/route.test.ts` — APK совпадает с манифестом (размер, SHA-256), ответ маршрута. Страница: «Версия 1.1.0» у кнопки, текст про автообновление, у телефона 1.0.0 — «Обновится до 1.1.0 автоматически» (`label-printers.test.ts`, `print-agent-settings.test.ts`, сквозной сценарий). Строки ru/en/uz, `i18n:types` перегенерирован. |
| AC4 Автообновление | PASS | `Updater` + `UpdateStore` + `SessionInstaller` + `UpdateJobService`. `UpdaterTest` (12): без сети — 0 запросов; новее — скачано, сверено, `.part` убран; повтор через 10 мин — без запроса, «Проверить обновления» — без повторной загрузки; битый файл — удалён, пауза 1 ч, потом успех; та же версия — не обновление; ставит само только свёрнутое и не печатающее приложение (Android 12+, `silent=true`), второй раз не запускает; Android 11 — `NEEDS_CONFIRMATION`, по кнопке `silent=false`; без «неизвестных приложений» — `NEEDS_PERMISSION`; отказ Android (`STATUS_FAILURE_CONFLICT`) — сборку не качаем снова, следующую качаем; неудачная установка — автоповтор только после паузы, по кнопке сразу; «Отмена» человека — без ошибок, кнопка остаётся; «обновлено до…» — один раз; параметры сессии `USER_ACTION_NOT_REQUIRED` при `silent`; задание JobScheduler — сеть, `persisted`, 6 ч, без дублей. `UpdateBannerTest`: плашка «Разрешить» → `ACTION_MANAGE_UNKNOWN_APP_SOURCES` для пакета, после разрешения — «Установится сама» и «Установить сейчас»; без обновления плашки нет. `UpdateInfoTest`, `UpdatePolicyTest` — разбор ответа, паузы 1/4/12/24 ч, интервал 30 мин, SHA-256 файла. |
| AC5 Выпуск 1.1.0 | PASS | `versionCode` 2, `versionName` 1.1.0, подпись v2 тем же сертификатом, что 1.0.0 (`e67c22a2…ce2a`), `debuggable=false`, разрешения и компоненты автообновления в манифесте APK — `raw/apk-verify.txt`. `publishRelease` отказывает без ключа и при неподнятом номере — `raw/publish-guards.txt`. Ключ — `SETUP_HELPER_KEYSTORE` или `SETUP_HELPER_KEYSTORE_BASE64`; в репозитории ключа нет. |
| AC6 Проверки | PASS | см. «Команды». Схема БД не менялась (`prisma/` без изменений). |
| AC7 Документация | PASS | `mobile/setup-helper/README.md`: «Если принтер не находится», «Шаблоны» (таблица и формат полей), «Автообновление» (по версиям Android), «Подпись» (сертификат, хранение ключа), «Выпустить новую версию» (`publishRelease`), CI. Деплой-эффект — в PR. |

## Команды и результаты

| Команда | Результат |
|---|---|
| `./gradlew :core:test :app:testDebugUnitTest --rerun-tasks` | 77 тестов, 0 упавших — `raw/android-tests.txt` |
| `./gradlew :app:lintRelease :app:lintDebug` | 0 ошибок, 0 предупреждений кода (одно — «есть новее AGP») |
| `./gradlew publishRelease` (с ключом) | BUILD SUCCESSFUL, APK 1 976 726 байт, sha256 `63eb1c32…1af8` |
| `npm run typecheck` | exit 0 |
| `npm run test:gate` (после слияния свежего master) | pass=4788, fail=0 |
| `npm run i18n:check` | exit 0 |
| `npx prisma validate` | valid |
| `npx eslint` (изменённые файлы сайта) | exit 0 |
| сквозной сценарий `e2e_v11.py` (next dev + PostgreSQL 16, чистая БД) | 38/38 — `raw/e2e-api.txt` (33 прежних шага + версия, ссылка, хеш скачанного APK, страница, пометка старой версии) |

## Ограничения

- На живом телефоне и принтере не проверено (в контейнере нет Bluetooth и
  эмулятора): поиск, сопряжение и установка обновления проверены
  Robolectric-тестами и разбором API Android (исходники Android 16).
- Тихое обновление — только Android 12+ и только после того, как человек
  один раз разрешит «Установку неизвестных приложений»; на Android 7–11
  система всегда спрашивает (плашка «Установить»).
- Версию 1.0.0 (без автообновления) на телефоне один раз обновляют вручную —
  поверх, с сохранением входа (подпись та же).
- Ключ подписи хранится вне репозитория (передан владельцу); без него
  следующий выпуск не встанет поверх.
