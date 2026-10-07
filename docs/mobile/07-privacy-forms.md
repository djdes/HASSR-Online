# 07. Privacy, Data safety и анкеты содержимого
Проверено по коду и официальным правилам 8 октября 2026. Это инструкция для заполнения: неизвестные настройки внешних обработчиков нужно подтвердить до отправки анкеты.

## Что установлено по реализации
| Данные | Использование |
|---|---|
| Имя, телефон, почта, должность, ID аккаунта | Вход, управление сотрудниками, авторство записей |
| Записи, комментарии, загруженные документы | Рабочие журналы организации |
| Допуск к работе, отметки здоровья, сведения медкнижек | Рабочие проверки; это данные здоровья |
| Фотографии | Вложения, подтверждение работы, распознавание показаний/этикеток |
| Действия пользователя, IP и сведения о клиенте | Аудит и безопасность |
| Идентификатор установки/устройства, push-токен | Firebase/APNs, доставка уведомлений |
| Обращения и отзывы | Поддержка и обратная связь |
| Голосовой ввод | Системное распознавание речи; результат сохраняется в поле |

Яндекс Метрика исключается в режиме нативного приложения. Рекламного SDK и рекламного отслеживания в проверенной интеграции не обнаружено. Отсутствие аналитики не отменяет сбор данных для работы приложения.

Фото для распознавания передаются AI-диспетчеру по подписанным ссылкам (`src/lib/ai-vision/run.ts`). Конкретный исполнитель и его условия хранения определяются конфигурацией сервера. Нельзя утверждать, что все снимки обрабатываются только на телефоне.

Распознавание речи не ограничено режимом on-device: плагин создаёт системный запрос без принудительного локального распознавания. Он может использовать серверы Apple или выбранного Android-провайдера. WeSetup не загружает исходную запись голоса на собственный сервер, но это само по себе не доказывает отсутствие передачи аудио третьей стороне. [Поведение Speech framework Apple](https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition).

## Перед заполнением — четыре проверки владельца
1. Уточнить действующих обработчиков: хостинг, Firebase/APNs, поставщик распознавания речи, исполнитель AI-диспетчера и включённые организацией интеграции.
2. Подтвердить цели и сроки хранения у каждого, использование только по поручению WeSetup и отсутствие рекламы/обучения на данных, если это заявляется.
3. Согласовать публичную политику с фактической обработкой. Текущая страница `/privacy` не описывает Firebase, APNs и голос полностью; старый черновик [privacy-policy-draft.md](privacy-policy-draft.md) ещё требует завершения. Его дополнения описывают также AI-фото.
4. Проверить удаление обычного аккаунта, аккаунта руководителя и сохранение авторства в журналах. Не обещать удаление всех записей, если приложение сохраняет их по правилам организации.

## Google Play: App content
| Карточка | Ответ для текущего приложения |
|---|---|
| Privacy policy | https://wesetup.ru/privacy — после приведения политики к реальным потокам данных |
| Ads | No |
| App access | All or some functionality is restricted; рабочие review accounts и инструкция входа |
| Target audience | 18 and over — рабочая аудитория |
| News / Government | No |
| Advertising ID | No, если итоговый манифест сборки не содержит AD_ID |
| Account deletion URL | https://wesetup.ru/delete-account |
| Financial features | Не заявлять банковские/инвестиционные услуги; описать реальную корпоративную модель, если консоль задаёт уточнения |

### Health apps declaration — исправление прежней инструкции
Нельзя выбрать «My app doesn’t provide any health features» только потому, что WeSetup не медицинская программа. Google включает приложения, которые используют данные здоровья для других функций.

Для журналов здоровья и допуска сотрудников **Disease Prevention and Public Health** — предложенное сопоставление с категорией Google «health status monitoring». Это вывод по функции приложения. Если доступна категория **Other**, поясните там ведение рабочих записей здоровья. Отмечайте дополнительные категории только если такие функции действительно доступны. Не выбирайте Medical Device Apps: приложение не заявляет функцию медицинского устройства.

