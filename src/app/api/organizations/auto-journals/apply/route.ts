import { getJournalControls, rejectJournalAutomation } from "@/lib/journal-controls.server";
import { automationOn } from "@/lib/journal-controls";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { buildingTargets } from "@/lib/building-targets";
import {
  loadBuildingJournalSettings,
  readBuildingJournalSettings,
  withBuildingJournalSettings,
  worksAtBuilding,
} from "@/lib/building-settings";
import { journalSettingsWriteTarget } from "@/lib/journal-settings-target";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getJournalAutomation } from "@/lib/journal-automation";
import { getAutofillCapability } from "@/lib/journal-autofill-capability";
import { applyJournalAutoFill } from "@/lib/journal-autofill";
import { resolveAutomationStaff } from "@/lib/journal-automation-staff";
import { ensureActiveDocument } from "@/lib/journal-auto-create";
import { buildDateKeys, toDateKey } from "@/lib/hygiene-document";
import { resolveDayStart } from "@/lib/today-compliance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/organizations/auto-journals/apply
 * Body: { code: string }
 *
 * Догоняет уже начатый период сразу после включения автозаполнения:
 * заполняет пустые ячейки с начала периода по сегодня. Без него человек
 * включал тумблер и не видел НИЧЕГО до следующей ночи — фича выглядела
 * сломанной.
 *
 * Почему отдельный POST, а не часть PUT настроек: букфилл ходит по всем
 * дням периода и может занять секунды, а сохранение настройки обязано
 * отвечать мгновенно.
 *
 * Идемпотентно: движок пишет только в пустые строки и ячейки, повторный
 * вызов возвращает нули.
 */
const bodySchema = z.object({ code: z.string().min(1) });

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot,
    })
  ) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const code = parsed.code;
  const capability = getAutofillCapability(code);
  if (!capability) {
    return NextResponse.json(
      { error: "Для этого журнала автозаполнение недоступно" },
      { status: 400 }
    );
  }

  const organizationId = getActiveOrgId(session);
  const blocked = await rejectJournalAutomation(organizationId, "autoFill");
  if (blocked) return blocked;
  // Точка из шапки — её автоматика и её документы; «Вся организация» —
  // документы всех точек. Руководитель точки — только свою точку.
  const target = await journalSettingsWriteTarget(session);
  if (!target.ok) return target.response;
  const pointId = target.pointId;
  const orgRow = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      timezone: true,
      journalAutomationJson: true,
      autoJournalCodes: true,
    },
  });
  const org = withBuildingJournalSettings(orgRow, await readBuildingJournalSettings(db, pointId));
  const automation = getJournalAutomation(org, code);
  if (!automation.autoFill) {
    return NextResponse.json(
      { error: "Автозаполнение для этого журнала выключено" },
      { status: 400 }
    );
  }

  // Автосоздание включено, а документа на сегодня нет — заводим его
  // прямо сейчас: иначе заполнять было бы нечего и человек снова
  // остался бы без результата. Только если автосоздание включено и в
  // спецрежиме.
  if (automation.autoCreate && automationOn(await getJournalControls(organizationId), "autoCreate")) {
    // «Вся организация» — документ каждой точке, где автоматика журнала
    // включена (у точки со своей автоматикой — по её настройкам).
    const targets = pointId ? [pointId] : await buildingTargets(organizationId);
    const ownByBuilding = pointId ? null : await loadBuildingJournalSettings(db, organizationId);
    for (const buildingId of targets) {
      const effective =
        ownByBuilding && buildingId
          ? getJournalAutomation(withBuildingJournalSettings(orgRow, ownByBuilding.get(buildingId)), code)
          : automation;
      if (!effective.autoCreate || !effective.autoFill) continue;
      await ensureActiveDocument(db, {
        organizationId,
        templateCode: code,
        autoFill: true,
        buildingId,
      }).catch((error) => {
        console.warn(`[auto-journals/apply] ensureActiveDocument ${code}`, error);
        return null;
      });
    }
  }

  const now = new Date();
  const todayStart = resolveDayStart(org?.timezone ?? null, now);
  const todayKey = toDateKey(todayStart);

  const documents = await db.journalDocument.findMany({
    where: {
      organizationId,
      ...(pointId ? { buildingId: pointId } : {}),
      status: "active",
      autoFill: true,
      template: { code },
      dateFrom: { lte: todayStart },
      dateTo: { gte: todayStart },
    },
    select: {
      id: true,
      buildingId: true,
      config: true,
      responsibleUserId: true,
      responsibleTitle: true,
      dateFrom: true,
      dateTo: true,
    },
  });
  if (documents.length === 0) {
    return NextResponse.json({
      documents: 0,
      created: 0,
      updated: 0,
      skipped: 0,
    });
  }

  const allUsers = await db.user.findMany({
    where: { organizationId, isActive: true, archivedAt: null },
    select: { id: true, name: true, role: true, buildingIds: true },
    orderBy: [{ role: "asc" }, { id: "asc" }],
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const document of documents) {
    // Букфилл идёт с начала периода по сегодня: будущие дни журнала
    // заполнять нельзя — это записи о непроведённом контроле.
    const dateKeys = buildDateKeys(document.dateFrom, document.dateTo).filter(
      (dateKey) => dateKey <= todayKey
    );
    if (dateKeys.length === 0) continue;
    // Состав строк кадрового журнала: политика, если задана, иначе весь
    // активный ростер точки документа — то же правило, что и у ночного крона.
    const users = allUsers.filter((user) => worksAtBuilding(user, document.buildingId));
    let employeeIds = users.map((user) => user.id);
    if (capability === "staff" && automation.staff) {
      const resolved = await resolveAutomationStaff(db, {
        organizationId,
        templateCode: code,
        staffPolicy: automation.staff,
        buildingId: document.buildingId,
      });
      if (resolved.employeeIds.length > 0) employeeIds = resolved.employeeIds;
    }
    const result = await applyJournalAutoFill(db, {
      // Пишем журнал отката: выключение тумблера сможет вернуть как было.
      recordUndo: true,
      document: {
        id: document.id,
        organizationId,
        templateCode: code,
        config: document.config,
        responsibleUserId: document.responsibleUserId,
        responsibleTitle: document.responsibleTitle,
        dateFrom: document.dateFrom,
        dateTo: document.dateTo,
      },
      dateKeys,
      employeeIds,
      users,
    });
    created += result.created;
    updated += result.updated;
    skipped += result.skipped;
  }

  return NextResponse.json({
    documents: documents.length,
    created,
    updated,
    skipped,
  });
}
