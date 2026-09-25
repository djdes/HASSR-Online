import { withDefaultOffCodes } from "@/lib/health-check-default-off";
import { ALL_JOURNAL_CODES } from "@/lib/onboarding-presets";
import type { OrgSphere } from "@/lib/org-profile";

/**
 * Какие журналы нужны заведению в зависимости от сферы деятельности.
 *
 * Раньше новая организация получала все журналы каталога включёнными, и на
 * дашборде висело «0/35» — человек видел объём, который в реальности к
 * нему не относится, и не понимал, с чего начать. Отсюда одна таблица
 * правды: обязательный минимум по сфере включаем, рекомендованное
 * предлагаем, остальное прячем — включить можно в любой момент.
 *
 * Отдельная категория — бумажные бланки. Раньше здесь утверждалось, что
 * все они «не принимаются электронно»; сверка показала, что это верно
 * только для инструктажей по охране труда (ТК РФ ст. 22.1 ч. 3 прямо
 * выводит их из электронного кадрового документооборота, письмо Минтруда
 * от 12.01.2023 № 14-6/ООГ-97). Противопожарный инструктаж и журнал
 * эксплуатации СПЗ вести электронно МОЖНО — с электронной подписью
 * (приказ МЧС № 806, разъяснения МЧС от 15.11.2022 № 1210; ППР № 1479
 * п. 17(1) вообще не задаёт формы). Бланк мы даём как удобный дефолт для
 * тех, у кого подписи у персонала нет, а не как единственный законный
 * путь.
 *
 * Второй важный факт: СанПиН 2.3/2.4.4282-26 почти нигде не требует
 * «журнала утверждённой формы» — он требует ФИКСИРОВАТЬ результаты
 * контроля, формы приложений № 1–5 называет рекомендуемыми и прямо
 * разрешает вести их на бумажном и (или) электронном носителе. Это
 * довод в пользу продукта, а не мелкая деталь.
 *
 * Основание у каждого журнала разное, и мешать их в одно «обязателен»
 * нельзя: требование санитарных правил, обязанность вести записи по
 * ХАССП (ТР ТС 021/2011 ст. 10) и «спрашивают при проверках» — три
 * разные вещи для человека, который решает, вести журнал или нет.
 *
 * ВНИМАНИЕ: содержимое таблицы — юридическое. Сверено 2026-09-01 по
 * СанПиН 2.3/2.4.4282-26 (постановление Главного государственного
 * санитарного врача РФ от 02.06.2026 № 18, действует с 01.09.2026 до
 * 01.09.2032; заменил 2.3/2.4.3590-20), ТР ТС 021/2011 ст. 10, ТК РФ
 * ст. 22.1 ч. 3 и Правилам обучения по ОТ № 2464, приказу МЧС № 806,
 * ППР № 1479 (до 31.12.2026), приказу Минтруда № 903н. Разбор со
 * ссылками — в
 * `C:/Users/Yaroslav/.claude/plans/wesetup-journals-legal-review.md`.
 * Номера пунктов нового СанПиН подтверждены только для фритюра (п. 44);
 * остальные подсказки намеренно без номеров — полнотекстовая юр-сверка
 * 4282-26 ещё требуется. Срок ППР истекает — перепроверить в декабре 2026.
 */

export type LawRef = { label: string; url: string };

/**
 * На чём держится требование вести журнал:
 * - `sanpin` — прямо требуют санитарные правила;
 * - `haccp` — обязанность вести записи процедур ХАССП (ТР ТС 021/2011);
 * - `practice` — закон не обязывает, но спрашивают при проверках
 *   (методические рекомендации Роспотребнадзора).
 *
 * Показываем человеку разными словами: «обязателен» без разбора врёт в
 * обе стороны — либо пугает лишним, либо усыпляет там, где штраф реален.
 */
export type RuleBasis = "sanpin" | "haccp" | "practice";

export type ElectronicRule = {
  /** Код JournalTemplate. */
  code: string;
  /**
   * Условие применимости — «при наличии фритюра». Такой журнал считается
   * обязательным, но выключается без предупреждения: у заведения может
   * просто не быть оборудования.
   */
  condition?: string;
  basis?: RuleBasis;
  /** Норма, на которую ссылаемся в подсказке у журнала. */
  law?: LawRef;
  /** Уточнение под названием: срок хранения, периодичность. */
  note?: string;
};

export type PaperJournal = {
  id: string;
  name: string;
  /**
   * Правда ли, что закон не даёт вести журнал электронно. Верно только
   * для инструктажей по охране труда; у остальных бланк — удобство, а
   * не обязанность, и подписывать их «Только на бумаге» значит вводить
   * человека в заблуждение.
   */
  paperOnly?: boolean;
  /** Одна строка «за что штраф» — человеку нужно понимать цену вопроса. */
  why: string;
  law: LawRef;
  fineHint: string;
  /** Колонки бланка — из них строится PDF для печати. */
  columns: string[];
};

export type SphereRules = {
  sphere: OrgSphere;
  intro: string;
  introLaw: LawRef;
  electronicRequired: ElectronicRule[];
  electronicRecommended: string[];
  paperRequired: string[];
  /**
   * Приказы, без которых заведение этой сферы не готово к проверке
   * (коды `ORDER_TEMPLATES`, src/lib/orders/catalog.ts). Начальная
   * настройка просит оформить их все.
   */
  ordersRequired: string[];
  /** Приказы «желательно оформить» — показываем свёрнутым списком. */
  ordersRecommended: string[];
  /**
   * Журналы, для которых сфере предлагаем настроить чек-лист (типовые
   * пункты — src/lib/checklist-defaults.ts). Показываются, только если
   * журнал у организации включён.
   */
  checklistJournals: string[];
};

