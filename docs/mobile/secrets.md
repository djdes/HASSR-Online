# Секреты сборки и сервера (для разработчика)

Справочник для Ярослава: какие секреты нужны workflow «Выпуск приложений» (`.github/workflows/mobile-release.yml`)
и серверу wesetup.ru, откуда они берутся, как их закодировать и куда положить. Что присылает начальник — в
[05-handoff.md](05-handoff.md).

Правила:

- Секреты живут только в GitHub Secrets и в `.env` на сервере. В git, в чаты, в задачи и в логи — никогда.
- Файлы-исходники (`.p8`, `.json`, `.plist`, `.jks`) после занесения храните в менеджере паролей, а не в папке «Загрузки».
- Команды ниже — для Windows PowerShell 5.1. Репозиторий: `djdes/HACCP-Online`.

## Секреты GitHub

Где: GitHub → репозиторий → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
Или из PowerShell через `gh` (секрет читается из входного потока, в историю команд не попадает):

```powershell
# base64 файла → секрет
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\путь\к\файлу")) | gh secret set ИМЯ_СЕКРЕТА -R djdes/HACCP-Online

# обычный текст → секрет (gh спросит значение, ввод скрыт)
gh secret set ИМЯ_СЕКРЕТА -R djdes/HACCP-Online

# проверить список (значения GitHub не показывает)
gh secret list -R djdes/HACCP-Online
```

| Секрет | Что это | Откуда | Как положить |
|---|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | Ключ загрузки Android `upload.jks` | Генерирует разработчик (раздел ниже) | base64 файла |
| `ANDROID_KEYSTORE_PASSWORD` | Пароль хранилища ключей | Задаёт разработчик при генерации | текст |
| `ANDROID_KEY_ALIAS` | Имя ключа в хранилище: `wesetup-upload` | При генерации | текст |
| `ANDROID_KEY_PASSWORD` | Пароль ключа. Для хранилища PKCS12 (формат `keytool` по умолчанию) он **совпадает** с паролем хранилища | При генерации | текст |
| `GOOGLE_SERVICES_JSON_BASE64` | `google-services.json` Android-приложения Firebase | Начальник, [04](04-firebase.md) шаг 2 | base64 файла |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | JSON-ключ сервисного аккаунта `play-publisher` | Начальник, [03](03-google-play-console.md) шаг 6 | **текст JSON как есть**, не base64: `Get-Content -Raw C:\путь\play.json \| gh secret set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON -R djdes/HACCP-Online` |
| `APPLE_TEAM_ID` | Team ID (10 символов) | Начальник, [01](01-apple-developer.md) шаг 3 | текст |
| `ASC_KEY_ID` | Key ID ключа App Store Connect API | Начальник, [02](02-app-store-connect.md) шаг 4 | текст |
| `ASC_ISSUER_ID` | Issuer ID ключа App Store Connect API | Там же | текст |
| `ASC_KEY_P8_BASE64` | Файл `AuthKey_XXXXXXXXXX.p8` ключа App Store Connect API (роль Admin) | Там же | base64 файла |
| `GOOGLE_SERVICE_INFO_PLIST_BASE64` | `GoogleService-Info.plist` iOS-приложения Firebase | Начальник, [04](04-firebase.md) шаг 3 | base64 файла |

Не путать: ключ **APNs** (`.p8` для push) в GitHub не нужен — начальник загружает его в Firebase.

Проверка: **Actions** → **Выпуск приложений** → **Run workflow**. Ошибка `base64: invalid input` — секрет вставлен
с переносами или не тот файл; `Keystore was tampered with, or password was incorrect` — неверный пароль.

## Ключ загрузки Android

Генерирует разработчик один раз. Хранится в `C:\Users\Yaroslav\wesetup-android\` (вне репозитория). Копию файла и
пароль получает начальник ([05-handoff.md](05-handoff.md)) и хранит сам.

```powershell
New-Item -ItemType Directory -Force C:\Users\Yaroslav\wesetup-android | Out-Null
Set-Location C:\Users\Yaroslav\wesetup-android
# keytool входит в JDK (Android Studio: <папка Android Studio>\jbr\bin\keytool.exe)
keytool -genkeypair -v -keystore upload.jks -alias wesetup-upload -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=WeSetup, O=WeSetup, C=RU"
# keytool спросит пароль. Пароль — случайный, от 20 символов, сразу в менеджер паролей.
# Для PKCS12 отдельный пароль ключа не поддерживается: ANDROID_KEY_PASSWORD = ANDROID_KEYSTORE_PASSWORD.

