import { db as prisma } from "@/lib/db";
import { DAILY_JOURNAL_CODES } from "@/lib/daily-journal-codes";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { MED_BOOK_TEMPLATE_CODE, normalizeMedBookEntryData } from "@/lib/med-book-document";
import { orgTodayKey } from "@/lib/timezone";

/**
 * Обзор партнёрского кабинета: плитки + таблица клиентов.
 *
 * Требование AC8 — фиксированное число запросов независимо от числа
 * клиентов (≤ 6). Поэтому здесь нет вызовов `getTemplatesFilledToday`
 * на организацию: вместо этого пять batch-выборок по всем клиентам
 * сразу, а вся агрегация — в памяти (`aggregateOverview`, чистая
 * функция, покрыта тестами).
 *
 * Определения (зафиксированы в spec K11):
 *  - «Активные (7 дней)» — есть реальные записи в каждый из последних
 *    7 календарных дней (по датам записей документов или по createdAt
 *    полевых записей, в UTC-ключах дней).
 *  - «Просрочка сегодня» — у клиента есть активный ежедневный документ
 *    (код из `DAILY_JOURNAL_CODES`, срок покрывает сегодня по часовому
 *    поясу клиента), в котором за сегодня нет ни одной реальной записи.
 *    Журналы, хранящие строки в config (уборка, бракераж), здесь не
 *    учитываются — см. docs/partners-open-questions.md.
 *  - «Медкнижки истекают» — число строк медкнижек, у которых хотя бы
 *    одно обследование истекает в ближайшие 30 дней (включая сегодня)
 *    или уже просрочено.
 */

export const OVERVIEW_WINDOW_DAYS = 7;
export const MED_BOOK_HORIZON_DAYS = 30;

export {
  OVERVIEW_FILTER_LABELS,
  filterOverviewClients,
  isOverviewFilter,
  type OverviewClientRow,
  type OverviewFilter,
  type OverviewTiles,
  type PartnerOverview,
} from "./overview-shared";
import type { PartnerAccessLevel } from "./access-guard";
import { CONVERTED_SOURCE } from "./org-conversion-core";
import type { OverviewClientRow, OverviewTiles, PartnerOverview } from "./overview-shared";

/* ---------- чистая агрегация (тестируется без БД) ---------- */

export type OverviewClientInput = {
  partnerClientId: string;
  organizationId: string;
  name: string;
  type: string;
  plan: string;
  subscriptionEnd: Date | null;
  timezone: string;
  attachedAt: Date;
  detachedAt: Date | null;
  accessLevel: PartnerAccessLevel;
  clientHidesBranding: boolean;
  /**
   * Организацию завёл партнёр, и активных людей в ней ещё нет — значит
   * она не передана клиенту. Необязательное: тесты агрегатора собирают
   * строки вручную и про это поле не знают.
   */
  needsHandover?: boolean;
};

export type OverviewDocInput = {
  id: string;
  organizationId: string;
  code: string;
  dateFrom: Date;
  dateTo: Date;
};

/** Одна строка `groupBy(documentId, date)` по реальным записям документов. */
export type OverviewDocDayInput = { documentId: string; date: Date };

/** `groupBy(organizationId)` по полевым записям за 7 дней. */
export type OverviewFieldActivityInput = { organizationId: string; lastAt: Date; days: string[] };

export type OverviewMedBookInput = { organizationId: string; data: unknown };

export function dayKeyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Последние N календарных дней (UTC-ключи), включая сегодня. */
export function lastDayKeys(now: Date, days: number): string[] {
  const keys: string[] = [];
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = 0; i < days; i += 1) {
    keys.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
  }
  return keys;
}

export function addDaysKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Истекает ли медкнижка в горизонте: любое обследование с expiryDate ≤ today+horizon. */
export function medBookExpiresWithin(data: unknown, todayKey: string, horizonDays: number): boolean {
  const entry = normalizeMedBookEntryData(data);
  const limit = addDaysKey(todayKey, horizonDays);
  return Object.values(entry.examinations).some(
    (exam) => typeof exam.expiryDate === "string" && exam.expiryDate.length === 10 && exam.expiryDate <= limit,
  );
}

