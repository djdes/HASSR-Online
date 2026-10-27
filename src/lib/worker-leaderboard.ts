import { db } from "@/lib/db";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";

/**
 * Топ-3 (или N) активных сотрудников за последние 30 дней по числу
 * заполненных записей в журналах + сумма бонусов. Простая
 * геймификация — повар видит «Сидоров заполнил 234 записи и взял
 * 1500 ₽» → хочет тоже попасть в топ.
 *
 * Считаем JournalDocumentEntry (большинство daily-журналов) +
 * JournalEntry (legacy field-based) за месяц по `createdAt`. Сумма
 * бонусов — из `BonusEntry.amountKopecks` со status="approved".
 */

/**
 * Руководитель точки (фаза 2 «Офис и точки») видит в рейтинге только людей
 * своих точек: остальных убираем до сортировки. Без точек — все.
 */
async function dropOutsidePoints(
  organizationId: string,
  byUser: Map<string, unknown>,
  pointScope: readonly string[] | null | undefined,
): Promise<void> {
  if (!pointScope || pointScope.length === 0) return;
  const inScope = await db.user.findMany({
    where: { organizationId, id: { in: [...byUser.keys()] }, buildingIds: { hasSome: [...pointScope] } },
    select: { id: true },
  });
  const keep = new Set(inScope.map((user) => user.id));
  for (const id of [...byUser.keys()]) if (!keep.has(id)) byUser.delete(id);
}

export type LeaderboardEntry = {
  userId: string;
  userName: string;
  positionTitle: string | null;
  entryCount: number;
  bonusKopecks: number;
};

export async function getWorkerLeaderboard(
  organizationId: string,
  limit = 3,
  daysWindow = 30,
  pointScope?: readonly string[] | null
): Promise<LeaderboardEntry[]> {
  const since = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000);

  const [docEntries, legacyEntries, bonuses] = await Promise.all([
    db.journalDocumentEntry.groupBy({
      by: ["employeeId"],
      where: {
        document: { organizationId },
        createdAt: { gte: since },
        ...NOT_AUTO_SEEDED,
      },
      _count: { _all: true },
    }),
    db.journalEntry.groupBy({
      by: ["filledById"],
      where: {
        organizationId,
        createdAt: { gte: since },
      },
      _count: { _all: true },
    }),
    db.bonusEntry.groupBy({
      by: ["userId"],
      where: {
        organizationId,
        status: "approved",
        createdAt: { gte: since },
      },
      _sum: { amountKopecks: true },
    }),
  ]);

  // Aggregate by userId
  const byUser = new Map<
    string,
    { entries: number; bonus: number }
  >();
  for (const e of docEntries) {
    const u = byUser.get(e.employeeId) ?? { entries: 0, bonus: 0 };
    u.entries += e._count._all;
    byUser.set(e.employeeId, u);
  }
  for (const e of legacyEntries) {
    if (!e.filledById) continue;
    const u = byUser.get(e.filledById) ?? { entries: 0, bonus: 0 };
    u.entries += e._count._all;
    byUser.set(e.filledById, u);
  }
  for (const b of bonuses) {
    const u = byUser.get(b.userId) ?? { entries: 0, bonus: 0 };
    u.bonus += b._sum.amountKopecks ?? 0;
    byUser.set(b.userId, u);
  }

  await dropOutsidePoints(organizationId, byUser, pointScope);
  if (byUser.size === 0) return [];

  // Sort by (entries DESC, then bonus DESC), take top N.
  const sorted = [...byUser.entries()]
    .map(([userId, v]) => ({ userId, entries: v.entries, bonus: v.bonus }))
    .sort((a, b) => b.entries - a.entries || b.bonus - a.bonus)
    .slice(0, limit);

  // Hydrate user names + positions.
  const userIds = sorted.map((s) => s.userId);
  const users = await db.user.findMany({
    where: { id: { in: userIds }, isActive: true },
    select: { id: true, name: true, positionTitle: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  return sorted.flatMap<LeaderboardEntry>((s) => {
    const u = userById.get(s.userId);
    if (!u) return [];
    return [
      {
        userId: u.id,
        userName: u.name,
        positionTitle: u.positionTitle,
        entryCount: s.entries,
        bonusKopecks: s.bonus,
      },
    ];
  });
}

/**
 * Аутсайдеры: активные сотрудники с наименьшим числом записей за
 * период. Используется на /dashboard как «кому помочь сегодня» —
 * менеджер видит кого надо подтянуть, прежде чем compliance упадёт
 * заметно.
 *
 * Фильтр `minEntries` исключает совсем неактивных (новенькие /
 * бухгалтер / технолог): по умолчанию показываем только тех у кого
 * есть хотя бы 1 запись (значит они — рядовые сотрудники, не support
 * staff). Менеджер не получает шум вида «бухгалтер не заполнил
 * холодильники, ему помочь».
 */
export async function getStrugglingWorkers(
  organizationId: string,
  limit = 3,
  daysWindow = 30,
  minEntries = 1,
  pointScope?: readonly string[] | null
): Promise<LeaderboardEntry[]> {
  const since = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000);

  const [docEntries, legacyEntries, bonuses] = await Promise.all([
    db.journalDocumentEntry.groupBy({
      by: ["employeeId"],
      where: {
        document: { organizationId },
        createdAt: { gte: since },
        ...NOT_AUTO_SEEDED,
      },
      _count: { _all: true },
    }),
    db.journalEntry.groupBy({
      by: ["filledById"],
      where: {
        organizationId,
        createdAt: { gte: since },
      },
      _count: { _all: true },
    }),
    db.bonusEntry.groupBy({
      by: ["userId"],
      where: {
        organizationId,
        status: "approved",
        createdAt: { gte: since },
      },
      _sum: { amountKopecks: true },
    }),
  ]);

  const byUser = new Map<string, { entries: number; bonus: number }>();
  for (const e of docEntries) {
    const u = byUser.get(e.employeeId) ?? { entries: 0, bonus: 0 };
    u.entries += e._count._all;
    byUser.set(e.employeeId, u);
  }
  for (const e of legacyEntries) {
    if (!e.filledById) continue;
    const u = byUser.get(e.filledById) ?? { entries: 0, bonus: 0 };
    u.entries += e._count._all;
    byUser.set(e.filledById, u);
  }
  for (const b of bonuses) {
    const u = byUser.get(b.userId) ?? { entries: 0, bonus: 0 };
    u.bonus += b._sum.amountKopecks ?? 0;
    byUser.set(b.userId, u);
  }

  await dropOutsidePoints(organizationId, byUser, pointScope);
  if (byUser.size === 0) return [];

  // ASC по entries — внизу самые слабые.
  const sorted = [...byUser.entries()]
    .map(([userId, v]) => ({ userId, entries: v.entries, bonus: v.bonus }))
    .filter((s) => s.entries >= minEntries)
    .sort((a, b) => a.entries - b.entries || a.bonus - b.bonus)
    .slice(0, limit);

  const userIds = sorted.map((s) => s.userId);
  const users = await db.user.findMany({
    where: { id: { in: userIds }, isActive: true, archivedAt: null },
    select: { id: true, name: true, positionTitle: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  return sorted.flatMap<LeaderboardEntry>((s) => {
    const u = userById.get(s.userId);
    if (!u) return [];
    return [
      {
        userId: u.id,
        userName: u.name,
        positionTitle: u.positionTitle,
        entryCount: s.entries,
        bonusKopecks: s.bonus,
      },
    ];
  });
}
