# 10. Если отказали: частые причины и готовые ответы

Отказ — обычная часть первой публикации, особенно у Apple. Не спорьте эмоционально и не отправляйте ту же сборку
без изменений. Порядок такой:

1. Прочитайте письмо и найдите номер правила (Apple: «Guideline 4.2 …»; Google: название правила).
2. Найдите причину в таблице ниже.
3. Если нужна правка в приложении или на сайте — перешлите письмо разработчику (текст письма, не пароли).
4. Если правка не нужна — ответьте готовым текстом (Apple: **App Review** → **Reply**; Google: **Статус правил** → **Обжаловать**).

**Что понадобится заранее** — письмо об отказе. **Сколько времени** — 15 минут на ответ; повторная проверка — 1–7 дней.
**Сколько стоит** — бесплатно.

## Apple

| Правило | Что пишут | Что делать |
|---|---|---|
| **4.2 / 4.2.2** Minimum Functionality | «Приложение похоже на сайт, упакованный в приложение» | Ответ А ниже. Если откажут повторно — разработчик добавляет заметную нативную пользу, затем апелляция |
| **2.1** App Completeness / Information Needed | «Не смогли войти» или «нужна дополнительная информация» | Проверить демо-вход ([08](08-review.md)), ответ Б |
| **3.1.1** In-App Purchase | «Приложение даёт доступ к оплате мимо встроенных покупок» | В приложении на обеих платформах изначально нет оплаты: экран «Тариф» только показывает статус подписки, без кнопок и ссылок на покупку и оплату — правка не нужна, достаточно ответа В |
| **5.1.1(v)** Account Deletion | «Нет удаления аккаунта» или «только деактивация» | Ответ Г |
| **5.1.1(ii)** Permission | «Непонятно, зачем камера/микрофон» | Разработчик уточняет тексты запросов разрешений; новая сборка |
| **2.3.x** Accurate Metadata | Скриншоты не из приложения, упоминание других платформ | Исправить карточку ([06](06-store-listings.md)), сборка не нужна |
| **2.1** Performance: App Crashes | Приложение закрылось | Переслать разработчику письмо и приложенные crash-логи |

### Ответ А — правило 4.2 (приложение «как сайт»)

```text
Hello,

Thank you for the review. We would like to clarify how WeSetup goes beyond a repackaged website.

WeSetup is a daily work tool for kitchen and production staff of food businesses. Employees use it on their phones during a shift to keep the food-safety logbooks required by Russian sanitary law (SanPiN) and HACCP. The app is built around native iOS capabilities that a website in Safari cannot provide in the same way:

1. Push notifications (APNs) remind staff when a logbook entry is due and deliver new shift tasks; tapping a notification opens the exact task.
2. Universal links: QR posters placed on fridges and in production rooms, and links in our bot's messages, open the matching logbook directly in the app. Scanning a poster with the Camera app is the main way staff start their work.
3. Native printing of logbooks for sanitary inspections through the iOS print dialog.
4. Native share sheet for exported reports (PDF, spreadsheets).
5. iOS speech recognition for hands-free input of temperatures and notes while working with food.
6. Camera for photo evidence attached to records and for barcode scanning.
7. An offline screen that keeps the app usable in kitchens and basements with poor connectivity.

The app is used by the employees of our business customers every day, with personal accounts issued by their employer. The demo account in the review notes shows real sample data of a demo cafe. A QR poster for testing universal links is attached to the review information.

We would be glad to provide a video of these features on a device if that helps.

Best regards,
WeSetup team
```

Смысл по-русски: приложение — ежедневный рабочий инструмент на смене; перечислены нативные функции (push, ссылки
с QR-плакатов, печать, «Поделиться», голосовой ввод, камера, экран без связи); аккаунты выдаёт работодатель; предлагаем
прислать видео.

Если откажут повторно по 4.2: запишите на iPhone видео 1–2 минуты (вход → push → открыть задачу из push → QR-плакат
камерой → печать → голосовой ввод), приложите к ответу. Не помогло — апелляция: https://developer.apple.com/contact/app-store/?topic=appeal

### Ответ Б — правило 2.1 (не смогли войти / нужна информация)

