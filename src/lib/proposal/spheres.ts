import { ORG_SPHERES, type OrgSphere } from "@/lib/org-profile";

/**
 * Тексты КП под сферу. Правило одно: только то, что продукт умеет
 * сегодня, и только журналы, которые правила сферы (`SPHERE_RULES`)
 * включают или рекомендуют. У каждого преимущества перечислены коды
 * журналов, на которых оно держится, — тест `content.test.ts` сверяет их
 * с правилами сферы и каталогом: поменяли правила — тест подскажет
 * поправить текст.
 *
 * Где что проверено в коде (для отчёта и для следующего, кто будет
 * править тексты):
 *   • QR-наклейка холодильника/склада открывает форму именно этого
 *     объекта — `src/app/equipment-fill/[equipmentId]`, `room-fill`,
 *     `OBJECT_QR_JOURNAL_HINTS` (`src/lib/journal-fill.ts`); печать
 *     наклеек и плакатов — `/settings/equipment/qr-sheet`, `/settings/qr-posters`;
 *   • запись встаёт в графу сегодняшнего дня с именем заполнившего —
 *     `equipment-fill` (upsert строки дня под сотрудником);
 *   • остальные журналы — QR-плакат журнала (`/qj`, `journal-fill-html.ts`),
 *     форма из колонок журнала (`tasksflow-adapters/generic.ts`);
 *   • УФ-лампа: «Я включил» / «Я выключил», ресурс считается сам —
 *     `src/app/equipment-fill/[equipmentId]/uv-lamp-client.tsx`.
 * Модуль чистый — его читает и клиентский компонент ROOT.
 */

export type ProposalStep = { title: string; text: string };

export type ProposalBenefit = {
  title: string;
  text: string;
  /** Коды журналов (`ACTIVE_JOURNAL_CATALOG`), на которых держится преимущество. */
  journals: readonly string[];
};

export type ProposalSphereCopy = {
  sphere: OrgSphere;
  /** Подпись сферы в интерфейсе — как в анкете (`ORG_SPHERES`). */
  label: string;
  /** После «для»: «ресторана», «кафе и кофейни». */
  forWhom: string;
  /** «вашего ресторана» — в первом абзаце. */
  your: string;
  /** «ваш ресторан» — в заголовке «Что получит ваш ресторан». */
  yourNom: string;
  /** Кто сканирует QR: «шеф-повар». */
  who: string;
  /** Кто подключается на подписке: «повара и уборщицы». */
  team: string;
  /**
   * Пищевая сфера: в заголовке «ХАССП и СанПиН», в тексте — ссылка на
   * СанПиН 2.3/2.4.4282-26 (прямо разрешает электронные журналы). Салону
   * и фитнесу пищевые журналы не нужны (`SPHERE_RULES.beauty/fitness`) —
   * у них «СанПиН» без «ХАССП».
   */
  food: boolean;
  /** Где висит QR — сценарий «Как это работает». */
  qr: "fridge" | "poster";
  /** Для сценария «poster»: где висит плакат и что вносят. */
  poster?: { place: string; placeTitle: string; entry: string };
  benefits: readonly ProposalBenefit[];
};

/**
 * «Так же с телефона — …» под шагами: какие ещё журналы сферы заполняются по
 * QR-плакату. Группы журналов: хотя бы один код группы должен быть в правилах
 * сферы (тест `content.test.ts`).
 */
export type ProposalAlsoPhone = { text: string; groups: readonly (readonly string[])[] };

const ALSO_FOOD: ProposalAlsoPhone = {
  text: "бракераж, гигиенический журнал, уборка",
  groups: [["finished_product", "perishable_rejection"], ["hygiene"], ["cleaning"]],
};
const ALSO_FITNESS: ProposalAlsoPhone = {
  text: "уборки, учёт дезсредств",
  groups: [["cleaning", "general_cleaning"], ["disinfectant_usage"]],
};
const ALSO_BEAUTY: ProposalAlsoPhone = {
  text: "учёт дезсредств, генеральные уборки",
  groups: [["disinfectant_usage"], ["general_cleaning"]],
};

/** Что ещё сфера заполняет с телефона (для «Так же с телефона — …»). */
export function proposalAlsoPhone(sphere: OrgSphere): ProposalAlsoPhone {
  if (sphere === "fitness") return ALSO_FITNESS;
  if (sphere === "beauty") return ALSO_BEAUTY;
  return ALSO_FOOD;
}

const COLD = "cold_equipment_control";
const CLIMATE = "climate_control";

const FRIDGES: ProposalBenefit = {
  title: "Холодильники и склад",
  text: "Температура холодильников — по QR на дверце, влажность склада — по QR на стене. У каждого объекта свой код.",
  journals: [COLD, CLIMATE],
};

