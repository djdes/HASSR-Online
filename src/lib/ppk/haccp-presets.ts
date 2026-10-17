/**
 * Справочные тексты ХАССП для раздела ППК: подписи групп продукции, показатели
 * безопасности по группам (ТР ТС 021/2011) и типовые этапы и опасности для
 * общепита. Чистые константы — без БД и React.
 */
import type { HazardData, ProductCategory } from "./records";

export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  "ready-meals": "Готовые блюда (кулинарная продукция)",
  "semi-finished": "Кулинарные полуфабрикаты",
  dairy: "Молочная продукция",
  meat: "Мясная продукция",
  fish: "Рыбная продукция",
  bakery: "Хлебобулочные и кондитерские изделия",
  drinks: "Напитки",
};

type Indicator = { name: string; norm: string };

const BY_SUBGROUP = "по подгруппе";

const KMAFANM: Indicator = { name: "КМАФАнМ, КОЕ/г", norm: "по подгруппе: ТР ТС 021/2011, прил. 1" };
const BGKP: Indicator = { name: "БГКП (колиформы)", norm: "не допускаются в массе, г — по подгруппе" };
const S_AUREUS: Indicator = { name: "S. aureus", norm: "не допускаются в массе, г — по подгруппе" };
const PATHOGENS: Indicator = { name: "Патогенные, в т. ч. сальмонеллы", norm: "не допускаются в 25 г" };
const LISTERIA: Indicator = { name: "L. monocytogenes", norm: "не допускаются в 25 г" };
const PROTEUS: Indicator = { name: "Бактерии рода Proteus", norm: BY_SUBGROUP };
const YEASTS: Indicator = { name: "Дрожжи, КОЕ/г", norm: BY_SUBGROUP };
const MOLDS: Indicator = { name: "Плесени, КОЕ/г", norm: BY_SUBGROUP };
const TOXIC: Indicator = {
  name: "Токсичные элементы (свинец, кадмий, мышьяк, ртуть)",
  norm: "по ТР ТС 021/2011, прил. 3",
};

const PRESETS: Record<ProductCategory, Indicator[]> = {
  "ready-meals": [KMAFANM, BGKP, S_AUREUS, PATHOGENS, LISTERIA, PROTEUS, TOXIC],
  "semi-finished": [KMAFANM, BGKP, S_AUREUS, PATHOGENS, PROTEUS, TOXIC],
  dairy: [
    KMAFANM,
    BGKP,
    S_AUREUS,
    PATHOGENS,
    LISTERIA,
    YEASTS,
    MOLDS,
    { name: "Антибиотики", norm: "по ТР ТС 033/2013" },
    TOXIC,
  ],
  meat: [
    KMAFANM,
    BGKP,
    S_AUREUS,
    PATHOGENS,
    LISTERIA,
    PROTEUS,
    { name: "Антибиотики", norm: "по ТР ТС 034/2013" },
    TOXIC,
  ],
  fish: [
    KMAFANM,
    BGKP,
    S_AUREUS,
    PATHOGENS,
    LISTERIA,
    { name: "Гистамин (лососёвые, сельдевые, скумбриевые, тунцовые), мг/кг", norm: "не более 100" },
    { name: "Паразитологические показатели", norm: "живые личинки паразитов не допускаются" },
    TOXIC,
  ],
  bakery: [KMAFANM, BGKP, S_AUREUS, PATHOGENS, YEASTS, MOLDS, TOXIC],
  drinks: [
    { name: "КМАФАнМ, КОЕ/см³", norm: BY_SUBGROUP },
    { name: "БГКП (колиформы)", norm: BY_SUBGROUP },
    { name: "Дрожжи и плесени, КОЕ/см³", norm: BY_SUBGROUP },
    { name: "Патогенные, в т. ч. сальмонеллы", norm: BY_SUBGROUP },
  ],
};

/** Показатели безопасности для группы — копия, её можно править в форме. */
export function productIndicatorPreset(category: ProductCategory): Indicator[] {
  return PRESETS[category].map((row) => ({ ...row }));
}

/** Типовые этапы техпроцесса общепита — подсказки для поля «Этап». */
export const TYPICAL_STEPS: string[] = [
  "Приёмка сырья",
  "Хранение сырья",
  "Размораживание",
  "Первичная обработка",
  "Нарезка и порционирование",
  "Тепловая обработка",
  "Охлаждение",
  "Хранение готовой продукции",
  "Раздача",
  "Мойка посуды и инвентаря",
];

/** Типовые опасности для общепита; оценки 1–4 — стартовые, их правит пользователь. */
export const TYPICAL_HAZARDS: HazardData[] = [
  {
    step: "Приёмка сырья",
    hazard: "Патогенные микроорганизмы в сыром мясе и птице (сальмонеллы, листерии)",
    type: "bio",
    probability: 3,
    severity: 4,
    measures: "Входной контроль, ветеринарные документы, температура при приёмке",
  },
  {
    step: "Приёмка сырья",
    hazard: "Остатки пестицидов и нитраты в овощах",
    type: "chem",
    probability: 2,
    severity: 3,
    measures: "Документы поставщика, выборочный лабораторный контроль",
  },
  {
    step: "Хранение сырья",
    hazard: "Рост микроорганизмов при нарушении температуры хранения",
    type: "bio",
    probability: 3,
    severity: 3,
    measures: "Контроль температуры холодильников дважды в смену, товарное соседство",
  },
  {
    step: "Размораживание",
    hazard: "Размножение микроорганизмов при размораживании в тепле",
    type: "bio",
    probability: 2,
    severity: 3,
    measures: "Размораживание в холодильнике при 0…+4 °C",
  },
  {
    step: "Первичная обработка",
    hazard: "Перекрёстное загрязнение сырой и готовой продукцией",
    type: "bio",
    probability: 3,
    severity: 3,
    measures: "Раздельный инвентарь по цветовой маркировке, разделение потоков",
  },
  {
    step: "Тепловая обработка",
    hazard: "Выживание патогенов при недостаточной тепловой обработке",
    type: "bio",
    probability: 3,
    severity: 4,
    measures: "Температура в толще продукта не ниже +75 °C, контроль термощупом",
  },
  {
    step: "Охлаждение",
    hazard: "Рост спорообразующих бактерий при медленном охлаждении",
    type: "bio",
    probability: 2,
    severity: 4,
    measures: "Интенсивное охлаждение в шкафу шоковой заморозки, контроль времени и температуры",
  },
  {
    step: "Нарезка и порционирование",
    hazard: "Осколки стекла и металлические включения",
    type: "phys",
    probability: 1,
    severity: 3,
    measures: "Учёт стеклянных предметов, контроль целостности инвентаря",
  },
  {
    step: "Раздача",
    hazard: "Аллергены в блюде без информации для гостя",
    type: "allergen",
    probability: 2,
    severity: 3,
    measures: "Маркировка аллергенов в меню, раздельный инвентарь",
  },
  {
    step: "Хранение готовой продукции",
    hazard: "Превышение сроков годности",
    type: "bio",
    probability: 2,
    severity: 3,
    measures: "Маркировка времени приготовления, контроль сроков",
  },
];
