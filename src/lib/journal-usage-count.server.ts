import { db } from "@/lib/db";

/**
 * Сколько организаций ведут журнал в WeSetup (есть документ журнала, без
 * демо и платформы) — строка «Этот журнал ведут N организаций» на странице
 * журнала (спека journal-page-engagement-2026-11). Кеш — час на журнал.
 */

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; count: number }>();

export async function journalUsageCount(code: string): Promise<number> {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.count;
  const rows = await db.journalDocument.groupBy({
    by: ["organizationId"],
    where: {
      template: { code },
      organization: { isDemo: false, id: { not: process.env.PLATFORM_ORG_ID || "platform" } },
    },
  });
  const count = rows.length;
  if (cache.size > 200) cache.clear();
  cache.set(code, { at: Date.now(), count });
  return count;
}
