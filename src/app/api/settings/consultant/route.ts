import { NextResponse } from "next/server";

import { readJson, requireOrgAdminApi } from "@/lib/partners/api";
import { isPartnerAccessLevel } from "@/lib/partners/access-guard";
import { NEUTRAL_SUPPORT_NAME, logoUrlFor } from "@/lib/partners/branding";
import { partnerErrorResponse } from "@/lib/partners/errors";
import {
  detachOrganizationFromPartner,
  getOrganizationConsultant,
  setClientAccessLevel,
  setClientHidesBranding,
} from "@/lib/partners/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Настройки → «Консультант» — сторона клиента.
 *
 * GET    → текущий консультант (бренд, уровень доступа, переключатель).
 * PATCH  → { accessLevel?: "view"|"edit", hideBranding?: boolean }
 * DELETE → отключить сопровождение (доступ партнёра закрывается сразу).
 *
 * Партнёр из кабинета клиента сюда не попадает: путь в PARTNER_DENYLIST,
 * плюс requireOrgAdminApi отдельно режет partnerAccess.
 */
async function consultantPayload(organizationId: string) {
  const consultant = await getOrganizationConsultant(organizationId);
  if (!consultant) return { consultant: null };
  // Партнёр скрыл себя: клиент видит, что доступ есть и у кого (служба
  // сопровождения WeSetup), может его ограничить или отключить — но без
  // бренда, контактов и слова «партнёр».
  if (consultant.brand.hiddenFromClients) {
    return {
      consultant: {
        partnerClientId: consultant.partnerClientId,
        accessLevel: consultant.accessLevel,
        clientHidesBranding: true,
        attachedAt: consultant.attachedAt.toISOString(),
        partnerStatus: "active",
        partnerType: "support",
        city: null,
        brandName: NEUTRAL_SUPPORT_NAME,
        slug: "",
        logoUrl: null,
        supportPhone: null,
        supportTelegram: null,
        supportEmail: null,
        consultantLine: null,
        hidden: true,
      },
    };
  }
  return {
    consultant: {
      partnerClientId: consultant.partnerClientId,
      accessLevel: consultant.accessLevel,
      clientHidesBranding: consultant.clientHidesBranding,
      attachedAt: consultant.attachedAt.toISOString(),
      partnerStatus: consultant.partnerStatus,
      partnerType: consultant.partnerType,
      city: consultant.city,
      brandName: consultant.brand.brandName,
      slug: consultant.brand.slug,
      logoUrl: consultant.brand.hasLogoLight ? logoUrlFor(consultant.brand, "light") : null,
      supportPhone: consultant.brand.supportPhone,
      supportTelegram: consultant.brand.supportTelegram,
      supportEmail: consultant.brand.supportEmail,
      consultantLine: consultant.consultantLine,
    },
  };
}

export async function GET() {
  const auth = await requireOrgAdminApi();
  if (!auth.ok) return auth.response;
  return NextResponse.json(await consultantPayload(auth.organizationId));
}

export async function PATCH(request: Request) {
  const auth = await requireOrgAdminApi();
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  try {
    if ("accessLevel" in body) {
      if (!isPartnerAccessLevel(body.accessLevel)) {
        return NextResponse.json({ error: "Уровень доступа: view или edit" }, { status: 400 });
      }
      await setClientAccessLevel({
        organizationId: auth.organizationId,
        level: body.accessLevel,
        actorUserId: auth.session.user.id,
      });
    }
    if ("hideBranding" in body) {
      await setClientHidesBranding({ organizationId: auth.organizationId, hide: body.hideBranding === true });
    }
    return NextResponse.json({ ok: true, ...(await consultantPayload(auth.organizationId)) });
  } catch (error) {
    return partnerErrorResponse(error);
  }
}

export async function DELETE() {
  const auth = await requireOrgAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const result = await detachOrganizationFromPartner({
      organizationId: auth.organizationId,
      by: "client",
      actorUserId: auth.session.user.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return partnerErrorResponse(error);
  }
}
