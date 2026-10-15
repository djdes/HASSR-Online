import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateJournalDocumentPdf } from "@/lib/document-pdf";
import { authenticateAgent } from "@/lib/print-agent-auth";
import { isLocale } from "@/i18n/locales";
import { journalPdfErrorResponse } from "@/lib/journal-pdf-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/print/jobs/<id>/pdf — агент забирает бланк для печати.
 *
 * Отдельным запросом, а не полем в очереди: PDF журнала за месяц весит
 * сотни килобайт, и складывать его в каждую строку очереди (как делает
 * Magday со своими чеками) значило бы раздувать таблицу без нужды. Здесь
 * он собирается на лету тем же кодом, что и кнопка «Скачать PDF».
 *
 * Права журнала здесь НЕ проверяем: их проверил тот, кто нажал «На
 * принтер». Агент — это принтер организации, а не пользователь, своих
 * прав на журналы у него нет и быть не должно.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 401 });
  }

  const { id } = await params;
  const job = await db.printJob.findFirst({
    where: {
      id,
      agentId: agent.id,
      organizationId: agent.organizationId,
      status: "printing",
    },
    select: { documentId: true, locale: true },
  });

  if (!job?.documentId) {
    return NextResponse.json({ error: "Задание не найдено" }, { status: 404 });
  }

  // The queue's captured value wins over all current user/organization settings.
  const locale = isLocale(job.locale) ? job.locale : "ru";
  try {
    const { buffer, fileName } = await generateJournalDocumentPdf({
      documentId: job.documentId,
      organizationId: agent.organizationId,
      locale,
    });
    const uint8 = new Uint8Array(buffer);
    return new Response(uint8, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Language": locale,
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(uint8.length),
      },
    });
  } catch (error) {
    const missing = error instanceof Error && error.message === "Документ не найден";
    if (!missing) console.error("[print-job-pdf] Generation failed", error);
    return journalPdfErrorResponse(request, missing ? "DOCUMENT_NOT_FOUND" : "PDF_FAILED", locale);
  }
}
