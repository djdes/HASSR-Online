# 00. Обзор: как выпустить приложения WeSetup в App Store и Google Play

Эта инструкция — для руководителя, который регистрирует аккаунты разработчика, оплачивает взносы,
заполняет карточки приложений и отправляет их на проверку. Приложения собирает разработчик
(Ярослав). Всё, что нужно передать ему, собрано в [05-handoff.md](05-handoff.md).

**Что понадобится заранее**

- Документы ООО «БФС»: выписка из ЕГРЮЛ (или лист записи), ИНН/ОГРН, юридический адрес.
- Паспорт того, кто регистрирует аккаунты (у него должно быть право подписывать договоры от имени компании).
- Рабочая почта на домене компании (например, `имя@wesetup.ru`) и мобильный телефон.
- Зарубежная банковская карта (Visa, Mastercard или American Express), которая списывает доллары США.
- iPhone или Mac с включённой двухфакторной защитой Apple Account (для Apple).
- Аккаунт Google (желательно отдельный рабочий, а не личный) — для Google Play и Firebase.

**Сколько времени** — ваших действий: 4–6 часов, растянутых на несколько недель ожидания проверок.
Реалистичный срок до появления приложений в магазинах — 2–6 недель (оценка, магазины сроков не обещают).

**Сколько стоит**

| Что | Цена | Как часто |
|---|---|---|
| Apple Developer Program | 99 $ | каждый год |
| Google Play Console | 25 $ | один раз |
| Firebase (push-уведомления) | 0 $ | бесплатный тариф Spark, карта не нужна |
| D-U-N-S номер | 0 $ при запросе через форму Apple | один раз |

Приложения бесплатные, без покупок внутри. Поэтому договор о платных приложениях, банковские и налоговые
формы в магазинах заполнять не нужно.

## Кто что делает

| Шаг | Начальник | Разработчик |
|---|---|---|
| 1 | Получает D-U-N-S номер компании ([01](01-apple-developer.md)) | — |
| 2 | Регистрирует Apple Developer на компанию ([01](01-apple-developer.md)) | — |
| 3 | Регистрирует Google Play Console на компанию ([03](03-google-play-console.md)) | Помогает подтвердить сайт wesetup.ru в Search Console |
| 4 | Создаёт проект Firebase ([04](04-firebase.md)) | — |
| 5 | В App Store Connect: создаёт приложение, ключ API, ключ push ([02](02-app-store-connect.md)) | — |
| 6 | В Play Console: создаёт приложение ([03](03-google-play-console.md)) | Присылает файл первой сборки (AAB) |
| 7 | Передаёт ключи и файлы разработчику безопасным способом ([05](05-handoff.md)) | Заносит их в GitHub и на сервер ([secrets.md](secrets.md)) |
| 8 | — | Собирает приложения: iOS — в TestFlight, Android — во внутреннее тестирование |
| 9 | Ставит тестовые версии на свой телефон, проверяет ([09](09-release.md)) | Исправляет, если что-то не так |
| 10 | Заполняет карточки и анкеты ([06](06-store-listings.md), [07](07-privacy-forms.md)) | Готовит скриншоты |
| 11 | Вписывает тестовый вход для проверяющих ([08](08-review.md)) | Создаёт демо-компанию и присылает вход |
| 12 | Отправляет на проверку и нажимает «Опубликовать» ([09](09-release.md)) | Отвечает на технические вопросы проверяющих |

Схема по времени (стрелка — «нельзя начать, пока не закончено»):

```
D-U-N-S ──► Apple Developer ──► App Store Connect (приложение, ключ API, ключ push) ─┐
   │                                                                                 ├─► передать ключи ─► сборки ─► проверка ─► выпуск
   └──────► Google Play Console ──► приложение в Play Console ───────────────────────┤
Firebase (можно сразу, без D-U-N-S) ─────────────────────────────────────────────────┘
```

D-U-N-S нужен и Apple, и Google, поэтому начинайте с него. Firebase можно сделать в любой день —
он не зависит от остальных шагов.

## Что важно знать заранее

- **Правки сайта приходят в приложения сами.** Приложение открывает сайт wesetup.ru внутри себя.
  Всё, что меняется на сайте, сразу видно в приложениях без обновления в магазинах.
  Новая версия приложения нужна только если меняется его «нативная» часть — это решает разработчик
  ([11-updates.md](11-updates.md)).
- **Аналитика в приложениях выключена.** Яндекс Метрика работает на сайте, но внутри приложений её нет.
  Поэтому в анкетах магазинов пункт «аналитика» не отмечается ([07](07-privacy-forms.md)).
