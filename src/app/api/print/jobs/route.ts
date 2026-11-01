import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { aclActorFromSession, hasJournalAccess } from "@/lib/journal-acl";
import { AGENT_ONLINE_WINDOW_MS } from "@/lib/print-agent-auth";
import { agentMayTakeJob, pointsWithOwnAgent } from "@/lib/print-point-routing";
import { resolveExportLocale } from "@/i18n/export-locale";
import { translatorFor } from "@/i18n/translator";
import { canSeeDocumentPoint } from "@/lib/document-point-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/print/jobs — отправить журнал на принтер заведения.
 *
 * Ради этого всё и делалось: пришла проверка, человек с телефона открыл
 * журнал и нажал «На принтер» — бланк выехал на кассе, никого не надо
 * звать к компьютеру.
 *
 * Права проверяем здесь и только здесь: у агента своих прав на журналы
 * нет, он печатает то, что ему дали.
 */
export async function POST(request: Request) {
  const session = await requireAuth();
  const organizationId = getActiveOrgId(session);
  const personalLocale = resolveExportLocale(null, session.user)!;
  const t = await translatorFor(personalLocale);

  let body: { documentId?: unknown; locale?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "EMPTY_REQUEST", error: t("journalApi.emptyRequest") }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ code: "EMPTY_REQUEST", error: t("journalApi.emptyRequest") }, { status: 400 });
  }
  const locale = resolveExportLocale(body.locale, session.user);
  if (!locale) return NextResponse.json({ code: "INVALID_LOCALE", error: t("journalPdf.errors.invalidLocale") }, { status: 400 });
  const documentId = String(body.documentId ?? "").trim();
  if (!documentId) {
    return NextResponse.json({ code: "DOCUMENT_REQUIRED", error: t("journalApi.documentRequired") }, { status: 400 });
  }

  const doc = await db.journalDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      title: true,
      organizationId: true,
      buildingId: true,
      template: { select: { code: true, name: true } },
    },
  });
  if (!doc || doc.organizationId !== organizationId || !(await canSeeDocumentPoint(session, doc.buildingId))) {
    return NextResponse.json({ code: "DOCUMENT_NOT_FOUND", error: t("journalPdf.errors.notFound") }, { status: 404 });
  }

  // Та же проверка, что у скачивания PDF: если человеку нельзя скачать
  // журнал, то и распечатать его он не должен.
  const access = await hasJournalAccess(
    aclActorFromSession({
      user: {
        id: session.user.id,
        role: session.user.role,
        isRoot: session.user.isRoot === true,
      },
    }),
    doc.template.code,
  );
  if (!access) {
    return NextResponse.json(
      { code: "JOURNAL_FORBIDDEN", error: t("journalPdf.errors.forbidden") },
      { status: 403 },
    );
  }

  // Принтер своей точки (2026-11-01): «принтер на связи» — только тот,
  // который возьмёт это задание (своей точки или общий, если у точки
  // своего принтера нет).
  const agents = await db.printAgent.findMany({
    where: { organizationId, revokedAt: null },
    select: { id: true, name: true, buildingId: true, lastSeenAt: true },
  });
  const pointsWithAgent = pointsWithOwnAgent(agents);
  const onlineSince = Date.now() - AGENT_ONLINE_WINDOW_MS;
  const online =
    agents.find(
      (agent) =>
        agent.lastSeenAt &&
        agent.lastSeenAt.getTime() >= onlineSince &&
        agentMayTakeJob(agent, doc.buildingId, pointsWithAgent),
    ) ?? null;

  // Задание ставим в очередь даже без агента на связи: он может
  // подняться через минуту и допечатает. Но человеку об этом говорим
  // сразу — иначе он будет стоять у принтера и не понимать, чего ждёт.
  const job = await db.printJob.create({
    data: {
      organizationId,
      documentId: doc.id,
      buildingId: doc.buildingId,
      locale,
      docTitle: `${doc.template.name} — ${doc.title}`,
      createdById: session.user.id,
      createdByName: session.user.name ?? null,
    },
    select: { id: true },
  });

  return NextResponse.json({
    jobId: job.id,
    agentOnline: Boolean(online),
    agentName: online?.name ?? null,
  });
}
