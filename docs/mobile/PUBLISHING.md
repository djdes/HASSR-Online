# Публикация WeSetup в App Store и Google Play — актуальный маршрут

Обновлено: **31 октября 2026**. Версия приложения: **1.1.0**. Идентификатор на обеих платформах: **ru.wesetup.app**.

Этот файл — главный. Подробные экраны консолей — в разделах [00](00-overview.md)–[11](11-updates.md), тексты для
копирования — [store-listing.md](store-listing.md), секреты — [secrets.md](secrets.md).

## 1. Где мы сейчас

| Что | Состояние |
|---|---|
| Приложения Android и iOS, версия 1.1.0 (`mobile/`) | Готовы, в master. Оболочка открывает wesetup.ru/mini — всё, что меняется на сайте, приходит в приложения без новой версии |
| Сборка Android | Проверена: отладочный APK и пробный подписанный выпуск (одноразовый ключ, AAB + APK, подписи, пакет и версия) — в «Проверке приложений» при каждой правке `mobile/` |
| Сборка iOS | Проверена сборкой для симулятора в «Проверке приложений»; манифест приватности (`PrivacyInfo.xcprivacy`) внутри приложения |
| Проверка перед выпуском | Не даст собрать выпуск без ключа подписи, паролей, Firebase-файлов или с тестовым адресом сайта |
| Ссылки, которые открываются в приложении | Кабинет, журналы, QR-плакаты и наклейки, QR в шапке печатного журнала (`/qj/…`), личный QR-вход (`/q/…`), настройка входа по QR (`/pair/…`), приглашения (`/join/…`, `/invite/…`), удаление аккаунта |
| Скриншоты | 6 для iPhone 6,9" (1320×2868) и 6 для Android (1080×1920), сняты 31.10.2026 с текущего интерфейса; значок 512 и баннер 1024×500 — [asset-manifest.json](asset-manifest.json) |
| Тексты карточек | Готовы, лимиты проверены автоматически — [store-listing.md](store-listing.md) |
| Кабинет на домашнем экране (PWA) | Обновлён вместе с приложениями: тот же значок, заставка на iPhone, значок уведомлений — работает сразу после деплоя сайта |
| Аккаунты Apple Developer, Google Play Console, Firebase | **Нужен владелец** (раздел 2) |
| Секреты GitHub для выпуска | **Нужен владелец.** 07.10.2026 выпуск остановился: секретов не было. Первым шагом «Выпуск приложений» сам перечисляет, каких секретов нет |
| Переменные сервера (`APPLE_TEAM_ID`, `ANDROID_CERT_SHA256`, `APPLE_APP_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`) | После аккаунтов — вписывает разработчик ([secrets.md](secrets.md)) |
| Демо-вход для проверяющих на рабочем сайте | **Нужен владелец** (раздел 8) |
| Политика конфиденциальности с разделом о приложениях | **Нужен юрист** — черновик правок: [privacy-policy-draft.md](privacy-policy-draft.md) |

## 2. Что сделать владельцу — по порядку

- [ ] **D-U-N-S** компании ([01](01-apple-developer.md)) — нужен и Apple, и Google.
- [ ] **Apple Developer Program** на организацию ([01](01-apple-developer.md)), затем в **App Store Connect** ([02](02-app-store-connect.md)):
  запись приложения `ru.wesetup.app`, **командный** ключ App Store Connect API с ролью **Admin**, ключ APNs для push.
- [ ] **Google Play Console** на организацию ([03](03-google-play-console.md)) и приложение «WeSetup: журналы ХАССП».
- [ ] **Firebase** ([04](04-firebase.md)): приложения Android и iOS `ru.wesetup.app`, ключ APNs в настройках
  Cloud Messaging, сервисный аккаунт для сервера.
