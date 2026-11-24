import { NextResponse } from "next/server";
import { requireProductionDocsAccess } from "@/lib/production-control-docs.server";
import { loadPpkPrintData } from "@/lib/ppk/structure-print.server";
import { buildPpkStructurePdf } from "@/lib/ppk/structure-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PDF Программы производственного контроля по структуре документа владельца
 * (2026-11-24): пункты 1.1–3.7 и приложения, сканы, колонтитул и сквозная нумерация.
 */
export async function GET() {
  // Смотреть — и заведующей с «проверкой задач»: «Пришла проверка» → «Нормативка».
  const auth = await requireProductionDocsAccess();
  if (!auth.ok) return auth.response;

  const data = await loadPpkPrintData(auth.scope);
  const pdf = await buildPpkStructurePdf(data);
  const name = `ППК — ${data.bundle.org.orgName || "организация"}.pdf`.replace(/[\/:*?"<>|]+/g, "-");
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
