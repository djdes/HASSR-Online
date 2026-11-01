import { collectCalendarEvents } from "@/lib/calendar/events";
import { db } from "@/lib/db";
import { getDisabledJournalCodes, parseDisabledCodes } from "@/lib/disabled-journals";
import { buildingWhere } from "@/lib/building-scope";
import { filterRecipientsByPlace } from "@/lib/place-recipients";
import { deliverableEmail } from "@/lib/core-journal-keepers";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { getTemplatesFilledToday } from "@/lib/today-compliance";
import { getDbRoleValuesWithLegacy, MANAGEMENT_ROLES } from "@/lib/user-roles";
import type { WeeklyDigestData } from "@/lib/weekly-digest/render";

export const DAYS_IN_DIGEST = 7;
const EXPIRING_DAYS = 14;
const STAFF_TEMPLATE_CODES = ["hygiene", "health_check"];

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Неделя, закончившаяся сегодня: [сегодня − 7, сегодня). */
export function digestWeek(now: Date): { weekStart: Date; weekEnd: Date } {
  const weekEnd = utcDayStart(now);
  const weekStart = new Date(weekEnd);
  weekStart.setUTCDate(weekStart.getUTCDate() - DAYS_IN_DIGEST);
  return { weekStart, weekEnd };
}

/**
 * Все цифры недельной сводки для одной организации. null — организации нет;
 * `totalSlots === 0` — журналов нет, слать нечего.
 *
 * `buildingId` — сводка одной точки (фаза 3 «Офис и точки»): её набор
 * журналов, документы, люди, отклонения и задачи; сроки (календарь) — дело
 * офиса, в сводку точки не идут.
 */