Сначала попросите разработчика проверить вход демо-аккаунта. Затем:

```text
Hello,

Thank you for your message. The demo account has been checked and works. Please sign in on the first screen with:
Phone: [телефон]
Password: [пароль]
Enter the phone number exactly as shown above and tap "Войти".

The app is intended for employees of food businesses in Russia; accounts are created by the employer, so there is no public sign-up. The demo company contains sample records and tasks for today.

Best regards,
WeSetup team
```

### Ответ В — правило 3.1.1 (оплата)

Правка сборки не нужна: в приложении на обеих платформах никогда не было оплаты. Есть только экран «Тариф» для
чтения — название тарифа, до какого числа действует (или что закончился) и суммы прошлых платежей; кнопок
покупки, продления, пополнения и оплаты и ссылок на них там нет. Это сделано в коде сайта, который приложение
просто показывает. Ответ:

```text
Hello,

Thank you for the review. WeSetup is a companion app for our own business service, not a storefront: it has no purchase, top-up, renewal or payment buttons and no links to any purchase or payment. The only related screen, "Тариф", is read-only: it shows the company's subscription status (plan name, active until or ended, amounts of past payments) and offers no way to buy or pay. No digital goods are sold in the app, so there is no purchase UI to add.

WeSetup is sold directly to businesses under a contract for use by their employees (Guideline 3.1.3(c) Enterprise Services), managed on our website, not in the app; the app only lets these employees access the service their company has already arranged.

Best regards,
WeSetup team
```

### Ответ Г — правило 5.1.1(v) (удаление аккаунта)

```text
Hello,

Account deletion is available in the app: open the Profile screen ("Профиль") and tap "Удалить аккаунт", then confirm. The same is available on the web: https://wesetup.ru/delete-account

For an employee account, deletion erases the person's contact and sign-in data (e-mail, phone, Telegram link, PIN and sign-in keys) and the account can no longer be used. Food-safety logbook records that the employer is legally required to keep under Russian sanitary law (SanPiN / HACCP) stay with the company together with the name of the employee who made them; this retention is disclosed to the user before deletion. For a company owner (or the last manager of a company), the app leads to deletion of the whole company account, which is completed after a 30-day waiting period so that the company is not left without a head by mistake.

Please use the second demo account from the review notes to test deletion.

Best regards,
WeSetup team
```

Перед отправкой разработчик сверяет текст с тем, что реально делает удаление.

## Google Play

| Причина | Что пишут | Что делать |
|---|---|---|
| **Доступ к приложению** (App access) | «Не смогли войти по вашим данным» | Проверить демо-вход, обновить «Данные для входа» ([08](08-review.md)), отправить на проверку |
| **Безопасность данных** | «Ответы не соответствуют поведению приложения» | Сверить с [07](07-privacy-forms.md) и политикой конфиденциальности, исправить анкету |
| **Удаление аккаунта** | «Нет ссылки или пути удаления» | Проверить ссылку `https://wesetup.ru/delete-account` в анкете и пункт в приложении |
| **Минимальная функциональность / WebView** | «Приложение только показывает сайт» | Ответ Д |
| **Вводящие в заблуждение метаданные** | Скриншоты или описание | Исправить карточку ([06](06-store-listings.md)) |
| **Целевая аудитория** | «Приложение может привлекать детей» | Указать только 18+, убрать «детские» картинки |

### Ответ Д — Google, приложение «как сайт»

```text
Hello,

WeSetup is the official app of our own service wesetup.ru; we own and operate the website shown in the app. The app is a daily work tool for employees of food businesses and adds native Android features: push notifications about shift tasks and logbook reminders, App Links from QR posters and bot messages, native printing, file export via the Android share sheet, speech-to-text input, camera for photos and barcodes, and an offline screen. Sign-in details for the demo company are provided in App content.

Best regards,
WeSetup team
```

## Частые ошибки

- Отправили ту же сборку без изменений — получите тот же отказ.
- В ответе пароли и ключи от консолей — никогда. Только демо-вход.
- Долгое молчание: Apple и Google ждут ответа, но через несколько недель могут закрыть заявку — отвечайте в течение 1–3 дней.
