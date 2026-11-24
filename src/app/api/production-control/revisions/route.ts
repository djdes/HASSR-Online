import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditLog } from "@/lib/audit-log";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { approveRevision, loadRevisionRegister, loadRevisionStates } from "@/lib/ppk/revisions.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?docKeys=a,b — состояния документов для плашек редакции (статус, последняя
 * редакция «ППК NNN», следующий номер). Без docKeys — реестр редакций организации.
 */
export async function GET(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const raw = new URL(request.url).searchParams.get("docKeys");
  if (raw === null) {
    const register = await loadRevisionRegister(auth.scope.organizationId);
    return NextResponse.json({ register }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const keys = raw.split(",").map((key) => key.trim()).filter(Boolean).slice(0, 300);
  const states = await loadRevisionStates(auth.scope, keys);
  return NextResponse.json(
    {
      states: Object.fromEntries(
        [...states].map(([key, { doc, ...state }]) => [key, { ...state, title: doc.title, empty: doc.empty }]),
      ),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const bodySchema = z.object({ docKey: z.string().min(1).max(200) });

/** POST { docKey } — утвердить текущую редакцию документа: следующий номер реестра «ППК NNN». */
export async function POST(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  const actor = { id: auth.session.user.id, name: auth.session.user.name ?? "" };
  const result = await approveRevision(auth.scope, actor, parsed.data.docKey);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  if (result.created) {
    await recordAuditLog({
      request,
      session: auth.session,
      organizationId: auth.scope.organizationId,
      action: "production-control.revision-approve",
      entity: "PpkRevision",
      entityId: result.docKey,
      details: { code: result.revision.code, title: result.title },
    });
  }
  return NextResponse.json({ created: result.created, revision: result.revision, docKey: result.docKey });
}