- **Главный риск на проверке Apple** — правило 4.2 «минимальная функциональность»: Apple отказывает
  приложениям, которые просто показывают сайт. Как мы на это отвечаем — в [08-review.md](08-review.md)
  и [10-rejections.md](10-rejections.md).
- **В приложениях нет оплаты — ни на iOS, ни на Android.** Ни покупок, ни пополнения баланса, ни ссылок на
  оплату тарифа: подписка компании управляется на сайте, приложение об этом ничего не показывает. Так сделано
  заранее в коде сайта, а не как реакция на отказ Apple — правило 3.1.1 не должно даже возникнуть; если
  проверяющий всё же спросит — готовый ответ в [10-rejections.md](10-rejections.md).

## Компания зарегистрирована в России: что известно на 26 сентября 2026

Здесь только то, что удалось подтвердить. Что не подтверждено официально — так и помечено.

**Apple Developer Program**

- На официальной странице регистрации Apple написано: «Регистрация может быть недоступна в некоторых
  регионах, например из-за санкций или других ограничений». Списка таких регионов Apple не публикует.
  Будет ли одобрена заявка ООО «БФС», станет понятно только после подачи. *(Официально не подтверждено ни «да», ни «нет».)*
- D-U-N-S номер для компаний из России выдаёт совместное предприятие «Интерфакс — Дан энд Брэдстрит»
  (dnb.ru). Название компании в базе D&B пишется латиницей по правилам транслитерации — именно это
  написание Apple и Google покажут как продавца. Проверить, есть ли уже номер, и запросить новый
  бесплатно можно через форму на сайте Apple ([01](01-apple-developer.md)).
- Взнос 99 $ оплачивается картой, которая списывает доллары США. Российские карты, по сообщениям
  посредников (vc.ru, easypayments.online, 2026), не принимаются. *(Неофициальные источники.)*
- Статьи 2026 года на vc.ru и сайтах посредников пишут, что российские юрлица регистрируются, но не могут
  получать деньги с продаж. Для нас это не важно: приложения бесплатные. *(Неофициальные источники.)*
- Что можно сделать, если Apple откажет компании из России (варианты, не рекомендации юриста):
  1. Подать заявку повторно через поддержку Apple Developer и уточнить причину.
  2. Зарегистрировать аккаунт на связанное юрлицо в другой стране. Тогда продавцом в App Store будет
     это юрлицо, а политику конфиденциальности и условия нужно согласовать с юристом (сейчас оператор
     данных в них — ООО «БФС»).
  3. Выпустить только Android-приложение, а для iPhone оставить сайт и Telegram — ничего не теряется,
     функции те же.

**Google Play Console**

- В официальной таблице Google «Страны, где можно регистрировать аккаунты разработчика» Россия отмечена
  как поддерживаемая (проверено 26.09.2026).
- Для организаций из России Google принимает: свидетельство о регистрации или выписку из реестра,
  налоговое свидетельство, и паспорт/удостоверение уполномоченного представителя (выданное в любой стране).
- С 10 марта 2022 Google Play приостановил оплату покупок для пользователей в России; бесплатные
  приложения остаются доступными. С 26 декабря 2024 разработчики с банковским счётом для выплат в России
  не могут зарабатывать через Google Play. Для бесплатного приложения без покупок это не важно.
- Сможет ли Google создать платёжный профиль организации со страной «Россия» без затруднений — сообщения
  разработчиков расходятся. *(Официально не подтверждено.)*

**Firebase и закон**

- Отправка push-уведомлений (Firebase Cloud Messaging) бесплатна и не требует карты.
  Работу доставки на телефоны в России Google официально не гарантирует и не запрещает. *(Не подтверждено.)*
- Закон с июля 2026 о штрафах за вход на российских сайтах через иностранные сервисы (Google, Apple ID)
  нас не касается: в приложении вход по телефону и паролю WeSetup. *(По публикации Гарант.ру.)*
- Push-уведомления проходят через серверы Google и Apple — физически за пределами РФ. Перед выпуском стоит
  показать юристу политику конфиденциальности: сейчас в ней написано, что трансграничной передачи нет, и нет
  слов про приложения. Разобранные варианты правки — в
  [черновике для юриста](privacy-policy-draft.md) ([07](07-privacy-forms.md) — готовые ответы для анкет
  магазинов, их тоже нужно свести с итоговым текстом политики после правки юристом).

## Источники (проверено 26 сентября 2026)

Apple:
- Регистрация и требования к организациям: https://developer.apple.com/programs/enroll/ ,
  https://developer.apple.com/help/account/membership/program-enrollment/