- [ ] Передать ключи разработчику безопасным способом ([05](05-handoff.md)) или самому занести **секреты GitHub** (раздел 4).
- [ ] Запустить **«Выпуск приложений»** (раздел 5) и проверить приложения на своём телефоне ([09](09-release.md), шаг 4).
- [ ] Заполнить карточки и анкеты (разделы 6–7), вход для проверяющих (раздел 8).
- [ ] Отправить на проверку и после одобрения нажать «Опубликовать» (раздел 9).

Регистрация организации из России в Apple официально не подтверждена ни «да», ни «нет» — что делать при отказе,
в [00-overview.md](00-overview.md). Google Play для организаций из России доступен.

## 3. Карточки приложений в консолях

**App Store Connect** → Apps → **+** → New App:

| Поле | Значение |
|---|---|
| Platforms | iOS |
| Name | WeSetup |
| Primary language | Russian |
| Bundle ID | ru.wesetup.app |
| SKU | wesetup-ios |
| Версия первой публикации | **1.1.0** — как в сборке. Если запись уже создана с «1.0», поменяйте номер на странице версии до выбора сборки |

Сохраните числовой **Apple ID приложения** (App Information) — он нужен серверу как `APPLE_APP_ID`.

**Google Play Console** → All apps → **Create app**: имя `WeSetup: журналы ХАССП`, язык Russian — ru-RU, App, Free.
Имя пакета `ru.wesetup.app` подтянется из первого AAB, который загружается вручную через консоль.

## 4. Секреты GitHub

GitHub → репозиторий → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
Подробности, команды PowerShell и где что взять — [secrets.md](secrets.md).

