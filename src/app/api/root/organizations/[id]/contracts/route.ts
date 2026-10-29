import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { issueClientContract, loadContractContext } from "@/lib/contracts/service.server";
import { contractErrorResponse, parseIssueInput } from "@/lib/contracts/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET  /api/root/organizations/[id]/contracts — карточка договора: готовность
 *      реквизитов БФС и клиента, значения формы, получатели, история.
 * POST — выпустить договор с номером «WS-ГГГГ/NNNN» (снимок реквизитов).
 */
export async function GET(_request: Request, { params }: Params) {
  await requireRoot();
  const { id } = await params;
  try {
    return NextResponse.json(await loadContractContext(id));
  } catch (error) {
    return contractErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const session = await requireRoot();
  const { id } = await params;
  const input = parseIssueInput(await request.json().catch(() => null));
  if (!input.ok) return input.response;
  try {
    const contract = await issueClientContract(id, input.data, session.user.id ?? null);
    await recordAuditLog({
      request,
      session,
      organizationId: id,
      action: "client_contract.issue",
      entity: "ClientContract",
      entityId: contract.id,
      details: { number: contract.number, date: input.data.date, templateVersion: contract.templateVersion },
    });
    return NextResponse.json({ contract: { id: contract.id, number: contract.number } }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error);
  }
}
