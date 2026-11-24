import { DEFAULT_OFF_JOURNAL_CODES, isUntouchedDisabledCodes } from "@/lib/health-check-default-off";
import {
  categoryForSphere,
  resolveSphereForCategory,
  sphereForCategory,
  type ObjectCategory,
} from "@/lib/object-categories";
import { SEEDED_DEFAULT_OFF_CODES } from "@/lib/new-journals-default-off";
import { normalizeSphere, type OrgSphere } from "@/lib/org-profile";
import {
  defaultDisabledCodesFor,
  requiredCodesFor,
  rulesFor,
  type SphereRules,
} from "@/lib/sphere-journal-rules";

/**
 * Журналы идут за сферой объекта (владелец, 2026-11-23: «объекты завязываем
 * на категориях»). Чистые функции — их зовут API объектов и «Настройка
 * журналов», проверяют тесты.
 */

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * Правила нескольких сфер одним набором: обязательные — объединение (правило
 * первой сферы побеждает при повторе кода), рекомендованные — без
 * обязательных, бумажные и приказы — объединение. Вступление и закон —
 * основной (первой) сферы.
 */
export function mergedRulesFor(spheres: readonly OrgSphere[]): SphereRules {
  const list = spheres.length > 0 ? spheres : (["other"] as const);
  const base = rulesFor(list[0]);
  if (list.length === 1) return base;
  const required = new Map(base.electronicRequired.map((rule) => [rule.code, rule]));
  let recommended = [...base.electronicRecommended];
  let paper = [...base.paperRequired];
  let ordersRequired = [...base.ordersRequired];
  let ordersRecommended = [...base.ordersRecommended];
  let checklists = [...base.checklistJournals];
  for (const sphere of list.slice(1)) {
    const rules = rulesFor(sphere);
    for (const rule of rules.electronicRequired) if (!required.has(rule.code)) required.set(rule.code, rule);
    recommended = [...recommended, ...rules.electronicRecommended];
    paper = [...paper, ...rules.paperRequired];
    ordersRequired = [...ordersRequired, ...rules.ordersRequired];
    ordersRecommended = [...ordersRecommended, ...rules.ordersRecommended];
    checklists = [...checklists, ...rules.checklistJournals];
  }
  const requiredOrders = new Set(ordersRequired);
  return {
    ...base,
    electronicRequired: [...required.values()],
    electronicRecommended: unique(recommended).filter((code) => !required.has(code)),
    paperRequired: unique(paper),
    ordersRequired: unique(ordersRequired),
    ordersRecommended: unique(ordersRecommended).filter((code) => !requiredOrders.has(code)),
    checklistJournals: unique(checklists),
  };
}

/** Обязательные журналы нескольких сфер. */
export function requiredCodesForSpheres(spheres: readonly OrgSphere[]): string[] {
  return unique(spheres.flatMap((sphere) => requiredCodesFor(sphere)));
}

/**
 * Набор журналов организации ещё стартовый: человек его не трогал. Пустой
 * (или только наши «выключенные по умолчанию») — или ровно набор сферы после
 * регистрации (одного журнала может не хватать: его включили ради QR шаблона).
 */
export function isStarterJournalSet(disabled: readonly string[], sphere: unknown): boolean {
  if (isUntouchedDisabledCodes([...disabled])) return true;
  const defaults = new Set(defaultDisabledCodesFor(normalizeSphere(sphere)));
  const harmless = new Set<string>([...DEFAULT_OFF_JOURNAL_CODES, ...SEEDED_DEFAULT_OFF_CODES]);
  const current = new Set(disabled);
  const extra = [...current].filter((code) => !defaults.has(code) && !harmless.has(code));
  const missing = [...defaults].filter((code) => !current.has(code));
  return extra.length === 0 && missing.length <= 1;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((code) => right.has(code));
}

export type ObjectJournalPlan = {
  /** Новая основная сфера организации (`Organization.type`); null — не менять. */
  organizationSphere: OrgSphere | null;
  /** Набор выключенных журналов всей организации; null — не менять. */
  organizationDisabled: string[] | null;
  /** Свой набор выключенных журналов объекта; null — не менять. */
  objectDisabled: string[] | null;
};

const NO_CHANGE: ObjectJournalPlan = { organizationSphere: null, organizationDisabled: null, objectDisabled: null };

/**
 * Что сделать с журналами, когда объекту выбрали сферу:
 *  - у организации нет основной сферы («Другое») — основной становится эта;
 *  - создание объекта основной категории: стартовый набор организации
 *    становится набором сферы, иначе объект живёт набором организации;
 *  - создание объекта другой категории — свой набор объекта по его сфере;
 *  - смена сферы объекта — включаем (не выключаем) обязательные журналы новой
 *    сферы там, где объект берёт набор (свой или организации).
 */
export function planObjectCategoryJournals(input: {
  organizationSphere: unknown;
  organizationDisabled: readonly string[];
  category: ObjectCategory;
  reason: "create" | "change";
  /** Свой набор объекта; null — объект живёт набором организации. */
  objectDisabled: readonly string[] | null;
}): ObjectJournalPlan {
  const before = normalizeSphere(input.organizationSphere);
  const adopt = categoryForSphere(before) === null;
  const main = adopt ? sphereForCategory(input.category) : before;
  const mainCategory = categoryForSphere(main);
  const objectSphere = resolveSphereForCategory(main, input.category);
  const organizationSphere = adopt ? main : null;

  if (input.reason === "create") {
    if (input.category === mainCategory) {
      if (!isStarterJournalSet(input.organizationDisabled, before)) return { ...NO_CHANGE, organizationSphere };
      const next = defaultDisabledCodesFor(main);
      return {
        organizationSphere,
        organizationDisabled: sameSet(next, input.organizationDisabled) ? null : next,
        objectDisabled: null,
      };
    }
    return { organizationSphere, organizationDisabled: null, objectDisabled: defaultDisabledCodesFor(objectSphere) };
  }

  const required = new Set(requiredCodesFor(objectSphere));
  const source = input.objectDisabled ?? input.organizationDisabled;
  const next = source.filter((code) => !required.has(code));
  if (next.length === source.length) return { ...NO_CHANGE, organizationSphere };
  return input.objectDisabled
    ? { organizationSphere, organizationDisabled: null, objectDisabled: next }
    : { organizationSphere, organizationDisabled: next, objectDisabled: null };
}
