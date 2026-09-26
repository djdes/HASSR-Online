# 04. Firebase: push-уведомления

Firebase — сервис Google, через который приходят push-уведомления на Android и iPhone. Используем только
Firebase Cloud Messaging (FCM). Аналитику Firebase не включаем.

**Что понадобится заранее**

- Аккаунт Google (тот же рабочий, что для Play Console).
- Для шага 5: файл ключа APNs `AuthKey_XXXXXXXXXX.p8`, его Key ID и Team ID ([01](01-apple-developer.md), шаги 3 и 5).
  Шаги 1–4 и 6 можно сделать раньше, не дожидаясь Apple.

**Сколько времени** — около 30 минут.

**Сколько стоит** — бесплатно. Тариф Spark, карта не нужна; отправка push в Firebase бесплатна.

## Шаг 1. Создать проект

1. Откройте https://console.firebase.google.com → **Создать проект** (Create a project).
2. **Название** — `WeSetup`. Firebase сам предложит идентификатор проекта (например, `wesetup-1a2b3`) — оставьте.
3. **Google Analytics** — **выключите** переключатель. Зачем: приложение не собирает аналитику, и в анкетах
   магазинов мы так и пишем ([07](07-privacy-forms.md)).
4. **Создать проект**.

## Шаг 2. Android-приложение

1. На главной странице проекта → **Добавить приложение** → значок **Android**.
2. Поля:
   - **Android package name** — `ru.wesetup.app` (строчными буквами, точно так). Потом не меняется.
   - **App nickname** — `WeSetup Android` (видно только вам).
   - **Debug signing certificate SHA-1** — оставьте пустым: для push не нужен.
3. **Register app** → **Download google-services.json**. Сохраните файл — он для разработчика.
4. Остальные шаги мастера (добавление SDK) пропустите кнопками **Next** / **Continue to console** — это делает разработчик.

## Шаг 3. iOS-приложение

1. На главной странице проекта → **Добавить приложение** → значок **Apple (iOS)**.
2. Поля:
   - **Apple bundle ID** — `ru.wesetup.app`.
   - **App nickname** — `WeSetup iOS`.
   - **App Store ID** — можно оставить пустым; если приложение в App Store Connect уже создано — впишите его
     Apple ID (число из [02](02-app-store-connect.md), шаг 2).
3. **Register app** → **Download GoogleService-Info.plist**. Сохраните файл — он для разработчика.
4. Остальные шаги мастера пропустите.

## Шаг 4. Проверить, что включена отправка push (FCM API v1)

1. Шестерёнка рядом с **Project Overview** → **Project settings** → вкладка **Cloud Messaging**.
2. В блоке **Firebase Cloud Messaging API (V1)** должно быть **Enabled**. Если **Disabled** — нажмите на три точки → **Manage API in Google Cloud Console** → **Enable**.
3. Старый API (**Legacy**) включать не нужно.

## Шаг 5. Загрузить ключ APNs (для iPhone)

1. **Project settings** → **Cloud Messaging** → блок **Apple app configuration** → выберите приложение `ru.wesetup.app`.
2. В **APNs Authentication Key** → **Upload** в строке **Production APNs auth key**:
   - файл `AuthKey_XXXXXXXXXX.p8`;
   - **Key ID** — 10 символов ключа APNs;
   - **Team ID** — 10 символов из Membership details.
   → **Upload**.
3. То же самое в строке **Development APNs auth key** (тот же файл, тот же Key ID). Зачем: ключ создан для
   «Sandbox & Production» и подходит для тестовых и магазинных сборок.

## Шаг 6. Ключ сервисного аккаунта (для сервера WeSetup)

Зачем: с этим ключом сервер wesetup.ru отправляет push через Firebase.

1. **Project settings** → вкладка **Service accounts**.
2. **Firebase Admin SDK** → **Generate new private key** → **Generate key**.
3. Скачается `.json` файл. Это `FIREBASE_SERVICE_ACCOUNT_JSON` — передайте разработчику ([05-handoff.md](05-handoff.md)).
   Это полноценный пароль к проекту: не отправляйте его в чат открытым текстом.

## Шаг 7 (по желанию). Доступ разработчику

**Project settings** → **Users and permissions** → **Add member** → почта разработчика → роль **Editor**.
Тогда проверять доставку push он сможет сам.

## Частые ошибки

- Опечатка в `ru.wesetup.app` (заглавная буква, пробел) — push не придёт, а исправить идентификатор нельзя:
  придётся удалить приложение в проекте и добавить заново.
- Ключ APNs загружен только в **Development** — в сборках из TestFlight и App Store push на iPhone не приходят.
- В поле **Key ID** вписан Key ID ключа App Store Connect API, а не ключа APNs. Это разные ключи ([05](05-handoff.md)).
- Включена Google Analytics — тогда анкеты о данных придётся менять. Выключается в **Project settings** → **Integrations** → **Google Analytics** → **Manage** → **Unlink**.
- Файлы `google-services.json` и `GoogleService-Info.plist` скачаны с цифрой в имени (`google-services (1).json`) — переименуйте, как было.
