import { NextResponse } from "next/server";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { renderPaperJournalPdf } from "@/lib/paper-journal-pdf";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
import { getVisibleOrgBranding } from "@/lib/partners/branding";
import { paperJournalById } from "@/lib/sphere-journal-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Бланк бумажного журнала.
 *
 * GET — чистый бланк (кнопка «Скачать бланк»), POST — тот же бланк с уже
 * вписанными строками со страницы «Заполнить и распечатать». Ничего не
 * сохраняем: эти журналы живут на бумаге, в БД им места нет.
 */

type PaperPeriod = { from: string | null; to: string | null };

function isoDay(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : null;
}

async function build(
  id: string,
  rows: string[][] | undefined,
  period?: PaperPeriod,
) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }
  const journal = paperJournalById(id);
  if (!journal) {
    return NextResponse.json({ error: "Журнал не найден" }, { status: 404 });
  }
  const organizationId = getActiveOrgId(session);
  const [organization, branding] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        journalShortName: true,
        legalProfileJson: true,
        inn: true,
        address: true,
      },
    }),
    getVisibleOrgBranding(organizationId),
  ]);

  const pdf = renderPaperJournalPdf({
    journal,
    // Название — как в шапке журналов (сокращённое → ЕГРЮЛ → полное).
    organization: {
      name: resolveOrgJournalName(organization),
      inn: organization?.inn ?? null,
      address: organization?.address ?? null,
    },
    rows,
    period,
    branding: branding ? { brandName: branding.brandName, pdfSignature: branding.pdfSignature } : null,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${journal.id}.pdf"`,
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return build(id, undefined);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const rows = Array.isArray(body?.rows)
    ? (body.rows as unknown[])
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => row.map((cell) => String(cell ?? "")))
    : undefined;
  // Период приходит только со страницы документа; черновик и публичный
  // семпл его не шлют — их бланк печатается как раньше.
  const from = isoDay(body?.dateFrom);
  const to = isoDay(body?.dateTo);
  return build(id, rows, from || to ? { from, to } : undefined);
}
