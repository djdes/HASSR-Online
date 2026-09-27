import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { loadBuildingContext } from "@/lib/active-building";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { sortJournalsByName } from "@/lib/journal-sort";
import { scheduleObligationSync, utcDayKey } from "@/lib/obligation-sync-throttle";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";
import {
  getManagerObligationSummary,
  listOpenJournalObligationsForUser,
  syncDailyJournalObligationsForOrganization,
  syncDailyJournalObligationsForUser,
} from "@/lib/journal-obligations";
import {
  aclActorFromSession,
  getAllowedJournalCodes,
} from "@/lib/journal-acl";
import { getUserPermissions } from "@/lib/permissions-server";
import { isManagerLikePermissions } from "@/lib/permissions";
import { getServerSession } from "@/lib/server-session";
import { getManagerScope, getAssignableJournalCodes } from "@/lib/manager-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const requestNow = new Date();

  const actor = aclActorFromSession({
    user: {
      id: session.user.id,
      role: session.user.role,
      isRoot: session.user.isRoot === true,
    },
  });
  const [allowedCodes, disabledCodes, perms, areas, scope, buildingContext] = await Promise.all([
    getAllowedJournalCodes(actor),
    getDisabledJournalCodes(getActiveOrgId(session)),
    getUserPermissions(session.user.id),
    db.area.findMany({
      where: { organizationId: getActiveOrgId(session), lat: { not: null }, lng: { not: null } },
      select: { id: true, name: true, lat: true, lng: true },
    }),
    getManagerScope(session.user.id, getActiveOrgId(session)),
    loadBuildingContext(session),
  ]);
  const fullAccess = hasFullWorkspaceAccess({
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  });

  const assignableCodes = getAssignableJournalCodes(scope, allowedCodes);

  // Признак руководителя — общий с ботом и /api/mini/session
  // (`isManagerLikePermissions`). Здесь раньше стояла своя копия через
  // `dashboard.view`, и она отдавала экран руководителя линейному
  // персоналу: это право есть у всех по умолчанию.
  const isManagerLike =
    session.user.isRoot === true ||
    isManagerLikePermissions(perms, session.user.role);
  const canFillJournals =
    session.user.isRoot === true || perms.has("journals.fill");

  const rawTemplates = await db.journalTemplate.findMany({
    where:
      assignableCodes === null
        ? { isActive: true }
        : { isActive: true, code: { in: assignableCodes } },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
    },
    orderBy: { name: "asc" },
  });

  // Журналы по алфавиту — тем же правилом, что на сайте (П-3).
  const templates = sortJournalsByName(
    rawTemplates.filter((template) => !disabledCodes.has(template.code)),
    (template) => template.name
  );
  const user = {
    name: session.user.name ?? "",
    organizationName: session.user.organizationName ?? "",
    // Активная организация — для переключателя в профиле Mini App:
    // человек должен видеть, в какой точке он сейчас работает.
    organizationId: getActiveOrgId(session),
  };

  // Expose resolved permissions so the client can gate UI without
  // re-implementing the resolve chain.
  const permissionList = Array.from(perms);
  // Точки: чип на главной и переключатель в профиле Mini App (П-3 —
  // зеркало пилюли в шапке сайта).
  const location = {
    enabled: buildingContext.enabled,
    buildings: buildingContext.buildings,
    activeBuildingId: buildingContext.activeBuildingId,
    activeBuilding: buildingContext.activeBuilding,
    canSwitch: buildingContext.canSwitch,
  };

  if (isManagerLike) {
    // Сверка всей организации тяжёлая: ждём её только пока за сегодня нет
    // ни одной строки, дальше — в фоне, не чаще раза в минуту.
    try {
      const orgHasRowsToday =
        (await db.journalObligation.count({
          where: { organizationId: getActiveOrgId(session), dateKey: utcDayKey(requestNow) },
        })) > 0;
      await scheduleObligationSync(
        `org:${getActiveOrgId(session)}`,
        () => syncDailyJournalObligationsForOrganization(getActiveOrgId(session), requestNow),
        { force: !orgHasRowsToday },
      );
    } catch (syncErr) {
      console.error("[mini:home] org sync failed:", syncErr);
    }
    const summary = await getManagerObligationSummary(
      getActiveOrgId(session),
      requestNow,
      undefined,
      buildingContext.activeBuildingId
    );

    return NextResponse.json({
      user,
      mode: "manager",
      permissions: permissionList,
      location,
      summary,
      areas,
      all: templates.map((template) => ({
        code: template.code,
        name: template.name,
        description: template.description,
        filled: false,
      })),
    });
  }

  if (!canFillJournals) {
    // Read-only mode: no obligations, just viewable journals.
    return NextResponse.json({
      user,
      mode: "readonly",
      permissions: permissionList,
      location,
      areas,
      all: templates.map((template) => ({
        code: template.code,
        name: template.name,
        description: template.description,
        filled: false,
      })),
    });
  }

  try {
    const userHasRowsToday =
      (await db.journalObligation.count({
        where: { userId: session.user.id, dateKey: utcDayKey(requestNow) },
      })) > 0;
    await scheduleObligationSync(
      `user:${session.user.id}`,
      () =>
        syncDailyJournalObligationsForUser({
          userId: session.user.id,
          organizationId: getActiveOrgId(session),
          now: requestNow,
        }),
      { force: !userHasRowsToday },
    );
  } catch (syncErr) {
    console.error("[mini:home] user sync failed:", syncErr);
  }
  const now = await listOpenJournalObligationsForUser(
    session.user.id,
    requestNow
  );
  const openJournalCodes = new Set(now.map((row) => row.journalCode));

  // Phase 3 (шаг 3.4): подтягиваем bonusAmountKopecks + claim-state по
  // тем же obligation-ам отдельным запросом, чтобы не ломать сигнатуру
  // общего helper-а `listOpenJournalObligationsForUser`. UI решает
  // показывать ли «Взять с бонусом» или «уже взял Иван в 12:34».
  const obligationIds = now.map((row) => row.id);
  const bonusRows = obligationIds.length
    ? await db.journalObligation.findMany({
        where: { id: { in: obligationIds } },
        select: {
          id: true,
          claimedById: true,
          claimedAt: true,
          template: { select: { bonusAmountKopecks: true } },
        },
      })
    : [];
  const claimerIds = Array.from(
    new Set(
      bonusRows
        .map((row) => row.claimedById)
        .filter((id): id is string => typeof id === "string")
    )
  );
  const claimers = claimerIds.length
    ? await db.user.findMany({
        where: { id: { in: claimerIds } },
        select: { id: true, name: true },
      })
    : [];
  const claimerNameById = new Map(
    claimers.map((user) => [user.id, user.name ?? ""])
  );
  const bonusByObligationId = new Map(
    bonusRows.map((row) => [row.id, row])
  );

  return NextResponse.json({
    user,
    mode: "staff",
    permissions: permissionList,
    location,
    areas,
    now: now.map((row) => {
      const bonus = bonusByObligationId.get(row.id);
      const bonusAmountKopecks =
        bonus?.template.bonusAmountKopecks ?? 0;
      const claimedById = bonus?.claimedById ?? null;
      const claimedByName =
        claimedById !== null
          ? claimerNameById.get(claimedById) ?? null
          : null;
      const claimedAt = bonus?.claimedAt
        ? bonus.claimedAt.toISOString()
        : null;
      return {
        id: row.id,
        code: row.journalCode,
        name: row.template.name,
        description: row.template.description,
        href: `/mini/o/${row.id}`,
        buildingName: row.buildingName ?? null,
        bonusAmountKopecks,
        claimedById,
        claimedByName,
        claimedAt,
      };
    }),
    all: templates.map((template) => ({
      code: template.code,
      name: template.name,
      description: template.description,
      filled: !openJournalCodes.has(template.code),
    })),
  });
}