const HYGIENE: ProposalBenefit = {
  title: "Гигиена перед сменой",
  text: "Осмотр сотрудников — отметка в гигиеническом журнале до начала смены, с телефона.",
  journals: ["hygiene"],
};

const BRAKERAGE: ProposalBenefit = {
  title: "Бракераж",
  text: "Бракераж готовых блюд и скоропортящейся продукции — записи с телефона прямо на кухне.",
  journals: ["finished_product", "perishable_rejection"],
};

const FRYER: ProposalBenefit = {
  title: "Фритюр",
  text: "Вид жира, продукция и оценка качества — строка в журнале учёта фритюрных жиров.",
  journals: ["fryer_oil"],
};

const CLEANING: ProposalBenefit = {
  title: "Уборка",
  text: "Уборки — отметка по QR-плакату журнала: что сделано, кем и когда.",
  journals: ["cleaning"],
};

const WRITEOFF: ProposalBenefit = {
  title: "Списание",
  text: "Просрочка и брак — акт забраковки с телефона вместо бумажных актов.",
  journals: ["product_writeoff"],
};

const UV_LAMP: ProposalBenefit = {
  title: "УФ-лампы",
  text: "«Я включил» и «Я выключил» по QR на лампе — время работы и остаток ресурса считаются сами.",
  journals: ["uv_lamp_runtime"],
};

const INCOMING: ProposalBenefit = {
  title: "Приёмка",
  text: "Входной контроль поставок и бракераж скоропорта на приёмке — с телефона.",
  journals: ["incoming_control", "perishable_rejection"],
};

/**
 * Порядок — как в `ORG_SPHERES`. Проверка полноты — в тесте: у каждой
 * сферы есть тексты, 3–5 преимуществ.
 */
