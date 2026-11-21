import type { Session } from "next-auth";

import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { aclActorFromSession, canFinalizeJournal, hasJournalAccess } from "@/lib/journal-acl";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

/**
 * Доступ к подписям УКЭП документа журнала (спека journal-ukep-signing-2026-11-21, Р4).
 * Маршрут сам проверяет точку документа (`canSeeDocumentPoint` — соглашение всех
 * маршрутов `journal-documents/[id]`, его стережёт document-point-access.test.ts):
 *   1. `findUkepDocument` — документ своей организации, иначе 404;
 *   2. `canSeeDocumentPoint(session, document.buildingId)` в маршруте — иначе 404;
 *   3. `ukepJournalAccess` — доступ к журналу (иначе 403) и право подписи
 *      (руководство или право «завершать» журнал).
 */
export type UkepDocument = {
  organizationId: string;
  document: { id: string; title: string; buildingId: string | null; templateCode: string };
};

export async function findUkepDocument(session: Session, documentId: string): Promise<UkepDocument | null> {
  const organizationId = getActiveOrgId(session);
  const document = await db.journalDocument.findFirst({
    where: { id: documentId, organizationId },
    select: { id: true, title: true, buildingId: true, template: { select: { code: true } } },
  });
  if (!document) return null;
  return {
    organizationId,
    document: { id: document.id, title: document.title, buildingId: document.buildingId, templateCode: document.template.code },
  };
}

export async function ukepJournalAccess(session: Session, templateCode: string): Promise<{ read: boolean; canSign: boolean }> {
  const actor = aclActorFromSession({
    user: {
      id: session.user.id,
      role: session.user.role,
      isRoot: session.user.isRoot === true,
      permissionPreset: session.user.permissionPreset,
    },
  });
  if (!(await hasJournalAccess(actor, templateCode))) return { read: false, canSign: false };
  const canSign = hasFullWorkspaceAccess(session.user) || (await canFinalizeJournal(actor, templateCode));
  return { read: true, canSign };
}

/** Имя файла для скачивания: без путей и управляющих символов, всегда `.pdf`. */
export function ukepPdfFileName(raw: unknown): string {
  const base = typeof raw === "string" ? raw : "";
  const cleaned = base
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.pdf$/i, "")
    .slice(0, 120)
    .trim();
  return `${cleaned || "journal"}.pdf`;
}

/** `Content-Disposition` с русским именем (RFC 5987) и запасным латинским. */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]+/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
