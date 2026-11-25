import { NextResponse } from "next/server";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { isPointScoped } from "@/lib/point-scope";
import { compareRevisions } from "@/lib/ppk/revisions.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NUMBER_RE = /^[1-9]\d{0,8}$/;

/**
 * GET ?docKey=&from=<номер>&to=<номер|current> — что изменилось между
 * редакциями документа ППК (2026-11-25). Без from/to — по умолчанию: документ
 * изменён после утверждения — последняя редакция ↔ текущий текст, иначе
 * предыдущая ↔ последняя. Доступ — как у реестра: руководство, область ППК;
 * руководителю точки — свои и общие документы.
 */
export async function GET(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const docKey = params.get("docKey") ?? "";
  const fromRaw = params.get("from");
  const toRaw = params.get("to");
  if (!docKey || docKey.length > 200) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  if (fromRaw !== null && !NUMBER_RE.test(fromRaw)) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  if (toRaw !== null && toRaw !== "current" && !NUMBER_RE.test(toRaw)) {
    return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  }
  const result = await compareRevisions(auth.scope, docKey, isPointScoped(auth.session.user) ? auth.scope.buildingId : null, {
    from: fromRaw === null ? null : Number(fromRaw),
    to: toRaw === null ? null : toRaw === "current" ? "current" : Number(toRaw),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
