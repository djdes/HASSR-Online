import { requireRoot } from "@/lib/auth-helpers";
import { attachmentHeader, renderClientContractPdf } from "@/lib/contracts/render.server";
import { findClientContract } from "@/lib/contracts/service.server";
import { contractErrorResponse } from "@/lib/contracts/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — PDF выпущенного договора (из снимка). `?inline=1` — открыть в браузере. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; contractId: string }> }) {
  await requireRoot();
  const { id, contractId } = await params;
  try {
    await findClientContract(id, contractId);
    const file = await renderClientContractPdf(contractId);
    const inline = new URL(request.url).searchParams.get("inline") === "1";
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": attachmentHeader(file, inline),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return contractErrorResponse(error);
  }
}