export async function buildWeeklyDigestData(
  organizationId: string,
  now: Date,
  buildingId: string | null = null,
): Promise<WeeklyDigestData | null> {
  const { weekStart, weekEnd } = digestWeek(now);
  const [templates, org, point] = await Promise.all([
    db.journalTemplate.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true, disabledJournalCodes: true } }),
    buildingId
      ? db.building.findFirst({ where: { id: buildingId, organizationId }, select: { name: true } })
      : Promise.resolve(null),
  ]);
  if (!org || (buildingId && !point)) return null;

  const disabledCodes = buildingId
    ? await getDisabledJournalCodes(organizationId, buildingId)
    : parseDisabledCodes(org.disabledJournalCodes);
  // Документы и оборудование точки — для задач и отклонений.
  const [pointDocIds, pointEquipmentIds] = buildingId
    ? await Promise.all([
        db.journalDocument
          .findMany({ where: { organizationId, buildingId }, select: { id: true } })
          .then((rows) => rows.map((row) => row.id)),
        db.equipment
          .findMany({ where: { area: { organizationId, buildingId } }, select: { id: true } })
          .then((rows) => rows.map((row) => row.id)),
      ])
    : [null, null];
  const docScope = buildingWhere(buildingId);
  const incidentScope = buildingId
    ? { OR: [{ equipmentId: { in: pointEquipmentIds ?? [] } }, { documentId: { in: pointDocIds ?? [] } }] }
    : {};
  const visibleTemplates = templates.filter((t) => !disabledCodes.has(t.code));

  const dailyResults: Array<{ day: Date; filledIds: Set<string> }> = [];
  for (let i = 0; i < DAYS_IN_DIGEST; i += 1) {
    const day = new Date(weekStart);
    day.setUTCDate(day.getUTCDate() + i);
    if (day >= weekEnd) break;
    const filled = await getTemplatesFilledToday(
      organizationId,
      day,
      visibleTemplates.map((t) => ({ id: t.id, code: t.code })),
      disabledCodes,
      { treatAperiodicAsFilled: false, buildingId }
    );
    dailyResults.push({ day, filledIds: filled });
  }
  const totalSlots = dailyResults.length * visibleTemplates.length;
  const filledSlots = dailyResults.reduce((sum, r) => sum + r.filledIds.size, 0);
  const compliancePct = totalSlots ? Math.round((filledSlots / totalSlots) * 100) : 0;

  const missedByTemplate = new Map<string, number>();
  for (const tpl of visibleTemplates) {
    let missed = 0;
    for (const r of dailyResults) if (!r.filledIds.has(tpl.id)) missed += 1;
    if (missed > 0) missedByTemplate.set(tpl.id, missed);
  }
  const bottomTemplates = [...missedByTemplate.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, count]) => ({ name: visibleTemplates.find((t) => t.id === id)?.name ?? "—", missed: count }));

  const [entries, tfLinks, incidents, openIncidents, staff, staffEntries, calendar] = await Promise.all([
    db.journalDocumentEntry.findMany({
      where: { document: { organizationId, ...docScope }, date: { gte: weekStart, lt: weekEnd }, ...NOT_AUTO_SEEDED },
      select: { employeeId: true },
      take: 5000,
    }),
    db.tasksFlowTaskLink.findMany({
      where: {
        integration: { organizationId, enabled: true },
        ...(pointDocIds ? { journalDocumentId: { in: pointDocIds } } : {}),
        OR: [{ completedAt: { gte: weekStart, lt: weekEnd } }, { remoteStatus: "active" }],
      },
      select: { remoteStatus: true, completedAt: true },
    }),
    db.temperatureDeviationIncident.count({ where: { organizationId, createdAt: { gte: weekStart, lt: weekEnd }, ...incidentScope } }),
    db.temperatureDeviationIncident.count({ where: { organizationId, createdAt: { gte: weekStart, lt: weekEnd }, resolvedAt: null, ...incidentScope } }),
    db.user.findMany({
      where: {
        organizationId,
        isActive: true,
        role: { notIn: getDbRoleValuesWithLegacy(MANAGEMENT_ROLES) },
        ...(buildingId ? { buildingIds: { has: buildingId } } : {}),
      },
      select: { id: true, name: true },
    }),
    db.journalDocumentEntry.findMany({
      where: {
        document: { organizationId, ...docScope, template: { code: { in: STAFF_TEMPLATE_CODES } } },
        date: { gte: weekStart, lt: weekEnd },
        ...NOT_AUTO_SEEDED,
      },
      select: { employeeId: true },
      distinct: ["employeeId"],
    }),
    buildingId ? Promise.resolve([]) : collectCalendarEvents(organizationId, now).catch(() => []),
  ]);

  const byEmployee = new Map<string, number>();
  for (const e of entries) byEmployee.set(e.employeeId, (byEmployee.get(e.employeeId) ?? 0) + 1);
  const topPair = [...byEmployee.entries()].sort((a, b) => b[1] - a[1])[0];
  let topEmployeeName: string | null = null;
  let topEmployeeCount = 0;
  if (topPair) {
    const emp = await db.user.findUnique({ where: { id: topPair[0] }, select: { name: true } });
    topEmployeeName = emp?.name ?? null;
    topEmployeeCount = topPair[1];
  }

  const tfDone = tfLinks.filter((l) => l.remoteStatus === "completed" && l.completedAt && l.completedAt >= weekStart && l.completedAt < weekEnd).length;
  const tfStuck = tfLinks.filter((l) => l.remoteStatus === "active").length;

  // «Не отмечался» имеет смысл, только если журналы здоровья вообще ведутся:
  // иначе список — это просто все сотрудники.
  const marked = new Set(staffEntries.map((e) => e.employeeId));
  const absentEmployees = marked.size > 0 ? staff.filter((u) => !marked.has(u.id)).map((u) => u.name).slice(0, 12) : [];

  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + EXPIRING_DAYS * 86_400_000).toISOString().slice(0, 10);
  const expiring = calendar
    .filter((e) => e.date >= today && e.date <= horizon)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 12)
    .map((e) => ({ date: e.date, title: e.title }));

  return {
    orgName: point ? `${org.name} · ${point.name}` : org.name,
    weekStart: weekStart.toISOString().slice(0, 10),
    weekEnd: weekEnd.toISOString().slice(0, 10),
    compliancePct,
    filledSlots,
    totalSlots,
    bottomTemplates,
    topEmployeeName,
    topEmployeeCount,
    tfDone,
    tfStuck,
    incidents: { total: incidents, open: openIncidents },
    absentEmployees,
    expiring,
  };
}

/**
 * Руководители, которым уходит письмо: активные, с настоящей почтой и не
 * выключившие отчёт. Сводка компании — офису, сводка точки (`buildingId`)
 * — людям точки (фаза 3 «Офис и точки», `filterRecipientsByPlace`).
 */
export async function weeklyDigestRecipients(organizationId: string, buildingId: string | null = null): Promise<string[]> {
  const managers = await db.user.findMany({
    where: { organizationId, isActive: true, role: { in: getDbRoleValuesWithLegacy(MANAGEMENT_ROLES) } },
    select: { email: true, contactEmail: true, notificationPrefs: true, buildingIds: true },
  });
  // Только люди самого места: сводка точки — её руководителям, сводка
  // компании — тем, кто работает на всю компанию (и без офиса, 2026-11-01).
  const users = await filterRecipientsByPlace(organizationId, managers, buildingId, true);
  const out: string[] = [];
  for (const u of users) {
    // Служебная почта сотрудника без входа (`…@<org>.local.haccp`) — не адрес;
    // личная почта из карточки — адрес.
    const email = deliverableEmail(u);
    if (!email) continue;
    const prefs = (u.notificationPrefs ?? {}) as { weeklyDigest?: boolean };
    if (prefs.weeklyDigest === false) continue;
    out.push(email);
  }
  return Array.from(new Set(out));
}