- D-U-N-S: https://developer.apple.com/help/account/membership/D-U-N-S/
- Ключи App Store Connect API: https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/
- Роли: https://developer.apple.com/help/app-store-connect/reference/account-management/role-permissions/
- Ключ для push (APNs): https://developer.apple.com/help/account/keys/create-a-private-key/ ,
  https://developer.apple.com/help/account/capabilities/communicate-with-apns-using-authentication-tokens/
- Правила проверки (2.1, 3.1, 4.2, 4.8, 5.1.1): https://developer.apple.com/app-store/review/guidelines/
- Удаление аккаунта: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Конфиденциальность в карточке: https://developer.apple.com/app-store/app-privacy-details/
- Возрастной рейтинг: https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/ ,
  https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/
- Шифрование: https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/
- Скриншоты: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/

Google:
- Регистрация: https://support.google.com/googleplay/android-developer/answer/6112435
- Тип аккаунта и D-U-N-S: https://support.google.com/googleplay/android-developer/answer/13634885 ,
  https://support.google.com/googleplay/android-developer/answer/13628312
- Подтверждение личности и сайта: https://support.google.com/googleplay/android-developer/answer/10841920
- Документы для России: https://support.google.com/googleplay/android-developer/answer/15633622?co=GENIE.CountryCode%3DRU
- Страны регистрации: https://support.google.com/googleplay/android-developer/answer/9306917
- Тестирование 12 тестировщиков 14 дней (только личные аккаунты): https://support.google.com/googleplay/android-developer/answer/14151465
- Безопасность данных: https://support.google.com/googleplay/android-developer/answer/10787469
- Удаление аккаунта: https://support.google.com/googleplay/android-developer/answer/13327111
- Содержание приложения, реклама, вход для проверяющих: https://support.google.com/googleplay/android-developer/answer/9859455
- Подписание приложений Google Play: https://support.google.com/googleplay/android-developer/answer/9842756
- Графика карточки: https://support.google.com/googleplay/android-developer/answer/9866151
- Google Play Developer API (сервисный аккаунт): https://developers.google.com/android-publisher/getting_started
- Россия, оплата и выплаты: https://support.google.com/googleplay/android-developer/answer/11950272 ,
  https://support.google.com/googleplay/android-developer/answer/15685001

Firebase:
- Android: https://firebase.google.com/docs/android/setup ; iOS: https://firebase.google.com/docs/ios/setup
- Ключ APNs в Firebase: https://firebase.google.com/docs/cloud-messaging/ios/client
- Сервисный аккаунт для отправки: https://firebase.google.com/docs/cloud-messaging/auth-server
- Цены: https://firebase.google.com/pricing

Россия (неофициальные источники, помечены в тексте):
- Интерфакс — Дан энд Брэдстрит: https://www.dnb.ru/faq/
- https://vc.ru/id4285729/2650867-registraciya-apple-developer-dlya-rossijskih-razrabotchikov
- https://easypayments.online/blog/kak-sozdat-zarubezhnyy-akkaunt-v-apple-developer
- Закон об иностранной авторизации: https://www.garant.ru/article/2136195/

## Разделы инструкции

1. [Apple Developer: регистрация компании](01-apple-developer.md)
2. [App Store Connect: приложение, ключи](02-app-store-connect.md)
3. [Google Play Console](03-google-play-console.md)
4. [Firebase: push-уведомления](04-firebase.md)
5. [Что передать разработчику](05-handoff.md)
6. [Карточки магазинов](06-store-listings.md) и [готовые тексты](store-listing.md)
7. [Анкеты о данных](07-privacy-forms.md)
8. [Проверка: вход для проверяющих](08-review.md)
9. [Выпуск](09-release.md)
10. [Если отказали](10-rejections.md)
11. [Обновления](11-updates.md)

Отдельно — [черновик правок политики конфиденциальности](privacy-policy-draft.md) для юриста и владельца:
что в ней нужно поправить из-за приложений (не публиковать без проверки).

## Частые ошибки

- Начать с Apple или Google, не получив D-U-N-S, — регистрация организации без него не пройдёт.
- Регистрироваться как «физическое лицо» (Individual / Personal) ради скорости. Продавцом будет ваше имя,
  а в Google Play для личных аккаунтов нужен закрытый тест 12 человек 14 дней подряд.
- Писать название компании по-разному в D-U-N-S, Apple и Google. Везде должно быть одно написание — как в D&B.
- Пересылать ключи и пароли в обычном чате или почте открытым текстом (см. [05-handoff.md](05-handoff.md)).