export function aggregateOverview(input: {
  now: Date;
  clients: OverviewClientInput[];
  docs: OverviewDocInput[];
  docDays: OverviewDocDayInput[];
  fieldActivity: OverviewFieldActivityInput[];
  medBooks: OverviewMedBookInput[];
}): PartnerOverview {
  const { now } = input;
  const windowKeys = lastDayKeys(now, OVERVIEW_WINDOW_DAYS);

  const docById = new Map(input.docs.map((doc) => [doc.id, doc]));
  const daysByOrg = new Map<string, Set<string>>();
  const lastActivityByOrg = new Map<string, number>();
  const docsWithToday = new Set<string>();

  const touch = (orgId: string, key: string, at: number) => {
    let set = daysByOrg.get(orgId);
    if (!set) {
      set = new Set();
      daysByOrg.set(orgId, set);
    }
    set.add(key);
    const prev = lastActivityByOrg.get(orgId) ?? 0;
    if (at > prev) lastActivityByOrg.set(orgId, at);
  };

  for (const row of input.docDays) {
    const doc = docById.get(row.documentId);
    if (!doc) continue;
    const key = dayKeyUtc(row.date);
    touch(doc.organizationId, key, row.date.getTime());
    docsWithToday.add(`${row.documentId}:${key}`);
  }
  for (const row of input.fieldActivity) {
    for (const key of row.days) touch(row.organizationId, key, row.lastAt.getTime());
  }

  const medBooksByOrg = new Map<string, number>();
  const clientsByOrg = new Map(input.clients.map((c) => [c.organizationId, c]));
  for (const book of input.medBooks) {
    const client = clientsByOrg.get(book.organizationId);
    if (!client) continue;
    const todayKey = orgTodayKey(client.timezone, now);
    if (medBookExpiresWithin(book.data, todayKey, MED_BOOK_HORIZON_DAYS)) {
      medBooksByOrg.set(book.organizationId, (medBooksByOrg.get(book.organizationId) ?? 0) + 1);
    }
  }

  const docsByOrg = new Map<string, OverviewDocInput[]>();
  for (const doc of input.docs) {
    if (!DAILY_JOURNAL_CODES.has(doc.code)) continue;
    const list = docsByOrg.get(doc.organizationId) ?? [];
    list.push(doc);
    docsByOrg.set(doc.organizationId, list);
  }

  const clients: OverviewClientRow[] = input.clients.map((client) => {
    const todayKey = orgTodayKey(client.timezone, now);
    const days = daysByOrg.get(client.organizationId) ?? new Set<string>();
    const activeLast7Days = windowKeys.every((key) => days.has(key));
    const lastTs = lastActivityByOrg.get(client.organizationId);

    let overdueToday = 0;
    for (const doc of docsByOrg.get(client.organizationId) ?? []) {
      const from = dayKeyUtc(doc.dateFrom);
      const to = dayKeyUtc(doc.dateTo);
      if (todayKey < from || todayKey > to) continue;
      if (!docsWithToday.has(`${doc.id}:${todayKey}`)) overdueToday += 1;
    }

    return {
      partnerClientId: client.partnerClientId,
      organizationId: client.organizationId,
      name: client.name,
      type: client.type,
      plan: client.plan,
      subscriptionEnd: client.subscriptionEnd ? client.subscriptionEnd.toISOString() : null,
      attachedAt: client.attachedAt.toISOString(),
      detachedAt: client.detachedAt ? client.detachedAt.toISOString() : null,
      accessLevel: client.accessLevel,
      clientHidesBranding: client.clientHidesBranding,
      lastActivityAt: lastTs ? new Date(lastTs).toISOString() : null,
      activeLast7Days: client.detachedAt ? false : activeLast7Days,
      overdueToday: client.detachedAt ? 0 : overdueToday,
      medBooksExpiring: client.detachedAt ? 0 : (medBooksByOrg.get(client.organizationId) ?? 0),
      needsHandover: client.detachedAt ? false : Boolean(client.needsHandover),
    };
  });

  const attached = clients.filter((c) => !c.detachedAt);
  const tiles: OverviewTiles = {
    clientsTotal: attached.length,
    activeLast7Days: attached.filter((c) => c.activeLast7Days).length,
    overdueToday: attached.filter((c) => c.overdueToday > 0).length,
    medBooksExpiring30: attached.filter((c) => c.medBooksExpiring > 0).length,
  };

  clients.sort((a, b) => {
    if (!!a.detachedAt !== !!b.detachedAt) return a.detachedAt ? 1 : -1;
    return a.name.localeCompare(b.name, "ru");
  });

  return { generatedAt: now.toISOString(), tiles, clients };
}

/* ---------- загрузка из БД: ровно 5 запросов ---------- */

