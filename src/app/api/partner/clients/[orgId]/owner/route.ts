import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { readJson, requirePartnerApi } from "@/lib/partners/api";
import { assignClientOwner } from "@/lib/partners/client-organizations";
import { partnerErrorResponse } from "@/lib/partners/errors";
import { CONVERTED_SOURCE } from "@/lib/partners/org-conversion-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — «Передать клиенту»: назначить владельца организации.
 *
 * Один роут на три случая — назначить впервые, отправить приглашение
 * ещё раз и исправить опечатку в адресе. Что именно происходит, решает
 * состояние в базе, а не отдельные кнопки с разной логикой.
 */
export async function POST(request: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const auth = await requirePartnerApi();
  if (!auth.ok) return auth.response;
  const { session, membership } = auth.ctx;
  const { orgId } = await ctx.params;

  // Только организации, которые завёл сам партнёр (`source: "manual"`) или
  // перевёл в клиенты из своего аккаунта (`converted`). Иначе на клиенте,
  // пришедшем по ссылке и почему-либо оставшемся без владельца (легаси до
  // миграции аккаунтов), партнёр смог бы назначить владельцем произвольный
  // адрес — то есть отдать чужую организацию.
  const link = await db.partnerClient.findFirst({
    where: {
      partnerId: membership.partnerId,
      organizationId: orgId,
      detachedAt: null,
      source: { in: ["manual", CONVERTED_SOURCE] },
    },
    select: { id: true, organization: { select: { name: true } } },
  });
  if (!link) {
    return NextResponse.json(
      { error: "Передать можно только организацию, которую вы завели сами или перевели из своего аккаунта" },
      { status: 404 },
    );
  }

  const body = await readJson<{ email?: unknown; name?: unknown; phone?: unknown }>(request);

  try {
    const handover = await assignClientOwner({
      partnerId: membership.partnerId,
      organizationId: orgId,
      actorUserId: session.user.id,
      actorName: session.user.name ?? session.user.email ?? "сотрудник",
      brandName: membership.partner.brandName,
      organizationName: link.organization.name,
      owner: {
        email: String(body.email ?? ""),
        name: String(body.name ?? ""),
        phone: typeof body.phone === "string" ? body.phone : null,
      },
    });
    return NextResponse.json({ ok: true, handover });
  } catch (error) {
    return partnerErrorResponse(error);
  }
}