# Отпечаток SHA-256 ключа загрузки (для сверки с Play Console):
keytool -list -v -keystore upload.jks -alias wesetup-upload
```

**Почему его нельзя терять.** Этим ключом подписана каждая сборка, которую мы загружаем в Google Play. Приложение
на телефонах подписывает Google своим ключом (Play App Signing), поэтому потеря ключа загрузки не смертельна, но
до его замены новые версии загрузить нельзя.

**Если ключ потерян или утёк:**

1. Сгенерировать новое хранилище (команда выше, другое имя файла, например `upload-2.jks`).
2. Выгрузить сертификат: `keytool -export -rfc -keystore upload-2.jks -alias wesetup-upload -file upload_certificate.pem`.
3. Play Console → **Тестирование и выпуск** → **Целостность приложения** → **Подписание приложений** →
   **Запросить сброс ключа загрузки** (Request upload key reset) → причина → загрузить `upload_certificate.pem`.
   Делает владелец аккаунта или пользователь с правом управлять подписанием.
4. После одобрения Google обновить секреты `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`.
5. Обновить на сервере `ANDROID_CERT_SHA256`: отпечаток ключа загрузки сменился (ключ подписи приложения — нет).
6. Отдать начальнику копию нового ключа, старую удалить.

## Переменные окружения сервера

Где: `/var/www/wesetupru/data/www/wesetup.ru/app/.env` на сервере wesetup.ru (вход по SSH — см. CLAUDE.md).
Деплой сохраняет `.env` (делает копию и возвращает её), поэтому правка переживает выкладки. После правки:
`pm2 restart haccp-online`. Шаблоны с комментариями — в `.env.shared`.

Правьте файл в редакторе на сервере (`nano .env`), а не командами `echo` — иначе значения останутся в истории команд.

| Переменная | Что это | Откуда | Формат |
|---|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Ключ сервисного аккаунта Firebase для отправки push (FCM HTTP v1) | Начальник, [04](04-firebase.md) шаг 6 | JSON **одной строкой в одинарных кавычках**, см. ниже. Пусто — push в приложения выключен |
| `APPLE_TEAM_ID` | Team ID для `/.well-known/apple-app-site-association` | Начальник, [01](01-apple-developer.md) шаг 3 | `A1B2C3D4E5` |
| `ANDROID_CERT_SHA256` | Отпечатки SHA-256 для `/.well-known/assetlinks.json`: ключ подписи приложения из Play Console **и** ключ загрузки | Начальник, [03](03-google-play-console.md) шаг 7 | через запятую без пробелов: `AB:CD:...:EF,12:34:...:56` |
| `APPLE_APP_ID` | Числовой Apple ID приложения для кнопки «Обновить» | Начальник, [02](02-app-store-connect.md) шаг 2 | `6740000000` |
| `MOBILE_APP_MIN_VERSION` | Минимальная версия приложения; ниже — экран «Обновите приложение» | Решает разработчик ([11](11-updates.md)) | `1.0.0`; пусто — без проверки |

JSON сервисного аккаунта одной строкой (поле `private_key` содержит `\n` — в одинарных кавычках dotenv оставит их как
есть, и `JSON.parse` превратит их в переводы строк):

```powershell
node -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))))" C:\путь\firebase-sa.json | Set-Clipboard
```

В `.env`: `FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'` — вставить из буфера между одинарными кавычками.
Одинарные кавычки нужны ещё и потому, что деплой читает `.env` через bash (`set -a; . ./.env`): двойные кавычки
внутри JSON разорвали бы значение в двойных кавычках, а без кавычек bash споткнулся бы о пробелы.

Проверка после `pm2 restart haccp-online`:

```powershell
curl.exe -s https://wesetup.ru/.well-known/apple-app-site-association
curl.exe -s https://wesetup.ru/.well-known/assetlinks.json
```

Первый ответ должен содержать `A1B2C3D4E5.ru.wesetup.app` (ваш Team ID), второй — оба отпечатка. Push проверяется
тестовым напоминанием на телефон с установленной тестовой версией.

## Если секрет утёк

| Что утекло | Что сделать |
|---|---|
| Ключ App Store Connect API (`.p8`) | Начальник: App Store Connect → Users and Access → Integrations → ключ → **Revoke**; создать новый (роль Admin); обновить `ASC_KEY_ID`, `ASC_KEY_P8_BASE64` |
| Ключ APNs | Начальник: developer.apple.com → Keys → **Revoke**; создать новый; загрузить в Firebase |
| Ключ сервисного аккаунта Firebase или Google Play | Google Cloud → Сервисные аккаунты → Ключи → удалить ключ; создать новый; обновить `.env` сервера или `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` |
| Ключ загрузки Android | Раздел «Если ключ потерян или утёк» выше |
| `google-services.json`, `GoogleService-Info.plist` | Это не секреты в строгом смысле (идентификаторы проекта), но в публичный доступ не выкладывать |
