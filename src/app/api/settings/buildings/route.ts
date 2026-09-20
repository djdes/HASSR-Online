import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — список зданий + помещений для активной org.
 * POST — { name, address?, sortOrder? } создать здание.
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
  return NextResponse.json({ buildings });
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
  return NextResponse.json({ ok: true, perLocationJournals: body.perLocationJournals });
}
