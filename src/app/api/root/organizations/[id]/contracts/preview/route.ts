import { requireRoot } from "@/lib/auth-helpers";
import { contractFileName } from "@/lib/contracts/numbering";
import { attachmentHeader, renderContractSnapshotPdf } from "@/lib/contracts/render.server";
import { buildContractSnapshot } from "@/lib/contracts/service.server";
import { contractErrorResponse, parseIssueInput } from "@/lib/contracts/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/root/organizations/[id]/contracts/preview — черновик PDF по
 * данным формы, без номера и без записи в базу: проверить текст до выпуска.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await params;
  const input = parseIssueInput(await request.json().catch(() => null));
  if (!input.ok) return input.response;
  try {
    const snapshot = await buildContractSnapshot(id, input.data, null);
    const { bytes } = await renderContractSnapshotPdf(snapshot);
    const name = contractFileName(`draft-${input.data.date}`, "pdf");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": attachmentHeader({ fileName: `Проект-договора-${input.data.date}.pdf`, asciiFileName: name.ascii }, true),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return contractErrorResponse(error);
  }
}
