import type { AccountBillingKind } from "@/lib/billing-period";
import { ORG_SPHERES, type OrgSphere } from "@/lib/org-profile";
import { isTechnicalEmail } from "@/lib/technical-email";

/**
 * Аудитория рассылки: пользователи платформы с фильтрами и загруженные
 * контакты. Здесь — чистая часть: фильтры пользователей работают над
 * готовыми строками (сервер собирает их одним проходом: пользователи,
 * организации, тарифы, подписки), контакты фильтруются запросом (много).
 */

export type BillingFilter = "any" | AccountBillingKind;

export type UserAudienceFilters = {
  /** Руководители — кто может открыть тариф и настройки; или все. */
  role: "managers" | "all";
  sphere: OrgSphere | "any";
  billing: BillingFilter;
  search: string;
  hasEmail: boolean;
  hasTelegram: boolean;
  hasPush: boolean;
  /** «ГГГГ-ММ-ДД» по Москве, включительно. */
  registeredFrom: string | null;
  registeredTo: string | null;
};

export const DEFAULT_USER_FILTERS: UserAudienceFilters = {
  role: "managers",
  sphere: "any",
  billing: "any",
  search: "",
  hasEmail: false,
  hasTelegram: false,
  hasPush: false,
  registeredFrom: null,
  registeredTo: null,
};

const BILLING_VALUES: ReadonlySet<string> = new Set([
  "any",
  "exempt",
  "paid",
  "legacy",
  "free_period",
  "free",
  "needs_decision",
]);
const SPHERE_VALUES: ReadonlySet<string> = new Set(ORG_SPHERES.map((s) => s.value));
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function bool(value: unknown): boolean {
  return value === true || value === "1" || value === "true";
}

/** Фильтры из query/JSON: всё незнакомое — значение по умолчанию. */
export function normalizeUserFilters(raw: unknown): UserAudienceFilters {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sphere = typeof r.sphere === "string" && SPHERE_VALUES.has(r.sphere) ? (r.sphere as OrgSphere) : "any";
  const billing = typeof r.billing === "string" && BILLING_VALUES.has(r.billing) ? (r.billing as BillingFilter) : "any";
  const day = (v: unknown) => (typeof v === "string" && DAY_RE.test(v) ? v : null);
  return {
    role: r.role === "all" ? "all" : "managers",
    sphere,
    billing,
    search: typeof r.search === "string" ? r.search.trim().slice(0, 100) : "",
    hasEmail: bool(r.hasEmail),
    hasTelegram: bool(r.hasTelegram),
    hasPush: bool(r.hasPush),
    registeredFrom: day(r.registeredFrom),
    registeredTo: day(r.registeredTo),
  };
}

export type AudienceUserRow = {
  id: string;
  name: string;
  /** Адрес для рассылки: контактная почта или логин, если он настоящий. */
  email: string | null;
  isManagement: boolean;
  organizationId: string;
  organizationName: string;
  sphere: OrgSphere;
  billing: AccountBillingKind;
  hasTelegram: boolean;
  webPushCount: number;
  appDeviceCount: number;
  /** ISO-время регистрации. */
  createdAt: string;
  marketingOptOut: boolean;
  /** Адрес в стоп-листе рекламных писем. */
  suppressed: boolean;
};

/** Адрес, на который пользователю можно писать: не служебный синтетический. */
export function userMarketingEmail(user: { email: string; contactEmail?: string | null }): string | null {
  const contact = (user.contactEmail ?? "").trim().toLowerCase();
  if (contact && contact.includes("@") && !isTechnicalEmail(contact)) return contact;
  const login = (user.email ?? "").trim().toLowerCase();
  if (login && login.includes("@") && !isTechnicalEmail(login)) return login;
  return null;
}

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** «2026-09-01» → 00:00 МСК этого дня. */
export function mskDayToDate(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - MSK_OFFSET_MS);
}

export function matchesUserFilters(row: AudienceUserRow, f: UserAudienceFilters): boolean {
  if (f.role === "managers" && !row.isManagement) return false;
  if (f.sphere !== "any" && row.sphere !== f.sphere) return false;
  if (f.billing !== "any" && row.billing !== f.billing) return false;
  if (f.hasEmail && !row.email) return false;
  if (f.hasTelegram && !row.hasTelegram) return false;
  if (f.hasPush && row.webPushCount + row.appDeviceCount === 0) return false;
  const created = Date.parse(row.createdAt);
  if (f.registeredFrom && created < mskDayToDate(f.registeredFrom).getTime()) return false;
  if (f.registeredTo && created >= mskDayToDate(f.registeredTo).getTime() + DAY_MS) return false;
  if (f.search) {
    const needle = f.search.toLowerCase().replace(/ё/g, "е");
    const hay = `${row.name} ${row.email ?? ""} ${row.organizationName}`.toLowerCase().replace(/ё/g, "е");
    if (!hay.includes(needle)) return false;
  }
  return true;
}

/** Отфильтровать и упорядочить: свежие регистрации сверху. */
export function filterAudienceUsers(rows: AudienceUserRow[], f: UserAudienceFilters): AudienceUserRow[] {
  return rows
    .filter((row) => matchesUserFilters(row, f))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- contacts

export const CONTACT_STATUSES = ["active", "unsubscribed", "bounced", "complained"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export type ContactFilters = {
  search: string;
  /** Сфера, «без сферы» или любая. */
  sphere: OrgSphere | "none" | "any";
  tag: string;
  status: ContactStatus | "any";
  source: string;
};

export const DEFAULT_CONTACT_FILTERS: ContactFilters = {
  search: "",
  sphere: "any",
  tag: "",
  status: "any",
  source: "",
};

export function normalizeContactFilters(raw: unknown): ContactFilters {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sphere =
    r.sphere === "none"
      ? "none"
      : typeof r.sphere === "string" && SPHERE_VALUES.has(r.sphere)
        ? (r.sphere as OrgSphere)
        : "any";
  const status =
    typeof r.status === "string" && (CONTACT_STATUSES as readonly string[]).includes(r.status)
      ? (r.status as ContactStatus)
      : "any";
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return {
    search: text(r.search, 100),
    sphere,
    tag: text(r.tag, 40).toLowerCase(),
    status,
    source: text(r.source, 200),
  };
}

/**
 * Условие выборки контактов (форма `Prisma.MarketingContactWhereInput`,
 * но без импорта Prisma — модуль читают и тесты).
 */
export function contactWhere(f: ContactFilters): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  if (f.status !== "any") and.push({ status: f.status });
  if (f.sphere === "none") and.push({ sphere: null });
  else if (f.sphere !== "any") and.push({ sphere: f.sphere });
  if (f.tag) and.push({ tags: { has: f.tag } });
  if (f.source) and.push({ source: f.source });
  if (f.search) {
    and.push({
      OR: [
        { email: { contains: f.search.toLowerCase() } },
        { name: { contains: f.search, mode: "insensitive" } },
        { company: { contains: f.search, mode: "insensitive" } },
        { city: { contains: f.search, mode: "insensitive" } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}
