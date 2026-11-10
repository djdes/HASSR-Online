# Публикация «Сетап помощник» (`ru.wesetup.helper`) в RuStore

Быстрая памятка по выкладке приложения печати этикеток в **RuStore Консоль** (`https://console.rustore.ru`).

- Готовые тексты для копирования (название, описания, комментарий модератору до 180 символов): [`listing-ru.md`](listing-ru.md)
- Полная инструкция по регистрации компании в RuStore и выкладке обоих приложений (`WeSetup` и `Сетап помощник`): [`../../../../docs/mobile/12-rustore.md`](../../../../docs/mobile/12-rustore.md)

## Как пересобрать скриншоты и APK для RuStore

1. **Скриншоты (6 экранов `1080×1920`, `1200×1920`, `1600×2560`):**
   ```powershell
   cd mobile\setup-helper
   .\gradlew.bat :app:testSiteDebugUnitTest --tests ru.wesetup.helper.StoreScreenshotsTest
   ```
   Скриншоты рендерятся в `app/build/store-screenshots/{phone,tablet-7,tablet-10}/` и сохранены без альфа-канала (24-bit RGB) в `store/google-play/graphics/screenshots/`.

2. **Подписанный релизный APK для RuStore (`play`-флейвор без `REQUEST_INSTALL_PACKAGES`):**
   - В GitHub Actions workflow `.github/workflows/setup-helper-check.yml` на каждый пуш собирает и подписывает официальным ключом (`20:B6:BD:34:9E:46:99:BD:DB:23:EF:0F:81:CF:3A:61:26:07:D3:B8:19:08:13:BA:64:03:21:56:41:DF:EC:B4`) три артефакта:
     - `setup-helper-play-apk-<N>` → **`app-play-release.apk`** (основной файл для загрузки в RuStore)
     - `setup-helper-play-bundle-<N>` → `app-play-release.aab` (для Google Play)
     - `setup-helper-site-apk-<N>` → `app-site-release.apk` (только для сайта `wesetup.ru/setup-helper.apk`)