const COPY: Record<OrgSphere, Omit<ProposalSphereCopy, "sphere" | "label">> = {
  restaurant: {
    forWhom: "ресторана",
    your: "вашего ресторана",
    yourNom: "ваш ресторан",
    who: "шеф-повар",
    team: "повара и уборщицы",
    food: true,
    qr: "fridge",
    benefits: [FRIDGES, BRAKERAGE, HYGIENE, FRYER],
  },
  cafe: {
    forWhom: "кафе и кофейни",
    your: "вашего кафе",
    yourNom: "ваше кафе",
    who: "администратор",
    team: "бариста и повара",
    food: true,
    qr: "fridge",
    benefits: [
      {
        title: "Холодильники и витрины",
        text: "Температура холодильников и витрин — по QR на дверце: у каждого свой код.",
        journals: [COLD],
      },
      HYGIENE,
      INCOMING,
      CLEANING,
    ],
  },
  bar: {
    forWhom: "бара и паба",
    your: "вашего бара",
    yourNom: "ваш бар",
    who: "бармен",
    team: "бармены и официанты",
    food: true,
    qr: "fridge",
    benefits: [
      { title: "Холодильники с заготовками", text: "Температура — по QR на дверце: бармен отмечает за несколько секунд.", journals: [COLD] },
      { ...HYGIENE, title: "Гигиена бармена" },
      { title: "Бой посуды", text: "Разбитая посуда — строка в журнале учёта боя: что, сколько, где и почему.", journals: ["tableware_breakage"] },
      CLEANING,
    ],
  },
  canteen: {
    forWhom: "столовой",
    your: "вашей столовой",
    yourNom: "ваша столовая",
    who: "заведующая производством",
    team: "повара и кухонные работники",
    food: true,
    qr: "fridge",
    benefits: [
      { ...BRAKERAGE, text: "Бракераж готовых блюд и скоропорта — записи с телефона, без тетрадей на раздаче." },
      FRIDGES,
      { title: "Суточные пробы", text: "Отбор и хранение суточных проб — строки журнала с телефона.", journals: ["daily_samples"] },
      HYGIENE,
    ],
  },
  fastfood: {
    forWhom: "фастфуда",
    your: "вашей точки",
    yourNom: "ваша точка",
    who: "старший смены",
    team: "повара смены",
    food: true,
    qr: "fridge",
    benefits: [
      FRYER,
      {
        title: "Холодильники",
        text: "Температура — по QR на дверце: у каждого холодильника свой код, запись в графу дня.",
        journals: [COLD],
      },
      WRITEOFF,
      HYGIENE,
    ],
  },
  bakery: {
    forWhom: "пекарни",
    your: "вашей пекарни",
    yourNom: "ваша пекарня",
    who: "технолог",
    team: "пекари и кондитеры",
    food: true,
    qr: "fridge",
    benefits: [
      {
        title: "Входной контроль сырья",
        text: "Мука, дрожжи, упаковка — приёмка партии с отметкой, кто принимал.",
        journals: ["incoming_raw_materials_control"],
      },
      FRIDGES,
      { title: "Бракераж выпечки", text: "Оценка готовой продукции — запись с телефона прямо в цехе.", journals: ["finished_product"] },
      { title: "Допуск партии", text: "Партия продукции — допуск к отгрузке записью в журнале.", journals: ["batch_release"] },
    ],
  },
  catering: {
    forWhom: "кейтеринга и доставки",
    your: "вашей кухни",
    yourNom: "ваша кухня",
    who: "шеф-повар",
    team: "повара и водители",
    food: true,
    qr: "fridge",
    benefits: [
      {
        title: "Интенсивное охлаждение",
        text: "Охлаждение горячих блюд перед упаковкой — время и температура в журнале.",
        journals: ["intensive_cooling"],
      },
      {
        title: "Температура в пути",
        text: "Контроль температуры при перевозке — запись с телефона.",
        journals: ["transport_temperature"],
      },
      BRAKERAGE,
      FRIDGES,
    ],
  },
  hotel: {
    forWhom: "отеля и гостиницы",
    your: "вашего отеля",
    yourNom: "ваш отель",
    who: "шеф-повар",
    team: "повара и горничные",
    food: true,
    qr: "fridge",
    benefits: [
      { ...BRAKERAGE, title: "Завтраки", text: "Бракераж блюд и скоропорта для завтраков — записи с телефона прямо на кухне." },
      { ...FRIDGES, title: "Склады и холодильники", text: "Температура и влажность складов, холодильники — по QR: у каждого объекта свой код." },
      { title: "Бассейн", text: "Если в отеле есть бассейн — контроль качества воды в том же кабинете.", journals: ["pool_water_control"] },
      HYGIENE,
    ],
  },
  retail: {
    forWhom: "продуктового магазина",
    your: "вашего магазина",
    yourNom: "ваш магазин",
    who: "заведующая магазином",
    team: "продавцы",
    food: true,
    qr: "fridge",
    benefits: [
      { title: "Холодильные витрины", text: "Температура — по QR на витрине или холодильнике: у каждого свой код.", journals: [COLD] },
      { ...INCOMING, title: "Приёмка товара" },
      { ...WRITEOFF, title: "Списание просрочки" },
      { ...HYGIENE, title: "Гигиена продавцов" },
    ],
  },
  gas_station: {
    forWhom: "АЗС и придорожного кафе",
    your: "вашего кафе",
    yourNom: "ваше кафе",
    who: "оператор смены",
    team: "операторы смен",
    food: true,
    qr: "fridge",
    benefits: [
      FRYER,
      { title: "Холодильники", text: "Температура — по QR на дверце: отметка между покупателями.", journals: [COLD] },
      { ...WRITEOFF, title: "Списание просрочки" },
      { ...HYGIENE, title: "Гигиена оператора" },
    ],
  },
  education: {
    forWhom: "школы, детского сада и лагеря",
    your: "вашего пищеблока",
    yourNom: "ваш пищеблок",
    who: "заведующая",
    team: "повара и медсестра",
    food: true,
    qr: "fridge",
    benefits: [
      { ...BRAKERAGE, text: "Бракераж блюд и скоропорта спрашивают почти на каждой проверке — записи с телефона прямо на кухне." },
      {
        title: "С-витаминизация",
        text: "Витаминизация третьих и сладких блюд — строка в журнале каждый день.",
        journals: ["vitaminization"],
      },
      { title: "Суточные пробы", text: "Отбор и хранение суточных проб — записи с телефона.", journals: ["daily_samples"] },
      UV_LAMP,
    ],
  },
  medical: {
    forWhom: "медцентра, больницы и санатория",
    your: "вашего пищеблока",
    yourNom: "ваш пищеблок",
    who: "диетсестра",
    team: "повара и медсёстры",
    food: true,
    qr: "fridge",
    benefits: [
      { ...BRAKERAGE, text: "На пищеблоке бракераж обязателен — записи о блюдах и скоропорте с телефона." },
      {
        title: "Пробы и С-витаминизация",
        text: "Суточные пробы и витаминизация блюд — строки журналов каждый день.",
        journals: ["daily_samples", "vitaminization"],
      },
      UV_LAMP,
      FRIDGES,
    ],
  },
  production: {
    forWhom: "пищевого производства",
    your: "вашего производства",
    yourNom: "ваше производство",
    who: "технолог",
    team: "мастера смен и технологи",
    food: true,
    qr: "fridge",
    benefits: [
      {
        title: "Входной контроль сырья",
        text: "Сырьё, ингредиенты, упаковка — приёмка партии с отметкой, кто принимал.",
        journals: ["incoming_raw_materials_control"],
      },
      {
        title: "Металлопримеси",
        text: "Если контроль есть в плане ХАССП — журнал учёта металлопримесей в сырье.",
        journals: ["metal_impurity"],
      },
      {
        title: "Прослеживаемость",
        text: "Журнал прослеживаемости продукции — от сырья до партии.",
        journals: ["traceability_test"],
      },
      FRIDGES,
    ],
  },
  fitness: {
    forWhom: "фитнес-центра и бассейна",
    your: "вашего клуба",
    yourNom: "ваш клуб",
    who: "администратор",
    team: "администраторы и уборщицы",
    food: false,
    qr: "poster",
    poster: {
      place: "QR-плакат журнала печатается в кабинете и вешается у бортика бассейна.",
      placeTitle: "QR у бассейна",
      entry: "Температура воды, хлор и pH встают в журнал с датой и именем того, кто заполнял.",
    },
    benefits: [
      {
        title: "Вода в бассейне",
        text: "Температура, свободный и связанный хлор, pH — строка журнала с телефона у бортика.",
        journals: ["pool_water_control"],
      },
      {
        title: "Дезинфекция",
        text: "Учёт дезинфицирующих средств: какое средство, сколько и до какого срока годно.",
        journals: ["disinfectant_usage"],
      },
      {
        title: "Уборки",
        text: "Текущие и генеральные уборки раздевалок и душевых — отметки по QR-плакату.",
        journals: ["cleaning", "general_cleaning"],
      },
      {
        title: "Дезинсекция",
        text: "Обработки по договору — журнал дезинфекции, дезинсекции и дератизации.",
        journals: ["pest_control"],
      },
    ],
  },
  beauty: {
    forWhom: "салона красоты и барбершопа",
    your: "вашего салона",
    yourNom: "ваш салон",
    who: "мастер",
    team: "мастера",
    food: false,
    qr: "poster",
    poster: {
      place: "QR-плакат журнала печатается в кабинете и вешается у стерилизатора.",
      placeTitle: "QR у стерилизатора",
      entry: "Закладка встаёт в журнал: инструменты, режим, индикатор и кто закладывал.",
    },
    benefits: [
      {
        title: "Стерилизация инструментов",
        text: "Инструменты, способ, режим и индикатор — строка журнала с телефона.",
        journals: ["instrument_sterilization"],
      },
      {
        title: "Дезсредства",
        text: "Учёт дезинфицирующих средств: какое средство, сколько и до какого срока годно.",
        journals: ["disinfectant_usage"],
      },
      {
        title: "Генеральные уборки",
        text: "График и отметки генеральных уборок — подтверждение всегда под рукой.",
        journals: ["general_cleaning"],
      },
      UV_LAMP,
    ],
  },
  other: {
    forWhom: "вашей организации",
    your: "вашей организации",
    yourNom: "ваша организация",
    who: "ответственный сотрудник",
    team: "сотрудники",
    food: true,
    qr: "fridge",
    benefits: [FRIDGES, HYGIENE, INCOMING, CLEANING],
  },
};

