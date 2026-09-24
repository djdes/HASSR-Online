import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildingTargets } from "@/lib/active-building";
import { buildingWhere } from "@/lib/building-scope";
import { closeEventBuildingKey } from "@/lib/journal-close-events";
import { checkCronSecret } from "@/lib/cron-auth";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { closeJournalForDay, utcDayStart } from "@/lib/journal-close-events";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/auto-close-shifts?secret=$CRON_SECRET
 *
 * Запускается ежечасно. Для каждой organization берёт shiftEndHour
 * (по умолчанию 0 = полночь) и проверяет: если сейчас «после конца
 * вчерашней смены», то для каждого shared-template без записей и
 * без явного closeEvent создаём auto-closed-empty closure.
 *
 * Это означает: журнал считается выполненным (compliance ✅), но в
 * weekly-digest менеджер увидит «5 журналов auto-closed-empty» — флаг
 * халатности (никто не нажал ни «добавить запись», ни «не требуется»).
 *
 * Идемпотентно: если closure уже существует на (template, date, org) —
 * skip.
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const now = new Date();
  const currentHourUtc = now.getUTCHours();

  // Только организации, у которых сейчас наступил час shiftEndHour.
  // Это позволяет ночным сменам ставить shiftEndHour=6 (закрытие в
  // 06:00 утра), и cron срабатывает на них только в 06 UTC.
  const orgs = await db.organization.findMany({
    where: { shiftEndHour: currentHourUtc, ...NOT_DIRECTORY_ORG_WHERE },
    select: { id: true, shiftEndHour: true },
  });

  if (orgs.length === 0) {
    return NextResponse.json({
      ok: true,
      currentHourUtc,
      orgsToProcess: 0,
      report: null,
    });
  }

  // Для shiftEndHour=0 (полночь) закрываем СЕГОДНЯ-1 = вчера.
  // Для shiftEndHour=6 (утро) тоже закрываем «прошедшую» смену = вчера.
  // Логика: сейчас наступил час окончания смены → закрываем
  // предыдущий «суточный период».
  const targetDate = utcDayStart(now);
  targetDate.setUTCDate(targetDate.getUTCDate() - 1);

  // Получаем все shared-шаблоны (которые могут требовать closure).
  const sharedTemplates = await db.journalTemplate.findMany({
    where: { taskScope: "shared", isActive: true },
    select: { id: true, code: true },
  });
  const sharedTemplateIds = sharedTemplates.map((t) => t.id);

  let totalClosed = 0;
  let totalSkipped = 0;
  const perOrgReports: Array<{
    orgId: string;
    closed: number;
    skipped: number;
  }> = [];

  for (const org of orgs) {
    let closed = 0;
    let skipped = 0;
    // Точки: день закрывается на каждой точке отдельно (или один раз для
    // организации без точек).
    const targets = await buildingTargets(org.id);

    for (const tplId of sharedTemplateIds) for (const buildingId of targets) {
      // Skip if уже есть closure (включая reopened — мы НЕ авто-закрываем
      // переоткрытые, юзер уже принял решение).
      const existing = await db.journalCloseEvent.findFirst({
        where: {
          organizationId: org.id,
          templateId: tplId,
          date: targetDate,
          buildingKey: closeEventBuildingKey(buildingId),
        },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      // Skip если за target-day были записи в этом template (значит
      // смена была активна, просто никто не нажал «завершить смену»).
      // В этом случае мы НЕ создаём auto-closed-empty — потому что
      // записи есть. Compliance считается через entries в today-compliance.
      const targetEnd = new Date(targetDate);
      targetEnd.setUTCDate(targetEnd.getUTCDate() + 1);

      const [docEntryCount, legacyEntryCount] = await Promise.all([
        db.journalDocumentEntry.count({
          where: {
            document: { organizationId: org.id, templateId: tplId, ...buildingWhere(buildingId) },
            date: { gte: targetDate, lt: targetEnd },
            ...NOT_AUTO_SEEDED,
          },
        }),
        db.journalEntry.count({
          where: {
            organizationId: org.id,
            templateId: tplId,
            createdAt: { gte: targetDate, lt: targetEnd },
          },
        }),
      ]);
      if (docEntryCount + legacyEntryCount > 0) {
        skipped += 1;
        continue;
      }

      // Найти activeDocument для writing closure (опционально —
      // closure может быть и без journalDocumentId).
      const activeDoc = await db.journalDocument.findFirst({
        where: {
          organizationId: org.id,
          templateId: tplId,
          status: "active",
          dateFrom: { lte: targetDate },
          dateTo: { gte: targetDate },
          ...buildingWhere(buildingId),
        },
        select: { id: true },
      });

      const result = await closeJournalForDay({
        organizationId: org.id,
        templateId: tplId,
        journalDocumentId: activeDoc?.id ?? null,
        buildingId,
        date: targetDate,
        kind: "auto-closed-empty",
        reason: null,
        closedByUserId: null,
      });
      if (result.ok) {
        closed += 1;
      } else {
        skipped += 1;
      }
    }

    perOrgReports.push({ orgId: org.id, closed, skipped });
    totalClosed += closed;
    totalSkipped += skipped;
  }

  return NextResponse.json({
    ok: true,
    currentHourUtc,
    targetDate: targetDate.toISOString(),
    orgsProcessed: orgs.length,
    sharedTemplatesChecked: sharedTemplateIds.length,
    totalClosed,
    totalSkipped,
    perOrgReports: perOrgReports.slice(0, 20), // первые 20 для отчёта
  });
}

export const GET = handle;
export const POST = handle;
