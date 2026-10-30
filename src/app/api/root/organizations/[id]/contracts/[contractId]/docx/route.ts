import { requireRoot } from "@/lib/auth-helpers";
import { attachmentHeader, renderClientContractDocx } from "@/lib/contracts/render.server";
import { findClientContract } from "@/lib/contracts/service.server";
import { contractErrorResponse } from "@/lib/contracts/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — DOCX выпущенного договора для правок (из снимка, без факсимиле). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; contractId: string }> }) {
  await requireRoot();
  const { id, contractId } = await params;
  try {
    await findClientContract(id, contractId);
    const file = await renderClientContractDocx(contractId);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": attachmentHeader(file),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return contractErrorResponse(error);
  }
}
