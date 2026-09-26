# 08. Проверка: вход и заметка для проверяющих

Проверяющие Apple и Google открывают приложение сами. Без входа они увидят только экран логина и откажут
(Apple — правило 2.1). Поэтому им нужен рабочий демо-вход и короткое объяснение, что делает приложение.

**Что понадобится заранее**

- Демо-вход от разработчика: он создаёт на wesetup.ru компанию «Кафе «Демо»» с заполненными журналами и два
  аккаунта. Значения: **(пришлёт разработчик)**.
- Картинка QR-плаката демо-компании (PNG или PDF) — тоже от разработчика.

**Сколько времени** — 20 минут.

**Сколько стоит** — бесплатно.

## Демо-вход

| Что | Значение |
|---|---|
| Основной аккаунт (заведующая: видит и задачи сотрудника, и сводку руководителя) — телефон | (пришлёт разработчик) |
| Основной аккаунт — пароль | (пришлёт разработчик) |
| Второй аккаунт (повар) для проверки удаления аккаунта — телефон | (пришлёт разработчик) |
| Второй аккаунт — пароль | (пришлёт разработчик) |

Разработчик проверяет перед отправкой: демо-компания — обычная компания с действующим доступом, а не
временный «демо-кабинет» с сайта (тот удаляется сам через несколько дней); вход только по телефону и паролю,
без кода из Telegram; в демо-компании есть записи за последние дни и задачи на сегодня; основной аккаунт — не
единственный руководитель компании; второй аккаунт — обычный сотрудник, его удаление ничего не ломает.
После проверки, если второй аккаунт удалили, разработчик заводит его заново.

## App Store: App Review Information

App Store Connect → WeSetup → **1.0 Prepare for Submission** → блок **App Review Information**:

| Поле | Что вписать |
|---|---|
| **Sign-in required** | отметить |
| **User name** | телефон основного аккаунта |
| **Password** | пароль основного аккаунта |
| **Contact Information** — First name, Last name, Phone, Email | того, кто быстро ответит проверяющим (вы или разработчик), телефон в формате `+7...` |
| **Notes** | текст на английском ниже, с подставленными данными второго аккаунта |
| **Attachment** | картинка QR-плаката демо-компании |

### Текст для поля Notes (копировать целиком)

```text
WeSetup is a work tool for employees of food businesses (cafes, restaurants, canteens, food production) in Russia. It replaces paper food-safety logbooks required by Russian sanitary rules (SanPiN) and HACCP: staff record fridge temperatures, hygiene and health checks, cleaning and product quality checks, and receive daily shift tasks. The interface is in Russian.

Accounts are created by the employer (the company manager), so there is no public sign-up in the app. The demo account belongs to a demo company "Кафе «Демо»" with sample data.

HOW TO SIGN IN
Enter the phone number and password from the Sign-In Information fields, then tap "Войти".

NATIVE FEATURES OF THE APP
1. Push notifications (APNs via Firebase Cloud Messaging) about new tasks and journal reminders. The app asks for permission after sign-in, after a short explanation screen. Tapping a notification opens the exact screen.
2. Printing journals and reports through the iOS print dialog (AirPrint or Save to PDF): open any journal document and tap "Печать".
3. File export: reports (PDF, spreadsheets) open in the iOS share sheet.
4. Voice input for numbers and notes using iOS speech recognition (microphone and Speech Recognition permissions): tap the microphone button next to a field.
5. Camera: photos attached to journal records and barcode scanning.
6. Universal links: QR posters in the kitchen and links in our bot's messages open the matching journal directly in the app. The attached image is a QR poster of the demo company; scan it with the iPhone Camera app.
7. Offline screen with a Retry button when there is no connection.

ACCOUNT DELETION
Profile screen ("Профиль") → "Удалить аккаунт". Please use the second demo account to test deletion:
Phone: [второй аккаунт — телефон]
Password: [второй аккаунт — пароль]
Deletion erases the employee's contact and sign-in data (e-mail, phone, Telegram link, PIN and sign-in keys); the person's name stays in the food-safety logbook records they made, together with the account holder, because Russian sanitary law (SanPiN/HACCP) requires keeping the author of a record — this is disclosed before deletion. Deletion is also available on the web: https://wesetup.ru/delete-account

The app is free and has no purchases, top-ups, subscriptions or links to payment of any kind on either platform, and no ads. Companies subscribe to WeSetup directly with us under a business contract, managed on our website, not in the app; the app is a companion for that business service and does not sell any digital goods.

Contact: support@wesetup.ru
```

### Перевод (для вас, вставлять не нужно)

