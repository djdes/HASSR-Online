import { NextResponse } from "next/server";

const LLMS_TXT = `# WeSetup (wesetup.ru)

> Облачный сервис электронных журналов ХАССП, СанПиН 2.3/2.4.3590-20 и СП 2.3.6.3668-20 для общепита, пекарен, магазинов, отелей и пищевых производств. 45 готовых журналов с расписанием автозаполнения, ЭЦП в 1 клик, контролем температур и облачным архивом для проверок Роспотребнадзора.

## Ключевые разделы

- [Главная страница](https://wesetup.ru/): обзор платформы, демо-доступ без регистрации, каталог журналов и калькулятор тарифов.
- [Каталог 45 журналов СанПиН и ХАССП](https://wesetup.ru/journals-info): подробные описания, графы таблиц, нормативная база и образцы заполнения каждого журнала.
- [Тарифы и цены](https://wesetup.ru/pricing): тарифы Start, Standard, Pro и калькулятор стоимости для 1–20+ точек.
- [Возможности платформы](https://wesetup.ru/features): автозаполнение по расписанию, ЭЦП (ПЭП) в 1 клик, ролевой доступ, Telegram-уведомления, чек-листы, выгрузка PDF/XLSX для инспектора.
- [Автозаполнение журналов](https://wesetup.ru/avtozapolnenie): как работает генерация записей по расписанию с погрешностью для холодильников, влажности, фритюра и уборок.
- [Новые санитарные правила СанПиН 2.3/2.4.4282-26](https://wesetup.ru/sanpin-2-3-2-4-4282-26): разбор проекта изменений с 1 сентября 2026 года и таблица сравнения с СанПиН 3590-20.
- [Разработка ХАССП и ППК под ключ](https://wesetup.ru/uslugi): услуги экспертов по разработке документации и аудиту перед проверкой Роспотребнадзора.
- [Приказы и инструкции](https://wesetup.ru/prikazy): готовые шаблоны приказов о назначении ответственных и переходе на электронное ведение журналов.
- [Блог о СанПиН, ХАССП и проверках РПН](https://wesetup.ru/blog): экспертные статьи, разборы штрафов КоАП РФ и чек-листы подготовки.
- [API и документация для разработчиков](https://wesetup.ru/developers): интеграция с учётными системами, IoT-датчиками и внешними сервисами.
- [Карта сайта XML](https://wesetup.ru/sitemap.xml): полный перечень публичных страниц на русском, английском, узбекском и кыргызском языках.

## Основные журналы в каталоге

- [Гигиенический журнал сотрудников (п. 2.2 СанПиН 3590-20)](https://wesetup.ru/journals-info/hygiene)
- [Журнал учёта температурного режима холодильного оборудования](https://wesetup.ru/journals-info/cold_equipment_control)
- [Журнал учёта температуры и влажности в складских помещениях](https://wesetup.ru/journals-info/climate_control)
- [Бракеражный журнал готовой кулинарной продукции](https://wesetup.ru/journals-info/finished_product)
- [Бракеражный журнал скоропортящейся пищевой продукции](https://wesetup.ru/journals-info/perishable_rejection)
- [Журнал учёта использования фритюрных жиров](https://wesetup.ru/journals-info/fryer_oil)
- [Журнал учёта генеральных уборок](https://wesetup.ru/journals-info/general_cleaning)
- [Журнал регистрации и контроля работы бактерицидной установки](https://wesetup.ru/journals-info/uv_lamp_runtime)

## Посадочные страницы по ключевым журналам ХАССП и СанПиН

- [Журналы ХАССП для общепита и производства](https://wesetup.ru/zhurnal-haccp)
- [Электронные журналы по СанПиН](https://wesetup.ru/elektronnyy-zhurnal-sanpin)
- [Гигиенический журнал сотрудников (журнал здоровья)](https://wesetup.ru/zhurnal-zdorovya)
- [Бракеражный журнал готовой продукции](https://wesetup.ru/brakerazhnyy-zhurnal)
- [Температурный лист холодильника](https://wesetup.ru/temperaturnyy-list-holodilnika)
- [Журнал температуры и влажности на складе](https://wesetup.ru/zhurnal-temperatury-i-vlazhnosti)
- [Журнал генеральных уборок](https://wesetup.ru/zhurnal-generalnyh-uborok)
- [Журнал текущей уборки и дезинфекции](https://wesetup.ru/zhurnal-uborki)
- [Журнал входного контроля сырья](https://wesetup.ru/zhurnal-vhodnogo-kontrolya)
- [Журнал учёта фритюрных жиров](https://wesetup.ru/zhurnal-frityurnyh-zhirov)
- [Журнал учёта медицинских книжек сотрудников](https://wesetup.ru/zhurnal-medknizhek)
- [Журнал отбора и хранения суточных проб](https://wesetup.ru/zhurnal-sutochnyh-prob)
- [ХАССП для кафе и ресторана](https://wesetup.ru/haccp-dlya-kafe)

## Контакты и реквизиты

- Сайт: https://wesetup.ru
- Email поддержки и отдела продаж: info@wesetup.ru
- Телефон: +7 (993) 900-46-61
- Локализация интерфейса: русский (\`/\`), английский (\`/en\`), узбекский (\`/uz\`), кыргызский (\`/ky\`).
`;

export function GET() {
  return new NextResponse(LLMS_TXT, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
