import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { ackDocForUser } from "@/lib/ppk/acknowledge.server";
import { loadPpkBundle } from "@/lib/ppk/assemble.server";
import { buildPpkProgramPdf } from "@/lib/ppk/pdf";
import { ppkDocKindKey } from "@/lib/ppk/scope";
import { ppkScopeForSession } from "@/lib/ppk/scope.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contentDisposition = (mode: "inline" | "attachment", name: string) =>
  `${mode}; filename*=UTF-8''${encodeURIComponent(name.replace(/[\/:*?"<>|]+/g, "-"))}`;

/**
 * GET — Программа производственного контроля для ознакомления (лист
 * ознакомления, пункт 3.7 структуры ППК): загруженный файл ППК точки или
 * организации, без него — PDF, собранный из разделов. Только тем, кто в
 * аудитории документа «ppk» (сотрудники объекта, когда программа утверждена
 * версией или загружена файлом) — тот же отбор, что у отметки «Ознакомлен».
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const scope = await ppkScopeForSession(auth.session);
  const doc = await ackDocForUser(scope, auth.session.user.id, "ppk");
  if (!doc) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });

  const file = await db.knowledgeDocument.findFirst({
    where: { organizationId: scope.organizationId, kind: ppkDocKindKey("ppk", scope.buildingId) },
    select: { fileName: true, mimeType: true, content: true },
  });
  if (file) {
    const pdf = file.mimeType === "application/pdf";
    return new NextResponse(new Uint8Array(file.content), {
      headers: {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": contentDisposition(pdf ? "inline" : "attachment", file.fileName),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }

  const bundle = await loadPpkBundle(scope);
  return new NextResponse(new Uint8Array(buildPpkProgramPdf(bundle)), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition("inline", `ППК — ${bundle.org.orgName || "организация"}.pdf`),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
