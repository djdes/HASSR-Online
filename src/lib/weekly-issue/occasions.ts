import { addDays } from "@/lib/channel-autopost/topics";

/**
 * Праздники и поводы для еженедельного выпуска: российский календарь и
 * отраслевые даты общепита и пищевого производства. Подсказка `hint` —
 * чем WeSetup может пригодиться в этот повод (факт для ИИ, не текст поста).
 */

export type OccasionKind = "holiday" | "industry" | "season";

export interface Occasion {
  key: string;
  title: string;
  kind: OccasionKind;
  hint: string;
  /** Дата начала (YYYY-MM-DD) в году `year`. */
  start: (year: number) => string;
  /** Последний день повода (для сезонов); нет — однодневный. */
  end?: (year: number) => string;
}

export interface UpcomingOccasion {
  key: string;
  title: string;
  kind: OccasionKind;
  hint: string;
  /** Дата начала ближайшего вхождения. */
  dateKey: string;
  endKey: string;
  /** Через сколько дней от точки отсчёта (0 — уже идёт). */
  daysAway: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const fixed = (month: number, day: number) => (year: number) => `${year}-${pad(month)}-${pad(day)}`;

/** Православная Пасха (юлианский расчёт + 13 дней, верно для 1900–2099). */
export function orthodoxEaster(year: number): string {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julian = `${year}-${pad(month)}-${pad(day)}`;
  return addDays(julian, 13);
}

/** n-й день недели месяца (weekday: 0 — вс, 6 — сб). */
export function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return `${year}-${pad(month)}-${pad(1 + shift + (n - 1) * 7)}`;
}

export const OCCASIONS: Occasion[] = [
  { key: "new-year", title: "Новый год и новогодние каникулы", kind: "holiday", start: fixed(1, 1), end: fixed(1, 8), hint: "длинные каникулы и сменный график: журналы и задачи сотрудникам идут сами, руководитель видит пропуски с телефона" },
  { key: "christmas", title: "Рождество", kind: "holiday", start: fixed(1, 7), hint: "праздничное меню и банкеты — бракераж, температура блюд на раздаче и сроки хранения под контролем" },
  { key: "valentine", title: "День святого Валентина", kind: "holiday", start: fixed(2, 14), hint: "пик бронирований в кафе и ресторанах — кухня работает на пределе, чек-листы и журналы не дают упустить контроль" },
  { key: "defender", title: "День защитника Отечества", kind: "holiday", start: fixed(2, 23), hint: "праздничные банкеты и корпоративы — бракераж готовой продукции и учёт сроков годности" },
  { key: "maslenitsa", title: "Масленица", kind: "season", start: (y) => addDays(orthodoxEaster(y), -55), end: (y) => addDays(orthodoxEaster(y), -49), hint: "неделя блинов: больше заготовок и полуфабрикатов — маркировка, сроки и температура хранения" },
  { key: "women", title: "Международный женский день", kind: "holiday", start: fixed(3, 8), hint: "один из самых загруженных дней в общепите — журналы с телефона экономят время смены" },
  { key: "consumer-rights", title: "Всемирный день защиты прав потребителей", kind: "industry", start: fixed(3, 15), hint: "повод проверить, готово ли заведение к проверке: журналы, медкнижки, документы ХАССП" },
  { key: "easter", title: "Пасха", kind: "holiday", start: (y) => orthodoxEaster(y), hint: "куличи и праздничная выпечка — бракераж и сроки годности кондитерских изделий" },
  { key: "may-holidays", title: "Майские праздники", kind: "holiday", start: fixed(5, 1), end: fixed(5, 11), hint: "длинные выходные и сезон веранд — журналы ведутся без бумаги и без руководителя на месте" },
  { key: "children", title: "День защиты детей и летний сезон лагерей", kind: "season", start: fixed(6, 1), hint: "питание детей в лагерях и школах — строгие требования СанПиН, бракераж и пробы" },
  { key: "food-safety-day", title: "Всемирный день безопасности пищевых продуктов", kind: "industry", start: fixed(6, 7), hint: "профильный день для отрасли: ХАССП, журналы и контроль качества — то, чем занимается WeSetup" },
  { key: "russia-day", title: "День России", kind: "holiday", start: fixed(6, 12), hint: "длинные выходные — сменный график, задачи сотрудникам и контроль с телефона" },
  { key: "trade-day", title: "День работников торговли", kind: "industry", start: (y) => nthWeekday(y, 7, 6, 4), hint: "профессиональный праздник торговли — магазины с собственным производством тоже ведут журналы СанПиН" },
  { key: "school", title: "День знаний и школьное питание", kind: "season", start: fixed(9, 1), hint: "старт учебного года: школьные столовые и комбинаты питания под пристальным вниманием проверок" },
  { key: "sanepid-day", title: "День работников санитарно-эпидемиологической службы", kind: "industry", start: fixed(9, 15), hint: "повод напомнить: журналы и программа производственного контроля всегда готовы к проверке" },
  { key: "world-food-day", title: "Всемирный день продовольствия", kind: "industry", start: fixed(10, 16), hint: "качество и безопасность продуктов — ежедневная работа кухни, которую WeSetup делает видимой" },
  { key: "food-industry-day", title: "День работников пищевой промышленности", kind: "industry", start: (y) => nthWeekday(y, 10, 0, 3), hint: "профессиональный праздник пищевых производств — ХАССП и журналы цехов в одном кабинете" },
  { key: "chef-day", title: "Международный день повара", kind: "industry", start: fixed(10, 20), hint: "праздник поваров — журналы с телефона вместо бумажных тетрадей на кухне" },
  { key: "unity-day", title: "День народного единства", kind: "holiday", start: fixed(11, 4), hint: "праздничные выходные — сменный график и задачи сотрудникам без звонков" },
  { key: "corporate-season", title: "Сезон новогодних корпоративов", kind: "season", start: fixed(12, 1), end: fixed(12, 30), hint: "банкеты и корпоративы: больше заготовок и смен — бракераж, температура холодильников и сроки годности под контролем" },
];

/**
 * Поводы, которые начинаются в ближайшие `days` дней от `fromKey` или уже
 * идут (сезон). Отсортированы по дате.
 */
export function upcomingOccasions(fromKey: string, days = 31, occasions: readonly Occasion[] = OCCASIONS): UpcomingOccasion[] {
  const toKey = addDays(fromKey, days);
  const fromYear = Number(fromKey.slice(0, 4));
  const out: UpcomingOccasion[] = [];
  for (const occasion of occasions) {
    for (const year of [fromYear - 1, fromYear, fromYear + 1]) {
      const start = occasion.start(year);
      const end = occasion.end ? occasion.end(year) : start;
      if (end < fromKey || start > toKey) continue;
      const daysAway = Math.max(0, Math.round((Date.parse(`${start}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000));
      out.push({ key: occasion.key, title: occasion.title, kind: occasion.kind, hint: occasion.hint, dateKey: start, endKey: end, daysAway });
      break;
    }
  }
  return out.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}
