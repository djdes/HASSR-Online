import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { createOrganization } from "@/lib/create-organization";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { ORG_SPHERE_VALUES } from "@/lib/validators";
import { rewriteSessionClaims } from "@/lib/session-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(2, "Название — минимум 2 символа").max(200),
  sphere: z.enum(ORG_SPHERE_VALUES).default("restaurant"),
  copyFrom: z.string().trim().optional(),
});

/**
 * POST /api/organizations — завести ещё одну точку.
 *
 * Создавать может только владелец аккаунта: организации внутри одного
 * аккаунта делят тариф и лимит сотрудников, и разрешать это
 * приглашённому руководителю значит разрешить ему тратить чужие деньги.
 * Сразу после создания переключаем человека в новую организацию — иначе
 * он остаётся в старой и не понимает, сработало ли.
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const account = await db.account.findUnique({
    where: { ownerUserId: session.user.id },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Создавать организации может только владелец аккаунта" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Проверьте поля" },
      { status: 400 },
    );
  }

  const { organizationId } = await createOrganization({
    name: parsed.data.name,
    sphere: parsed.data.sphere,
    accountId: account.id,
    ownerUserId: session.user.id,
    // Клиент присылает "current" — какая именно организация активна,
    // он знать не обязан, а подставлять чужой id ему нельзя.
    copyFromOrganizationId:
      parsed.data.copyFrom === "current" ? getActiveOrgId(session) : null,
  });

  await db.auditLog.create({
    data: {
      organizationId,
      userId: session.user.id,
      userName: session.user.name ?? null,
      action: "org.created",
      entity: "organization",
      entityId: organizationId,
      details: { name: parsed.data.name, sphere: parsed.data.sphere },
    },
  });

  await rewriteSessionClaims({ activeOrganizationId: organizationId });
  await db.user.update({
    where: { id: session.user.id },
    data: { lastActiveOrganizationId: organizationId },
  });

  return NextResponse.json({ ok: true, organizationId });
}

/**
 * GET — организации, доступные текущему человеку. `canCreateMasterCabinet` —
 * владелец аккаунта: в мини-приложении у него в «Кабинете» есть «Создать
 * мастер-кабинет» (как в меню профиля сайта).
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { listAccessibleOrganizations } = await import(
    "@/lib/organization-access"
  );
  const [organizations, ownedAccount] = await Promise.all([
    listAccessibleOrganizations(auth.session.user.id),
    db.account.findUnique({
      where: { ownerUserId: auth.session.user.id },
      select: { id: true },
    }),
  ]);
  return NextResponse.json({
    organizations,
    canCreateMasterCabinet:
      Boolean(ownedAccount) && hasFullWorkspaceAccess(auth.session.user),
  });
}
