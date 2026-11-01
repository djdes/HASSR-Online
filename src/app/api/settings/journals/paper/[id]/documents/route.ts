import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { paperJournalById } from "@/lib/sphere-journal-rules";
import { buildJournalDocumentTitle } from "@/lib/journal-document-title";
import { loadBuildingContext } from "@/lib/active-building";
import { paperDocumentBuilding, paperDocumentsListWhere } from "@/lib/paper-journal-point";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Документы бумажного журнала: список и создание.
 *
 * Бумажный журнал ведётся так же, как электронный: заводим документ на
 * период с ответственным, заполняем, закрываем. Разница только в том,
 * что оригиналом остаётся распечатанный лист с живыми подписями — здесь
 * хранится подготовка к печати, чтобы не перезаполнять бланк каждый раз.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const { id } = await params;
  // Точки (2026-11-01): на точке — её документы и общие, на уровне
  // организации — все доступные человеку.
  const context = await loadBuildingContext(session);
  const documents = await db.paperJournalDocument.findMany({
    where: { organizationId: getActiveOrgId(session), journalId: id, ...paperDocumentsListWhere(context) },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      status: true,
      dateFrom: true,
      dateTo: true,
      responsible: true,
      closedAt: true,
      createdAt: true,
      updatedAt: true,
      buildingId: true,
      building: { select: { name: true } },
    },
  });

  return NextResponse.json({
    documents: documents.map(({ building, ...document }) => ({ ...document, buildingName: building?.name ?? null })),
  });
}

/** `YYYY-MM-DD` → Date (UTC-полночь); мусор → null. */
function parseIsoDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function text(value: unknown, max = 200): string | null {
  return typeof value === "string" ? value.trim().slice(0, max) || null : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const { id } = await params;
  const journal = paperJournalById(id);
  if (!journal) {
    return NextResponse.json({ error: "Журнал не найден" }, { status: 404 });
  }

  // Точки (2026-11-01): документ принадлежит точке из шапки, в режиме
  // «Вся организация» без офиса — сначала выбрать точку.
  const place = paperDocumentBuilding(await loadBuildingContext(session));
  if ("error" in place) {
    return NextResponse.json({ error: place.error }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  // Строки документа подставляет редактор при первом открытии — здесь
  // документ создаётся пустым, если клиент не прислал их сам.
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const dateFrom = parseIsoDay(body?.dateFrom);
  const dateTo = parseIsoDay(body?.dateTo);
  if (dateFrom && dateTo && dateTo < dateFrom) {
    return NextResponse.json(
      { error: "Дата окончания раньше даты начала" },
      { status: 400 },
    );
  }
  const title =
    text(body?.title) ??
    buildJournalDocumentTitle({
      journalName: journal.name,
      dateFrom: typeof body?.dateFrom === "string" ? body.dateFrom : null,
      dateTo: typeof body?.dateTo === "string" ? body.dateTo : null,
    });

  const document = await db.paperJournalDocument.create({
    data: {
      organizationId: getActiveOrgId(session),
      journalId: id,
      title,
      rows,
      dateFrom,
      dateTo,
      responsible: text(body?.responsible),
      responsibleUserId: text(body?.responsibleUserId, 64),
      verifier: text(body?.verifier),
      verifierUserId: text(body?.verifierUserId, 64),
      createdById: session.user.id,
      buildingId: place.buildingId,
    },
    select: { id: true, title: true, status: true },
  });

  return NextResponse.json({ document });
}