| Секрет | Что это |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Ключ загрузки Google Play `upload.jks` в base64. Ключ **уже существует** (у разработчика, отпечаток в [secrets.md](secrets.md)) — не заменяйте его новым |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Пароли и имя ключа загрузки |
| `GOOGLE_SERVICES_JSON_BASE64` | `google-services.json` Firebase для Android в base64 |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Только для автоматической загрузки во внутреннее тестирование (`track=internal`); первую сборку Google принимает только вручную |
| `APPLE_TEAM_ID` | Team ID (10 знаков) |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64` | Ключ App Store Connect API (`.p8` в base64) |
| `GOOGLE_SERVICE_INFO_PLIST_BASE64` | `GoogleService-Info.plist` Firebase для iOS в base64 |

Ключ **APNs** и ключ **App Store Connect API** — два разных файла `.p8`: первый загружается в Firebase, второй — в GitHub.

## 5. Сборки: «Выпуск приложений»

GitHub → **Actions** → **Выпуск приложений** → **Run workflow** (ветка `master`):

| Поле | Первый раз |
|---|---|
| platform | `both` |
| track | `none` — только собрать (первый AAB Google принимает только вручную) |
| play_status | `draft` |
| upload_ios | `false` — только собрать; `true` — сразу в TestFlight |
| build_number | пусто (номер запуска) или число больше всех загруженных раньше |

Что делает: сначала проверяет, все ли секреты на месте, и перечисляет недостающие; затем собирает и проверяет
подписи, пакет `ru.wesetup.app`, версию 1.1.0 и номер сборки, манифест приватности iOS. В артефактах запуска:

- Android `wesetup-android-<номер>`: `app-release.aab` — для Google Play, `app-release.apk` — поставить на телефон
  напрямую, `release-manifest.json` (SHA-256, коммит), `upload-certificate.txt` (отпечаток ключа загрузки);
- iOS `wesetup-ios-<номер>`: `WeSetup.ipa` и `release-manifest.json`. IPA ставится через TestFlight
  (`upload_ios=true` или приложение Transporter на Mac), просто скопировать его на iPhone нельзя.

Отладочный APK и сборка для симулятора из «Проверки приложений» в магазины не загружаются.

## 6. Карточки: тексты и картинки

- Тексты — [store-listing.md](store-listing.md) (название, подзаголовок, рекламный текст, ключевые слова, описание,
  «Что нового»). Длины проверены: `npm --prefix mobile run test:release`.
- App Store: скриншоты `screenshots/ios/01…06` (iPhone 6,9"), категория Business (+ Productivity), Support и
  Marketing URL — https://wesetup.ru, Privacy Policy — https://wesetup.ru/privacy, **Manually release this version**.
- Google Play: значок `store-graphics/icon-512.png`, баннер `store-graphics/feature-graphic.png`, скриншоты
  `screenshots/android/01…06`, почта support@wesetup.ru, сайт https://wesetup.ru, политика https://wesetup.ru/privacy.

Скриншоты сняты в режиме приложения на демо-компании «Кафе «Демо»» (вымышленные люди и данные) в середине смены.
Как переснять — `.agent/tasks/pwa-mobile-release-2026-10-31/e2e/shots-take.mts`, затем `node mobile/scripts/store-assets.mjs`.

Не обещайте в текстах полной работы без интернета и гарантированного прохождения проверки.

## 7. Анкеты о данных

Ответы по текущему коду и что подтвердить до отправки — [07-privacy-forms.md](07-privacy-forms.md). Главное:

- Рекламы нет, рекламного отслеживания нет (`NSPrivacyTracking = false`), Метрика в приложении выключена.
- Данные собираются: имя, телефон, почта, записи журналов, фото, отметки здоровья и допуска, идентификаторы для push.
  Отметки здоровья — это данные здоровья: в Google Play нельзя выбирать «не использует данные здоровья».
- Удаление аккаунта: в приложении «Профиль → Удалить аккаунт» и страница https://wesetup.ru/delete-account.
- Шифрование: только стандартный HTTPS — `ITSAppUsesNonExemptEncryption = false` уже в сборке.
- Возрастной рейтинг рассчитывает магазин по анкете — отвечайте по фактическому содержимому.

## 8. Вход для проверяющих

1. На **рабочем** сайте — отдельная демо-компания с вымышленными сотрудниками и записями (скрипт есть у
   разработчика, нужен пароль администратора платформы).
2. Постоянный вход руководителя (телефон + пароль) и второй аккаунт — для проверки удаления. Вход должен работать
   на чистом телефоне без SMS, Telegram и VPN.
3. Учётные данные — в закрытые поля App Review Information / App access, заметка для проверяющих — из
   [08-review.md](08-review.md), квадратные скобки заменить.

## 9. Выпуск

- **Google Play:** первый `app-release.aab` загрузить вручную во **внутреннее тестирование**, включить Play App
  Signing, дать ссылку тестировщикам; затем «Рабочая версия» → тот же выпуск → проверка → «Опубликовать»
  ([09](09-release.md), шаги 2 и 5). Для личного аккаунта, созданного после 13.11.2023, сначала закрытый тест
  12 человек 14 дней — поэтому регистрируйте аккаунт на организацию.
- **App Store:** сборка в TestFlight → проверка на iPhone → страница версии **1.1.0** → Build → Add for Review →
  Submit → после одобрения **Release This Version** ([09](09-release.md), шаги 3 и 6).
- Отказ — ответы в [10-rejections.md](10-rejections.md).

## 10. После выхода — разработчику

- `APPLE_APP_ID` — числовой Apple ID приложения (кнопка «Обновить» ведёт прямо в App Store).
- `ANDROID_CERT_SHA256` — отпечаток **App signing key** из Play Console (App integrity) и отпечаток ключа загрузки,
  через запятую: без отпечатка Google ссылки с QR открываются в браузере, а не в приложении.
- `APPLE_TEAM_ID` — Team ID, иначе iPhone не откроет ссылки в приложении.
- `FIREBASE_SERVICE_ACCOUNT_JSON` — без него сервер не отправляет push в приложения.
- Проверить: https://wesetup.ru/.well-known/apple-app-site-association и https://wesetup.ru/.well-known/assetlinks.json.
- Заменить на сайте плашку «Скоро в App Store и Google Play» ссылками на магазины.

Следующие версии — [11-updates.md](11-updates.md): поднять `version` в `mobile/package.json`, запустить «Выпуск
приложений» с номером сборки больше прежних, в консолях — новая версия с «Что нового».
