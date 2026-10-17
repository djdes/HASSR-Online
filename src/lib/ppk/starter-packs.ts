/**
 * Стартовые пакеты для мастера «ППК за 10 минут»: по типу заведения —
 * продукция, опасности, блок-схемы, планы лаборатории и дезинсекции, нормативы.
 * Чистый модуль без БД и React; каждый вызов отдаёт свежую копию.
 */
import { productIndicatorPreset, TYPICAL_HAZARDS } from "./haccp-presets";
import { NORM_CATALOG } from "./norm-catalog";
import type {
  HazardData,
  LabPlanItem,
  PestPlanItem,
  PpkRecordBlock,
  ProductCategory,
  ProductData,
} from "./records";

export const STARTER_KINDS = ["cafe", "canteen", "bakery", "shop"] as const;
export type StarterKind = (typeof STARTER_KINDS)[number];

export function isStarterKind(value: unknown): value is StarterKind {
  return typeof value === "string" && (STARTER_KINDS as readonly string[]).includes(value);
}

/** Блоки, которые заполняет мастер, в порядке отчёта. */
export const STARTER_BLOCKS = [
  "products",
  "hazards",
  "flowchart",
  "lab-plan",
  "pest-plan",
  "norms",
  "policy",
] as const satisfies readonly PpkRecordBlock[];
export type StarterBlock = (typeof STARTER_BLOCKS)[number];

export type StarterPack = {
  products: ProductData[];
  hazards: HazardData[];
  flowcharts: { title: string; template: "hot" | "cold" | "pastry" }[];
  labPlan: LabPlanItem[];
  pestPlan: PestPlanItem[];
  norms: string[];
};

/** Типовой план лаборатории — те же строки, что кнопка «Заполнить типовым» на странице лаборатории. */
const TYPICAL_LAB_PLAN: LabPlanItem[] = [
  { object: "product", subject: "Готовые блюда", indicator: "Микробиологические показатели", everyMonths: 3, laboratory: "", lastDate: null },
  { object: "swabs", subject: "Смывы с оборудования и инвентаря", indicator: "БГКП", everyMonths: 3, laboratory: "", lastDate: null },
  { object: "swabs", subject: "Смывы с рук персонала", indicator: "БГКП, S. aureus", everyMonths: 3, laboratory: "", lastDate: null },
  { object: "water", subject: "Питьевая вода", indicator: "Микробиологические и органолептические показатели", everyMonths: 6, laboratory: "", lastDate: null },
];

/** Типовой план дезинсекции — как «Заполнить типовым» на странице дезинсекции. */
const TYPICAL_PEST_PLAN: PestPlanItem[] = [
  { kind: "disinsection", object: "Все помещения", frequency: "Ежемесячно", contractor: "", lastDate: null, nextDate: null },
  { kind: "deratization", object: "Все помещения", frequency: "Ежемесячно", contractor: "", lastDate: null, nextDate: null },
  { kind: "disinfection", object: "Все помещения", frequency: "Ежеквартально", contractor: "", lastDate: null, nextDate: null },
];

const BAKERY_FINISHING_HAZARD: HazardData = {
  step: "Отделка",
  hazard: "Рост микроорганизмов в креме при нарушении температуры хранения",
  type: "bio",
  probability: 3,
  severity: 3,
  measures: "Хранение изделий с кремом при +2…+6 °C, маркировка срока",
};

function product(
  name: string,
  category: ProductCategory,
  fields: Pick<ProductData, "composition" | "storage" | "shelfLife" | "usage" | "packaging">,
): ProductData {
  return { name, category, ...fields, indicators: productIndicatorPreset(category) };
}

const RECOMMENDED_NORMS = NORM_CATALOG.filter((doc) => doc.recommended).map((doc) => doc.id);

function typicalHazards(): HazardData[] {
  return TYPICAL_HAZARDS.map((row) => ({ ...row }));
}

