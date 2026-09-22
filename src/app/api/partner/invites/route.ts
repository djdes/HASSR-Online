import { NextResponse } from "next/server";

import { readJson, requirePartnerApi } from "@/lib/partners/api";
import { partnerErrorResponse } from "@/lib/partners/errors";
import { INVITE_STATUS_LABELS, buildInviteTexts } from "@/lib/partners/invite-texts";
import { listClientInvites } from "@/lib/partners/invites-list";
import { createClientInvite } from "@/lib/partners/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Раздел «Приглашения»: ссылка, код, готовые тексты и список email-приглашений. */
export async function GET() {
  const auth = await requirePartnerApi();
  if (!auth.ok) return auth.response;
  const { partner } = auth.ctx.membership;
  const invites = await listClientInvites(partner.id);

  return NextResponse.json({
    texts: buildInviteTexts(partner.brandName, partner.slug, partner.code, partner.hideFromClients),
    statusLabels: INVITE_STATUS_LABELS,
    invites,
  });
}

export async function POST(request: Request) {
  const auth = await requirePartnerApi();
  if (!auth.ok) return auth.response;
  const body = await readJson<{ email?: string }>(request);
  try {
    const invite = await createClientInvite({
      partnerId: auth.ctx.membership.partnerId,
      email: String(body.email ?? ""),
    });
    return NextResponse.json({ ok: true, invite });
  } catch (error) {
    return partnerErrorResponse(error);
  }
}
