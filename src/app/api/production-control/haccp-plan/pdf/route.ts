import { NextResponse } from "next/server";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { loadPpkBundle } from "@/lib/ppk/assemble.server";
import { buildHaccpPlanPdf } from "@/lib/ppk/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PDF документа, собранного из разделов «Производственного контроля». */
export async function GET() {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;

  const bundle = await loadPpkBundle(auth.organizationId);
  const pdf = buildHaccpPlanPdf(bundle);
  const name = `ХАССП-план — ${bundle.org.orgName || "организация"}.pdf`.replace(/[\/:*?"<>|]+/g, "-");
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
