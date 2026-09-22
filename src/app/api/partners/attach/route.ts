import { NextResponse } from "next/server";

import { readJson, requireOrgAdminApi } from "@/lib/partners/api";
import { isPartnerAccessLevel } from "@/lib/partners/access-guard";
import { partnerErrorResponse } from "@/lib/partners/errors";
import { attachOrganizationToPartner, findPartnerForAttach, isPartnerOwnOrganization } from "@/lib/partners/service";
import { NEUTRAL_SUPPORT_NAME } from "@/lib/partners/branding";
import { db } from "@/lib/db";

/** Имя партнёра для глаз клиента: скрытый — «Служба сопровождения WeSetup». */
async function clientFacingName(partnerId: string, brandName: string): Promise<string> {
  const row = await db.partner.findUnique({ where: { id: partnerId }, select: { hideFromClients: true } });
  return row?.hideFromClients ? NEUTRAL_SUPPORT_NAME : brandName;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/partners/attach — клиент подключает консультанта.
 * body: { slug?: string; code?: string; accessLevel: "view"|"edit" }
 *
 * Уровень доступа выбирает клиент. Один активный партнёр на организацию;
 * собственная организация партнёра клиентом стать не может.
 */
export async function POST(request: Request) {
  const auth = await requireOrgAdminApi();
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : null;
  const code = typeof body.code === "string" ? body.code.trim() : null;
  const accessLevel = isPartnerAccessLevel(body.accessLevel) ? body.accessLevel : "view";
  try {
    const partner = await findPartnerForAttach({ slug, code });
    if (!partner) return NextResponse.json({ error: "Партнёр с такой ссылкой или кодом не найден" }, { status: 404 });
    const result = await attachOrganizationToPartner({
      partnerId: partner.id,
      organizationId: auth.organizationId,
      accessLevel,
      source: slug ? "link" : "code",
      actorUserId: auth.session.user.id,
    });
    return NextResponse.json({ ok: true, brandName: await clientFacingName(partner.id, partner.brandName), ...result });
  } catch (error) {
    return partnerErrorResponse(error);
  }
}

/** GET ?slug=|?code= — предпросмотр перед подключением (бренд + можно ли). */
export async function GET(request: Request) {
  const auth = await requireOrgAdminApi();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug")?.trim().toLowerCase() || null;
  const code = url.searchParams.get("code")?.trim() || null;
  const partner = await findPartnerForAttach({ slug, code });
  if (!partner) return NextResponse.json({ partner: null });
  const own = await isPartnerOwnOrganization(partner.id, auth.organizationId);
  return NextResponse.json({
    partner: {
      slug: partner.slug,
      brandName: await clientFacingName(partner.id, partner.brandName),
      active: partner.status === "active",
      ownOrganization: own,
    },
  });
}