const KOAP_66: LawRef = {
  label: "ст. 6.6 КоАП РФ",
  url: "https://www.consultant.ru/document/cons_doc_LAW_34661/dceffcf2617aa8cbad91f46398ce0beab3d0ea76/",
};

/**
 * Детские организации: проверяющие применяют ещё и ст. 6.7.
 *
 * Ссылка — на кодекс целиком, без якоря: подставлять правдоподобный
 * хэш вслепую нельзя, битая ссылка на статью хуже отсутствия ссылки.
 */
const KOAP_67: LawRef = {
  label: "ст. 6.6 и 6.7 КоАП РФ",
  url: "https://www.consultant.ru/document/cons_doc_LAW_34661/",
};

/** Пищевое производство отвечает не по 6.6, а по «техрегламентной» 14.43. */
const KOAP_1443: LawRef = {
  label: "ст. 14.43 КоАП РФ",
  url: "https://www.consultant.ru/document/cons_doc_LAW_34661/",
};

/**
 * Санитарные правила общепита — на них ссылаются подсказки журналов.
 *
 * С 01.09.2026 действует СанПиН 2.3/2.4.4282-26 (постановление Главного
 * государственного санитарного врача РФ от 02.06.2026 № 18, срок — до
 * 01.09.2032). Он заменил 2.3/2.4.3590-20 досрочно. Существо сохранено:
 * гигиенический журнал, температура холодильников и складов, фритюр,
 * бракеражи; электронное ведение по-прежнему разрешено прямо. Изменилась
 * нумерация пунктов, поэтому в подсказках номера остались только там, где
 * они подтверждены (фритюр — п. 44); остальное — без номера: выдумывать
 * ссылку на пункт в юридическом тексте нельзя.
 */
const SANPIN_4282: LawRef = {
  label: "СанПиН 2.3/2.4.4282-26",
  url: "https://www.consultant.ru/law/hotdocs/94329.html",
};

/** ТР ТС 021/2011, ст. 10 — процедуры ХАССП и записи по ним. */
const TR_TS_021: LawRef = {
  label: "ТР ТС 021/2011, ст. 10",
  url: "https://www.consultant.ru/document/cons_doc_LAW_124331/",
};

/** Методические рекомендации: основание «спрашивают при проверках». */
const MR_CHILD: LawRef = {
  label: "МР 2.4.0179-20",
  url: "https://files.stroyinf.ru/Data2/1/4293720/4293720726.htm",
};

/**
 * Дезинфекция, дезинсекция, дератизация. Номер правил есть в коде
 * (journal-doc-guides.ts); прямой адрес документа не подтверждён —
 * ссылка ведёт на поиск по номеру.
 */
const SANPIN_3686: LawRef = {
  label: "СанПиН 3.3686-21",
  url: "https://www.consultant.ru/search/?q=%D0%A1%D0%B0%D0%BD%D0%9F%D0%B8%D0%9D%203.3686-21",
};

/**
 * Эксплуатация помещений и сооружений, в том числе бассейнов. Пункт не
 * указываем: формулировку требований к журналу контроля воды нужно
 * сверить по полному тексту (см. note у правила). Ссылка — поиск по номеру.
 */
const SP_3678: LawRef = {
  label: "СП 2.1.3678-20",
  url: "https://www.consultant.ru/search/?q=%D0%A1%D0%9F%202.1.3678-20",
};

/**
 * Требования к организациям, которые оказывают бытовые услуги, в том
 * числе парикмахерским и салонам красоты: стерилизация инструментов,
 * уборки, дезинфекция. Номера пунктов не приводим — формулировки для
 * салонов требуют юр-сверки по полному тексту. Ссылка — поиск по номеру.
 */
const SANPIN_3678: LawRef = {
  label: "СанПиН 2.1.3678-20",
  url: "https://www.consultant.ru/search/?q=%D0%A1%D0%B0%D0%BD%D0%9F%D0%B8%D0%9D%202.1.3678-20",
};

/**
 * Обращение с отходами, в том числе медицинскими (класс Б —
 * эпидемиологически опасные). Номер пункта не приводим; ссылка — поиск.
 */
const SANPIN_3684: LawRef = {
  label: "СанПиН 2.1.3684-21",
  url: "https://www.consultant.ru/search/?q=%D0%A1%D0%B0%D0%BD%D0%9F%D0%B8%D0%9D%202.1.3684-21",
};

/**
 * Фитнес-центры отвечают не по «пищевой» 6.6, а по общим статьям о
 * санитарных требованиях к помещениям и сооружениям. Суммы штрафов в
 * текст не выносим — требуют юр-сверки; ссылка — на кодекс целиком, без
 * якоря (как KOAP_67).
 */
const KOAP_63_64: LawRef = {
  label: "ст. 6.3 и 6.4 КоАП РФ",
  url: "https://www.consultant.ru/document/cons_doc_LAW_34661/",
};

/**
 * Суточные пробы, витаминизация и контроль рациона — требования к
 * питанию в детских и медицинских организациях. План ссылался на
 * СанПиН 2.3/2.4.3590-20, но с 01.09.2026 действует 4282-26 (см. шапку
 * файла) — ссылаемся на действующий, без номера пункта: он требует
 * юр-сверки по полному тексту.
 */
const CHILD_MED_NUTRITION_NOTE =
  "СанПиН — питание в детских и медицинских организациях; номер пункта требует юр-сверки по полному тексту 4282-26";

