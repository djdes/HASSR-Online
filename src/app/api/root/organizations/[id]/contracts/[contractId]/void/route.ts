import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { voidClientContract } from "@/lib/contracts/service.server";
import { contractErrorResponse } from "@/lib/contracts/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — аннулировать договор: номер не переиспользуется, отправка блокируется. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; contractId: string }> }) {
  const session = await requireRoot();
  const { id, contractId } = await params;
  try {
    const contract = await voidClientContract(id, contractId, session.user.id ?? null);
    await recordAuditLog({
      request,
      session,
      organizationId: id,
      action: "client_contract.void",
      entity: "ClientContract",
      entityId: contract.id,
      details: { number: contract.number },
    });
    return NextResponse.json({ ok: true, status: contract.status });
  } catch (error) {
    return contractErrorResponse(error);
  }
}
