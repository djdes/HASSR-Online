# Приложения WeSetup для Android и iOS

Capacitor-оболочка вокруг мини-версии сайта. Приложение не хранит копию сайта:
оно открывает `https://wesetup.ru/mini?src=app` с сервера, поэтому любая правка
сайта сразу видна в приложении без повторной проверки в магазинах. Новая версия
приложения нужна только при изменении того, что лежит в этой папке.

Спецификация: `docs/superpowers/specs/2026-09-26-mobile-apps-design.md`,
план: `docs/superpowers/plans/2026-09-26-mobile-apps.md`.

## Что внутри

| Путь | Что это |
|---|---|
| `capacitor.config.ts` | Идентификатор `ru.wesetup.app`, название «WeSetup», стартовый адрес, приписка к User-Agent `WeSetupApp/<версия> (android\|ios)`, заставка, push |
| `package.json` | Версии Capacitor и плагинов (точные, без `^`) и **версия приложения** |
| `www/offline.html` | Экран «Нет связи с интернетом» с кнопкой «Повторить» (`server.errorPath`) |
| `www/index.html` | Заглушка: Capacitor требует папку веб-файлов, в работе не видна |
| `assets/` | Исходники иконки и заставки (1024 и 2732 px), рисует `scripts/make-assets.mjs` |
| `android/` | Проект Android (Gradle) |
| `ios/` | Проект iOS (Xcode + CocoaPods) |
| `ios/App/fastlane/` | Сборка iOS и отправка в TestFlight |

Своё в нативной части:

- **WebPrint** — локальный плагин печати: `print({ jobName })` открывает системную
  печать текущей страницы (принтер или PDF), `openSettings()` — экран приложения
  в настройках телефона. Android: `android/app/src/main/java/ru/wesetup/app/WebPrintPlugin.java`
  (регистрация в `MainActivity`), iOS: `ios/App/App/WebPrintPlugin.swift`
  (регистрация в `WeSetupViewController.capacitorDidLoad`).
- **Фото «камера или галерея»** на Android — `WeSetupWebChromeClient.java`: для
  `<input type="file" accept="image/*">` без `capture` показывает выбор камеры и
  галереи (стандартный Capacitor открывает только галерею).
- **Запасное скачивание файлов** на Android (`MainActivity.downloadFile`): если
  WebView получил файл с `Content-Disposition: attachment`, он скачивается
  системным загрузчиком с куками сессии. Основной путь — «Поделиться» из кода сайта.
- **Универсальные ссылки**: Android — intent-filter с `autoVerify` для
  `https://wesetup.ru` (`/mini`, `/journals`, `/join`, `/journal-fill`,
  `/equipment-fill`, `/room-fill`, `/task-fill`, `/delete-account`); iOS —
  `ios/App/App/App.entitlements` (`applinks:wesetup.ru`, `webcredentials:wesetup.ru`).
- **Push**: `@capacitor-firebase/messaging`. Без файлов Firebase приложение
  собирается и работает, только без push.

## Версии

| Пакет | Версия |
|---|---|
| @capacitor/core, cli, android, ios | 8.5.2 |
| @capacitor/app | 8.1.1 |
| @capacitor/app-launcher | 8.0.1 |
| @capacitor/filesystem | 8.1.3 |
| @capacitor/share | 8.0.2 |
| @capacitor/splash-screen | 8.0.2 |
| @capacitor/status-bar | 8.0.3 |
| @capacitor-firebase/messaging | 8.5.2 (Firebase Messaging: Android 25.0.1, iOS ~> 12.7) |
| @capacitor-community/speech-recognition | 7.0.1 (последняя; peer `@capacitor/core >= 7`) |
| @capacitor/assets (dev) | 3.0.5 |
| typescript (dev, нужен CLI для `capacitor.config.ts`) | 5.9.3 |

Android: minSdk 24, compile/target SDK 36, AGP 8.13.0, Gradle 8.14.3, JDK 21.
iOS: iOS 15+, только iPhone (`TARGETED_DEVICE_FAMILY = 1`), Xcode 26, **CocoaPods**
(не Swift Package Manager: у `@capacitor-community/speech-recognition` нет
`Package.swift`, только podspec).

## Сборка Android на своём компьютере (Windows)

Нужны JDK 21 и Android SDK (platform 36, build-tools 35/36, platform-tools).
Так собиралось при подготовке (всё тяжёлое — на диске D:):

```bash
cd mobile
npm ci --cache d:/wt/.npm-cache
npx cap sync android

cd android
# в Git Bash; ANDROID_SDK_ROOT убрать, если он указывает на другой SDK —
# иначе Gradle откажется собирать («different paths to the SDK»)
unset ANDROID_SDK_ROOT
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.9.10-hotspot"
export ANDROID_HOME=d:/wt/android-sdk
export GRADLE_USER_HOME=d:/wt/.gradle
./gradlew.bat assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk` (~7 МБ). Поставить на
телефон с включённой отладкой по USB: `adb install -r app-debug.apk`.

Подписанный выпуск локально (если есть ключ): положить `android/app/upload.jks`,
задать `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` и
выполнить `./gradlew bundleRelease -PversionCode=<номер>`. Без `upload.jks`
release-сборка получается неподписанной.

