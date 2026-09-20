import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { normalizeCleaningDocumentConfig } from "@/lib/cleaning-document";

/**
 * /api/journals/cleaning/default-config
 *
 * Управление шаблоном по умолчанию для журнала уборки. Когда менеджер
 * нажимает «Сохранить как шаблон» в журнале — сюда POST'ом приходит
 * текущий config (rooms, ответственные, scope-шаги, weekday-маски),
 * сохраняется в Organization.defaultCleaningDocumentConfig.
 *
 * Каждый новый JournalDocument для cleaning при создании сначала
 * смотрит в это поле и копирует rooms + responsibles из шаблона
 * (см. src/app/api/journal-documents/route.ts ~line 322).
 *
 *   GET    — вернуть текущий шаблон или null
 *   POST   — сохранить config из body как шаблон по умолчанию
 *   DELETE — очистить шаблон (вернёт fallback на встроенные blueprint'ы)
 *
 * Доступ: только management roles (manager/head_chef/owner) или ROOT.
 */

export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const row = await db.organization.findUnique({
    where: { id: getActiveOrgId(session) },
    select: { defaultCleaningDocumentConfig: true },
  });
  return NextResponse.json({ config: row?.defaultCleaningDocumentConfig ?? null });
}

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { config?: unknown }
    | null;
  if (!body || typeof body !== "object" || !body.config) {
    return NextResponse.json({ error: "Не передан config" }, { status: 400 });
  }

  // Прогоняем через нормализатор, чтобы не сохранить мусор в Json-колонку.
  const orgUsers = await db.user.findMany({
    where: { organizationId: getActiveOrgId(session), isActive: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  const orgAreas = await db.area.findMany({
    where: { organizationId: getActiveOrgId(session) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const normalized = normalizeCleaningDocumentConfig(body.config, {
    users: orgUsers,
    areas: orgAreas,
  });

  // Из normalized сохраняем только бизнес-данные, а matrix/marks/entries
  // НЕ сохраняем — они уникальны для каждого документа.
  const templateConfig = {
    title: normalized.title,
    documentTitle: normalized.documentTitle,
    settings: normalized.settings,
    autoFill: normalized.autoFill,
    rooms: normalized.rooms,
    responsiblePairs: normalized.responsiblePairs,
    cleaningResponsibles: normalized.cleaningResponsibles,
    controlResponsibles: normalized.controlResponsibles,
    legend: normalized.legend,
    schedule: normalized.schedule,
    procedure: normalized.procedure,
    responsiblePersons: normalized.responsiblePersons,
    periodicity: normalized.periodicity,
    ventilationEnabled: normalized.ventilationEnabled,
    skipWeekends: normalized.skipWeekends,
    cleaningMode: normalized.cleaningMode,
    selectedRoomIds: normalized.selectedRoomIds,
    selectedCleanerUserIds: normalized.selectedCleanerUserIds,
    roomsRaceMode: normalized.roomsRaceMode,
  };

  await db.organization.update({
    where: { id: getActiveOrgId(session) },
    data: { defaultCleaningDocumentConfig: templateConfig as object },
  });

  return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
}

export async function DELETE() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  await db.organization.update({
    where: { id: getActiveOrgId(session) },
    data: { defaultCleaningDocumentConfig: null as unknown as object },
  });
  return NextResponse.json({ ok: true });
}
