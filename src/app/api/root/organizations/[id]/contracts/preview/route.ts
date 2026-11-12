import { requireRoot } from "@/lib/auth-helpers";
import { contractFileName } from "@/lib/contracts/numbering";
import { attachmentHeader, CONTRACT_MIME, contractFormat, renderContractSnapshotDocx, renderContractSnapshotPdf } from "@/lib/contracts/render.server";
import { buildContractSnapshot } from "@/lib/contracts/service.server";
import { contractErrorResponse, parseIssueInput } from "@/lib/contracts/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/root/organizations/[id]/contracts/preview?format=pdf|docx —
 * проект договора по данным формы (реквизиты клиента, свой текст), без
 * номера и без записи в базу: проверить текст или отдать клиенту на правки.
 * ИНН для проекта не обязателен — вместо него будет линия.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await params;
  const input = parseIssueInput(await request.json().catch(() => null));
  if (!input.ok) return input.response;
  const format = contractFormat(request);
  try {
    const snapshot = await buildContractSnapshot(id, input.data, null, { requireInn: false });
    const bytes = format === "docx" ? await renderContractSnapshotDocx(snapshot) : (await renderContractSnapshotPdf(snapshot)).bytes;
    const name = contractFileName(`draft-${input.data.date}`, format);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": CONTRACT_MIME[format],
        "Content-Disposition": attachmentHeader({ fileName: `Проект-договора-${input.data.date}.${format}`, asciiFileName: name.ascii }, format === "pdf"),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return contractErrorResponse(error);
  }
}