export async function loadPartnerOverview(partnerId: string, now = new Date()): Promise<PartnerOverview> {
  const sinceUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (OVERVIEW_WINDOW_DAYS - 1)));
  // Записи документов датируются полуночью UTC локального дня — берём с запасом в сутки.
  const sinceWithSlack = new Date(sinceUtc.getTime() - 86_400_000);

  // 1. Клиенты партнёра вместе с организацией (включая отключённых — история).
  const links = await prisma.partnerClient.findMany({
    where: { partnerId },
    select: {
      id: true,
      organizationId: true,
      attachedAt: true,
      detachedAt: true,
      accessLevel: true,
      clientHidesBranding: true,
      source: true,
      organization: {
        select: {
          name: true,
          type: true,
          subscriptionPlan: true,
          subscriptionEnd: true,
          timezone: true,
          // Активных людей нет — владелец ещё не принял приглашение.
          // У переведённой из личного аккаунта люди есть, а владельца нет.
          _count: {
            select: {
              users: { where: { isActive: true } },
              members: { where: { role: "owner", user: { isActive: true } } },
            },
          },
        },
      },
    },
  });

  const clients: OverviewClientInput[] = links.map((link) => ({
    partnerClientId: link.id,
    organizationId: link.organizationId,
    name: link.organization.name,
    type: link.organization.type,
    plan: link.organization.subscriptionPlan,
    subscriptionEnd: link.organization.subscriptionEnd,
    timezone: link.organization.timezone || "Europe/Moscow",
    attachedAt: link.attachedAt,
    detachedAt: link.detachedAt,
    accessLevel: link.accessLevel === "edit" ? "edit" : "view",
    clientHidesBranding: link.clientHidesBranding,
    needsHandover:
      (link.source === "manual" && link.organization._count.users === 0) ||
      (link.source === CONVERTED_SOURCE && link.organization._count.members === 0),
  }));

  const activeOrgIds = clients.filter((c) => !c.detachedAt).map((c) => c.organizationId);
  if (activeOrgIds.length === 0) {
    return aggregateOverview({ now, clients, docs: [], docDays: [], fieldActivity: [], medBooks: [] });
  }

  // 2. Активные документы клиентов, чей срок пересекает окно.
  const docRows = await prisma.journalDocument.findMany({
    where: { organizationId: { in: activeOrgIds }, status: "active", dateTo: { gte: sinceWithSlack } },
    select: { id: true, organizationId: true, dateFrom: true, dateTo: true, template: { select: { code: true } } },
  });
  const docs: OverviewDocInput[] = docRows.map((d) => ({
    id: d.id,
    organizationId: d.organizationId,
    code: d.template.code,
    dateFrom: d.dateFrom,
    dateTo: d.dateTo,
  }));

  // 3. Дни с реальными записями по документам (одна groupBy на всех клиентов).
  const docDays =
    docs.length === 0
      ? []
      : await prisma.journalDocumentEntry.groupBy({
          by: ["documentId", "date"],
          where: { documentId: { in: docs.map((d) => d.id) }, date: { gte: sinceWithSlack }, ...NOT_AUTO_SEEDED },
        });

  // 4. Полевые записи за окно — по организациям. Нужны сами дни, поэтому
  //    берём createdAt (объём ограничен 7 днями и только клиентами партнёра).
  const fieldRows = await prisma.journalEntry.findMany({
    where: { organizationId: { in: activeOrgIds }, createdAt: { gte: sinceWithSlack } },
    select: { organizationId: true, createdAt: true },
  });
  const fieldByOrg = new Map<string, { lastAt: Date; days: Set<string> }>();
  for (const row of fieldRows) {
    const acc = fieldByOrg.get(row.organizationId) ?? { lastAt: row.createdAt, days: new Set<string>() };
    if (row.createdAt > acc.lastAt) acc.lastAt = row.createdAt;
    acc.days.add(dayKeyUtc(row.createdAt));
    fieldByOrg.set(row.organizationId, acc);
  }
  const fieldActivity: OverviewFieldActivityInput[] = [...fieldByOrg.entries()].map(([organizationId, acc]) => ({
    organizationId,
    lastAt: acc.lastAt,
    days: [...acc.days],
  }));

  // 5. Медкнижки всех клиентов.
  const medRows = await prisma.journalDocumentEntry.findMany({
    where: {
      document: { organizationId: { in: activeOrgIds }, status: "active", template: { code: MED_BOOK_TEMPLATE_CODE } },
      ...NOT_AUTO_SEEDED,
    },
    select: { data: true, document: { select: { organizationId: true } } },
  });
  const medBooks: OverviewMedBookInput[] = medRows.map((r) => ({ organizationId: r.document.organizationId, data: r.data }));

  return aggregateOverview({
    now,
    clients,
    docs,
    docDays: docDays.map((r) => ({ documentId: r.documentId, date: r.date })),
    fieldActivity,
    medBooks,
  });
}