function build(kind: StarterKind): Pick<StarterPack, "products" | "hazards" | "flowcharts"> {
  switch (kind) {
    case "cafe":
      return {
        products: [
          product("Салат «Цезарь»", "ready-meals", {
            composition: "Курица, салат романо, сухарики, сыр пармезан, соус",
            storage: "+2…+6 °C",
            shelfLife: "до 12 часов с момента приготовления",
            usage: "Подаётся сразу после приготовления",
            packaging: "Порционная тарелка",
          }),
          product("Суп-пюре", "ready-meals", {
            composition: "Овощи, бульон, сливки, специи",
            storage: "Горячее хранение не ниже +65 °C",
            shelfLife: "до 3 часов после приготовления",
            usage: "Подаётся горячим",
            packaging: "Порционная тарелка",
          }),
          product("Котлеты рубленые", "semi-finished", {
            composition: "Фарш, лук, хлеб, молоко, соль",
            storage: "0…+4 °C",
            shelfLife: "до 24 часов",
            usage: "Тепловая обработка до +75 °C в толще продукта",
            packaging: "Гастроёмкость с крышкой",
          }),
          product("Десерт творожный", "dairy", {
            composition: "Творог, сливки, сахар, ягодный соус",
            storage: "+2…+6 °C",
            shelfLife: "до 36 часов",
            usage: "Подаётся охлаждённым",
            packaging: "Порционная креманка",
          }),
        ],
        hazards: typicalHazards(),
        flowcharts: [
          { title: "Горячий цех", template: "hot" },
          { title: "Холодный цех", template: "cold" },
        ],
      };
    case "canteen":
      return {
        products: [
          product("Каша молочная", "dairy", {
            composition: "Крупа, молоко, сахар, масло сливочное, соль",
            storage: "Горячее хранение не ниже +65 °C",
            shelfLife: "до 2 часов после приготовления",
            usage: "Подаётся горячей",
            packaging: "Порционная тарелка",
          }),
          product("Суп овощной", "ready-meals", {
            composition: "Овощи, бульон, картофель, зелень",
            storage: "Горячее хранение не ниже +65 °C",
            shelfLife: "до 3 часов после приготовления",
            usage: "Подаётся горячим",
            packaging: "Порционная тарелка",
          }),
          product("Тефтели", "semi-finished", {
            composition: "Фарш, рис, лук, соль",
            storage: "0…+4 °C",
            shelfLife: "до 24 часов",
            usage: "Тепловая обработка до +75 °C в толще продукта",
            packaging: "Гастроёмкость с крышкой",
          }),
          product("Компот", "drinks", {
            composition: "Сухофрукты или ягоды, сахар, вода",
            storage: "+2…+6 °C",
            shelfLife: "до 24 часов",
            usage: "Подаётся охлаждённым",
            packaging: "Ёмкость с крышкой, стакан",
          }),
        ],
        hazards: typicalHazards(),
        flowcharts: [
          { title: "Горячий цех", template: "hot" },
          { title: "Холодный цех", template: "cold" },
        ],
      };
    case "bakery":
      return {
        products: [
          product("Хлеб пшеничный", "bakery", {
            composition: "Мука пшеничная, вода, дрожжи, соль, сахар",
            storage: "+15…+25 °C, влажность до 75 %",
            shelfLife: "до 48 часов",
            usage: "Реализация в день выпечки",
            packaging: "Бумажный пакет",
          }),
          product("Пирожное с кремом", "bakery", {
            composition: "Бисквит, крем на сливках, сахар, яйца",
            storage: "+2…+6 °C",
            shelfLife: "до 36 часов",
            usage: "Реализация охлаждённым",
            packaging: "Картонная коробка",
          }),
          product("Пирожки", "bakery", {
            composition: "Тесто дрожжевое, начинка по рецептуре",
            storage: "+15…+25 °C",
            shelfLife: "до 24 часов",
            usage: "Реализация в день выпечки",
            packaging: "Бумажный пакет",
          }),
        ],
        hazards: [...typicalHazards().filter((row) => row.step !== "Размораживание"), { ...BAKERY_FINISHING_HAZARD }],
        flowcharts: [{ title: "Кондитерский цех", template: "pastry" }],
      };
    case "shop":
      return {
        products: [
          product("Салаты", "ready-meals", {
            composition: "Овощи, мясо или птица, заправка",
            storage: "+2…+6 °C",
            shelfLife: "до 12 часов",
            usage: "Реализация охлаждёнными",
            packaging: "Контейнер с крышкой",
          }),
          product("Выпечка", "bakery", {
            composition: "Тесто, начинка по рецептуре",
            storage: "+15…+25 °C",
            shelfLife: "до 24 часов",
            usage: "Реализация в день выпечки",
            packaging: "Бумажный пакет",
          }),
          product("Нарезка гастрономии", "meat", {
            composition: "Колбасные изделия, сыры, мясные деликатесы",
            storage: "0…+6 °C",
            shelfLife: "до 24 часов после нарезки",
            usage: "Реализация охлаждённой",
            packaging: "Лоток с плёнкой",
          }),
        ],
        hazards: typicalHazards(),
        flowcharts: [{ title: "Кулинария", template: "cold" }],
      };
  }
}

/** Пакет для типа заведения: новая копия, её можно править. */
export function starterPack(kind: StarterKind): StarterPack {
  return {
    ...build(kind),
    labPlan: TYPICAL_LAB_PLAN.map((row) => ({ ...row })),
    pestPlan: TYPICAL_PEST_PLAN.map((row) => ({ ...row })),
    norms: [...RECOMMENDED_NORMS],
  };
}

export type StarterSummary = {
  products: number;
  hazards: number;
  flowcharts: number;
  labPlan: number;
  pestPlan: number;
  norms: number;
};

/** Сколько чего добавит пакет — для подписи в окне мастера. */
export function starterSummary(kind: StarterKind): StarterSummary {
  const pack = starterPack(kind);
  return {
    products: pack.products.length,
    hazards: pack.hazards.length,
    flowcharts: pack.flowcharts.length,
    labPlan: pack.labPlan.length,
    pestPlan: pack.pestPlan.length,
    norms: pack.norms.length,
  };
}
