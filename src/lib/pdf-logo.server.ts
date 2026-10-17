/**
 * Логотип организации для PDF из БД (server-only). Только загруженный в
 * кабинете файл и только если он текущий (`logoUrl` указывает на него):
 * внешнюю ссылку сервер не скачивает, см. `pdf-logo.ts`.
 */

import { readOrgLogo } from "@/lib/org-logo";
import { isOwnUploadedLogo, pdfLogoFromFile, type PdfLogo } from "@/lib/pdf-logo";

export async function loadPdfOrgLogo(organizationId: string, logoUrl: string | null | undefined): Promise<PdfLogo | null> {
  if (!isOwnUploadedLogo(organizationId, logoUrl)) return null;
  try {
    const file = await readOrgLogo(organizationId);
    return file ? await pdfLogoFromFile(file) : null;
  } catch (error) {
    console.warn("[pdf-logo] load failed", error instanceof Error ? error.message : error);
    return null;
  }
}
