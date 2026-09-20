import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  EQUIPMENT_CLEANING_TEMPLATE_CODE,
  getEquipmentCleaningEntryDateBounds,
  normalizeEquipmentCleaningRowData,
} from "@/lib/equipment-cleaning-document";
import { isManagementRole } from "@/lib/user-roles";
import { canWriteJournal } from "@/lib/journal-acl";
import { orgTodayKey } from "@/lib/timezone";

function aclActorFromSession(session: {
  user: { id: string; role: string; isRoot?: boolean };
}) {
  return {
    id: session.user.id,
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  };
}

async function loadDocument(id: string, organizationId: string) {
  const document = await db.journalDocument.findUnique({
    where: { id },
    include: { template: true },
  });

  if (!document || document.organizationId !== organizationId) {
    return null;
  }

  if (document.template.code !== EQUIPMENT_CLEANING_TEMPLATE_CODE) {
    throw new Error("WRONG_TEMPLATE");
  }

  return document;
}

function normalizeEntry(entry: {
  id: string;
  data: unknown;
}) {
  return {
    id: entry.id,
    data: normalizeEquipmentCleaningRowData(entry.data),
  };
}

/**
 * Дата мойки: с начала года документа по сегодня (пояс организации).
 * Проверка общая для POST и PATCH — раньше PATCH не проверял дату вовсе
 * и через правку строки в журнал заезжало будущее.
 */
async function checkWashDate(
  washDate: string,
  documentDateFrom: Date,
  organizationId: string
) {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const todayKey = orgTodayKey(organization?.timezone ?? "Europe/Moscow");
  const { min, max } = getEquipmentCleaningEntryDateBounds(
    documentDateFrom.toISOString().slice(0, 10),
    todayKey
  );
  if (washDate > max) {
    return NextResponse.json(
      { error: "Дата мойки не может быть в будущем" },
      { status: 400 }
    );
  }
  if (washDate < min) {
    return NextResponse.json(
      { error: `Дата мойки не может быть раньше ${min.split("-").reverse().join(".")}` },
      { status: 400 }
    );
  }
  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { id } = await params;
  const document = await loadDocument(id, getActiveOrgId(session));
  if (!document) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  if (document.status === "closed") {
    return NextResponse.json({ error: "Документ закрыт" }, { status: 400 });
  }
  if (!(await canWriteJournal(aclActorFromSession(session), EQUIPMENT_CLEANING_TEMPLATE_CODE))) {
    return NextResponse.json({ error: "Нет доступа к этому журналу" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    data?: unknown;
  };
  const data = normalizeEquipmentCleaningRowData(body.data);

  // Пустую строку не сохраняем: раньше «Добавить» плодило пустые записи.
  if (!data.equipmentName.trim()) {
    return NextResponse.json(
      { error: "Укажите наименование оборудования" },
      { status: 400 }
    );
  }
  if (!data.washDate) {
    return NextResponse.json({ error: "Укажите дату мойки" }, { status: 400 });
  }

  const dateError = await checkWashDate(
    data.washDate,
    document.dateFrom,
    getActiveOrgId(session)
  );
  if (dateError) return dateError;

  const employeeId =
    data.washerUserId || data.controllerUserId || document.createdById || null;
  if (!employeeId) {
    return NextResponse.json({ error: "Не выбран сотрудник" }, { status: 400 });
  }

  const employee = await db.user.findFirst({
    where: {
      id: employeeId,
      organizationId: getActiveOrgId(session),
    },
    select: { id: true },
  });
  if (!employee) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  const entryDate = new Date(`${data.washDate}T${data.washTime}:00`);

  const entry = await db.journalDocumentEntry.create({
    data: {
      documentId: document.id,
      employeeId,
      date: entryDate,
      data,
    },
    select: {
      id: true,
      data: true,
    },
  });

  return NextResponse.json({ entry: normalizeEntry(entry) });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { id } = await params;
  const document = await loadDocument(id, getActiveOrgId(session));
  if (!document) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  if (document.status === "closed") {
    return NextResponse.json({ error: "Документ закрыт" }, { status: 400 });
  }
  if (!(await canWriteJournal(aclActorFromSession(session), EQUIPMENT_CLEANING_TEMPLATE_CODE))) {
    return NextResponse.json({ error: "Нет доступа к этому журналу" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    data?: unknown;
  };
  if (!body.id) {
    return NextResponse.json({ error: "Не указан идентификатор строки" }, { status: 400 });
  }

  const currentEntry = await db.journalDocumentEntry.findFirst({
    where: {
      id: body.id,
      documentId: document.id,
    },
    select: { id: true },
  });
  if (!currentEntry) {
    return NextResponse.json({ error: "Строка не найдена" }, { status: 404 });
  }

  const data = normalizeEquipmentCleaningRowData(body.data);
  if (!data.washDate) {
    return NextResponse.json({ error: "Укажите дату мойки" }, { status: 400 });
  }
  const dateError = await checkWashDate(
    data.washDate,
    document.dateFrom,
    getActiveOrgId(session)
  );
  if (dateError) return dateError;

  const employeeId =
    data.washerUserId || data.controllerUserId || document.createdById || null;
  if (!employeeId) {
    return NextResponse.json({ error: "Не выбран сотрудник" }, { status: 400 });
  }

  const entry = await db.journalDocumentEntry.update({
    where: { id: currentEntry.id },
    data: {
      employeeId,
      date: new Date(`${data.washDate}T${data.washTime}:00`),
      data,
    },
    select: {
      id: true,
      data: true,
    },
  });

  return NextResponse.json({ entry: normalizeEntry(entry) });
}

export async function DELETE(
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
  const document = await loadDocument(id, getActiveOrgId(session));
  if (!document) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  if (document.status === "closed") {
    return NextResponse.json({ error: "Документ закрыт" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    ids?: string[];
  };
  const ids = Array.isArray(body.ids) ? body.ids : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "Не переданы строки для удаления" }, { status: 400 });
  }

  const result = await db.journalDocumentEntry.deleteMany({
    where: {
      documentId: document.id,
      id: {
        in: ids,
      },
    },
  });

  return NextResponse.json({ deleted: result.count });
}
