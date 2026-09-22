import { NextResponse } from "next/server";

import { clientFacingBrand, getPartnerBrandBySlug, logoUrlFor } from "@/lib/partners/branding";
import { normalizeSlug } from "@/lib/partners/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?slug= — публичный бренд партнёра для `/p/<slug>` (только активные). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = normalizeSlug(url.searchParams.get("slug") ?? "");
  if (!slug) return NextResponse.json({ partner: null });
  const found = await getPartnerBrandBySlug(slug);
  if (!found) return NextResponse.json({ partner: null });
  const brand = clientFacingBrand(found);
  return NextResponse.json({
    partner: {
      slug: brand.slug,
      brandName: brand.brandName,
      loginGreeting: brand.loginGreeting,
      accentColor: brand.accentColor,
      logoUrl: brand.hasLogoLight ? logoUrlFor(brand, "light") : null,
      supportPhone: brand.supportPhone,
      supportTelegram: brand.supportTelegram,
      supportEmail: brand.supportEmail,
    },
  });
}
