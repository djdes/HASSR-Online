# «Сетап помощник» — Android-приложение для печати этикеток

Автономное Android-приложение (`ru.wesetup.helper`) для печати этикеток ХАССП и производственной маркировки на термопринтер **AIYIN IP-802BT** (и совместимые TSPL2-принтеры по Bluetooth Classic / BLE).

С версии **1.5.0** приложение работает **полностью без регистрации, входа и учётной записи**: сразу при запуске открывается главный экран со всеми шаблонами, живым предпросмотром этикеток и историей печати. Вариант `play` для Google Play вообще не запрашивает сетевых разрешений (`INTERNET`, `ACCESS_NETWORK_STATE`).

## Как пользоваться

1. Установить приложение из Google Play (`play`) или скачать APK с сайта (`https://wesetup.ru/api/setup-helper/download`, вариант `site`).
2. При желании в меню главного экрана (`⋮` → «Подпись на этикетках») задать локальную подпись: название заведения, сайт в шапке и имя ответственного по умолчанию (хранится только на устройстве).
3. Нажать «Добавить оборудование» → выбрать принтер в списке (PIN сопряжения — `0000` или `1234`). Посмотреть шаблоны и предпросмотр можно и без принтера — по кнопке «Посмотреть шаблоны этикеток».
4. «Пробная этикетка 58×40» — быстрая проверка; «Печать по шаблону» — 11 готовых шаблонов маркировки + произвольный текст + локальная «История» прошлых печатей.

## Что внутри

| Модуль / пакет | Что делает |
|---|---|
| `core/` (чистая Java) | `print/Tspl` — команды TSPL2, `print/MonoBitmap` — картинка в формате `BITMAP`, `print/LabelSettings` — размер, зазор, плотность; `template/*` — шаблоны (JSON), подстановки `{{…}}`, раскладка этикетки (`LayoutEngine`), `LabelRecord` |
| `core/…/catalog`, `app/…/catalog` | `Catalog`, `CatalogStore` — локальный справочник подсказок для полей этикеток |
| `app/…/LabelProfileStore` | локальная подпись шапки этикеток (`org.name`, `org.site`, `user.name`) в `SharedPreferences` |
| `app/…/bt` | поиск (`DeviceScanner`), сопряжение с PIN (`Pairing`), SPP и BLE (`SppConnection`, `BleConnection`, `PrinterConnector`), очередь печати (`PrinterManager`) |
| `app/…/print/LabelRenderer` | рисует этикетку Android Canvas и переводит в монохром |
| `core/…/update`, `app/…/update`, `app/…/net/ApiClient` | автообновление для варианта `site`: проверка `GET /api/setup-helper/version`, скачивание APK и установка через `PackageInstaller` |
| `app/src/main/assets/templates/*.json` | 12 шаблонов этикеток |

## Сборка

Два варианта (`productFlavors`, измерение `distribution`):

- **site** — APK с `wesetup.ru`, обновляется через сайт (`publishRelease`);
- **play** — AAB для Google Play: без самообновления и без сетевых разрешений (`src/play/AndroidManifest.xml`, `BuildConfig.SELF_UPDATE = false`). Материалы для консоли — в `store/google-play/`.

Нужны JDK 21 и Android SDK (platform 36, build-tools 35+).

```bash
cd mobile/setup-helper
./gradlew :core:test :app:testSiteDebugUnitTest   # тесты: ядро, экраны (Robolectric)
./gradlew :app:testPlayDebugUnitTest              # вариант Google Play
./gradlew assembleSiteRelease                     # APK для сайта: app/build/outputs/apk/site/release/
./gradlew bundlePlayRelease                       # AAB для Google Play: app/build/outputs/bundle/playRelease/
```

### Подпись

Репозиторий публичный, поэтому ключа подписи в нём нет. Release подписывается ключом из переменных окружения:

```bash
export SETUP_HELPER_KEYSTORE=/путь/к/ключу.jks        # или:
export SETUP_HELPER_KEYSTORE_BASE64="$(base64 -w0 ключ.jks)"
export SETUP_HELPER_KEYSTORE_PASSWORD=…
export SETUP_HELPER_KEY_ALIAS=setup-helper
export SETUP_HELPER_KEY_PASSWORD=…
```

Все выпуски с 1.2.0 подписаны одним ключом — сертификат SHA-256 `20b6bd349e4699bddb23ef0f81cf3a612607d3b8190813ba6403215641dfecb4` (`releaseCertSha256` в `app/build.gradle`).

**Где лежит ключ** (alias `setup-helper`, PKCS12; пароли — в `.env` рядом):

| Где | Что |
|---|---|
| Сервер wesetup.ru: `/var/www/wesetupru/data/secrets/setup-helper/` (права 700, вне сайта и деплоя) | `setup-helper-release.jks` + `setup-helper-release.env` |
| Рабочий компьютер разработки: `C:\Users\Oleg\.wesetup-keys\` | те же два файла |
| Секреты GitHub репозитория | `SETUP_HELPER_KEYSTORE_BASE64`, `SETUP_HELPER_KEYSTORE_PASSWORD`, `SETUP_HELPER_KEY_ALIAS`, `SETUP_HELPER_KEY_PASSWORD` |

**Выпуск через CI**: Actions → «Сетап помощник — проверка» → Run workflow на master с галочкой `publish` (или `gh workflow run setup-helper-check.yml -f publish=true`). Артефакт `setup-helper-publish-N` содержит готовые `setup-helper.apk` и `version.json`, а `setup-helper-play-aab-N` — подписанный `app-play-release.aab` для Google Play Console.
