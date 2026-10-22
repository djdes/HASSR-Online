import type { AccountBillingKind } from "@/lib/billing-period";

import type { AudienceUserRow } from "./audience";

/**
 * «Базы адресов» простого режима ROOT → «Рассылка»: кому отправить готовое
 * письмо, не выбирая людей поштучно.
 *
 *   - сегменты клиентов платформы — руководители, отобранные правилом
 *     (`CLIENT_SEGMENTS`): считаются на сервере по тем же строкам, что
 *     вкладка «Пользователи» (`loadAudienceUsers`);
 *   - загруженные базы — контакты с одним «Источником» (`MarketingContact.source`),
 *     только активные.
 *
 * Модуль чистый: id и правила читают и сервер, и тесты.
 */

export type MailingBaseKind = "clients" | "contacts";

export type MailingBase = {
  /** `clients:<ключ>` или `contacts:<источник>`. */
  id: string;
  kind: MailingBaseKind;
  title: string;
  description: string;
  /** Сколько людей (руководителей или активных контактов) в базе. */
  total: number;
  /** Сколько из них можно написать на почту (не в стоп-листе, не отписались). */
  emailable: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ещё не платят: бесплатный тариф, бесплатный период, решают про оплату, тестовый режим. */
const NOT_PAID: ReadonlySet<AccountBillingKind> = new Set(["free", "free_period", "needs_decision", "legacy"]);

export type ClientSegment = {
  id: string;
  title: string;
  description: string;
  match(row: AudienceUserRow, now: Date): boolean;
};

export const CLIENT_SEGMENTS: ClientSegment[] = [
  {
    id: "clients:managers",
    title: "Все клиенты",
    description: "Руководители всех заведений на платформе: владельцы, управляющие, заведующие.",
    match: (row) => row.isManagement,
  },
  {
    id: "clients:not-paid",
    title: "Клиенты, которые ещё не платят",
    description: "Руководители на бесплатном тарифе, в бесплатном периоде или перед решением об оплате.",
    match: (row) => row.isManagement && NOT_PAID.has(row.billing),
  },
  {
    id: "clients:paid",
    title: "Платящие клиенты",
    description: "Руководители организаций с оплаченной подпиской.",
    match: (row) => row.isManagement && row.billing === "paid",
  },
  {
    id: "clients:new-30",
    title: "Новые за 30 дней",
    description: "Руководители, которые зарегистрировались за последние 30 дней.",
    match: (row, now) => row.isManagement && now.getTime() - Date.parse(row.createdAt) <= 30 * DAY_MS,
  },
];

export const CONTACT_BASE_PREFIX = "contacts:";

export function contactBaseId(source: string): string {
  return `${CONTACT_BASE_PREFIX}${source}`;
}

/** `contacts:<источник>` → источник; иначе null. */
export function contactBaseSource(id: string): string | null {
  return id.startsWith(CONTACT_BASE_PREFIX) && id.length > CONTACT_BASE_PREFIX.length
    ? id.slice(CONTACT_BASE_PREFIX.length)
    : null;
}

export function clientSegment(id: string): ClientSegment | null {
  return CLIENT_SEGMENTS.find((s) => s.id === id) ?? null;
}

/** Письмо дойдёт: адрес есть, не в стоп-листе, человек не отписался от рекламы. */
export function userEmailable(row: AudienceUserRow): boolean {
  return Boolean(row.email) && !row.suppressed && !row.marketingOptOut;
}

/** Сегменты клиентов с числами — по строкам `loadAudienceUsers`. */
export function clientBases(rows: AudienceUserRow[], now: Date): MailingBase[] {
  return CLIENT_SEGMENTS.map((segment) => {
    const matched = rows.filter((row) => segment.match(row, now));
    return {
      id: segment.id,
      kind: "clients" as const,
      title: segment.title,
      description: segment.description,
      total: matched.length,
      emailable: matched.filter(userEmailable).length,
    };
  });
}

export const MAX_QUICK_BASES = 50;

/** id баз из запроса: только знакомые сегменты и `contacts:…`, без повторов. */
export function normalizeBaseIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (id.length > 240) continue;
    if (clientSegment(id) || contactBaseSource(id)) out.add(id);
    if (out.size >= MAX_QUICK_BASES) break;
  }
  return [...out];
}