/** Приказы: общий набор для всех пищевых сфер. */
const ORDERS_FOOD_REQUIRED = [
  "haccp-responsible",
  "sanitary-responsible",
  "journals-intro",
  "ppk-approval",
];
const ORDERS_FOOD_RECOMMENDED = [
  "haccp-team",
  "incoming-control",
  "cleaning-schedule",
  "disinfection",
  "medical-examinations",
  "workwear",
];
/** Детские и медицинские организации: плюс приказ о суточных пробах. */
const ORDERS_CHILD_MED_REQUIRED = [...ORDERS_FOOD_REQUIRED, "daily-samples"];
/** Пекарня и производство: плюс поверка средств измерений. */
const ORDERS_PRODUCTION_RECOMMENDED = [...ORDERS_FOOD_RECOMMENDED, "metrology"];

/** Чек-листы ежедневного контроля: пищевые сферы. */
const CHECKLISTS_FOOD = [
  "cleaning",
  "general_cleaning",
  "disinfectant_usage",
  "cold_equipment_control",
];
/**
 * Заметки «проверить у юриста» — для нас: на публичной странице их
 * вырезает publicNote (sphere-public-content.ts).
 */
const BEAUTY_3678_NOTE =
  "СанПиН 2.1.3678-20 — требования к парикмахерским и салонам красоты; номер пункта проверить у юриста";
const BEAUTY_3684_NOTE =
  "СанПиН 2.1.3684-21 — отходы класса Б собирают отдельно и обеззараживают; номер пункта проверить у юриста";

/** Детские и медицинские: плюс бактерицидные установки. */
const CHECKLISTS_CHILD_MED = [...CHECKLISTS_FOOD, "uv_lamp_runtime"];

/**
 * Бланки для печати.
 *
 * Только у двух журналов бумага — требование закона: инструктажи по
 * охране труда выведены из электронного документооборота (ТК РФ
 * ст. 22.1 ч. 3). Пожарный инструктаж и журнал эксплуатации СПЗ можно
 * вести электронно с подписью — бланк мы даём тем, у кого ЭП у
 * персонала нет. У каждого журнала об этом сказано в `why`, чтобы
 * человек не считал бумагу единственным вариантом.
 */
export const PAPER_JOURNALS: PaperJournal[] = [
  {
    id: "ot_intro",
    name: "Журнал вводного инструктажа по охране труда",
    paperOnly: true,
    why: "Только бумага с личной подписью: электронный кадровый документооборот к инструктажам по охране труда не применяется (ТК РФ ст. 22.1, письмо Минтруда № 14-6/ООГ-97). Инспектор ГИТ проверяет этот журнал первым.",
    law: {
      label: "ст. 5.27.1 КоАП РФ",
      url: "https://www.consultant.ru/document/cons_doc_LAW_34661/88755cc3b9fd053aebba33b58078eb459aa5a1d8/",
    },
    fineHint: "до 130 000 ₽ (для ИП и должностных лиц — до 25 000 ₽)",
    columns: [
      "Дата",
      "ФИО инструктируемого",
      "Год рождения",
      "Профессия, должность",
      "ФИО инструктирующего",
      "Подпись инструктирующего",
      "Подпись инструктируемого",
    ],
  },
  {
    id: "ot_workplace",
    name: "Журнал инструктажа на рабочем месте",
    paperOnly: true,
    why: "Первичный, повторный и внеплановый инструктажи — тоже только на бумаге с живой подписью (ТК РФ ст. 22.1 ч. 3).",
    law: {
      label: "ст. 5.27.1 КоАП РФ",
      url: "https://www.consultant.ru/document/cons_doc_LAW_34661/88755cc3b9fd053aebba33b58078eb459aa5a1d8/",
    },
    fineHint: "до 130 000 ₽ (для ИП и должностных лиц — до 25 000 ₽)",
    columns: [
      "Дата",
      "ФИО инструктируемого",
      "Профессия, должность",
      "Вид инструктажа",
      "ФИО инструктирующего",
      "Подпись инструктирующего",
      "Подпись инструктируемого",
    ],
  },
  {
    id: "fire_safety",
    name: "Журнал инструктажа по пожарной безопасности",
    why: "Ведётся отдельно от охраны труда и проверяется при любой пожарной проверке. Можно вести и электронно — с электронной подписью (приказ МЧС № 806, разъяснения МЧС от 15.11.2022 № 1210); бланк нужен, если подписи у сотрудников нет.",
    law: {
      label: "ст. 20.4 КоАП РФ",
      url: "https://www.consultant.ru/document/cons_doc_LAW_34661/9a42a7dcbc6d4d4b091d2e491b723161b4912163/",
    },
    fineHint: "до 400 000 ₽",
    columns: [
      "Дата",
      "ФИО инструктируемого",
      "Должность",
      "Вид инструктажа",
      "ФИО инструктирующего",
      "Подпись инструктирующего",
      "Подпись инструктируемого",
    ],
  },
  {
    id: "fire_extinguishers",
    name: "Журнал эксплуатации систем противопожарной защиты (учёт огнетушителей)",
    why: "На каждый огнетушитель — своя строка с датой осмотра и перезарядки. Форма произвольная (ППР № 1479 п. 17(1)), электронная тоже подходит — бланк даём для привычного бумажного ведения.",
    law: {
      label: "ППР № 1479, п. 60",
      url: "https://www.consultant.ru/document/cons_doc_LAW_363263/",
    },
    fineHint: "до 400 000 ₽",
    columns: [
      "Номер огнетушителя",
      "Тип, марка",
      "Дата ввода в эксплуатацию",
      "Место установки",
      "Дата осмотра",
      "Результат осмотра",
      "Дата перезарядки",
      "Подпись ответственного",
    ],
  },
  {
    id: "electrical_safety",
    name: "Журнал присвоения I группы по электробезопасности",
    why: "Нужен неэлектротехническому персоналу, который работает с электрооборудованием: мойщикам, поварам, уборщикам. Присвоение группы I — не реже раза в год, форму журнала организация определяет сама, но подписи проверяющего и работника обязательны.",
    law: {
      label: "Приказ Минтруда № 903н, п. 2.3",
      url: "https://www.consultant.ru/document/cons_doc_LAW_372952/",
    },
    fineHint: "до 130 000 ₽",
    columns: [
      "Дата",
      "ФИО работника",
      "Должность",
      "Группа по электробезопасности",
      "ФИО проверяющего",
      "Подпись проверяющего",
      "Подпись работника",
    ],
  },
];

