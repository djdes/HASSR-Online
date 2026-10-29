# Цены услуг → «Свяжитесь с нами» (2026-10-29)

Владелец: «Везде по сайту, где указаны цены на услуги, кроме тарифов, заменить
на фразу что-то вроде: Свяжитесь с нами и по клику контакты крупно.»

## Объём

Услуги — `PlatformService` (`priceRub`/`priceFrom`/`unit`, ROOT → «Услуги»), в
том числе «ППК индивидуально» (`ppk-development`). Тарифы подписки не трогаем.

## Критерии приёмки

- **AC1. Общий диалог контактов.** Новый клиентский компонент
  `src/components/contact/contact-us-dialog.tsx`: `ContactUsButton` (триггер со
  своим состоянием), `ContactUsDialog` (управляемый), `ContactUsPanel`
  (содержимое). В окне крупно и нажимаемо: телефон 8 (925) 305-80-77
  (`tel:+79253058077`, самый крупный элемент), Telegram (env
  `WESETUP_TG_SALES_URL` через `homeContacts`, иначе `https://t.me/wesetupbot`),
  почта `support@wesetup.ru`, «Написать в чат» (`contactSupport(subject)`, тема
  с названием услуги), строка «Расскажите, что нужно, — назовём стоимость под
  ваш объект». Тексты — `sharedUi.contactUs.*` в ru/en/uz. Окно — `ui/dialog`
  (на телефоне лист снизу), помещается в 390 px без горизонтальной прокрутки.
  Адрес Telegram вычисляет сервер (`contactTelegramUrl(process.env)` в
  `src/lib/contact-us.ts`, юнит-тест) и передаёт пропом.
- **AC2. Публичная `/uslugi`.** В карточках нет цены и подписи
  «Фиксированная цена…/Итоговую стоимость…» — на их месте кнопка «Свяжитесь с
  нами» (открывает AC1) и подпись про стоимость под объект; форма заявки
  («Заказать») остаётся. Тексты страницы не обещают цен (description, hero,
  кнопка «Смотреть услуги», шаг 3, вопрос FAQ). JSON-LD `Service` без `offers`
  / `price` / `minPrice`. В hero — кнопка «Свяжитесь с нами».
- **AC3. Витрина тарифов** (`TariffComparison`: лендинг `/`, `/en`, `/uz`,
  `/pricing`, кабинет `/settings/subscription`). Блок «ППК индивидуально» без
  «от N ₽» — вместо цены «Свяжитесь с нами» (открывает AC1), кнопка «Заказать
  индивидуально» остаётся. Строка таблицы «ППК под ваш объект» — «Индивидуально,
  по запросу» без суммы. Пропы `ppkFromRub` убраны, `readPpkIndividualPrice`
  больше не нужен. Цены тарифов на месте.
- **AC4. Кабинет «Услуги»** (`/settings/services`). В карточках нет цены и
  значка «мгновенной оплаты»; вместо цены — «Свяжитесь с нами» (AC1). Заказ —
  простая заявка «Оставить заявку»: в окне нет цены, списания баллов и
  «Оплатить и заказать», `payFromBalance` не отправляется (API совместим), в
  окне есть крупные контакты. Плашки «Баллов на балансе» в шапке нет.
- **AC5. «Пришла проверка → Эксперт»** (`/inspection/experts`): в карточках
  услуг нет пилюли с ценой; в блоке — подпись про стоимость и кнопка
  «Свяжитесь с нами» (AC1).
- **AC6. «Производственный контроль»** (`/production-control`,
  `/production-control/documents/package`): у «ППК под ваш объект» нет «от N ₽»
  — вместо неё «Свяжитесь с нами» (AC1); кнопка «Заказать индивидуально» на
  месте.
- **AC7. i18n.** Ненужные ключи удалены во всех трёх каталогах
  (`landingComponents.tariffs.ppk.price`, `…cells.ppkFrom`,
  `productionControl.individual.price`, `inspectionDay.experts.priceFrom/
  priceExact/priceOnRequest`, денежные пункты `settingsUi.servicesCatalog`,
  `settingsUi.servicesPage.balancePoints`), новые добавлены в ru/en/uz;
  `npm run i18n:types` и `npm run i18n:check` зелёные; в en/uz нет кириллицы в
  новых строках.
- **AC8. Не тронуто:** цены тарифов, ROOT `/root/services`, внутреннее
  уведомление владельцу «Цена по прайсу» (`requests.ts`), `/root/service-
  requests`, оборудование (`hardware-pricing.ts` и др.), подвал сайта,
  `whats-new-notes.ts`, `deploy.yml`.
- **AC9. Проверки:** `npm run typecheck`, `npx eslint` по изменённым файлам,
  затронутые юнит-тесты, `npm run test:gate`; e2e Playwright (1440 и 390 px,
  оболочка Mini App для одной страницы кабинета): на `/uslugi`, `/`, `/pricing`,
  `/settings/services`, `/inspection/experts`, `/production-control`,
  `/settings/subscription` нет «₽» рядом с услугами, цены тарифов есть, кнопка
  открывает окно с крупным видимым телефоном; в HTML `/uslugi` нет `"price"`.

## Ограничения

- Только локальная БД `wesetup_svcprice` (5433 — прод, не трогать).
- Не пушить, не мержить, PR не открывать.
