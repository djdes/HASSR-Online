import { NextResponse } from "next/server";
import { z } from "zod";
import { brandQrPngDataUrl } from "@/lib/brand-qr";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
} from "@/lib/invite-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/staff/join-token
 *
 * Генерирует одноразовый QR-токен для саморегистрации сотрудника. Админ
 * нажимает «Пригласить по QR» в /settings/users, получает раз ссылку
 * https://wesetup.ru/join/<token> + готовый QR-PNG (data URL для
 * <img src=…>), может распечатать или отправить через мессенджер.
 *
 * Auth: management (owner/manager/head_chef/technologist) или ROOT.
 *
 * Body (опционально):
 *   { suggestedJobPositionId?: string, label?: string }
 *
 * Response 200:
 *   {
 *     token: string,         // raw, показывается ОДИН раз
 *     joinUrl: string,
 *     qrPngDataUrl: string,
 *     expiresAt: ISO,
 *     id: string             // EmployeeJoinToken.id (для list / revoke)
 *   }
 */
const Schema = z.object({
  suggestedJobPositionId: z.string().min(1).optional().nullable(),
  label: z.string().trim().max(120).optional().nullable(),
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
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad input" },
        { status: 400 }
      );
    }
    throw err;
  }

  // Если указан suggestedJobPositionId — проверяем что он принадлежит
  // этой же организации (защита от подсовывания чужих ID).
  if (body.suggestedJobPositionId) {
    const pos = await db.jobPosition.findFirst({
      where: { id: body.suggestedJobPositionId, organizationId: orgId },
      select: { id: true },
    });
    if (!pos) {
      return NextResponse.json(
        { error: "Должность не найдена в этой организации" },
        { status: 400 }
      );
    }
  }

  const raw = generateInviteToken();
  const tokenHash = hashInviteToken(raw);
  const expiresAt = inviteExpiresAt();

  const created = await db.employeeJoinToken.create({
    data: {
      organizationId: orgId,
      tokenHash,
      suggestedJobPositionId: body.suggestedJobPositionId ?? null,
      createdById: auth.session.user.id,
      expiresAt,
      label: body.label ?? null,
    },
  });

  const base =
    process.env.NEXTAUTH_URL?.replace(/\/+$/, "") ?? "https://wesetup.ru";
  const joinUrl = `${base}/join/${raw}`;
  // Фирменный QR (`brand-qr.ts`): его показывают в окне и печатают (320 px ≈ 85 мм).
  const qrPngDataUrl = await brandQrPngDataUrl(joinUrl, { width: 640 });

  return NextResponse.json({
    id: created.id,
    token: raw,
    joinUrl,
    qrPngDataUrl,
    expiresAt: expiresAt.toISOString(),
  });
}
