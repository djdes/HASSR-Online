import { buildingWhere } from "@/lib/building-scope";
import { db } from "@/lib/db";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { normalizeSphere } from "@/lib/org-profile";
import { orgTodayKey } from "@/lib/timezone";

import {
  BRAKERAGE_CODE,
  TODAY_STORAGE,
  brakerageDishesOn,
  buildTodayView,
  cleaningMarkedOn,
  registerFilledOn,
  sphereToday,
  todayAndYesterdayKeys,
  todayJournalCodes,
  type TodayDish,
  type TodayView,
} from "@/lib/badge/today";

/**
 * Данные блока «Сегодня» для публичной страницы бейджа: какие журналы сферы
 * ведутся (есть действующий документ), заполнены ли они сегодня и вчера и
 * какие блюда сегодня прошли бракераж. `buildingId` — точка: её документы и
 * общие без точки, как во всём кабинете (`buildingWhere`).
 *
 * Кеш 5 минут на организацию и точку: страницу открывают гости по QR, а
 * считать журналы на каждое открытие незачем.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: TodayView }>();

export type BadgeTodayOrg = {
  id: string;
  type: string | null;
  timezone: string | null;
};

function dayStart(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

export async function getBadgeToday(
  org: BadgeTodayOrg,
  buildingId: string | null,
  now: Date = new Date(),
): Promise<TodayView> {
  // Сфера в ключе: смена сферы в настройках сразу меняет блок, без ожидания кеша.
  const sphere = normalizeSphere(org.type);
  const key = `${org.id}:${buildingId ?? "-"}:${sphere}`;
  const cached = cache.get(key);
  if (cached && now.getTime() - cached.at < CACHE_TTL_MS) return cached.value;

  const spec = sphereToday(sphere);
  // У точки могут быть свои выключенные журналы поверх организации.
  const disabled = await getDisabledJournalCodes(org.id, buildingId);
  const codes = todayJournalCodes(spec).filter((code) => !disabled.has(code));
  const { today, yesterday } = todayAndYesterdayKeys(orgTodayKey(org.timezone || undefined, now));
  const todayStart = dayStart(today);
  const yesterdayStart = dayStart(yesterday);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);

  const documents =
    codes.length === 0
      ? []
      : await db.journalDocument.findMany({
          where: {
            organizationId: org.id,
            status: "active",
            template: { code: { in: codes } },
            dateFrom: { lte: todayStart },
            dateTo: { gte: yesterdayStart },
            ...buildingWhere(buildingId),
          },
          select: { id: true, config: true, dateFrom: true, dateTo: true, template: { select: { code: true } } },
        });

  // «Ведётся» — есть документ, действующий сегодня.
  const kept = new Set(
    documents.filter((doc) => doc.dateTo >= todayStart).map((doc) => doc.template.code),
  );
  const filledToday = new Set<string>();
  const filledYesterday = new Set<string>();
  const dishes: TodayDish[] = [];

  const entryDocs = documents.filter((doc) => TODAY_STORAGE[doc.template.code]?.kind === "entries");
  if (entryDocs.length > 0) {
    const rows = await db.journalDocumentEntry.groupBy({
      by: ["documentId", "date"],
      where: {
        documentId: { in: entryDocs.map((doc) => doc.id) },
        date: { gte: yesterdayStart, lt: tomorrowStart },
        ...NOT_AUTO_SEEDED,
      },
      _count: { _all: true },
    });
    const codeOf = new Map(entryDocs.map((doc) => [doc.id, doc.template.code]));
    for (const row of rows) {
      const code = codeOf.get(row.documentId);
      if (!code || row._count._all === 0) continue;
      const dayKey = row.date.toISOString().slice(0, 10);
      if (dayKey === today) filledToday.add(code);
      if (dayKey === yesterday) filledYesterday.add(code);
    }
  }

  for (const doc of documents) {
    const code = doc.template.code;
    const storage = TODAY_STORAGE[code];
    if (!storage || storage.kind === "entries") continue;
    const filledOn = (dayKey: string) => {
      if (storage.kind === "cleaning") return cleaningMarkedOn(doc.config, dayKey);
      if (storage.kind === "register") return registerFilledOn(doc.config, storage.dateKey, dayKey);
      return brakerageDishesOn(doc.config, dayKey).length > 0;
    };
    if (filledOn(today)) filledToday.add(code);
    if (filledOn(yesterday)) filledYesterday.add(code);
    if (code === BRAKERAGE_CODE) dishes.push(...brakerageDishesOn(doc.config, today));
  }

  const value = buildTodayView(spec, { kept, filledToday, filledYesterday, dishes });
  cache.set(key, { at: now.getTime(), value });
  return value;
}

export type BadgePoint = { id: string; name: string; address: string | null };

/**
 * Точки для публичной страницы: только когда журналы ведутся по точкам и
 * торговых точек хотя бы две — иначе страница одна на организацию. Офис
 * (уровень всей организации) в список не входит.
 */
export async function getBadgePoints(org: { id: string; perLocationJournals: boolean }): Promise<BadgePoint[]> {
  if (!org.perLocationJournals) return [];
  const buildings = await db.building.findMany({
    where: { organizationId: org.id, kind: { not: "office" } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, address: true },
  });
  return buildings.length >= 2 ? buildings : [];
}

export function invalidateBadgeToday(organizationId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${organizationId}:`)) cache.delete(key);
  }
}
