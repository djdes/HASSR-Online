import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { requireApiAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { requireKnowledgeAccess } from "@/lib/knowledge-documents.server";
import { requirePpkAccess } from "./access.server";

export type EditableDoc = {
  id: string;
  organizationId: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  folder: string | null;
};

/**
 * Документ базы знаний или папки «Процедуры», который можно править: база —
 * тем, кто управляет базой знаний; процедуры — тем, кто ведёт ППК этой точки.
 * Другие папки, виды и чужие документы — «не найден».
 */
export async function requireEditableDoc(
  id: string,
): Promise<{ ok: true; session: Session; doc: EditableDoc } | { ok: false; response: NextResponse }> {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  const organizationId = getActiveOrgId(auth.session);
  const doc = await db.knowledgeDocument.findFirst({
    where: { id, organizationId, kind: null },
    select: { id: true, organizationId: true, title: true, fileName: true, mimeType: true, sizeBytes: true, folder: true, buildingId: true },
  });
  const notFound = { ok: false as const, response: NextResponse.json({ error: "Документ не найден" }, { status: 404 }) };
  if (!doc) return notFound;
  if (doc.folder === null) {
    const access = await requireKnowledgeAccess(true);
    if (!access.ok) return access;
    return { ok: true, session: access.session, doc };
  }
  if (doc.folder !== "procedures") return notFound;
  const access = await requirePpkAccess();
  if (!access.ok) return access;
  if (doc.buildingId !== access.scope.buildingId) return notFound;
  return { ok: true, session: access.session, doc };
}
