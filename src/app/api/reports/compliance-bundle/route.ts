import JSZip from "jszip";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { generateJournalDocumentPdf } from "@/lib/document-pdf";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
import { buildingPrintName } from "@/lib/building-scope";
import {
  buildCapaSummaryPdf,
  buildRegulatorCoverPdf,
  type RegulatorCapaRow,
} from "@/lib/regulator-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Сводный отчёт за проверкой Роспотребнадзора» — single-click archive
 * of every journal document overlapping a date range. Inspector asks
 * «покажите всё за март» → manager taps once → gets a ZIP with every
 * journal's PDF + a manifest listing what's inside.
 *
 *   GET /api/reports/compliance-bundle?from=YYYY-MM-DD&to=YYYY-MM-DD
 *     (dates optional — defaults to the current calendar month)
 *
 * Auth: session + management role (owner/manager/head_chef/root).
 *
 * Output: `application/zip` stream with
 *   - `ОТЧЁТ.txt`        — human-readable manifest
 *   - `<журнал>/<doc>.pdf` — one PDF per active/closed document that
 *     overlaps the range. Grouped by template name.
 *
 * Failures on individual documents are logged into the manifest instead
 * of failing the whole ZIP — an inspector would rather get 28 of 30
 * journals now than none after we retry one.
 */

function parseYmd(raw: string | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function firstOfCurrentMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function lastOfCurrentMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
}

