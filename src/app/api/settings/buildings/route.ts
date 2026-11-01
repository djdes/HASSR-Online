import { NextResponse } from "next/server";
import { OFFICE_BUILDING_KIND } from "@/lib/building-scope";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { checkPointsForCreation, limitResponse } from "@/lib/billing.server";
import { COMPANY_ONLY_API_ERROR, buildingInScope, isPointScoped } from "@/lib/point-scope";
import { closePointManagerSessions } from "@/lib/point-scope.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — список зданий + помещений для активной org.
 * POST — { name, address?, sortOrder? } создать здание. Второе и
 *   следующие здания — новые точки тарифа: сверх оплаченных — 402.
 * PATCH — { perLocationJournals } вести журналы отдельно по точкам.
 *
 * Auth: management (owner/manager/head_chef/technologist) или ROOT.
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);
  const buildings = await db.building.findMany({
    where: { organizationId: orgId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      rooms: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, kind: true, sortOrder: true },
      },
    },
  });
  // Руководителю точки — только его точки с их помещениями (аудит
  // 2026-11-01): точки и помещения остальных — дело руководства компании.
  return NextResponse.json({
    buildings: isPointScoped(auth.session.user)
      ? buildings.filter((building) => buildingInScope(auth.session.user, building.id))
      : buildings,
  });
}

const CreateSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(120),
  address: z.string().trim().max(200).optional().nullable(),
  sortOrder: z.number().int().optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);
  // Новая точка и деление по точкам — решения компании (фаза 2 «Офис и точки»).
  if (isPointScoped(auth.session.user)) {
    return NextResponse.json({ error: COMPANY_ONLY_API_ERROR }, { status: 403 });
  }

  let body: z.infer<typeof CreateSchema>;
  try {
    body = CreateSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad input" },
        { status: 400 }
      );
    }
    throw err;
  }

  const exists = await db.building.findFirst({
    where: { organizationId: orgId, name: body.name },
    select: { id: true },
  });
  if (exists) {
    return NextResponse.json(
      { error: "Точка с таким названием уже есть" },
      { status: 409 }
    );
  }

  // Точки тарифа: первое здание места не добавляет — организация и так
  // считалась одной точкой; каждое следующее — ещё одна точка.
  // Офис организации — не торговая точка и в тариф не считается.
  const buildingsNow = await db.building.count({ where: { organizationId: orgId, kind: { not: OFFICE_BUILDING_KIND } } });
  const points = await checkPointsForCreation(orgId, buildingsNow > 0 ? 1 : 0, { source: "settings/buildings" });
  if (!points.ok) return limitResponse(points);

  const created = await db.building.create({
    data: {
      organizationId: orgId,
      name: body.name,
      address: body.address ?? null,
      sortOrder: body.sortOrder ?? 0,
    },
    include: { rooms: true },
  });
  return NextResponse.json({ building: created });
}

const FlagSchema = z.object({
  perLocationJournals: z.boolean(),
});

/**
 * Точки (2026-09-05): тумблер «Вести журналы отдельно по точкам».
 * Включить можно только при двух и более зданиях — иначе точек нет и
 * режим ничего не меняет. Выключение оставляет `buildingId` у уже
 * созданных документов: они просто снова видны все вместе.
 */
export async function PATCH(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);
  // Новая точка и деление по точкам — решения компании (фаза 2 «Офис и точки»).
  if (isPointScoped(auth.session.user)) {
    return NextResponse.json({ error: COMPANY_ONLY_API_ERROR }, { status: 403 });
  }

  let body: z.infer<typeof FlagSchema>;
  try {
    body = FlagSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad input" },
        { status: 400 }
      );
    }
    throw err;
  }

  if (body.perLocationJournals) {
    const count = await db.building.count({ where: { organizationId: orgId } });
    if (count < 2) {
      return NextResponse.json(
        { error: "Добавьте хотя бы две точки, чтобы вести журналы отдельно" },
        { status: 400 }
      );
    }
  }

  await db.organization.update({
    where: { id: orgId },
    data: { perLocationJournals: body.perLocationJournals },
  });
  // При офисе деление решает, кто руководитель точки, — сессии руководителей
  // с местами перевыпускаются при следующем входе (фаза 2 «Офис и точки»).
  if (await db.building.count({ where: { organizationId: orgId, kind: OFFICE_BUILDING_KIND } })) {
    await closePointManagerSessions(orgId, auth.session.user.id);
  }
  return NextResponse.json({ ok: true, perLocationJournals: body.perLocationJournals });
}