export const PROPOSAL_SPHERES: Array<{ sphere: OrgSphere; label: string }> = ORG_SPHERES.map((item) => ({
  sphere: item.value,
  label: item.label,
}));

const SPHERE_SET = new Set<string>(ORG_SPHERES.map((item) => item.value));

export function isProposalSphere(value: unknown): value is OrgSphere {
  return typeof value === "string" && SPHERE_SET.has(value);
}

export function proposalSphereCopy(sphere: OrgSphere): ProposalSphereCopy {
  const copy = COPY[sphere] ?? COPY.other;
  const label = ORG_SPHERES.find((item) => item.value === sphere)?.label ?? "Другое";
  return { sphere: COPY[sphere] ? sphere : "other", label, ...copy };
}

/** «Шеф-повар» — с заглавной, для начала предложения. */
export function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Три шага «Как это работает» — холодильник (пищевые сферы) или плакат журнала. */
export function proposalSteps(copy: ProposalSphereCopy): [ProposalStep, ProposalStep, ProposalStep] {
  const who = capitalize(copy.who);
  if (copy.qr === "poster" && copy.poster) {
    return [
      { title: copy.poster.placeTitle, text: copy.poster.place },
      {
        title: "Скан телефоном",
        text: `${who} наводит камеру — открывается форма журнала. Устанавливать ничего не нужно.`,
      },
      { title: "Запись в журнале", text: copy.poster.entry },
    ];
  }
  return [
    {
      title: "QR на холодильнике",
      text: "Наклейки печатаются в кабинете — у каждого холодильника и склада свой код.",
    },
    {
      title: "Скан телефоном",
      text: `${who} наводит камеру — открывается форма именно этого холодильника. Устанавливать ничего не нужно.`,
    },
    {
      title: "Показание в журнале",
      text: "Температура встаёт в графу сегодняшнего дня — с именем того, кто заполнял.",
    },
  ];
}
