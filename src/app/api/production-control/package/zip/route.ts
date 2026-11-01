import JSZip from "jszip";
import { NextResponse } from "next/server";

import { requirePpkAccess } from "@/lib/ppk/access.server";
import { checkPlanFeature, limitResponse } from "@/lib/billing.server";
import { clientIp } from "@/lib/client-ip";
import { journalSampleRateLimiter } from "@/lib/rate-limit";
import { loadDocumentOrgBlock } from "@/lib/document-org-block.server";
import { toOrderOrgSnapshot } from "@/lib/document-org-block";
import { ORDER_TEMPLATES } from "@/lib/orders/catalog";
import { renderOrderPdf } from "@/lib/orders/pdf";
import { defaultOrderValues, type OrderOrgSnapshot } from "@/lib/orders/render";
import { loadPdfOrgLogo } from "@/lib/pdf-logo.server";
import type { PdfLogo } from "@/lib/pdf-logo";
import { COMPANY_ONLY_API_ERROR, isPointScoped } from "@/lib/point-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/production-control/package/zip — «Скачать весь пакет»: все
 * типовые приказы одним архивом, с реквизитами, логотипом и фирменным
 * цветом организации; поля для заполнения — прочерками, чтобы распечатать
 * и заполнить. Типовой пакет — возможность тарифа «Премиум» (и пробного).
 */

const BLANK_ORG: OrderOrgSnapshot = {
  orgName: "",
  orgShortName: "",
  orgInn: null,
  orgAddress: null,
  directorName: null,
  directorPost: null,
  city: null,
};

export async function GET(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  // Приказы компании с её реквизитами — не руководителю точки (2026-11-01).
  if (isPointScoped(auth.session.user)) {
    return NextResponse.json({ error: COMPANY_ONLY_API_ERROR }, { status: 403 });
  }
  const { organizationId } = auth;

  const feature = await checkPlanFeature(organizationId, "typicalPackage", "production-control/package/zip");
  if (!feature.ok) return limitResponse(feature);

  const ip = clientIp(request) ?? "unknown";
  if (!journalSampleRateLimiter.consume(`ppk-package:${ip}`)) {
    return NextResponse.json({ error: "Слишком много запросов. Попробуйте через минуту" }, { status: 429 });
  }

  let org = BLANK_ORG;
  let logo: PdfLogo | null = null;
  let brandColor: string | null = null;
  const block = await loadDocumentOrgBlock(organizationId);
  if (block) {
    org = toOrderOrgSnapshot(block);
    logo = await loadPdfOrgLogo(organizationId, block.brand.logoUrl);
    brandColor = block.brand.color;
  }

  try {
    const zip = new JSZip();
    ORDER_TEMPLATES.forEach((template, index) => {
      const { buffer, fileName } = renderOrderPdf({
        template,
        org,
        // Поля — прочерками: пакет печатают и заполняют ручкой.
        values: Object.fromEntries(Object.keys(defaultOrderValues(template)).map((key) => [key, ""])),
        number: "",
        issuedAt: "",
        logo,
        brandColor,
      });
      zip.file(`${String(index + 1).padStart(2, "0")}-${fileName}`, buffer);
    });
    const archive = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    console.info("[ppk] typical package downloaded", { organizationId, files: ORDER_TEMPLATES.length, bytes: archive.byteLength });
    return new NextResponse(new Uint8Array(archive), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="wesetup-document-package.zip"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[ppk] typical package failed", error);
    return NextResponse.json({ error: "Не удалось собрать пакет документов" }, { status: 500 });
  }
}
