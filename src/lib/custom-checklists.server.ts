import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { canWriteJournal, canFinalizeJournal, hasJournalAccess } from "@/lib/journal-acl";
import { hasCapability } from "@/lib/permission-presets";
import { CHECKLIST_CODE } from "@/lib/custom-checklists";

export async function requireChecklistAccess(operation: "read" | "write" | "finalize" | "manage" = "read") {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  const allowed = operation === "manage" ? hasCapability(auth.session.user, "journals.manage")
    : await (operation === "write" ? canWriteJournal : operation === "finalize" ? canFinalizeJournal : hasJournalAccess)(auth.session.user, CHECKLIST_CODE);
  if (!allowed) return { ok: false as const, response: NextResponse.json({ error: "Нет доступа к чек-листам" }, { status: 403 }) };
  return { ...auth, organizationId: getActiveOrgId(auth.session), canManage: hasCapability(auth.session.user, "journals.manage") };
}