// Группа I по электробезопасности нужна не только производству:
// неэлектротехнический персонал есть в любом заведении — мойщики,
// повара, уборщики работают с электрооборудованием, и присвоение группы
// оформляется журналом (приказ Минтруда № 903н, п. 2.3).
const PAPER_BASE = [
  "ot_intro",
  "ot_workplace",
  "fire_safety",
  "electrical_safety",
];
const PAPER_FULL = [...PAPER_BASE, "fire_extinguishers"];

/**
 * Вступление к набору журналов.
 *
 * Сознательно начинается с того, что закон РАЗРЕШАЕТ электронную форму:
 * это первое, что спрашивает человек, которому годами говорили «журнал
 * должен быть бумажный». Статья и суммы штрафа — разные по сферам,
 * поэтому передаются параметром, а не зашиты в текст.
 */
function intro(sphereLabel: string, penalty: string): string {
  return `Для сферы «${sphereLabel}» санитарные правила требуют вести эти записи — мы включили их сразу, остальное вы решаете сами. Вести можно в электронном виде: СанПиН 2.3/2.4.4282-26 прямо это разрешает — журналы приложений № 1–5 ведутся на бумажном и (или) электронном носителе. Отсутствие записей при проверке — нарушение: ${penalty}`;
}

/** Общепит: ст. 6.6 КоАП. */
const PENALTY_FOOD =
  "для организаций штраф до 50 000 ₽ или приостановка деятельности до 90 суток, для ИП — до 10 000 ₽.";

/** Детские организации: к 6.6 добавляется 6.7 с более высокими суммами. */
const PENALTY_CHILD =
  "для организаций штраф до 50 000 ₽ или приостановка до 90 суток; для детских организаций проверяющие применяют также ст. 6.7 КоАП РФ — до 70 000 ₽, при повторном нарушении до 150 000 ₽.";

/** Производство отвечает по техрегламенту, суммы там на порядок выше. */
const PENALTY_PRODUCTION =
  "для пищевого производства отсутствие процедур ХАССП и записей по ним — нарушение ТР ТС 021/2011: штраф по ст. 14.43 КоАП РФ до 300 000 ₽, при повторном нарушении или вреде здоровью — до 600 000 ₽ и приостановка деятельности.";

/** Условие у журнала температуры и влажности складов (СанПиН, склады). */
const CLIMATE_CONDITION = "нужен при наличии складских помещений (кладовых)";

/** Фритюр есть не везде — условие одинаковое во всех сферах. */
const FRYER_CONDITION = "нужен при наличии фритюра";

/**
 * Бракеражи обязательны для общепита, который кормит медицинские или
 * социальные организации. Обычной корпоративной столовой они не нужны —
 * поэтому это условие, а не безусловная обязанность.
 */
const CANTEEN_SOCIAL_CONDITION =
  "нужен, если столовая обслуживает медицинскую или социальную организацию";

