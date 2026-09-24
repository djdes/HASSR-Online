import type { OrgType } from "@/lib/onboarding-presets";

/**
 * Единый словарь профиля организации: сфера, форма собственности,
 * количество точек.
 *
 * До этого «тип организации» жил четырьмя разошедшимися копиями —
 * в модалке анкеты, в двух API-роутах и в форме настроек, — и списки
 * успели разъехаться. Здесь один источник, остальные импортируют.
 *
 * `Organization.type` переиспользован под СФЕРУ: заводить вторую
 * колонку ради переименования смысла нет, а старые значения
 * («meat», «dairy», …) переводятся картой LEGACY_SPHERE_MAP.
 */

/** Название организации по умолчанию при мгновенной регистрации. */
export const DEFAULT_ORG_NAME = "Моя организация";

/**
 * Порядок — по частотности обращений, чтобы человек нашёл свою сферу в
 * начале списка. Бар, столовая, отель, медицина, АЗС, кейтеринг и
 * магазин раньше сваливались в «Кафе» и «Другое» — набор журналов у них
 * заметно разный, поэтому у каждой теперь своя строка правил.
 */
export const ORG_SPHERES = [
  { value: "restaurant", label: "Ресторан", preset: "restaurant" },
  { value: "cafe", label: "Кафе / Кофейня", preset: "restaurant" },
  { value: "bar", label: "Бар / Паб", preset: "restaurant" },
  { value: "canteen", label: "Столовая", preset: "restaurant" },
  { value: "fastfood", label: "Фастфуд", preset: "restaurant" },
  { value: "bakery", label: "Пекарня", preset: "bakery" },
  { value: "catering", label: "Кейтеринг / Доставка", preset: "restaurant" },
  { value: "hotel", label: "Отель / Гостиница", preset: "restaurant" },
  { value: "retail", label: "Продуктовый магазин", preset: "other" },
  { value: "gas_station", label: "АЗС / Придорожное кафе", preset: "restaurant" },
  { value: "education", label: "Школа / Детсад / Лагерь", preset: "other" },
  {
    value: "medical",
    label: "Медцентр / Больница / Санаторий",
    preset: "other",
  },
  { value: "production", label: "Производство", preset: "meat" },
  // Фитнес: основа — бассейн, дезинфекция и уборки; пищевые журналы
  // нужны только при фитнес-баре (см. SPHERE_RULES.fitness).
  {
    value: "fitness",
    label: "Фитнес-центр / Спортклуб / Бассейн",
    preset: "other",
  },
  { value: "other", label: "Другое", preset: "other" },
] as const satisfies readonly {
  value: string;
  label: string;
  preset: OrgType;
}[];

export type OrgSphere = (typeof ORG_SPHERES)[number]["value"];

export const ORG_OWNERSHIP = [
  { value: "private", label: "Частное" },
  { value: "chain", label: "Сетевое" },
  { value: "state", label: "Государственное" },
  { value: "other", label: "Другое" },
] as const;

export type OrgOwnership = (typeof ORG_OWNERSHIP)[number]["value"];

/**
 * Старые значения `Organization.type` → новые сферы. Нужна и после
 * миграции: у ROOT'а есть организации, которые никто не открывал, и
 * внешний API мог записать что угодно.
 */
export const LEGACY_SPHERE_MAP: Record<string, OrgSphere> = {
  meat: "production",
  dairy: "production",
  confectionery: "bakery",
  school: "education",
  // «hospital» — старое значение внешнего API; теперь у медицины своя
  // сфера с обязательными бракеражами, а не общая «Другое».
  hospital: "medical",
};
// `catering` и `retail` из карты убраны намеренно: это теперь живые
// значения сфер, а `normalizeSphere` проверяет SPHERE_VALUES раньше
// legacy-карты — строки стали бы мёртвым кодом.

const SPHERE_VALUES = new Set<string>(ORG_SPHERES.map((s) => s.value));
const OWNERSHIP_VALUES = new Set<string>(ORG_OWNERSHIP.map((o) => o.value));

/** Приводит любое сохранённое значение к валидной сфере. */
export function normalizeSphere(value: unknown): OrgSphere {
  if (typeof value !== "string") return "other";
  const v = value.toLowerCase().trim();
  if (SPHERE_VALUES.has(v)) return v as OrgSphere;
  return LEGACY_SPHERE_MAP[v] ?? "other";
}

export function normalizeOwnership(value: unknown): OrgOwnership {
  if (typeof value !== "string") return "private";
  const v = value.toLowerCase().trim();
  return OWNERSHIP_VALUES.has(v) ? (v as OrgOwnership) : "private";
}

/** Максимум точек в анкете: больше похоже на опечатку, чем на сеть. */
/**
 * Потолок количества точек. Пятидесяти не хватало: сеть или
 * производство спокойно называет 180 объектов, и упереться в предел
 * прямо в анкете — плохое первое впечатление. Ограничение остаётся
 * только как защита от опечатки в поле ввода.
 */
export const MAX_LOCATIONS = 500;

export function normalizeLocationsCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_LOCATIONS, Math.max(1, Math.round(n)));
}

/**
 * Сфера → пресет онбординга. Пресеты не переписываем: их шесть, они
 * про производственный профиль, а сфер пятнадцать и они про язык клиента.
 */
export function sphereToPreset(value: unknown): OrgType {
  const sphere = normalizeSphere(value);
  const found = ORG_SPHERES.find((s) => s.value === sphere);
  return (found?.preset ?? "other") as OrgType;
}

export function sphereLabel(value: unknown): string {
  const sphere = normalizeSphere(value);
  return ORG_SPHERES.find((s) => s.value === sphere)?.label ?? "Другое";
}

export function ownershipLabel(value: unknown): string {
  const kind = normalizeOwnership(value);
  return ORG_OWNERSHIP.find((o) => o.value === kind)?.label ?? "Частное";
}
