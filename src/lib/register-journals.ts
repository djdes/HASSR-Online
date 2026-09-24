/**
 * Табличные журналы-реестры, у которых нет собственного экрана: строки
 * журнала целиком описываются полями шаблона (`JournalTemplate.fields`),
 * а экран, печать и внешний API строятся из этих полей общими
 * компонентами (`register-document-client.tsx`, `drawRegisterPdf`).
 *
 * Здесь — единый источник правды для журналов, добавленных в сентябре
 * 2026 (суточные пробы, витаминизация, рацион, перевозка, бой посуды,
 * вода в бассейне; затем инвентарь, стерилизация инструментов, отходы
 * класса Б, допуск партии): из него берут поля и сид шаблонов
 * (`prisma/seed.ts`), и экран документа, и тесты. Добавить ещё один
 * такой журнал = одна запись здесь + строка в каталоге.
 *
 * `complaint_register` тоже реестр, но у него свой экран и свои поля в
 * сиде — сюда он не входит.
 */

export type RegisterJournalFieldType =
  | "date"
  | "time"
  | "text"
  | "textarea"
  | "number"
  | "select";

export type RegisterJournalField = {
  key: string;
  label: string;
  type: RegisterJournalFieldType;
  required: boolean;
  options?: Array<{ value: string; label: string }>;
  /** Подсказка в поле ввода: пример значения. */
  placeholder?: string;
  /** Для `number`: шаг ввода. */
  step?: number;
};

export type RegisterJournalDefinition = {
  code: string;
  name: string;
  description: string;
  /** Короткая подсказка над таблицей: что записывать и когда. */
  hint: string;
  /** Ключ поля, по которому строка показывается в карточке как дата. */
  dateKey: string | null;
  /** Ключ поля — заголовок карточки на телефоне. */
  titleKey: string;
  fields: RegisterJournalField[];
  isMandatorySanpin: boolean;
  isMandatoryHaccp: boolean;
};

function option(value: string) {
  return { value, label: value };
}

const RESPONSIBLE: RegisterJournalField = {
  key: "responsible",
  label: "Ответственный",
  type: "text",
  required: false,
  placeholder: "ФИО",
};

