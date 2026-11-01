import { NextResponse } from "next/server";
import { requireProductionDocsAccess } from "@/lib/production-control-docs.server";
import { loadPpkBundle } from "@/lib/ppk/assemble.server";
import { buildPpkProgramPdf } from "@/lib/ppk/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PDF документа, собранного из разделов «Производственного контроля». */
export async function GET() {
  // Смотреть — и заведующей с «проверкой задач»: «Пришла проверка» → «Нормативка».
  const auth = await requireProductionDocsAccess();
  if (!auth.ok) return auth.response;

  const bundle = await loadPpkBundle(auth.scope);
  const pdf = buildPpkProgramPdf(bundle);
  const name = `ППК — ${bundle.org.orgName || "организация"}.pdf`.replace(/[\/:*?"<>|]+/g, "-");
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
