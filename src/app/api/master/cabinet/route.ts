import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { MasterCabinetError, renameMasterCabinet } from "@/lib/master-cabinet";
import { requireMasterDirectorySession } from "@/lib/master-directory-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH { name } — переименовать мастер-кабинет из его шапки (сотрудник кабинета). */
export async function PATCH(request: Request) {
  const auth = await requireMasterDirectorySession();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  try {
    const result = await renameMasterCabinet(auth.masterOrgId, body?.name);
    if (result.changed) {
      await recordAuditLog({
        request,
        session: auth.session,
        organizationId: auth.masterOrgId,
        action: "master_cabinet.renamed",
        entity: "Organization",
        entityId: auth.masterOrgId,
        details: { from: result.previousName, to: result.name, via: "master" },
      });
      console.info("[master-cabinet] renamed", { masterOrgId: auth.masterOrgId, from: result.previousName, to: result.name });
    }
    return NextResponse.json({ name: result.name, changed: result.changed });
  } catch (err) {
    if (err instanceof MasterCabinetError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[master-cabinet] rename failed", { masterOrgId: auth.masterOrgId }, err);
    return NextResponse.json({ error: "Не удалось переименовать кабинет" }, { status: 500 });
  }
}