export const REGISTER_JOURNALS: readonly RegisterJournalDefinition[] = [
  {
    code: "daily_samples",
    name: "Журнал отбора и хранения суточных проб",
    description:
      "Отбор суточных проб от каждого приёма пищи, условия их хранения и утилизация",
    hint: "Строка на каждое блюдо, от которого отобрана проба: что, сколько, во сколько отобрали и когда утилизировали.",
    dateKey: "date",
    titleKey: "dish",
    isMandatorySanpin: true,
    isMandatoryHaccp: false,
    fields: [
      { key: "date", label: "Дата", type: "date", required: true },
      {
        key: "meal",
        label: "Приём пищи",
        type: "select",
        required: true,
        options: ["Завтрак", "Второй завтрак", "Обед", "Полдник", "Ужин"].map(option),
      },
      { key: "dish", label: "Блюдо", type: "text", required: true, placeholder: "Например, суп гороховый" },
      { key: "mass", label: "Масса пробы, г", type: "number", required: false, step: 1, placeholder: "100" },
      { key: "takenAt", label: "Время отбора", type: "time", required: false },
      { key: "storageTemp", label: "Температура хранения, °C", type: "number", required: false, step: 0.1, placeholder: "+4" },
      { key: "disposedAt", label: "Дата и время утилизации", type: "text", required: false, placeholder: "Например, 12.09 в 12:30" },
      RESPONSIBLE,
    ],
  },
  {
    code: "vitaminization",
    name: "Журнал проведения витаминизации третьих и сладких блюд",
    description:
      "Учёт внесения витаминных препаратов в третьи и сладкие блюда",
    hint: "Запись в день витаминизации: какое блюдо, какой препарат, сколько внесли и во сколько блюдо выдали.",
    dateKey: "date",
    titleKey: "dish",
    isMandatorySanpin: true,
    isMandatoryHaccp: false,
    fields: [
      { key: "date", label: "Дата", type: "date", required: true },
      { key: "dish", label: "Блюдо", type: "text", required: true, placeholder: "Например, компот из сухофруктов" },
      { key: "preparation", label: "Препарат", type: "text", required: true, placeholder: "Например, аскорбиновая кислота" },
      { key: "portions", label: "Количество порций", type: "number", required: false, step: 1 },
      { key: "amount", label: "Внесено витамина, г", type: "number", required: false, step: 0.01 },
      { key: "addedAt", label: "Время внесения", type: "time", required: false },
      { key: "servedAt", label: "Время приёма блюда", type: "time", required: false },
      RESPONSIBLE,
    ],
  },
  {
    code: "ration_control",
    name: "Ведомость контроля за рационом питания",
    description:
      "Сравнение фактического набора продуктов на одного человека с нормой за период",
    hint: "Раз в 10 дней или в месяц: по каждой группе продуктов — норма и фактически выдано на одного человека.",
    dateKey: null,
    titleKey: "productGroup",
    isMandatorySanpin: false,
    isMandatoryHaccp: false,
    fields: [
      { key: "period", label: "Период (10 дней / месяц)", type: "text", required: true, placeholder: "Например, 01.09–10.09" },
      { key: "productGroup", label: "Группа продуктов", type: "text", required: true, placeholder: "Например, молоко и кисломолочные" },
      { key: "normPerPerson", label: "Норма на 1 человека, г", type: "number", required: false, step: 0.1 },
      { key: "factPerPerson", label: "Фактически на 1 человека, г", type: "number", required: false, step: 0.1 },
      { key: "deviation", label: "Отклонение, %", type: "number", required: false, step: 0.1 },
      { key: "note", label: "Примечание", type: "textarea", required: false },
    ],
  },
  {
    code: "transport_temperature",
    name: "Журнал контроля температуры при транспортировке",
    description:
      "Температура продукции при загрузке и выгрузке во время перевозки",
    hint: "Строка на каждый рейс: что везли, куда и какая температура была при загрузке и при выгрузке.",
    dateKey: "date",
    titleKey: "product",
    isMandatorySanpin: false,
    isMandatoryHaccp: true,
    fields: [
      { key: "date", label: "Дата", type: "date", required: true },
      { key: "vehicle", label: "Транспорт / госномер", type: "text", required: false, placeholder: "Например, Газель А123БВ" },
      { key: "route", label: "Маршрут / получатель", type: "text", required: false },
      { key: "product", label: "Продукция", type: "text", required: true },
      { key: "loadTemp", label: "Температура при загрузке, °C", type: "number", required: false, step: 0.1 },
      { key: "unloadTemp", label: "Температура при выгрузке, °C", type: "number", required: false, step: 0.1 },
      { key: "time", label: "Время", type: "time", required: false },
      RESPONSIBLE,
    ],
  },
  {
    code: "tableware_breakage",
    name: "Журнал учёта боя посуды",
    description: "Учёт разбитой посуды и инвентаря и сбора осколков",
    hint: "Запись сразу после боя: что разбилось, где, почему и собраны ли осколки.",
    dateKey: "date",
    titleKey: "item",
    isMandatorySanpin: false,
    isMandatoryHaccp: false,
    fields: [
      { key: "date", label: "Дата", type: "date", required: true },
      { key: "item", label: "Посуда / инвентарь", type: "text", required: true, placeholder: "Например, тарелка глубокая" },
      { key: "quantity", label: "Количество", type: "number", required: false, step: 1 },
      { key: "zone", label: "Где (зал / кухня / бар)", type: "text", required: false },
      { key: "cause", label: "Причина", type: "text", required: false },
      {
        key: "fragments",
        label: "Осколки собраны и утилизированы",
        type: "select",
        required: false,
        options: ["Да", "Нет"].map(option),
      },
      RESPONSIBLE,
    ],
  },
  {
    code: "pool_water_control",
    name: "Журнал контроля качества воды в бассейне",
    description:
      "Температура, остаточный хлор, pH и прозрачность воды в бассейне",
    hint: "Замер перед открытием и по графику в течение дня: температура, хлор, pH, прозрачность.",
    dateKey: "date",
    titleKey: "pool",
    isMandatorySanpin: true,
    isMandatoryHaccp: false,
    fields: [
      { key: "date", label: "Дата", type: "date", required: true },
      { key: "time", label: "Время", type: "time", required: false },
      { key: "pool", label: "Бассейн / ванна", type: "text", required: true, placeholder: "Например, большой бассейн" },
      { key: "waterTemp", label: "Температура воды, °C", type: "number", required: false, step: 0.1 },
      { key: "freeChlorine", label: "Свободный хлор, мг/л", type: "number", required: false, step: 0.01 },
      { key: "boundChlorine", label: "Связанный хлор, мг/л", type: "number", required: false, step: 0.01 },
      { key: "ph", label: "pH", type: "number", required: false, step: 0.1 },
      { key: "transparency", label: "Прозрачность", type: "text", required: false, placeholder: "Например, видна разметка дна" },
      { key: "visitors", label: "Посетителей за сеанс", type: "number", required: false, step: 1 },
      RESPONSIBLE,
    ],
  },
  {
    code: "inventory_condition",
    name: "Журнал оценки состояния металлического и пластикового инвентаря",
    description:
      "Осмотр ножей, досок, ёмкостей и другого инвентаря: сколы, трещины, отслоения",
    hint: "Строка на каждую осмотренную единицу: где стоит, из чего сделана, в каком состоянии и что с ней сделали.",
    dateKey: "date",
    titleKey: "item",
    isMandatorySanpin: false,
    isMandatoryHaccp: true,
    fields: [
      { key: "date", label: "Дата", type: "date", required: true },
      { key: "zone", label: "Цех / участок", type: "text", required: false, placeholder: "Например, холодный цех" },
      { key: "item", label: "Инвентарь", type: "text", required: true, placeholder: "Например, доска разделочная «СР»" },
      {
        key: "material",
        label: "Материал",
        type: "select",
        required: true,
        options: ["Металл", "Пластик"].map(option),
      },
      {
        key: "condition",
        label: "Состояние",
        type: "select",
        required: true,
        options: ["Исправен", "Есть повреждения", "Изъят из работы"].map(option),
      },
      { key: "action", label: "Что сделано", type: "text", required: false, placeholder: "Например, заменена новой" },
      RESPONSIBLE,
    ],
  },
  {
    code: "instrument_sterilization",
    name: "Журнал контроля стерилизации инструментов",
    description:
      "Учёт каждого цикла стерилизации инструментов: способ, режим и результат индикатора",
    hint: "Строка на каждую закладку в стерилизатор: какие инструменты, каким способом, при каком режиме и сработал ли индикатор.",
    dateKey: "date",
    titleKey: "instruments",
    isMandatorySanpin: true,
    isMandatoryHaccp: false,
    fields: [
      { key: "date", label: "Дата", type: "date", required: true },
      { key: "instruments", label: "Инструменты (наименование, кол-во)", type: "text", required: true, placeholder: "Например, кусачки — 3 шт., пушер — 2 шт." },
      {
        key: "method",
        label: "Способ",
        type: "select",
        required: true,
        options: [
          "Воздушный (сухожар)",
          "Паровой (автоклав)",
          "Химический",
          "Гласперленовый",
        ].map(option),
      },
      { key: "mode", label: "Режим (°C, мин)", type: "text", required: false, placeholder: "Например, 180 °C, 60 мин" },
      {
        key: "indicator",
        label: "Индикатор сработал",
        type: "select",
        required: false,
        options: ["Да", "Нет"].map(option),
      },
      { key: "sterilizer", label: "Стерилизатор", type: "text", required: false, placeholder: "Например, сухожар ГП-20" },
      RESPONSIBLE,
    ],
  },
  {
    code: "medical_waste_b",
    name: "Журнал учёта отходов класса Б",
    description:
      "Учёт эпидемиологически опасных отходов: сколько собрано, как обеззаражено и кому передано",
    hint: "Запись при каждом сборе и передаче отходов: что за отходы, сколько килограммов, как обеззаражены и кто забрал.",
    dateKey: "date",
    titleKey: "wasteType",
    isMandatorySanpin: true,
    isMandatoryHaccp: false,
    fields: [
      { key: "date", label: "Дата", type: "date", required: true },
      { key: "wasteType", label: "Вид отходов", type: "text", required: true, placeholder: "Например, использованные иглы, ватные диски" },
      { key: "amount", label: "Количество, кг", type: "number", required: false, step: 0.01 },
      { key: "disinfection", label: "Обеззараживание", type: "text", required: false, placeholder: "Например, дезраствор, 60 мин" },
      {
        key: "packaging",
        label: "Упаковка",
        type: "select",
        required: false,
        options: ["Жёлтый пакет", "Жёлтый контейнер для острого"].map(option),
      },
      { key: "handedTo", label: "Кому передано", type: "text", required: false, placeholder: "Организация, акт / накладная" },
      RESPONSIBLE,
    ],
  },
  {
    code: "batch_release",
    name: "Журнал допуска партии продукции к отгрузке",
    description:
      "Решение о выпуске партии готовой продукции после проверки внешнего вида, маркировки и упаковки",
    hint: "Строка на каждую партию перед отгрузкой: что проверили и допущена ли партия.",
    dateKey: "date",
    titleKey: "product",
    isMandatorySanpin: false,
    isMandatoryHaccp: true,
    fields: [
      { key: "date", label: "Дата", type: "date", required: true },
      { key: "product", label: "Продукция", type: "text", required: true, placeholder: "Например, хлеб пшеничный формовой" },
      { key: "batch", label: "Номер партии", type: "text", required: false, placeholder: "Например, 240926-01" },
      { key: "quantity", label: "Количество", type: "text", required: false, placeholder: "Например, 320 шт." },
      { key: "checks", label: "Проверено (органолептика, маркировка, упаковка)", type: "text", required: false, placeholder: "Например, вкус и запах в норме, этикетка верна" },
      {
        key: "decision",
        label: "Решение",
        type: "select",
        required: true,
        options: ["Допущено", "Не допущено"].map(option),
      },
      RESPONSIBLE,
    ],
  },
];

export const REGISTER_JOURNAL_CODES = REGISTER_JOURNALS.map((item) => item.code);

const BY_CODE = new Map(REGISTER_JOURNALS.map((item) => [item.code, item]));

export function getRegisterJournal(code: string): RegisterJournalDefinition | null {
  return BY_CODE.get(code) ?? null;
}

export function isGenericRegisterJournal(code: string): boolean {
  return BY_CODE.has(code);
}
