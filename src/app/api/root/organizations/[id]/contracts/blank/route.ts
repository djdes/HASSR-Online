import { requireRoot } from "@/lib/auth-helpers";
import { attachmentHeader, CONTRACT_MIME, contractFormat, renderContractSnapshotDocx, renderContractSnapshotPdf } from "@/lib/contracts/render.server";
import { buildBlankContractSnapshot } from "@/lib/contracts/service.server";
import { contractErrorResponse } from "@/lib/contracts/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/root/organizations/[id]/contracts/blank?format=pdf|docx —
 * «рыба» договора: реквизиты ООО «БФС» заполнены, данные клиента, номер и
 * дата — линии. От организации не зависит и ИНН клиента не требует.
 */
export async function GET(request: Request) {
  await requireRoot();
  const format = contractFormat(request);
  try {
    const snapshot = await buildBlankContractSnapshot();
    const bytes = format === "docx" ? await renderContractSnapshotDocx(snapshot, { blank: true }) : (await renderContractSnapshotPdf(snapshot, { blank: true })).bytes;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": CONTRACT_MIME[format],
        "Content-Disposition": attachmentHeader({ fileName: `Договор-WeSetup-шаблон.${format}`, asciiFileName: `Contract-WeSetup-blank.${format}` }),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return contractErrorResponse(error);
  }
}