function sanitizeForZip(name: string): string {
  // Remove characters that break on Windows/ZIP + collapse whitespace.
  return name
    .replace(/[\/\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new Response(JSON.stringify({ error: "Не авторизован" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot,
    })
  ) {
    return new Response(JSON.stringify({ error: "Это действие доступно руководителю" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const organizationId = getActiveOrgId(session);
  const url = new URL(request.url);
  const now = new Date();
  const from =
    parseYmd(url.searchParams.get("from")) ?? firstOfCurrentMonthUtc(now);
  const to = parseYmd(url.searchParams.get("to")) ?? lastOfCurrentMonthUtc(now);

  if (from > to) {
    return new Response(
      JSON.stringify({ error: "Неверный диапазон: from > to" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  // Guard against insane ranges — >400 days is either a date-picker bug
  // or an attempt to chew the whole archive into one ZIP.
  const days = Math.round((to.getTime() - from.getTime()) / 86400000);
  if (days > 400) {
    return new Response(
      JSON.stringify({
        error: "Слишком длинный диапазон. Выбирайте не больше 400 дней.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Find every document overlapping [from, to]. Include both active and
  // closed — an inspector cares about what was in the journal during the
  // period, not whether the doc is currently being written to.
  const toEndOfDay = new Date(to);
  toEndOfDay.setUTCHours(23, 59, 59, 999);

  const documents = await db.journalDocument.findMany({
    where: {
      organizationId,
      // Overlap: dateFrom <= to AND dateTo >= from
      dateFrom: { lte: toEndOfDay },
      dateTo: { gte: from },
    },
    include: {
      template: { select: { code: true, name: true } },
      building: { select: { name: true, journalName: true } },
    },
    orderBy: [
      { template: { sortOrder: "asc" } },
      { dateFrom: "asc" },
    ],
  });

  const [organization] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, journalShortName: true, legalProfileJson: true },
    }),
  ]);

  const zip = new JSZip();
  const manifestLines: string[] = [];
  manifestLines.push(`СВОДНЫЙ ОТЧЁТ ПО ЖУРНАЛАМ`);
  // Название — как в шапке журналов внутри архива.
  const organizationName = resolveOrgJournalName(organization);
  manifestLines.push(`Организация: ${organizationName}`);
  manifestLines.push(`Период: ${ymd(from)} — ${ymd(to)}`);
  manifestLines.push(`Собран: ${now.toLocaleString("ru-RU")}`);
  manifestLines.push(``);
  manifestLines.push(`=== Содержание ===`);

  const totals = { included: 0, failed: 0 };
  // Generate PDFs sequentially — parallelising N heavy PDF generations
  // would spike memory on a small VPS. One by one is slower but safer.
  for (const doc of documents) {
    const templateFolder = sanitizeForZip(doc.template.name || doc.template.code);
    const fileLabel = sanitizeForZip(
      `${doc.title}${doc.building ? ` · ${buildingPrintName(doc.building)}` : ""} · ${ymd(doc.dateFrom)}..${ymd(doc.dateTo)}`
    );
    try {
      const { buffer } = await generateJournalDocumentPdf({
        documentId: doc.id,
        organizationId,
      });
      zip.file(`${templateFolder}/${fileLabel}.pdf`, buffer);
      totals.included += 1;
      manifestLines.push(
        `✓ ${templateFolder} / ${fileLabel}.pdf (${doc.status === "closed" ? "закрыт" : "активен"})`
      );
    } catch (err) {
      totals.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      manifestLines.push(
        `✗ ${templateFolder} / ${fileLabel} — ошибка: ${message}`
      );
      console.error(
        `[compliance-bundle] PDF failed for ${doc.id}`,
        err
      );
    }
  }

  manifestLines.push(``);
  manifestLines.push(
    `Итого: включено ${totals.included}, ошибок ${totals.failed}, всего документов ${documents.length}.`
  );
  zip.file(`ОТЧЁТ.txt`, manifestLines.join("\r\n"));

  // --- CAPA за период (открытые к моменту сборки + закрытые в диапазоне)
  const capaRowsRaw = await db.capaTicket.findMany({
    where: {
      organizationId,
      OR: [
        { status: { not: "closed" } },
        {
          AND: [
            { status: "closed" },
            { closedAt: { gte: from, lte: toEndOfDay } },
          ],
        },
        { createdAt: { gte: from, lte: toEndOfDay } },
      ],
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      title: true,
      priority: true,
      status: true,
      createdAt: true,
      dueDate: true,
      closedAt: true,
      rootCause: true,
      correctiveAction: true,
      sourceType: true,
      assignedToId: true,
    },
  });
  const assigneeIds = Array.from(
    new Set(
      capaRowsRaw
        .map((r) => r.assignedToId)
        .filter((id): id is string => !!id)
    )
  );
  const assigneeNames =
    assigneeIds.length > 0
      ? new Map(
          (
            await db.user.findMany({
              where: { id: { in: assigneeIds } },
              select: { id: true, name: true },
            })
          ).map((u) => [u.id, u.name])
        )
      : new Map<string, string>();
  const capaRows: RegulatorCapaRow[] = capaRowsRaw.map((r) => ({
    title: r.title,
    priority: r.priority,
    status: r.status,
    createdAt: r.createdAt,
    dueDate: r.dueDate,
    closedAt: r.closedAt,
    assignedToName: r.assignedToId
      ? (assigneeNames.get(r.assignedToId) ?? null)
      : null,
    rootCause: r.rootCause,
    correctiveAction: r.correctiveAction,
  }));
  const capaOpen = capaRows.filter((r) => r.status !== "closed").length;
  const capaClosed = capaRows.filter((r) => r.status === "closed").length;
  const temperatureAnomalies = capaRowsRaw.filter(
    (r) => r.sourceType === "auto_temp_3days"
  ).length;

  try {
    const capaPdf = buildCapaSummaryPdf({
      organizationName,
      periodFrom: from,
      periodTo: to,
      rows: capaRows,
    });
    zip.file("CAPA.pdf", capaPdf);
  } catch (err) {
    console.error("[compliance-bundle] CAPA.pdf failed", err);
  }

  try {
    const cover = buildRegulatorCoverPdf({
      organizationName,
      periodFrom: from,
      periodTo: to,
      generatedAt: now,
      journalsIncluded: totals.included,
      journalsFailed: totals.failed,
      capaOpen,
      capaClosed,
      temperatureAnomalies,
      preparedBy: session.user.name ?? "",
    });
    zip.file("00_СВОДКА.pdf", cover);
  } catch (err) {
    console.error("[compliance-bundle] cover pdf failed", err);
  }

  const archive = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const uint8 = new Uint8Array(archive);
  const archiveName = `compliance-${ymd(from)}__${ymd(to)}.zip`;

  return new Response(uint8, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${archiveName}"`,
      "Content-Length": String(uint8.length),
      "X-Compliance-Included": String(totals.included),
      "X-Compliance-Failed": String(totals.failed),
    },
  });
}