Текст пояснения:
```text
WeSetup is a workplace food-safety recordkeeping application. Authorized employees record workplace hygiene and fitness-for-work checks, and managers maintain employee health-clearance records. The app does not diagnose conditions, recommend treatment, access Health Connect, or act as a medical device. Access to these records is restricted to authorized users within the employer's organization.
```
[Официальная инструкция Health apps](https://support.google.com/googleplay/android-developer/answer/14738291?hl=en).

### Data safety
«Собирает или передаёт данные» → **Yes**. «Зашифрованы при передаче» → **Yes** для проверенного HTTPS-трафика; подтвердите, что внешние обработчики тоже используют защищённые каналы.

| Тип | Собирается | Основные цели |
|---|---|---|
| Personal info: Name, Email address, Phone number, User IDs | Да, для используемых полей | App functionality; Account management |
| Health and fitness: Health info | Да | App functionality |
| Photos and videos: Photos | Да | App functionality |
| Files and docs | Да, при импорте/загрузке | App functionality |
| App activity: Other user-generated content | Да | App functionality |
| App activity: App interactions | Да | App functionality; Fraud prevention, security and compliance |
| Device or other IDs | Да | App functionality |
| Audio: Voice or sound recordings | Уточнить системного обработчика и его режим; не отмечать No без проверки | App functionality |

Для полей **Required/Optional** проверяйте возможность пользоваться приложением без конкретного сбора. Почта не обязательна для каждого сотрудника; фото может быть обязательным для назначенной ему задачи. Отключение показа push не всегда означает отключение сбора идентификатора SDK.

Для сохраняемых записей, фото, аудита и ID не выбирайте ephemeral processing. Аудио, которое обрабатывается только в реальном времени без хранения, может подпадать под ephemeral processing, но его передачу всё равно нужно отразить в форме Google.

**Shared:** не ставьте одно blanket-значение для всех типов. Передача обработчику, действующему только по вашему поручению, может подпадать под исключение service provider. Условия конкретных провайдеров должны это подтверждать; включённые интеграции тоже учитываются. Пользовательская передача «Поделиться» рассматривается отдельно от фоновой передачи сервиса.

[Официальные определения Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en).

## Apple: App Privacy
App Store Connect → App Privacy → Get Started. «Do you or your third-party partners collect data from this app?» → **Yes**.

Начальный перечень для проверки:
| Раздел | Типы |
|---|---|
| Contact Info | Name, Email Address, Phone Number |
| Health & Fitness | Health |
| User Content | Photos or Videos, Customer Support, Other User Content |
| Identifiers | User ID, Device ID |
| Usage Data | Product Interaction |
| Diagnostics | Other Diagnostic Data — по фактическим журналам безопасности |
| User Content / Audio Data | Проверить правила системного распознавания, хранение и применимость исключений Apple |

Основная цель — **App Functionality**. Записи, привязанные к учётной записи, — **Linked to user: Yes**. **Tracking: No** допустимо при подтверждённом отсутствии рекламного межсервисного отслеживания у приложения и встроенных поставщиков.

Не выбирайте Analytics только из-за наличия audit log; не скрывайте сбор аудита только из-за отсутствия Метрики. Проверять нужно приложение, SDK и серверную обработку вместе.

[Правила Apple о privacy labels](https://developer.apple.com/app-store/app-privacy-details/), [User Privacy and Data Use](https://developer.apple.com/app-store/user-privacy-and-data-use/).

## Возрастной рейтинг и пользовательский контент
Заполните действующую анкету Apple и IARC; рейтинг вычислит магазин. Целевая рабочая аудитория 18+ не равна автоматически рейтингу 18+.

Внутри организаций доступны записи и фотографии других сотрудников — не отрицайте наличие пользовательского контента или взаимодействия, если вопрос их включает. Отдельно учтите доступного в релизе AI-помощника. Не объявляйте неизменное «4+» до результата анкеты.

## Шифрование
В Info.plist установлено `ITSAppUsesNonExemptEncryption=false`. Текущая нативная оболочка использует системное HTTPS; собственной криптографии для пользователя она не предоставляет. Если состав криптографических функций изменится, пересмотрите ответ.
[Apple: export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/).

## Проверка перед отправкой
- Ответы в Apple и Google отражают одни и те же реальные данные с учётом разных определений магазинов.
- Политика доступна без входа и соответствует мобильной обработке.
- Из текста удалены неподтверждённые обещания «аудио никуда не передаётся» и «данные не передаются третьим лицам».
- Review accounts работают, удаление проверено, контактное лицо и правовые сведения заполнены владельцем.

## Privacy manifest в iOS-сборке
В проект добавлен `App/PrivacyInfo.xcprivacy` с причиной `C617.1` для файлового API `@capacitor/filesystem`. CI проверяет наличие декларации непосредственно в собранном приложении. Это техническая декларация используемого API; она не заменяет App Privacy и публичную политику. [Требование плагина](https://capacitorjs.com/docs/apis/filesystem).
