import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { listPersonBuildings, loadBuildingContext } from "@/lib/active-building";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { buildingInScope, isPointScoped } from "@/lib/point-scope";
import { checkJournalLimit, limitResponse } from "@/lib/billing.server";
import { disabledAfter, planPointJournalToggle } from "@/lib/point-journals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/journals/points — добавить или убрать журнал одной точке
 * («Журналы точек», `/journals/points`).
 *
 * Body: { buildingId: string | null, code: string, enabled: boolean }.
 * С делением журналов по точкам `buildingId` обязателен и меняется набор
 * только этой точки (`planPointJournalToggle`); без деления — `null` и набор
 * всей организации (как «Настройка журналов»). Права — как у страницы
 * (`admin.full`); руководитель точки — только свои точки. Бесплатный тариф —
 * тот же лимит журналов, что в «Настройке журналов».
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as
    | { buildingId?: unknown; code?: unknown; enabled?: unknown }
    | null;
  const code = typeof body?.code === "string" ? body.code : "";
  const buildingId = typeof body?.buildingId === "string" && body.buildingId ? body.buildingId : null;
  if (!code || typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "Нужны code и enabled" }, { status: 400 });
  }
  const enabled = body.enabled;
  const organizationId = getActiveOrgId(session);

  const [template, context, personBuildings] = await Promise.all([
    db.journalTemplate.findFirst({ where: { code, isActive: true }, select: { id: true } }),
    loadBuildingContext(session),
    listPersonBuildings(session),
  ]);
  if (!template) return NextResponse.json({ error: "Журнал не найден" }, { status: 404 });
  if (context.enabled) {
    if (!buildingId || !personBuildings.some((building) => building.id === buildingId)) {
      return NextResponse.json({ error: "Выберите точку" }, { status: 400 });
    }
    if (!buildingInScope(session.user, buildingId)) {
      return NextResponse.json({ error: "Это не ваша точка — её ведёт офис" }, { status: 403 });
    }
  } else {
    if (buildingId) return NextResponse.json({ error: "Журналы не делятся по точкам" }, { status: 400 });
    if (isPointScoped(session.user)) {
      return NextResponse.json({ error: "Это общие настройки компании — их меняет офис" }, { status: 403 });
    }
  }

  const [organization, buildings] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { disabledJournalCodes: true } }),
    db.building.findMany({ where: { organizationId }, select: { id: true, disabledJournalCodes: true } }),
  ]);
  const sets = {
    orgDisabled: [...parseDisabledCodes(organization?.disabledJournalCodes)],
    buildings: buildings.map((building) => ({
      id: building.id,
      disabled: building.disabledJournalCodes === null ? null : [...parseDisabledCodes(building.disabledJournalCodes)],
    })),
  };
  const target = context.enabled ? buildingId : null;
  const plan = planPointJournalToggle(sets, target, code, enabled);
  const disabledCodes = disabledAfter(plan, sets, target);

  if (enabled) {
    const limit = await checkJournalLimit(organizationId, disabledCodes, { source: "journals/points" });
    if (!limit.ok) return limitResponse(limit);
  }

  await db.$transaction([
    db.organization.update({ where: { id: organizationId }, data: { disabledJournalCodes: plan.orgDisabled } }),
    ...plan.buildings.map((building) =>
      db.building.update({ where: { id: building.id }, data: { disabledJournalCodes: building.disabled } }),
    ),
  ]);
  return NextResponse.json({ disabledCodes });
}
