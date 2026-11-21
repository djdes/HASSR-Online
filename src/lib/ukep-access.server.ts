import type { Session } from "next-auth";

import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { canSeeDocumentPoint } from "@/lib/document-point-access";
import { aclActorFromSession, canFinalizeJournal, hasJournalAccess } from "@/lib/journal-acl";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

/**
 * Доступ к подписям УКЭП документа журнала (спека journal-ukep-signing-2026-11-21, Р4):
 * документ своей организации и своей точки, доступ к журналу — видеть и скачивать;
 * подписывать — руководство или право «завершать» журнал.
 */
export type UkepDocumentAccess =
  | {
      ok: true;
      organizationId: string;
      document: { id: string; title: string; templateCode: string };
      canSign: boolean;
    }
  | { ok: false; status: 403 | 404; error: string };

export async function loadUkepDocument(session: Session, documentId: string): Promise<UkepDocumentAccess> {
  const organizationId = getActiveOrgId(session);
  const document = await db.journalDocument.findFirst({
    where: { id: documentId, organizationId },
    select: { id: true, title: true, buildingId: true, template: { select: { code: true } } },
  });
  if (!document || !(await canSeeDocumentPoint(session, document.buildingId))) {
    return { ok: false, status: 404, error: "Документ не найден" };
  }
  const actor = aclActorFromSession({
    user: {
      id: session.user.id,
      role: session.user.role,
      isRoot: session.user.isRoot === true,
      permissionPreset: session.user.permissionPreset,
    },
  });
  if (!(await hasJournalAccess(actor, document.template.code))) {
    return { ok: false, status: 403, error: "Нет доступа к этому журналу" };
  }
  const canSign = hasFullWorkspaceAccess(session.user) || (await canFinalizeJournal(actor, document.template.code));
  return {
    ok: true,
    organizationId,
    document: { id: document.id, title: document.title, templateCode: document.template.code },
    canSign,
  };
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
