# Первая публикация WeSetup: от аккаунтов до выпуска
Обновлено: 8 октября 2026. Версия приложения: **1.0.0**. Идентификатор обеих платформ: **ru.wesetup.app**.

## 1. Что уже сделано и чего ещё не хватает
Нативные проекты находятся в `mobile/android` и `mobile/ios`. Это Capacitor-приложения с системной печатью, камерой, голосовым вводом, отправкой файлов и push через Firebase. Они загружают актуальный интерфейс с wesetup.ru.

На момент подготовки этого пакета:
- проекты и 12 скриншотов найдены;
- старый Android AAB проверен: он **не подписан**, загружать его в Google Play нельзя;
- GitHub Secrets не содержат ключей мобильного выпуска;
- прежний ключ Android указан в `C:\Users\Yaroslav\wesetup-android`, но недоступен текущему пользователю Windows;
- Apple Team ID, ключ App Store Connect и обе конфигурации Firebase ожидаются от владельца;
- результаты новых проверок и точный состав файлов смотрите в `STATUS.md` внутри пакета. Наличие инструкции не означает, что подписанные сборки уже получены.

## 2. Сначала подготовьте аккаунты владельца
Если аккаунты уже готовы, переходите к разделу 3.

### Apple
1. Войдите своим Apple Account в [Apple Developer](https://developer.apple.com/account/), включите двухфакторную аутентификацию.
2. Для публикации от компании выберите **Organization** и используйте её настоящие реквизиты и D-U-N-S. Имя продавца определяется аккаунтом, а не названием приложения.
3. Завершите проверку организации и вступление в программу. Условия, доступность в стране и фактическую стоимость проверьте в форме Apple. Не создавайте аккаунт на фиктивную организацию.
4. Договоры принимает владелец аккаунта. Участнику команды достаточно приглашения с нужными правами — пароль владельца передавать не нужно.
5. Apple Developer → Membership details: сохраните **Team ID**.
6. Certificates, Identifiers & Profiles → Identifiers → **+** → App IDs → App → Explicit Bundle ID: `ru.wesetup.app`.
7. Включите **Push Notifications** и **Associated Domains**.
8. App Store Connect → Users and Access → Integrations → App Store Connect API: создайте **Team Key**, сохраните Key ID, Issuer ID и скачайте `.p8`. Доступ к Certificates, Identifiers & Profiles и cloud-managed distribution должен быть разрешён. Для первоначальной настройки существующего сценария используется ключ Admin; храните его как секрет.
9. Подробный маршрут регистрации: [01-apple-developer.md](01-apple-developer.md), [02-app-store-connect.md](02-app-store-connect.md).

### Google
1. Откройте [Google Play Console](https://play.google.com/console/) под аккаунтом владельца.
2. Для компании выберите **Organization**, заполните настоящие реквизиты и пройдите проверку личности/организации и контактов.
3. Завершите регистрацию и проверьте доступ к созданию приложений.
4. Если используется **личный аккаунт, созданный после 13 ноября 2023**, для доступа к production нужен закрытый тест с минимум 12 непрерывно подключёнными тестировщиками в течение минимум 14 дней и последующая заявка. Внутренний тест его не заменяет. [Официальное правило Google](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en).
5. Подробные экраны: [03-google-play-console.md](03-google-play-console.md).

## 3. Создайте карточки приложений
### App Store Connect
Apps → **+** → New App:
| Поле | Значение |
|---|---|
| Platforms | iOS |
| Name | WeSetup |
| Primary language | Russian |
| Bundle ID | ru.wesetup.app |
| SKU | wesetup-ios |
| User Access | По составу вашей команды |
| Версия первой публикации | **1.0.0**, как в сборке |

Сохраните числовой **Apple ID приложения** из App Information. Он отличается от Team ID и Apple Account.

### Google Play Console
All apps → **Create app**:
| Поле | Значение |
|---|---|
| App name | WeSetup: журналы ХАССП |
| Default language | Russian — ru-RU |
| App or game | App |
| Free or paid | Free |
| Category | Business |
Подтвердите декларации только после прочтения. Имя пакета `ru.wesetup.app` подтянется из первого AAB. Первый AAB загружается через консоль.

## 4. Firebase и доставка уведомлений
1. Создайте или откройте проект в [Firebase Console](https://console.firebase.google.com/).
2. Add app → Android: package name **ru.wesetup.app**. Скачайте `google-services.json`.
3. Add app → iOS: Bundle ID **ru.wesetup.app**. Скачайте `GoogleService-Info.plist`. При добавлении укажите числовой Apple ID, если консоль его спрашивает.
4. Apple Developer → Keys → создайте APNs authentication key, скачайте `.p8`, сохраните Key ID.
5. Firebase → Project settings → Cloud Messaging → Apple app configuration: загрузите **APNs key**, укажите его Key ID и Team ID.
6. Ключ **APNs** и ключ **App Store Connect API** — два разных ключа, несмотря на одинаковое расширение.
7. Firebase → Service accounts: подготовьте сервисный аккаунт для сервера. Его JSON нужен на сервере как `FIREBASE_SERVICE_ACCOUNT_JSON`, а не внутри приложения.
8. Подробности: [04-firebase.md](04-firebase.md).

Конфигурация Firebase внутри сборки подтверждает настройку клиента. Доставку push обязательно отдельно проверить на настоящем Android и iPhone после настройки сервера/APNs.

## 5. Восстановите ключ Android и заполните GitHub Secrets
Сначала найдите **существующий** `upload.jks`, его alias и пароли. Не заменяйте его случайным новым ключом. Если приложение уже загружалось в Play Console, сравните отпечаток с Upload key certificate в App integrity. Если ключ утрачен, порядок действий зависит от того, был ли первый выпуск; используйте процедуру Play Console.

GitHub → репозиторий WeSetup → Settings → Secrets and variables → Actions → **New repository secret**:
| Название | Содержимое |
|---|---|
| ANDROID_KEYSTORE_BASE64 | Старый upload.jks в base64 |
| ANDROID_KEYSTORE_PASSWORD | Пароль хранилища |
| ANDROID_KEY_ALIAS | Alias ключа |
| ANDROID_KEY_PASSWORD | Пароль ключа |
| GOOGLE_SERVICES_JSON_BASE64 | Android google-services.json в base64 |
| APPLE_TEAM_ID | Team ID |
| ASC_KEY_ID | Key ID ключа App Store Connect |
| ASC_ISSUER_ID | Issuer ID |
| ASC_KEY_P8_BASE64 | Ключ App Store Connect .p8 в base64 |
| GOOGLE_SERVICE_INFO_PLIST_BASE64 | iOS GoogleService-Info.plist в base64 |

`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` нужен дополнительно, только когда захотите автоматическую загрузку Android. Для ручной загрузки первого AAB он не нужен.

В PowerShell base64 можно положить сразу в буфер, не выводя секрет в чат или лог:
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\путь\к\файлу')) | Set-Clipboard
```
Вставьте в нужный GitHub Secret, затем очистите буфер. Сделайте отдельную защищённую резервную копию ключа Android.

## 6. Получите файлы сборок
Исправленный сценарий расположен в ветке `codex/mobile-first-release-2026-10`. Пока её изменения не перенесены в master, в форме запуска выберите именно эту ветку.

GitHub → Actions → **Выпуск приложений** → Run workflow:
| Поле | Для первого получения файлов |
|---|---|
| Use workflow from | Ветка с исправленным сценарием |
| platform | both |
| track | **none** |
| play_status | **draft** |
| upload_ios | **false** |
| build_number | **1**, если ничего ещё не загружали; иначе больше всех ранее использованных номеров |

После успешного выполнения скачайте артефакты:
- Android: `app-release.aab` — для Google Play; `app-release.apk` — для установки на телефон; `release-manifest.json` и `upload-certificate.txt`.
- iOS: `WeSetup.ipa` — для App Store Connect; `release-manifest.json`.
- SHA-256 каждого файла находится в manifest. Версия должна быть 1.0.0, package/bundle ID — ru.wesetup.app.

Для отправки в TestFlight можно повторить выпуск **с новым build_number** и `upload_ios=true`. Готовый IPA также можно загрузить через Transporter на Mac. IPA нельзя просто установить на обычный iPhone из папки: для тестирования используется TestFlight.

Неподписанный AAB, debug APK и iOS simulator App.app не являются файлами для публикации. Проверочный workflow выпускает именно тестовые артефакты — они отдельно помечены.

## 7. Настройте связь приложения с сайтом
Разработчику нужны:
- `APPLE_TEAM_ID`;
- числовой `APPLE_APP_ID`;
- SHA-256 **App signing certificate** из Google Play → App integrity;
- SHA-256 upload key для проверки APK, установленного напрямую;
- серверный `FIREBASE_SERVICE_ACCOUNT_JSON`.

На сервере должны корректно отвечать:
- `https://wesetup.ru/.well-known/apple-app-site-association`;
- `https://wesetup.ru/.well-known/assetlinks.json`;
- `https://wesetup.ru/privacy`;
- `https://wesetup.ru/delete-account`.

Fingerprint подписи Google Play отличается от upload key: после включения Play App Signing Google подписывает устанавливаемый пакет своим ключом. Проверьте переходы из QR/ссылок на версии, установленной именно из магазина.

## 8. Заполните описания и картинки
Все тексты для копирования: [store-listing.md](store-listing.md). В HTML-инструкции у блоков есть кнопка «Копировать».

### Apple — страница версии
| Поле | Что выбрать |
|---|---|
| Name | WeSetup |
| Subtitle | Журналы СанПиН и ХАССП |
| Category | Business; при необходимости Productivity как вторичная |
| Promotional Text, Description, Keywords | Одноимённые блоки из store-listing.md |
| Support URL | https://wesetup.ru |
| Marketing URL | https://wesetup.ru |
| Privacy Policy URL | https://wesetup.ru/privacy |
| Copyright | 2026 ООО «БФС» — только если это актуальный правообладатель |
| Price | Free |
| Version Release | **Manually release this version** |
| Content Rights | Подтвердите наличие прав на используемый пользовательский и сторонний контент; не отрицайте его наличие автоматически |
| Availability | Фактические страны обслуживания компании |

Скриншоты: `screenshots/ios/01…06`. Их размеры перечислены в `asset-manifest.json`. Сборка заявляет только iPhone. Сверьте комплект с [требованиями Apple](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/). Иконка Apple уже включена в нативный проект.

### Google — Main store listing
| Поле | Что выбрать |
|---|---|
| App name | WeSetup: журналы ХАССП |
| Short description, Full description | Блоки Google Play из store-listing.md |
| App icon | store-graphics/icon-512.png |
| Feature graphic | store-graphics/feature-graphic.png |
| Phone screenshots | screenshots/android/01…06 |
| Support email | support@wesetup.ru |
| Website | https://wesetup.ru |
| Privacy policy | https://wesetup.ru/privacy |

Не добавляйте обещаний гарантированного прохождения проверки или полной работы без интернета. В текущем приложении есть экран восстановления связи; доступность конкретных офлайн-действий зависит от загруженных данных.

## 9. Заполните анкеты честно по текущему приложению
Подробные ответы и места, которые требует подтвердить владелец: [07-privacy-forms.md](07-privacy-forms.md).

- **Ads:** рекламы в приложении нет.
- **App access:** требуется вход; предоставьте отдельные рабочие тестовые аккаунты.
- **Target audience Google:** рабочее приложение для взрослых; 18+ как целевая аудитория. Возрастной рейтинг магазина рассчитывается отдельно по анкете.
- **Health:** отметки здоровья и допуска сотрудников являются данными здоровья. Не выбирайте «не использует данные здоровья». Для текущего сценария предложена категория Disease Prevention and Public Health; это сопоставление нашей функции с описанием Google, а не медицинская сертификация.
- **Data safety/App Privacy:** имя, контакты, идентификаторы, записи, фото, данные здоровья, действия в приложении; также проверьте голосовое распознавание и действующих AI-провайдеров.
- **Tracking:** отсутствие рекламного отслеживания не означает отсутствие сбора данных.
- **Encryption:** текущий код использует стандартное защищённое соединение; `ITSAppUsesNonExemptEncryption=false`. При появлении собственного шифрования ответ нужно пересмотреть.
- **Account deletion:** укажите веб-страницу и проверьте сценарий удаления внутри приложения.
- **Возрастная анкета Apple/IARC:** отвечайте по доступному пользователям содержимому. Не задавайте заранее желаемое «4+» вместо заполнения формы.
- Ссылки на оплату в мобильном интерфейсе скрыты. Это не гарантия решения модератора о бизнес-модели; в review notes нужно описать реальную продажу корпоративной услуги.

## 10. Подготовьте вход для модератора
1. Создайте отдельную демонстрационную организацию на **рабочем сервере** с вымышленными сотрудниками и образцами документов.
2. Создайте постоянный аккаунт руководителя: телефон + пароль. Проверьте вход на чистом устройстве без SMS, Telegram, VPN, привязки к вашей сети или одноразового кода.
3. Второй аккаунт подготовьте для проверки удаления. Не удаляйте основной review account до окончания проверки.
4. Включите те журналы и функции, которые показаны на скриншотах. Демо не должно показывать реальные данные клиентов.
5. В App Review Information / App access вставьте реальные учётные данные в специальные закрытые поля консоли.
6. Заполните имя, фамилию и телефон реального контактного лица для ревью. Support email: support@wesetup.ru.
7. В Notes вставьте текст из [08-review.md](08-review.md), заменив все квадратные скобки. Описывайте push/universal links только после проверки их работы.
8. Пока эти поля не заполнены и вход не проверен, пакет нельзя считать готовым к отправке.

## 11. Google Play: первый тест и выпуск
1. Test and release → Testing → **Internal testing** → создайте список тестировщиков.
2. Releases → Create new release → настройте **Play App Signing**.
3. Загрузите подписанный `app-release.aab`. Убедитесь в версии, номере сборки и package name.
4. Release notes: блок «Что нового» из store-listing.md внутри тегов `<ru-RU>` и `</ru-RU>`.
5. Завершите обязательные разделы Dashboard / App content, сохраните выпуск и выдайте тестировщикам ссылку подключения. Доступность теста зависит от состояния аккаунта и проверок Google.
6. Проверьте вход, сохранение, фото, голос, печать/экспорт, push, переход по уведомлению, уход в фон, отсутствие сети и удаление аккаунта.
7. Для нового личного аккаунта выполните закрытый тест из раздела 2 и получите production access.
8. Production → Create release или Promote release из теста → проверьте страны и примечания.
9. Publishing overview: отправьте изменения на review. Если доступно Managed publishing, используйте его для управляемого момента выпуска.
10. После одобрения владелец подтверждает публикацию. Срок рассмотрения не гарантируется.

Новые приложения должны соответствовать текущему target API. Проект использует target SDK 36. [Правило Google](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en).

## 12. Apple: TestFlight и App Review
1. Загрузите IPA через сценарий `upload_ios=true` или Transporter. Дождитесь обработки App Store Connect.
2. TestFlight → Internal Testing → создайте группу и добавьте пользователей команды.
3. Установите TestFlight на iPhone, примите приглашение и пройдите проверку из раздела 11.
4. Страница версии **1.0.0** → Build: выберите обработанную сборку.
5. Заполните описания, скриншоты, App Privacy, Age Rating, App Review Information и страны.
6. Проверьте предупреждения в App Store Connect. **Manually release this version** оставьте включённым.
7. Add for Review → Submit for Review. При вопросах модератора отвечайте по существующим функциям, при необходимости приложите видео их работы.
8. После одобрения и статуса Pending Developer Release владелец нажимает **Release This Version**.

Минимум для подачи с 28 апреля 2026 — iOS 26 SDK; сценарий использует macOS/Xcode 26. [Требование Apple](https://developer.apple.com/news/?id=ueeok6yw). Проверка компиляции на macOS не заменяет подписанный IPA и тест на телефоне.

## 13. Что передать для завершения именно этого выпуска
- Готовность аккаунтов и выбранное юридическое лицо/контакт для ревью.
- Доступный путь к прежнему Android keystore и его параметрам либо заполненные GitHub Secrets.
- Apple Team ID и настроенный ключ App Store Connect API.
- Два Firebase-файла, настроенный APNs и серверный сервисный аккаунт.
- Рабочие review accounts, проверенные на production.
- Подтверждённые сведения о сторонних обработчиках фото/голоса для privacy-анкет.

Передавайте секреты через GitHub Secrets или защищённое хранилище. В переписке достаточно путей и статуса готовности.
