# Доказательства: «Сетап помощник» (25.10.2026)

Спецификация: `spec.md`. Всё ниже — результаты команд на текущем коде
(контейнер Linux, JDK 21, Android SDK 36, Node 22, PostgreSQL 16).

## Сводка по критериям

| AC | Итог | Чем подтверждено |
|---|---|---|
| AC1 Проект и сборка | PASS | `mobile/setup-helper` (Java, AGP 8.13.0, обёртка Gradle 8.14.3, compile/target 36, minSdk 24), модули `:app` и `:core`. `assembleRelease` и `assembleDebug` — BUILD SUCCESSFUL. APK `ru.wesetup.helper` «Сетап помощник», подпись v2, `debuggable=false`, `allowBackup=false` — `raw/apk-verify.txt`. Ключ подписи — из переменных окружения, в репозитории его нет (`.gitignore`: `*.jks`, `keystore.properties`). |
| AC2 Вход и сессия | PASS | Экран входа, ошибка пустых полей, сообщение об отзыве; без сессии — переход на вход; с сохранённой сессией главный экран открывается без сети (`ScreensTest`, Robolectric). Ключ шифруется Keystore AES-GCM (`KeystoreCipher`), пароль не хранится. Вход с кодом Telegram, выход и 401 — `raw/e2e-api.txt`. |
| AC3 «Добавить оборудование» | PASS | Разрешения по версии Android (`BtSupport`, `BaseActivity`), поиск: сопряжённые + классический + BLE (`DeviceScanner`); принтер AIYIN — первым (`ScreensTest.testScanListsTheAiyinPrinterFirst`, `PrinterNamesTest`). Подключение: сопряжение с PIN 0000→1234 (`Pairing`), SPP защищённый → незащищённый → канал 1 (`SppConnection`), BLE (`BleConnection`). Проверка на живом принтере в контейнере невозможна (нет Bluetooth) — см. «Ограничения». |
| AC4 Сайт видит подключение | PASS | Очередь на телефоне (`OutboxTest`: порядок, удаление принятых, только последняя печать принтера, предохранитель), события в формате сервера (`OutboxTest.testEventsMatchServerSchema`). Сервер: пакет с битым событием, повтор пакета, опоздавшее событие, перенос на другой телефон — `raw/e2e-api.txt`; страница «Онлайн принтер» показывает принтер и телефоны — там же и скриншоты (локально). |
| AC5 Протокол печати | PASS | Спецификация из драйвера — `raw/printer-spec-seagull.txt` (TSPL2, 203 dpi, 72 мм, Gap, DENSITY 8, текст растром). Поток байтов — `TsplTest` (точный заголовок, CRLF, `BITMAP 0,0,58,320,0,`, `PRINT n,1`, независимость от локали, пределы) и `raw/test-label-58x40.tspl.txt`. Полярность и упаковка — `MonoBitmapTest`. Калибровка `AUTODETECT`, самотест `SELFTEST`. |
| AC6 Шаблоны | PASS | 4 шаблона в assets; разбор и проверка ссылок на поля — `TemplateParserTest`; подстановки и «годен до» — `TemplateValuesTest`; перенос, подбор кегля, выравнивание, рамка и деления — `LayoutEngineTest`; все шаблоны на 58×40, 58×30, 40×30 помещаются, превью PNG и поток TSPL — `LabelPreviewTest`; экран печати рисует каждый шаблон настоящим Android Canvas, обязательное поле блокирует печать, ответственный подставлен из входа — `ScreensTest`. |
| AC7 Сервер | PASS | Prisma: `SetupHelperDevice`, `LabelPrinter`; diff от схемы master — только CREATE TABLE/INDEX и FK (`raw/schema-diff-from-master.sql`). Обработчики `/api/setup-helper/*`; чистые функции — `src/lib/setup-helper.test.ts` (13 тестов, в т.ч. правило «только руководство, не ROOT» — `helperAccessError`). Сквозной сценарий 33/33 — `raw/e2e-api.txt` (в т.ч. повар → 403, ROOT-правило в коде, журнал входов, хеш ключа в БД, чужая организация → 404, лимит 30/мин → 429, понижение роли → 401, APK скачивается). |
| AC8 Интерфейс сайта | PASS | Строки `printAgent.labelPrinters` в ru/en/uz, `npm run i18n:types` перегенерирован, `npm run i18n:check` — exit 0. `label-printers.test.ts` (каталоги, три языка, отключение через ConfirmDialog и sonner, пояс организации), `print-agent-settings.test.ts` обновлён под новые выборки. Ошибки гидрации в браузере нет (даты — в поясе организации). |
| AC9 Проверки | PASS | Все команды — в «Командах» ниже, перезапущены на финальном коде. Сквозной сценарий: вход → синхронизация (с повтором) → принтер на странице → отзыв → 401. **Отступление от буквы AC9:** сборка APK в CI — отдельный workflow `.github/workflows/setup-helper-check.yml` (тесты Gradle + отладочный APK и превью этикеток в артефактах; запускается и на PR), а не задание в `mobile-check.yml`: там оно запускало бы вместе с собой платную macOS-сборку iOS, а GitHub Actions не фильтрует пути для отдельных заданий. `mobile-check.yml` не реагирует на `mobile/setup-helper/**`. Цель критерия (CI собирает APK приложения) выполнена. |
| AC10 Документация | PASS | `mobile/setup-helper/README.md`, ссылка в `mobile/README.md`; деплой-эффект описан в PR. |

## Команды и результаты

| Команда | Результат |
|---|---|
| `./gradlew :core:test :app:testDebugUnitTest --rerun-tasks` | 50 тестов, 0 упавших — `raw/android-tests.txt` |
| `./gradlew :app:lintRelease` / `lintDebug` | 0 ошибок; остались только предупреждения «есть новее версия AGP/библиотек» (версии закреплены как у `mobile/android`) |
| `./gradlew assembleRelease assembleDebug` | BUILD SUCCESSFUL; release 1 945 901 байт, debug 6,5 МБ |
| `npx prisma validate` | valid |
| `npx tsx --test src/lib/setup-helper.test.ts` | 13/13 |
| `npx tsx --test …/print-agent/label-printers.test.ts …/print-agent-settings.test.ts` | 7/7 |
| `npx eslint` (изменённые файлы сайта) | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run i18n:check` | exit 0 |
| `npm run test:gate` | pass=4760, fail=0 — «Все тесты прошли», exit 0 |
| сквозной сценарий `e2e.py` (next dev + PostgreSQL 16, чистая БД) | 33/33 — `raw/e2e-api.txt` |

## Ограничения

- Печать на живом AIYIN IP-802BT и сопряжение не проверены: в контейнере нет
  Bluetooth и KVM для эмулятора. Проверены поток команд (байт в байт),
  отрисовка этикеток Android Canvas (Robolectric, native graphics), экраны и
  весь серверный путь. Первая печать на настоящем принтере — за владельцем;
  если текст выйдет перевёрнутым или бледным — «Настройки этикетки»
  (поворот, плотность), если съедет — «Калибровка зазора».
- Подпись APK — тестовым ключом (не в репозитории). APK, собранный другим
  ключом, ставится только после удаления этой версии.
- PNG-превью и скриншоты в `raw/` не коммитятся (`.gitignore` для `.agent`),
  они лежат в артефактах CI (`setup-helper-label-previews-*`) и в сессии.