WeSetup — рабочий инструмент для сотрудников предприятий питания в России. Он заменяет бумажные журналы по
СанПиН и ХАССП: сотрудники записывают температуру холодильников, проверки гигиены и здоровья, уборку и бракераж,
получают задачи на смену. Интерфейс на русском.

Аккаунты заводит работодатель (руководитель компании), поэтому в приложении нет свободной регистрации.
Демо-аккаунт принадлежит демо-компании «Кафе «Демо»» с примерами данных.

Как войти: введите телефон и пароль из полей входа, нажмите «Войти».

Нативные функции: 1) push-уведомления о задачах и напоминания о журналах, разрешение спрашивается после входа
и экрана с объяснением, нажатие открывает нужный экран; 2) печать журналов и отчётов через системную печать
iOS; 3) отчёты открываются в меню «Поделиться»; 4) голосовой ввод чисел и заметок через распознавание речи iOS;
5) камера: фото к записям и сканирование штрихкодов; 6) универсальные ссылки: QR-плакаты и ссылки из бота
открывают нужный журнал в приложении — во вложении QR-плакат демо-компании, наведите на него камеру iPhone;
7) экран «Нет связи» с кнопкой «Повторить».

Удаление аккаунта: «Профиль» → «Удалить аккаунт», проверять — на втором демо-аккаунте. У сотрудника стираются
телефон, почта, привязка Telegram, ПИН и ключи входа; имя остаётся в записях журналов, которые он заполнял, —
это требование СанПиН и ХАССП, о нём предупреждают перед удалением. Также на сайте:
https://wesetup.ru/delete-account.

Приложение бесплатное, без покупок, пополнений, подписок и ссылок на оплату на любой из платформ, без рекламы.
Компании оплачивают WeSetup напрямую по договору на сайте, а не в приложении; приложение — лишь спутник этого
бизнес-сервиса и не продаёт никаких цифровых товаров.

**Перед отправкой разработчик сверяет названия кнопок («Печать», микрофон, «Профиль», «Удалить аккаунт»)
с демо-аккаунтом** — если в интерфейсе они называются иначе, поправьте текст.

## Google Play: данные для входа

Play Console → **Правила и программы** → **Содержание приложения** → **Данные для входа** (Sign-in details) →
**Управлять** / **Начать**:

1. **Для доступа ко всем функциям или к части функций нужен вход** — выбрать.
2. **+ Добавить инструкции**:
   - **Название** — `Демо-компания`;
   - **Имя пользователя** — телефон основного аккаунта;
   - **Пароль** — пароль основного аккаунта;
   - **Дополнительная информация** — тот же английский текст, что для Apple (можно без пунктов про iOS), и
     данные второго аккаунта для проверки удаления.
3. Отметьте разрешение использовать эти данные для автоматических проверок совместимости.
4. **Сохранить**.

## Как отвечать проверяющим

**Apple.** Письмо «We noticed an issue with your submission» → App Store Connect → **Apps** → WeSetup →
**App Review** → откройте сообщение → **Reply**. Отвечайте по-английски, по делу, по пунктам замечания.
Если нужно что-то показать — приложите скриншот или короткое видео с телефона. Не отправляйте новую сборку,
пока не поняли, что именно не так. Готовые ответы — в [10-rejections.md](10-rejections.md).

Если не согласны с решением после ответа — форма апелляции: https://developer.apple.com/contact/app-store/?topic=appeal

**Google.** Письмо о нарушении и **Play Console** → **Входящие** / **Статус правил** (Policy status).
Там же кнопка **Обжаловать** (Appeal). Сначала исправьте то, что можно исправить (карточку, анкету), затем
отправьте изменения на проверку заново.

## Частые ошибки

- Демо-вход не работает в день проверки (сменили пароль, включили вход с кодом из Telegram, удалили компанию) —
  самый частый отказ по правилу 2.1.
- В демо-компании пусто — проверяющий решает, что приложение ничего не умеет (правило 4.2).
- Проверяющий удалил основной демо-аккаунт — поэтому для удаления даём второй.
- В карточке или внутри приложения (на любой платформе) есть призыв оплатить тариф — отказ по правилу 3.1.1
  (Apple) или аналогичному у Google. В приложении нет ни экрана «Тарифы и оплата», ни ссылок на оплату — это
  сделано в коде сайта заранее, а не как реакция на отказ. Если проверяющий всё же спросит про 3.1.1 — ответ:
  приложение — спутник бизнес-сервиса, никакие цифровые товары в нём не продаются, экрана покупок и ссылок на
  оплату нет.
