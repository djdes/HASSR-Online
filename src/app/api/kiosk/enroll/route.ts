import { NextResponse } from "next/server";
import { z } from "zod";
import { brandQrPngDataUrl } from "@/lib/brand-qr";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { generateInviteToken, hashInviteToken } from "@/lib/invite-tokens";
import { resolveQrPosterOrigin } from "@/lib/qr-poster-origin";
import { getViewedPointId } from "@/lib/active-building";
import { isPointScoped } from "@/lib/point-scope";
import { objectPointResponse } from "@/lib/point-objects.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/kiosk/enroll — привязать общий планшет к организации.
 *
 * Руководитель нажимает «Добавить планшет» в /settings/kiosk, получает
 * одноразовую ссылку `/api/kiosk/claim/<token>` + QR: открывает её на
 * планшете, тот запоминается как киоск. Включает режим киоска у организации.
 *
 * Body: { label: string, buildingId?: string }
 */
const Schema = z.object({
  label: z.string().trim().min(1).max(120),
  buildingId: z.string().min(1).optional().nullable(),
});

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await request.json().catch(() => ({})));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Bad input" }, { status: 400 });
    }
    throw err;
  }

  // Точка планшета (аудит точек, 2026-11-01): не передана — точка из шапки,
  // у руководителя точки с одной точкой — она. Планшет без точки показывает
  // сотрудников всей организации — его заводит только офис.
  const scope = isPointScoped(auth.session.user) ? (auth.session.user.pointScope ?? []) : [];
  const buildingId =
    body.buildingId ?? (scope.length === 1 ? scope[0] : await getViewedPointId(auth.session));
  if (buildingId) {
    const building = await db.building.findFirst({
      where: { id: buildingId, organizationId: orgId },
      select: { id: true },
    });
    if (!building) {
      return NextResponse.json({ error: "Точка не найдена" }, { status: 400 });
    }
  }
  const outOfScope = objectPointResponse(auth.session.user, buildingId);
  if (outOfScope) return outOfScope;

  const enrollToken = generateInviteToken();
  const device = await db.kioskDevice.create({
    data: {
      organizationId: orgId,
      buildingId: buildingId ?? null,
      label: body.label,
      secretHash: hashInviteToken(enrollToken),
      createdById: auth.session.user.id,
    },
    select: { id: true, label: true, createdAt: true },
  });

  // Включаем режим киоска у организации — иначе device-cookie не действует.
  await db.organization.update({ where: { id: orgId }, data: { kioskEnabled: true } });

  // Публичный домен, а не внутренний localhost:3002 (за nginx): иначе QR
  // на планшете вёл бы в никуда.
  const origin = resolveQrPosterOrigin({
    requested: new URL(request.url).searchParams.get("origin"),
    configured: process.env.NEXTAUTH_URL ?? null,
    production: process.env.NODE_ENV === "production",
  });
  const claimUrl = `${origin}/api/kiosk/claim/${enrollToken}`;
  const qrPngDataUrl = await brandQrPngDataUrl(claimUrl, { width: 600 });

  return NextResponse.json({
    id: device.id,
    label: device.label,
    claimUrl,
    qrPngDataUrl,
  });
}
