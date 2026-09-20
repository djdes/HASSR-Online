import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { buildDateKeys } from "@/lib/hygiene-document";
import {
  UV_LAMP_RUNTIME_TEMPLATE_CODE,
  normalizeUvRuntimeDocumentConfig,
} from "@/lib/uv-lamp-runtime-document";
import { applyUvRuntimeAutoFill } from "@/lib/uv-lamp-runtime-autofill";
import { isManagementRole, pickPrimaryManager } from "@/lib/user-roles";
import { orgTodayKey } from "@/lib/timezone";

type UvRuntimeAction = "apply_auto_fill";

/**
 * POST /api/journal-documents/[id]/uv-runtime
 *
 * Единственное действие — `apply_auto_fill`: проставляет типовой сеанс
 * работы установки (время включения/выключения из спецификации) во все
 * пустые дни периода документа. Ручные замеры не перетираются.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  if (!isManagementRole(session.user.role)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as { action?: UvRuntimeAction };
  if (body.action !== "apply_auto_fill") {
    return NextResponse.json({ error: "Не указано действие" }, { status: 400 });
  }

  const document = await db.journalDocument.findUnique({
    where: { id },
    include: {
      template: true,
      entries: { orderBy: [{ date: "asc" }] },
    },
  });

  if (!document || document.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  if (document.template.code !== UV_LAMP_RUNTIME_TEMPLATE_CODE) {
    return NextResponse.json({ error: "Неверный тип документа" }, { status: 400 });
  }

  if (document.status === "closed") {
    return NextResponse.json(
      { error: "Закрытый документ нельзя изменять" },
      { status: 400 }
    );
  }

  const users = await db.user.findMany({
    where: { organizationId: getActiveOrgId(session), isActive: true },
    select: { id: true, role: true },
    orderBy: [{ role: "asc" }, { id: "asc" }],
  });

  const responsibleUserId =
    document.responsibleUserId || pickPrimaryManager(users)?.id;

  if (!responsibleUserId) {
    return NextResponse.json(
      { error: "Нет активного сотрудника для автозаполнения" },
      { status: 400 }
    );
  }

  const config = normalizeUvRuntimeDocumentConfig(document.config);

  // Автозаполнение не должно «отработать» за будущие дни: установка ещё
  // не включалась. Обрезаем период по сегодняшней дате организации.
  const organization = await db.organization.findUnique({
    where: { id: getActiveOrgId(session) },
    select: { timezone: true },
  });
  const todayKey = orgTodayKey(organization?.timezone ?? "Europe/Moscow");
  const dateKeys = buildDateKeys(document.dateFrom, document.dateTo).filter(
    (dateKey) => dateKey <= todayKey
  );

  const result = await applyUvRuntimeAutoFill(db, {
    documentId: document.id,
    spec: config.spec,
    responsibleUserId,
    dateKeys,
    entries: document.entries,
  });

  return NextResponse.json(result);
}
