import { db } from "@/lib/db";
import { avitoConfigured, avitoFetch, avitoOwnUser } from "@/lib/avito/client.server";
import { advanceRubFromKopecks } from "@/lib/avito/notify";

/**
 * Кабинет Авито для экрана CRM → Авито: деньги, объявления и их статистика.
 * Аванс (`/cpa/v3/balanceInfo`, копейки) — с него списывают за просмотры и
 * целевые действия; кончится — объявления снимут с показов. Кошелёк
 * (`/core/v1/accounts/<id>/balance/`, рубли) — на платные услуги продвижения.
 */

export type AvitoBalances = { advanceRub: number | null; walletRub: number | null; bonusRub: number | null; errors: string[] };

export type AvitoItemRow = {
  id: number;
  title: string;
  status: string;
  price: number | null;
  url: string;
  address: string | null;
  category: string | null;
  views: number;
  contacts: number;
  favorites: number;
};

export type AvitoOverview = {
  configured: boolean;
  balances: AvitoBalances;
  items: AvitoItemRow[];
  statsDays: number;
  crm: { contacts: number; newUnassigned: number; awaiting: number; last7: number };
  errors: string[];
  loadedAt: string;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);

export async function avitoBalances(): Promise<AvitoBalances> {
  const result: AvitoBalances = { advanceRub: null, walletRub: null, bonusRub: null, errors: [] };
  if (!avitoConfigured()) return result;
  const own = await avitoOwnUser();
  await Promise.all([
    avitoFetch<{ balance?: number }>("/cpa/v3/balanceInfo", { method: "POST", json: {}, headers: { "X-Source": "wesetup-crm" } })
      .then((data) => {
        result.advanceRub = advanceRubFromKopecks(data.balance);
      })
      .catch((error) => result.errors.push(`аванс: ${errorText(error)}`)),
    avitoFetch<{ real?: number; bonus?: number }>(`/core/v1/accounts/${own.id}/balance/`)
      .then((data) => {
        result.walletRub = Number.isFinite(Number(data.real)) ? Number(data.real) : null;
        result.bonusRub = Number.isFinite(Number(data.bonus)) ? Number(data.bonus) : null;
      })
      .catch((error) => result.errors.push(`кошелёк: ${errorText(error)}`)),
  ]);
  return result;
}

type ItemResource = { id: number; title?: string; status?: string; price?: number | null; url?: string; address?: string; category?: { name?: string } };

async function listItems(): Promise<ItemResource[]> {
  const all: ItemResource[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const data = await avitoFetch<{ resources?: ItemResource[] }>(
      `/core/v1/items?per_page=100&page=${page}&status=active,removed,old,blocked,rejected`,
    );
    const rows = data.resources ?? [];
    all.push(...rows);
    if (rows.length < 100) break;
  }
  return all;
}

type StatsRow = { itemId: number; stats?: Array<{ uniqViews?: number; uniqContacts?: number; uniqFavorites?: number }> };

async function itemStats(userId: string, ids: number[], days: number): Promise<Map<number, { views: number; contacts: number; favorites: number }>> {
  const out = new Map<number, { views: number; contacts: number; favorites: number }>();
  const day = (offset: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date(Date.now() - offset * 86_400_000));
  for (let i = 0; i < ids.length; i += 200) {
    const data = await avitoFetch<{ result?: { items?: StatsRow[] } }>(`/stats/v1/accounts/${userId}/items`, {
      method: "POST",
      json: { dateFrom: day(days - 1), dateTo: day(0), itemIds: ids.slice(i, i + 200), fields: ["uniqViews", "uniqContacts", "uniqFavorites"], periodGrouping: "month" },
    });
    for (const row of data.result?.items ?? []) {
      const sum = { views: 0, contacts: 0, favorites: 0 };
      for (const point of row.stats ?? []) {
        sum.views += point.uniqViews ?? 0;
        sum.contacts += point.uniqContacts ?? 0;
        sum.favorites += point.uniqFavorites ?? 0;
      }
      out.set(row.itemId, sum);
    }
  }
  return out;
}

async function crmCounts() {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [contacts, newUnassigned, awaiting, last7] = await Promise.all([
    db.crmContact.count({ where: { avitoUserId: { not: null } } }),
    db.crmContact.count({ where: { avitoUserId: { not: null }, stage: "new", ownerId: null } }),
    db.crmContact.count({ where: { avitoUserId: { not: null }, awaitingChannel: "avito", stage: { notIn: ["lost", "spam"] } } }),
    db.crmContact.count({ where: { source: "avito", createdAt: { gte: since } } }),
  ]);
  return { contacts, newUnassigned, awaiting, last7 };
}

let cache: { at: number; data: AvitoOverview } | null = null;
const CACHE_MS = 2 * 60 * 1000;

/** Экран CRM → Авито. Ответ Авито держим 2 минуты: у статистики жёсткий лимит запросов. */
export async function loadAvitoOverview(force = false): Promise<AvitoOverview> {
  const statsDays = 30;
  const crm = await crmCounts();
  if (!avitoConfigured()) {
    return { configured: false, balances: { advanceRub: null, walletRub: null, bonusRub: null, errors: [] }, items: [], statsDays, crm, errors: [], loadedAt: new Date().toISOString() };
  }
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return { ...cache.data, crm };
  const errors: string[] = [];
  const [balances, items] = await Promise.all([
    avitoBalances().catch((error) => ({ advanceRub: null, walletRub: null, bonusRub: null, errors: [errorText(error)] }) as AvitoBalances),
    listItems().catch((error) => {
      errors.push(`объявления: ${errorText(error)}`);
      return [] as ItemResource[];
    }),
  ]);
  let stats = new Map<number, { views: number; contacts: number; favorites: number }>();
  if (items.length) {
    try {
      stats = await itemStats((await avitoOwnUser()).id, items.map((item) => item.id), statsDays);
    } catch (error) {
      errors.push(`статистика: ${errorText(error)}`);
    }
  }
  const order: Record<string, number> = { rejected: 0, blocked: 1, active: 2, old: 3, removed: 4 };
  const rows: AvitoItemRow[] = items
    .map((item) => ({
      id: item.id,
      title: item.title ?? `Объявление ${item.id}`,
      status: item.status ?? "unknown",
      price: item.price ?? null,
      url: item.url ?? `https://www.avito.ru/${item.id}`,
      address: item.address ?? null,
      category: item.category?.name ?? null,
      ...(stats.get(item.id) ?? { views: 0, contacts: 0, favorites: 0 }),
    }))
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.views - a.views);
  const data: AvitoOverview = { configured: true, balances, items: rows, statsDays, crm, errors: [...balances.errors, ...errors], loadedAt: new Date().toISOString() };
  cache = { at: Date.now(), data };
  return data;
}
