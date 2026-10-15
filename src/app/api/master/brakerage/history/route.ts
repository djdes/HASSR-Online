import { NextResponse } from "next/server";
import { requireMasterDirectorySession } from "@/lib/master-directory-guard";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await requireMasterDirectorySession();
  if (!auth.ok) return auth.response;
  const cursor = new URL(request.url).searchParams.get("cursor");
  if (cursor && (cursor.length > 100 || !await db.masterBrakerageBatch.findFirst({ where: { id: cursor, organizationId: auth.masterOrgId }, select: { id: true } }))) return NextResponse.json({ error: "Страница истории не найдена" }, { status: 404 });
  const records = await db.masterBrakerageBatch.findMany({ where: { organizationId: auth.masterOrgId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  // Baseline row snapshots are server-only. History lists need recipient summaries, not entire journals.
  const batches = records.slice(0, 100).map(batch => {
    const result = batch.result as { organizations?: Array<{ organizationId: string; organizationName: string; documentId: string | null; added: number }> } | null;
    const revisions = Array.isArray(batch.revisions) ? batch.revisions.map(value => {
      const revision = value as Record<string, unknown>;
      return { input: revision.input, changedAt: revision.changedAt, changedByName: revision.changedByName };
    }) : [];
    return { ...batch, revisions, result: result?.organizations ? { organizations: result.organizations.map(({ organizationId, organizationName, documentId, added }) => ({ organizationId, organizationName, documentId, added })) } : null };
  });
  return NextResponse.json({ batches, nextCursor: records.length > 100 ? batches.at(-1)?.id : null }, { headers: { "Cache-Control": "private, no-store" } });
}
