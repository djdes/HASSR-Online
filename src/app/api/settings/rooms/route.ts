import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { ROOM_KINDS } from "@/lib/room-kinds";
import { ensureRoomMirrorArea } from "@/lib/area-building-sync";
import { objectPointResponse } from "@/lib/point-objects.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  buildingId: z.string().min(1),
  name: z.string().trim().min(1, "Название обязательно").max(120),
  kind: z.enum(ROOM_KINDS).default("other"),
  sortOrder: z.number().int().optional(),
});

/** POST — создать помещение в указанном здании. */
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

  const building = await db.building.findFirst({
    where: { id: body.buildingId, organizationId: orgId },
    select: { id: true },
  });
  if (!building) {
    return NextResponse.json(
      { error: "Здание не найдено в этой организации" },
      { status: 404 }
    );
  }
  // Руководитель точки добавляет помещения только своей точке (аудит точек, 2026-11-01).
  const outOfScope = objectPointResponse(auth.session.user, building.id);
  if (outOfScope) return outOfScope;

  const exists = await db.room.findFirst({
    where: { buildingId: body.buildingId, name: body.name },
    select: { id: true },
  });
  if (exists) {
    return NextResponse.json(
      { error: "Помещение с таким названием уже есть в здании" },
      { status: 409 }
    );
  }

  const created = await db.room.create({
    data: {
      buildingId: body.buildingId,
      name: body.name,
      kind: body.kind,
      sortOrder: body.sortOrder ?? 0,
    },
  });

  // Auto-mirror в Area: schema разделяет Building/Room и Area
  // (legacy split — Area для оборудования + climate-журналов,
  // Building/Room — для journal-уборки). Юзер не должен ходить
  // в две страницы: «горячий цех» в Buildings сразу появляется цехом
  // в окне оборудования и в climate-журнале.
  // С 2026-10-17 цех знает точку: зеркало — цех этой точки (или цех без
  // точки, который её получает); у «Кухни» двух точек — два цеха.
  await ensureRoomMirrorArea({
    organizationId: orgId,
    room: { id: created.id, name: body.name, buildingId: body.buildingId },
  }).catch(() => {
    // Best-effort — если что-то пошло не так с Area, Room уже создан.
    // Юзер всегда может зайти в /settings/areas и создать вручную.
  });

  return NextResponse.json({ room: created });
}
