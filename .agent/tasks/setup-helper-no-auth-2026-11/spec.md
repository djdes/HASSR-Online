# «Сетап помощник» 1.5.0: работа без авторизации для прохождения модерации Google Play и локальная проверка в эмуляторе (03.11.2026)

## Запрос

> нужно что бы ты из приложения убрал автризацию вообще, и поставб какой нибудь эмулятор сюда что бы я протестил приложение
> да все сделай авторизацию убираю что бы пройти модерацию в google.console

## Контекст и решения

1. **Полный отказ от экрана входа и серверной привязки аккаунта.**
   - Приложение открывает сразу `MainActivity` без проверки сессии.
   - `LoginActivity`, `SessionStore`, `KeystoreCipher`, `TokenCipher`, `SyncManager`, `Outbox`, `HelperEvents`, `BrandingStore` и сетевое скачивание `CatalogStore` убираются: приложению больше не нужны ни почта/пароль, ни код из Telegram, ни демо-аккаунт для проверяющих Google Play.
2. **Локальная подпись этикеток на устройстве (`LabelProfileStore`).**
   - В шапке шаблонов этикеток слева печатается `{{org.name}}` (по умолчанию `WeSetup`), справа `{{org.site}}` (`wesetup.ru`), в поле ответственного подставляется `{{user.name}}`.
   - В меню главного экрана пункт «Подпись на этикетках» позволяет при желании задать локально название заведения, сайт/подпись в шапке и имя ответственного по умолчанию — всё хранится только в `SharedPreferences` телефона.
3. **Максимально чистая сборка `play` для Google Play Console.**
   - В `app/src/play/AndroidManifest.xml` кроме разрешений самообновления удаляются `android.permission.INTERNET` и `android.permission.ACCESS_NETWORK_STATE` (`tools:node="remove"`): вариант для Google Play вообще не ходит в интернет и не собирает никаких данных.
   - В варианте `site` (`SELF_UPDATE = true`) `ApiClient` оставляет только неавторизованную проверку и скачивание обновлений (`GET /api/setup-helper/version` и `/api/setup-helper/download`).
   - Тексты и анкеты в `mobile/setup-helper/store/google-play/` приводятся в соответствие: «Все функции доступны без специальных прав доступа» (App access) и «Нет, приложение не собирает и не передаёт пользовательские данные» (Data safety).
4. **Эмулятор на рабочем ПК.**
   - На диске `C:` свободно 12,4 ГБ, в BIOS выключена аппаратная виртуализация (`Virtualization Enabled In Firmware: No`), на `D:` свободно 8,5 ТБ.
   - Весь стек (`JDK 21`, `Android SDK`, `AVD`, кэш Gradle) разворачивается в `D:\android-dev` (вне репозитория). Для запуска без VT-x создаётся AVD на ARM-образе Android (QEMU TCG `-no-accel`), в него устанавливается собранный APK и запускается `MainActivity`.

## Критерии приёмки

- **AC1. Полное отсутствие авторизации.**
  - На чистой установке `MainActivity` и `PrintActivity` открываются сразу без редиректа на вход.
  - В манифесте и коде нет `LoginActivity`, `SessionStore`, `KeystoreCipher`, `SyncManager`, пунктов меню «Отправить на сайт» и «Выйти».
- **AC2. Локальная подпись этикеток и автономная работа.**
  - На главном экране отображается карточка автономной работы и меню «Подпись на этикетках», сохраняющее название заведения и ответственного локально и подставляющее их в `PrintJobs.baseValues`.
  - Все 12 шаблонов этикеток рендерятся Android Canvas без пустой шапки, история печати и поиск Bluetooth работают прежним образом.
- **AC3. Готовность варианта `play` и материалов Google Play.**
  - Итоговый манифест `play` не содержит `INTERNET`, `ACCESS_NETWORK_STATE`, `REQUEST_INSTALL_PACKAGES`, `UPDATE_PACKAGES_WITHOUT_USER_ACTION`, `RECEIVE_BOOT_COMPLETED`.
  - Документы `mobile/setup-helper/store/google-play/{app-content,data-safety,listing-ru,listing-en,README}.md` обновлены под работу без аккаунта; `StoreScreenshotsTest` генерирует актуальные скриншоты без экрана входа.
- **AC4. Сборка, тесты и живой запуск в эмуляторе.**
  - Версия поднята до `1.5.0` (`versionCode = 8`), проходят `:core:test`, `:app:testSiteDebugUnitTest`, `:app:testPlayDebugUnitTest`, собираются `assembleSiteDebug`, `assemblePlayDebug`, `assembleSiteRelease`, `bundlePlayRelease`, а также проходят проверки репозитория `npm run typecheck` и `npm run test:gate`.
  - На `D:\android-dev` развёрнут и запущен Android-эмулятор, установлен новый APK, открыт главный экран и экран шаблонов этикеток (подтверждено `adb` и скриншотом).