export const SPHERE_RULES: Record<OrgSphere, SphereRules> = {
  restaurant: {
    sphere: "restaurant",
    intro: intro("Ресторан", PENALTY_FOOD),
    introLaw: KOAP_66,
    electronicRequired: [
      { code: "hygiene", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — осмотр персонала ежедневно перед сменой" },
      { code: "cold_equipment_control", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — ежедневно" },
      { code: "climate_control", condition: CLIMATE_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН 2.3/2.4.4282-26" },
      { code: "fryer_oil", condition: FRYER_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН, п. 44 — хранить записи не менее 3 месяцев" },
    ],
    electronicRecommended: [
      "cleaning",
      "finished_product",
      "perishable_rejection",
      "incoming_control",
      "med_books",
      "general_cleaning",
      "disinfectant_usage",
      "tableware_breakage",
      "staff_training",
      "complaint_register",
      "inventory_condition",
    ],
    paperRequired: PAPER_FULL,
    ordersRequired: ORDERS_FOOD_REQUIRED,
    ordersRecommended: ORDERS_FOOD_RECOMMENDED,
    checklistJournals: CHECKLISTS_FOOD,
  },
  cafe: {
    sphere: "cafe",
    intro: intro("Кафе / Кофейня", PENALTY_FOOD),
    introLaw: KOAP_66,
    electronicRequired: [
      { code: "hygiene", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — осмотр персонала ежедневно перед сменой" },
      { code: "cold_equipment_control", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — ежедневно" },
      { code: "climate_control", condition: CLIMATE_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН 2.3/2.4.4282-26" },
    ],
    electronicRecommended: [
      "cleaning",
      "perishable_rejection",
      "incoming_control",
      "med_books",
      "tableware_breakage",
      "inventory_condition",
    ],
    paperRequired: PAPER_BASE,
    ordersRequired: ORDERS_FOOD_REQUIRED,
    ordersRecommended: ORDERS_FOOD_RECOMMENDED,
    checklistJournals: CHECKLISTS_FOOD,
  },
  fastfood: {
    sphere: "fastfood",
    intro: intro("Фастфуд", PENALTY_FOOD),
    introLaw: KOAP_66,
    electronicRequired: [
      { code: "hygiene", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — осмотр персонала ежедневно перед сменой" },
      { code: "cold_equipment_control", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — ежедневно" },
      { code: "climate_control", condition: CLIMATE_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН 2.3/2.4.4282-26" },
      { code: "fryer_oil", condition: FRYER_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН, п. 44 — хранить записи не менее 3 месяцев" },
    ],
    // Бракеражи ушли из обязательных: СанПиН требует их только от
    // медицинских и социальных учреждений и общепита, который их
    // обслуживает (СанПиН 2.3/2.4.4282-26, п. 56, подп. 3, 13, 14). Для
    // обычного заведения это рекомендация — называть её обязанностью
    // нечестно.
    electronicRecommended: [
      "finished_product",
      "perishable_rejection",
      "cleaning",
      "incoming_control",
      "disinfectant_usage",
      "uv_lamp_runtime",
      "product_writeoff",
      "tableware_breakage",
      "inventory_condition",
    ],
    paperRequired: PAPER_FULL,
    ordersRequired: ORDERS_FOOD_REQUIRED,
    ordersRecommended: ORDERS_FOOD_RECOMMENDED,
    checklistJournals: CHECKLISTS_FOOD,
  },
  education: {
    sphere: "education",
    intro: intro("Школа / Детсад / Лагерь", PENALTY_CHILD),
    introLaw: KOAP_67,
    electronicRequired: [
      { code: "hygiene", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — осмотр персонала ежедневно перед сменой" },
      { code: "cold_equipment_control", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — ежедневно" },
      { code: "climate_control", condition: CLIMATE_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН 2.3/2.4.4282-26" },
      // Бракеражи в детских организациях СанПиН не требует (в главе VIII
      // их нет вовсе), но их рекомендуют МР 2.4.0179-20 и спрашивают
      // почти на каждой проверке — оставляем включёнными, честно называя
      // основание.
      { code: "finished_product", basis: "practice", law: MR_CHILD },
      { code: "perishable_rejection", basis: "practice", law: MR_CHILD },
      { code: "daily_samples", basis: "sanpin", law: SANPIN_4282, note: CHILD_MED_NUTRITION_NOTE },
      { code: "vitaminization", basis: "sanpin", law: SANPIN_4282, note: CHILD_MED_NUTRITION_NOTE },
    ],
    // health_check не рекомендуем ни одной сфере: это дубль гигиенического
    // журнала (форма осталась от отменённого СанПиН 2409-08), и он
    // выключен по умолчанию — см. health-check-default-off.ts.
    electronicRecommended: [
      "incoming_control",
      "cleaning",
      "general_cleaning",
      "med_books",
      "uv_lamp_runtime",
      "cleaning_ventilation_checklist",
      "disinfectant_usage",
      "ration_control",
      "sanitary_day_control",
      "staff_training",
    ],
    paperRequired: PAPER_FULL,
    ordersRequired: ORDERS_CHILD_MED_REQUIRED,
    ordersRecommended: ORDERS_FOOD_RECOMMENDED,
    checklistJournals: CHECKLISTS_CHILD_MED,
  },
  bakery: {
    sphere: "bakery",
    intro: intro("Пекарня", PENALTY_FOOD),
    introLaw: KOAP_66,
    electronicRequired: [
      { code: "hygiene", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — осмотр персонала ежедневно перед сменой" },
      { code: "cold_equipment_control", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — ежедневно" },
      { code: "climate_control", condition: CLIMATE_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН 2.3/2.4.4282-26" },
      { code: "incoming_raw_materials_control", basis: "haccp", law: TR_TS_021 },
    ],
    electronicRecommended: [
      "cleaning",
      "pest_control",
      "metal_impurity",
      "fryer_oil",
      "finished_product",
      "general_cleaning",
      "training_plan",
      "ppe_issuance",
      "equipment_maintenance",
      "inventory_condition",
      "batch_release",
    ],
    paperRequired: PAPER_FULL,
    ordersRequired: ORDERS_FOOD_REQUIRED,
    ordersRecommended: ORDERS_PRODUCTION_RECOMMENDED,
    checklistJournals: CHECKLISTS_FOOD,
  },
  production: {
    sphere: "production",
    intro: intro("Производство", PENALTY_PRODUCTION),
    introLaw: KOAP_1443,
    electronicRequired: [
      { code: "hygiene", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — осмотр персонала ежедневно перед сменой" },
      { code: "cold_equipment_control", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — ежедневно" },
      { code: "climate_control", condition: CLIMATE_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН 2.3/2.4.4282-26" },
      { code: "incoming_raw_materials_control", basis: "haccp", law: TR_TS_021 },
      // Металлопримеси — только если контроль есть в плане ХАССП:
      // требовать журнал от производства без металлодетектора нелепо.
      {
        code: "metal_impurity",
        condition: "нужен, если в плане ХАССП есть контроль металлопримесей",
        basis: "haccp",
        law: TR_TS_021,
      },
      { code: "finished_product", basis: "haccp", law: TR_TS_021 },
    ],
    // Тест прослеживаемости — хорошая практика и частый вопрос аудита,
    // но отдельной обязанности вести такой журнал в ТР ТС нет.
    electronicRecommended: [
      "traceability_test",
      "cleaning",
      "equipment_cleaning",
      "pest_control",
      "audit_plan",
      "audit_protocol",
      "audit_report",
      "equipment_calibration",
      "glass_items_list",
      "glass_control",
      "transport_temperature",
      "training_plan",
      "staff_training",
      "ppe_issuance",
      "accident_journal",
      "equipment_maintenance",
      "breakdown_history",
      "sanitary_day_control",
      "inventory_condition",
      "batch_release",
    ],
    paperRequired: PAPER_FULL,
    ordersRequired: ORDERS_FOOD_REQUIRED,
    ordersRecommended: ORDERS_PRODUCTION_RECOMMENDED,
    checklistJournals: CHECKLISTS_FOOD,
  },
  bar: {
    sphere: "bar",
    intro: intro("Бар / Паб", PENALTY_FOOD),
    introLaw: KOAP_66,
    // У бара нет горячего цеха и бракеражей: персонал контактирует с
    // продукцией (гигиенический журнал) и хранит скоропорт в холоде.
    // Фритюр для закусок — опция, поэтому он в рекомендациях.
    electronicRequired: [
      { code: "hygiene", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — осмотр персонала ежедневно перед сменой" },
      { code: "cold_equipment_control", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — ежедневно" },
      { code: "climate_control", condition: CLIMATE_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН 2.3/2.4.4282-26" },
    ],
    electronicRecommended: [
      "cleaning",
      "fryer_oil",
      "perishable_rejection",
      "med_books",
      "tableware_breakage",
    ],
    paperRequired: PAPER_BASE,
    ordersRequired: ORDERS_FOOD_REQUIRED,
    ordersRecommended: ORDERS_FOOD_RECOMMENDED,
    checklistJournals: CHECKLISTS_FOOD,
  },
  canteen: {
    sphere: "canteen",
    intro: intro("Столовая", PENALTY_FOOD),
    introLaw: KOAP_66,
    // Столовая — полный цикл. Бракеражи здесь не «на всякий случай»:
    // они обязательны, когда столовая кормит медицинскую или социальную
    // организацию (СанПиН 2.3/2.4.4282-26, п. 56, подп. 3, 13, 14 —
    // сверено по тексту правил 2026-09-26). Для корпоративной столовой
    // условие просто не выполняется, и журнал выключается без
    // предупреждения.
    electronicRequired: [
      { code: "hygiene", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — осмотр персонала ежедневно перед сменой" },
      { code: "cold_equipment_control", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — ежедневно" },
      { code: "climate_control", condition: CLIMATE_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН 2.3/2.4.4282-26" },
      { code: "fryer_oil", condition: FRYER_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН, п. 44 — хранить записи не менее 3 месяцев" },
      { code: "finished_product", condition: CANTEEN_SOCIAL_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН — требует юр-сверки по полному тексту 4282-26" },
      { code: "perishable_rejection", condition: CANTEEN_SOCIAL_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН — требует юр-сверки по полному тексту 4282-26" },
    ],
    electronicRecommended: [
      "cleaning",
      "incoming_control",
      "intensive_cooling",
      "med_books",
      "daily_samples",
      "tableware_breakage",
      "sanitary_day_control",
      "staff_training",
      "inventory_condition",
    ],
    paperRequired: PAPER_FULL,
    ordersRequired: ORDERS_FOOD_REQUIRED,
    ordersRecommended: ORDERS_FOOD_RECOMMENDED,
    checklistJournals: CHECKLISTS_FOOD,
  },
  hotel: {
    sphere: "hotel",
    intro: intro("Отель / Гостиница", PENALTY_FOOD),
    introLaw: KOAP_66,
    // Пищеблок отеля (завтраки, ресторан) — обычный общепит по СанПиН.
    // Бассейн есть не у каждого отеля, поэтому его журнал — в
    // рекомендациях; журнала номерного фонда в каталоге нет — не обещаем.
    electronicRequired: [
      { code: "hygiene", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — осмотр персонала ежедневно перед сменой" },
      { code: "cold_equipment_control", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — ежедневно" },
      { code: "climate_control", condition: CLIMATE_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН 2.3/2.4.4282-26" },
      { code: "fryer_oil", condition: FRYER_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН, п. 44 — хранить записи не менее 3 месяцев" },
    ],
    electronicRecommended: [
      "cleaning",
      "general_cleaning",
      "finished_product",
      "perishable_rejection",
      "incoming_control",
      "med_books",
      "daily_samples",
      "pool_water_control",
      "complaint_register",
    ],
    paperRequired: PAPER_FULL,
    ordersRequired: ORDERS_FOOD_REQUIRED,
    ordersRecommended: ORDERS_FOOD_RECOMMENDED,
    checklistJournals: CHECKLISTS_FOOD,
  },
  medical: {
    sphere: "medical",
    intro: intro("Медцентр / Больница / Санаторий", PENALTY_FOOD),
    introLaw: KOAP_66,
    // Единственная сфера, где бракеражи обязательны по санитарным
    // правилам без оговорок: выдача пищи только после снятия пробы.
    // Точный номер пункта в 4282-26 требует юр-сверки — в подсказке
    // пишем существо требования, а не выдуманный номер.
    electronicRequired: [
      { code: "hygiene", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — осмотр персонала ежедневно перед сменой" },
      { code: "cold_equipment_control", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — ежедневно" },
      { code: "climate_control", condition: CLIMATE_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН 2.3/2.4.4282-26" },
      { code: "finished_product", basis: "sanpin", law: SANPIN_4282, note: "Обязателен для медицинских и социальных организаций — требует юр-сверки по полному тексту 4282-26" },
      { code: "perishable_rejection", basis: "sanpin", law: SANPIN_4282, note: "Обязателен для медицинских и социальных организаций — требует юр-сверки по полному тексту 4282-26" },
      { code: "daily_samples", basis: "sanpin", law: SANPIN_4282, note: CHILD_MED_NUTRITION_NOTE },
      { code: "vitaminization", basis: "sanpin", law: SANPIN_4282, note: CHILD_MED_NUTRITION_NOTE },
    ],
    electronicRecommended: [
      "incoming_control",
      "cleaning",
      "general_cleaning",
      "uv_lamp_runtime",
      "disinfectant_usage",
      "med_books",
      "ration_control",
      "sanitary_day_control",
      "instrument_sterilization",
      "medical_waste_b",
    ],
    paperRequired: PAPER_FULL,
    ordersRequired: ORDERS_CHILD_MED_REQUIRED,
    ordersRecommended: ORDERS_FOOD_RECOMMENDED,
    checklistJournals: CHECKLISTS_CHILD_MED,
  },
  gas_station: {
    sphere: "gas_station",
    intro: intro("АЗС / Придорожное кафе", PENALTY_FOOD),
    introLaw: KOAP_66,
    // Специальных санитарных норм для кафе-зоны АЗС нет — это обычный
    // общепит. Хот-доги и фри делают фритюр типичным, а магазин при
    // АЗС — списания просрочки (в рекомендациях).
    electronicRequired: [
      { code: "hygiene", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — осмотр персонала ежедневно перед сменой" },
      { code: "cold_equipment_control", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — ежедневно" },
      { code: "climate_control", condition: CLIMATE_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН 2.3/2.4.4282-26" },
      { code: "fryer_oil", condition: FRYER_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН, п. 44 — хранить записи не менее 3 месяцев" },
    ],
    electronicRecommended: [
      "perishable_rejection",
      "incoming_control",
      "product_writeoff",
      "cleaning",
      "disinfectant_usage",
      "med_books",
    ],
    paperRequired: PAPER_FULL,
    ordersRequired: ORDERS_FOOD_REQUIRED,
    ordersRecommended: ORDERS_FOOD_RECOMMENDED,
    checklistJournals: CHECKLISTS_FOOD,
  },
  catering: {
    sphere: "catering",
    intro: intro("Кейтеринг / Доставка", PENALTY_FOOD),
    introLaw: KOAP_66,
    // Дарк-китчен и выездное обслуживание — обычный общепит плюс
    // перевозка: интенсивное охлаждение перед упаковкой и температура
    // при транспортировке — в рекомендациях (обязанность вести их
    // отдельным журналом зависит от плана ХАССП).
    electronicRequired: [
      { code: "hygiene", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — осмотр персонала ежедневно перед сменой" },
      { code: "cold_equipment_control", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — ежедневно" },
      { code: "climate_control", condition: CLIMATE_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН 2.3/2.4.4282-26" },
      { code: "fryer_oil", condition: FRYER_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН, п. 44 — хранить записи не менее 3 месяцев" },
    ],
    electronicRecommended: [
      "intensive_cooling",
      "finished_product",
      "perishable_rejection",
      "incoming_control",
      "cleaning",
      "med_books",
      "daily_samples",
      "transport_temperature",
      "inventory_condition",
    ],
    paperRequired: PAPER_FULL,
    ordersRequired: ORDERS_FOOD_REQUIRED,
    ordersRecommended: ORDERS_FOOD_RECOMMENDED,
    checklistJournals: CHECKLISTS_FOOD,
  },
  retail: {
    sphere: "retail",
    intro: intro("Продуктовый магазин", PENALTY_FOOD),
    introLaw: KOAP_66,
    // Кулинария и развес при магазине — общепит по СанПиН 4282-26,
    // чистая торговля живёт по СП 2.3.6.3668-20. Применимость
    // гигиенического журнала к чистой торговле спорна и ТРЕБУЕТ
    // ЮР-СВЕРКИ; включаем как безопасный дефолт — выключить можно в
    // один клик. У температуры хранения law не ставим: корректную
    // ссылку на СП 2.3.6.3668-20 подставлять вслепую нельзя.
    electronicRequired: [
      { code: "hygiene", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — осмотр персонала ежедневно перед сменой" },
      { code: "cold_equipment_control", basis: "sanpin", note: "СП для торговых объектов — соблюдение условий хранения производителя; требует юр-сверки" },
      { code: "climate_control", condition: CLIMATE_CONDITION, basis: "sanpin", note: "Температура и влажность складов — требует юр-сверки" },
    ],
    electronicRecommended: [
      "perishable_rejection",
      "incoming_control",
      "product_writeoff",
      "cleaning",
      "disinfectant_usage",
      "med_books",
      "transport_temperature",
      "complaint_register",
    ],
    paperRequired: PAPER_BASE,
    ordersRequired: ORDERS_FOOD_REQUIRED,
    ordersRecommended: ORDERS_FOOD_RECOMMENDED,
    checklistJournals: CHECKLISTS_FOOD,
  },
  fitness: {
    sphere: "fitness",
    // Своё вступление: общий intro() говорит о пищевых журналах, а для
    // фитнеса они нужны только при баре. Основа — бассейн, дезинфекция,
    // уборки и охрана труда.
    intro:
      "Для сферы «Фитнес-центр / Спортклуб / Бассейн» основа санитарного контроля — вода в бассейне, дезинфекция, уборки и охрана труда: эти записи мы включили сразу, остальное вы решаете сами. Пищевые журналы нужны, только если у вас есть фитнес-бар с продуктами — тогда действует СанПиН 2.3/2.4.4282-26, и он прямо разрешает вести записи в электронном виде. Отсутствие производственного контроля при проверке — нарушение санитарных требований к эксплуатации помещений: штраф по ст. 6.3 и 6.4 КоАП РФ или приостановка деятельности.",
    introLaw: KOAP_63_64,
    electronicRequired: [
      { code: "pest_control", basis: "sanpin", law: SANPIN_3686, note: "СанПиН 3.3686-21 — дезинсекция и дератизация по договору" },
      {
        code: "pool_water_control",
        condition: "нужен, если в клубе есть бассейн или ванны",
        basis: "sanpin",
        law: SP_3678,
        note: "проверить формулировку у юриста",
      },
      {
        code: "hygiene",
        condition: "нужен, если есть фитнес-бар с продуктами",
        basis: "sanpin",
        law: SANPIN_4282,
        note: "СанПиН — осмотр персонала бара ежедневно перед сменой",
      },
      {
        code: "cold_equipment_control",
        condition: "нужен, если есть фитнес-бар с продуктами",
        basis: "sanpin",
        law: SANPIN_4282,
        note: "СанПиН — ежедневно",
      },
    ],
    electronicRecommended: [
      "cleaning",
      "general_cleaning",
      "disinfectant_usage",
      "uv_lamp_runtime",
      "staff_training",
      "accident_journal",
      "complaint_register",
      "climate_control",
      "equipment_maintenance",
      "breakdown_history",
      "med_books",
    ],
    paperRequired: PAPER_FULL,
    ordersRequired: [
      "sanitary-responsible",
      "journals-intro",
      "ppk-approval",
      "disinfection",
    ],
    ordersRecommended: ["cleaning-schedule", "medical-examinations", "workwear"],
    checklistJournals: [
      "cleaning",
      "general_cleaning",
      "disinfectant_usage",
      "uv_lamp_runtime",
      "pool_water_control",
    ],
  },
  beauty: {
    sphere: "beauty",
    // Своё вступление: общий intro() говорит о пищевых журналах, а салону
    // они не нужны. Основа — стерилизация инструментов, дезинфекция и
    // уборки; отходы класса Б — только при косметологии и инъекциях.
    intro:
      "Для сферы «Салон красоты / Барбершоп / Маникюр» основа санитарного контроля — стерилизация инструментов, дезинфекция и уборки: эти записи мы включили сразу, остальное вы решаете сами. Пищевые журналы салону не нужны: СанПиН 2.3/2.4.4282-26 написан для общепита, а к салонам относятся санитарные требования к бытовым услугам — СанПиН 2.1.3678-20. Вести записи можно в электронном виде и распечатать бланк к проверке в один клик. Отсутствие производственного контроля при проверке — нарушение санитарных требований: штраф по ст. 6.3 и 6.4 КоАП РФ или приостановка деятельности.",
    introLaw: KOAP_63_64,
    electronicRequired: [
      { code: "instrument_sterilization", basis: "sanpin", law: SANPIN_3678, note: BEAUTY_3678_NOTE },
      { code: "general_cleaning", basis: "sanpin", law: SANPIN_3678, note: BEAUTY_3678_NOTE },
      { code: "disinfectant_usage", basis: "sanpin", law: SANPIN_3678, note: BEAUTY_3678_NOTE },
      {
        code: "medical_waste_b",
        condition: "нужен, если в салоне есть косметология или инъекционные процедуры",
        basis: "sanpin",
        law: SANPIN_3684,
        note: BEAUTY_3684_NOTE,
      },
    ],
    electronicRecommended: [
      "cleaning",
      "uv_lamp_runtime",
      "pest_control",
      "staff_training",
      "accident_journal",
      "complaint_register",
      "climate_control",
      "med_books",
    ],
    paperRequired: PAPER_FULL,
    ordersRequired: [
      "sanitary-responsible",
      "journals-intro",
      "ppk-approval",
      "disinfection",
    ],
    ordersRecommended: ["cleaning-schedule", "medical-examinations", "workwear"],
    checklistJournals: [
      "cleaning",
      "general_cleaning",
      "disinfectant_usage",
      "uv_lamp_runtime",
      "instrument_sterilization",
    ],
  },
  other: {
    sphere: "other",
    intro: intro("Другое", PENALTY_FOOD),
    introLaw: KOAP_66,
    electronicRequired: [
      { code: "hygiene", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — осмотр персонала ежедневно перед сменой" },
      { code: "cold_equipment_control", basis: "sanpin", law: SANPIN_4282, note: "СанПиН — ежедневно" },
      { code: "climate_control", condition: CLIMATE_CONDITION, basis: "sanpin", law: SANPIN_4282, note: "СанПиН 2.3/2.4.4282-26" },
    ],
    electronicRecommended: [
      "cleaning",
      "perishable_rejection",
      "incoming_control",
    ],
    paperRequired: PAPER_BASE,
    ordersRequired: ORDERS_FOOD_REQUIRED,
    ordersRecommended: ORDERS_FOOD_RECOMMENDED,
    checklistJournals: CHECKLISTS_FOOD,
  },
};

export function rulesFor(sphere: OrgSphere): SphereRules {
  return SPHERE_RULES[sphere] ?? SPHERE_RULES.other;
}

/** Коды журналов, которые должны быть включены у этой сферы. */
export function requiredCodesFor(sphere: OrgSphere): string[] {
  return rulesFor(sphere).electronicRequired.map((rule) => rule.code);
}

/**
 * Что записать в `Organization.disabledJournalCodes` для новой
 * организации: всё, кроме обязательного минимума. Хранилище негативное
 * («всё, кроме»), поэтому набор считается вычитанием.
 */
export function defaultDisabledCodesFor(sphere: OrgSphere): string[] {
  const required = new Set(requiredCodesFor(sphere));
  // Через withDefaultOffCodes: журнал здоровья выключен у новых
  // организаций всегда, даже если его по ошибке вернут в какой-то набор.
  return withDefaultOffCodes(
    ALL_JOURNAL_CODES.filter((code) => !required.has(code))
  );
}

/** Бумажные журналы сферы — в том порядке, в каком они перечислены. */
export function paperJournalsFor(sphere: OrgSphere): PaperJournal[] {
  const ids = rulesFor(sphere).paperRequired;
  return ids
    .map((id) => PAPER_JOURNALS.find((journal) => journal.id === id))
    .filter((journal): journal is PaperJournal => Boolean(journal));
}

export function paperJournalById(id: string): PaperJournal | null {
  return PAPER_JOURNALS.find((journal) => journal.id === id) ?? null;
}