iOS на Windows не собрать — это делает GitHub Actions (или Mac: `npx cap sync ios`,
затем открыть `ios/App/App.xcworkspace` в Xcode).

## Выпуск: два workflow

**«Проверка приложений»** (`.github/workflows/mobile-check.yml`) — сама
запускается при изменениях в `mobile/**` и в `mobile-*.yml`, можно запустить
вручную. Без секретов. Собирает отладочный APK (артефакт
`wesetup-debug-apk-<номер>` — можно скачать и поставить) и iOS-сборку для
симулятора без подписи. Задание macOS короткое: минуты macOS в приватном
репозитории стоят в 10 раз дороже.

**«Выпуск приложений»** (`.github/workflows/mobile-release.yml`) — только вручную:
Actions → «Выпуск приложений» → Run workflow. Параметры:

- `platform` — `both` / `android` / `ios`;
- `track` — `internal` (отправить AAB во внутреннее тестирование Google Play) или
  `none` (только собрать, AAB — в артефактах);
- `play_status` — `completed` обычно; `draft`, пока приложение в Google Play ещё
  ни разу не выпускалось (Google не даёт создавать другие выпуски у черновика).

Номер сборки = номер запуска workflow (`github.run_number`), общий для Android
(`versionCode`) и iOS (`CFBundleVersion`), поэтому всегда растёт.

Секреты GitHub (названия точные; где взять — `docs/mobile/secrets.md`):

| Секрет | Для чего |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | ключ загрузки Google Play (`upload.jks` в base64) |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | пароли и имя ключа загрузки |
| `GOOGLE_SERVICES_JSON_BASE64` | `google-services.json` Firebase для Android (base64) |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | сервисный аккаунт Google Play (JSON как есть) |
| `APPLE_TEAM_ID` | Team ID Apple Developer |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64` | ключ App Store Connect API (файл `.p8` в base64) |
| `GOOGLE_SERVICE_INFO_PLIST_BASE64` | `GoogleService-Info.plist` Firebase для iOS (base64) |

### Подпись iOS без сертификатов в секретах

Сборка подписывается автоматически: `xcodebuild -allowProvisioningUpdates` с
ключом App Store Connect API (`-authenticationKeyPath/-authenticationKeyID/
-authenticationKeyIssuerID`) сам заводит App ID, включает Push и Associated Domains
по `App.entitlements`, создаёт профили; выгрузка в App Store подписывается
**облачным сертификатом распространения** (cloud-managed) Apple. Затем
`fastlane upload_to_testflight` отправляет сборку тем же ключом.

- Ключ App Store Connect API нужен **командный** (Users and Access → Integrations →
  App Store Connect API → Team Keys) с ролью **Admin**: только она даёт
  xcodebuild права на сертификаты, профили и облачную подпись. С ролью
  App Manager/Developer автоматическая подпись на облачном Mac не пройдёт.
- В App Store Connect заранее должна быть создана запись приложения с Bundle ID
  `ru.wesetup.app` (делает начальник по инструкции).
- Для архива Xcode использует сертификат разработчика и на чистой машине CI
  создаёт его сам. Если однажды сборка упадёт с ошибкой о лимите сертификатов —
  удалить старые сертификаты «Apple Development», созданные ключом API, в
  developer.apple.com → Certificates.
- Если Apple не включит возможности сама (ошибка про Push Notifications или
  Associated Domains в профиле) — включить их вручную у идентификатора
  `ru.wesetup.app` в developer.apple.com → Identifiers и перезапустить workflow.

## Куда класть файлы Firebase

В git они не попадают (см. `.gitignore`), CI кладёт их из секретов:

- Android: `android/app/google-services.json` — при наличии файла Gradle
  подключает плагин `google-services`, без него сборка идёт без push.
- iOS: `ios/App/App/GoogleService-Info.plist` — шаг сборки «Copy
  GoogleService-Info.plist» кладёт его в приложение, если он есть;
  `FirebaseApp.configure()` вызывается только когда файл в сборке.

Для локальной проверки push на Android — положить свой `google-services.json`
туда же и пересобрать.

## Как поднять версию

1. Поменять `"version"` в `mobile/package.json` (например, `1.0.0` → `1.1.0`).
2. `npx cap sync` — версия попадает в приписку User-Agent (`WeSetupApp/1.1.0 (…)`),
   в `versionName` Android и в `MARKETING_VERSION` iOS (fastlane берёт её из
   `package.json`).
3. Закоммитить и запустить «Выпуск приложений». Номер сборки поднимется сам.

Сайт может попросить обновить старые версии: `MOBILE_APP_MIN_VERSION` в `.env`
сервера (экран «Обновите приложение»).

## Иконка и заставка

`node scripts/make-assets.mjs` рисует `assets/icon-only.png`,
`icon-foreground.png`, `icon-background.png` (1024 px), `splash.png` и
`splash-dark.png` (2732 px) — фирменный блокнот с буквой «С» на фоне `#0b1024`.
Затем `npm run assets` (или `npx capacitor-assets generate …`, см. `package.json`)
раскладывает все размеры в `android/` и `ios/`.
