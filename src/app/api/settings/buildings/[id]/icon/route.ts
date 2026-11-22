import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { BUILDING_OUT_OF_SCOPE_ERROR, buildingInScope } from "@/lib/point-scope";
import { recordAuditLog } from "@/lib/audit-log";
import { BUILDING_ICON_KEYS, BUILDING_ICON_MAX_BYTES, type BuildingIconKey } from "@/lib/building-icons";
import { prepareOrgLogo } from "@/lib/org-logo-file";
import { setBuildingIconFile, setBuildingLibraryIcon } from "@/lib/building-icon-file.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Значок объекта (2026-11-22).
 *   PUT  { icon: "<ключ библиотеки>" | null } — типовой значок или «как было».
 *   POST multipart/form-data: file=<png|svg> — свой значок → { icon: "<адрес>" }.
 * Права — как у правки объекта (`PATCH /api/settings/buildings/[id]`):
 * руководство организации, руководитель точки — только своих точек.
 */

type Ctx = { params: Promise<{ id: string }> };

const PutSchema = z.object({
  icon: z.enum(BUILDING_ICON_KEYS as [BuildingIconKey, ...BuildingIconKey[]]).nullable(),
});

async function authorize(ctx: Ctx) {
  const auth = await requireApiAuth();
  if (!auth.ok) return { response: auth.response } as const;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return { response: NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 }) } as const;
  }
  const organizationId = getActiveOrgId(auth.session);
  const { id } = await ctx.params;
  const building = await db.building.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!building) return { response: NextResponse.json({ error: "Не найдено" }, { status: 404 }) } as const;
  if (!buildingInScope(auth.session.user, id)) {
    return { response: NextResponse.json({ error: BUILDING_OUT_OF_SCOPE_ERROR }, { status: 403 }) } as const;
  }
  return { session: auth.session, organizationId, buildingId: id } as const;
}

export async function PUT(request: Request, ctx: Ctx) {
  const access = await authorize(ctx);
  if ("response" in access) return access.response;
  const parsed = PutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Такого значка нет в библиотеке" }, { status: 400 });
  }
  await setBuildingLibraryIcon(access.buildingId, parsed.data.icon);
  await recordAuditLog({
    request,
    session: access.session,
    organizationId: access.organizationId,
    action: "building.icon.set",
    entity: "Building",
    entityId: access.buildingId,
    details: { icon: parsed.data.icon },
  });
  return NextResponse.json({ icon: parsed.data.icon });
}

export async function POST(request: Request, ctx: Ctx) {
  const access = await authorize(ctx);
  if ("response" in access) return access.response;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  }
  if (file.size > BUILDING_ICON_MAX_BYTES) {
    return NextResponse.json({ error: "Значок больше 300 КБ" }, { status: 413 });
  }
  const prepared = prepareOrgLogo(new Uint8Array(await file.arrayBuffer()), file.type);
  if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 415 });

  const icon = await setBuildingIconFile(access.organizationId, access.buildingId, prepared);
  await recordAuditLog({
    request,
    session: access.session,
    organizationId: access.organizationId,
    action: "building.icon.upload",
    entity: "Building",
    entityId: access.buildingId,
    details: { mime: prepared.mime, sizeBytes: prepared.bytes.byteLength },
  });
  return NextResponse.json({ icon });
}
