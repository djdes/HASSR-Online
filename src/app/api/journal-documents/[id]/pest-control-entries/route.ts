import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";
import { canWriteJournal } from "@/lib/journal-acl";

const PEST_CONTROL_TEMPLATE_CODE = "pest_control";

function aclActorFromSession(session: {
  user: { id: string; role: string; isRoot?: boolean };
}) {
  return {
    id: session.user.id,
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  };
}

function buildStoredDate(
  performedDate: string,
  hour: string | null | undefined,
  minute: string | null | undefined,
  timeSpecified: boolean,
  seconds: number
) {
  const date = new Date(`${performedDate}T00:00:00.000Z`);
  const safeHour = timeSpecified ? Number(hour ?? 0) : 0;
  const safeMinute = timeSpecified ? Number(minute ?? 0) : 0;
  date.setUTCHours(
    Number.isFinite(safeHour) ? safeHour : 0,
    Number.isFinite(safeMinute) ? safeMinute : 0,
    seconds,
    0
  );
  return date;
}

async function getAuthorizedDocument(documentId: string, organizationId: string) {
  const document = await db.journalDocument.findUnique({
    where: { id: documentId },
    include: { template: true },
  });

  if (!document || document.organizationId !== organizationId) {
    return null;
  }

  if (document.template.code !== "pest_control") {
    return "wrong_template" as const;
  }

  return document;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { id: documentId } = await params;
  const document = await getAuthorizedDocument(
    documentId,
    getActiveOrgId(session)
  );

  if (document === null) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  if (document === "wrong_template") {
    return NextResponse.json({ error: "Неверный тип документа" }, { status: 400 });
  }

  if (document.status === "closed") {
    return NextResponse.json({ error: "Документ закрыт" }, { status: 400 });
  }

  if (!(await canWriteJournal(aclActorFromSession(session), PEST_CONTROL_TEMPLATE_CODE))) {
    return NextResponse.json({ error: "Нет доступа к этому журналу" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        performedDate?: string;
        performedHour?: string | null;
        performedMinute?: string | null;
        timeSpecified?: boolean;
        event?: string;
        areaOrVolume?: string;
        treatmentProduct?: string;
        note?: string;
        performedBy?: string;
        acceptedRole?: string;
        acceptedEmployeeId?: string;
      }
    | null;

  if (!body?.performedDate || !body.acceptedEmployeeId) {
    return NextResponse.json(
      { error: "performedDate и acceptedEmployeeId обязательны" },
      { status: 400 }
    );
  }

  const employee = await db.user.findFirst({
    where: {
      id: body.acceptedEmployeeId,
      organizationId: getActiveOrgId(session),
      isActive: true,
    },
    select: { id: true },
  });

  if (!employee) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  const seconds = Math.floor(Math.random() * 60);
  const storedDate = buildStoredDate(
    body.performedDate,
    body.performedHour,
    body.performedMinute,
    body.timeSpecified === true,
    seconds
  );

  try {
    const entry = await db.journalDocumentEntry.create({
      data: {
        documentId,
        employeeId: employee.id,
        date: storedDate,
        data: {
          performedDate: body.performedDate,
          performedHour: body.performedHour ?? "",
          performedMinute: body.performedMinute ?? "",
          timeSpecified: body.timeSpecified === true,
          event: body.event ?? "",
          areaOrVolume: body.areaOrVolume ?? "",
          treatmentProduct: body.treatmentProduct ?? "",
          note: body.note ?? "",
          performedBy: body.performedBy ?? "",
          acceptedRole: body.acceptedRole ?? "",
          acceptedEmployeeId: employee.id,
        },
      },
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Строка с таким сотрудником, датой и временем уже существует" },
        { status: 409 }
      );
    }

    throw error;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { id: documentId } = await params;
  const document = await getAuthorizedDocument(
    documentId,
    getActiveOrgId(session)
  );

  if (document === null) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  if (document === "wrong_template") {
    return NextResponse.json({ error: "Неверный тип документа" }, { status: 400 });
  }

  if (document.status === "closed") {
    return NextResponse.json({ error: "Документ закрыт" }, { status: 400 });
  }

  if (!(await canWriteJournal(aclActorFromSession(session), PEST_CONTROL_TEMPLATE_CODE))) {
    return NextResponse.json({ error: "Нет доступа к этому журналу" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        id?: string;
        performedDate?: string;
        performedHour?: string | null;
        performedMinute?: string | null;
        timeSpecified?: boolean;
        event?: string;
        areaOrVolume?: string;
        treatmentProduct?: string;
        note?: string;
        performedBy?: string;
        acceptedRole?: string;
        acceptedEmployeeId?: string;
      }
    | null;

  if (!body?.id || !body.performedDate || !body.acceptedEmployeeId) {
    return NextResponse.json(
      { error: "id, performedDate и acceptedEmployeeId обязательны" },
      { status: 400 }
    );
  }

  const existingEntry = await db.journalDocumentEntry.findFirst({
    where: {
      id: body.id,
      documentId,
    },
  });

  if (!existingEntry) {
    return NextResponse.json({ error: "Строка не найдена" }, { status: 404 });
  }

  const employee = await db.user.findFirst({
    where: {
      id: body.acceptedEmployeeId,
      organizationId: getActiveOrgId(session),
      isActive: true,
    },
    select: { id: true },
  });

  if (!employee) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  const storedDate = buildStoredDate(
    body.performedDate,
    body.performedHour,
    body.performedMinute,
    body.timeSpecified === true,
    existingEntry.date.getUTCSeconds()
  );

  try {
    const entry = await db.journalDocumentEntry.update({
      where: { id: existingEntry.id },
      data: {
        employeeId: employee.id,
        date: storedDate,
        data: {
          performedDate: body.performedDate,
          performedHour: body.performedHour ?? "",
          performedMinute: body.performedMinute ?? "",
          timeSpecified: body.timeSpecified === true,
          event: body.event ?? "",
          areaOrVolume: body.areaOrVolume ?? "",
          treatmentProduct: body.treatmentProduct ?? "",
          note: body.note ?? "",
          performedBy: body.performedBy ?? "",
          acceptedRole: body.acceptedRole ?? "",
          acceptedEmployeeId: employee.id,
        },
      },
    });

    return NextResponse.json({ entry });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Строка с таким сотрудником, датой и временем уже существует" },
        { status: 409 }
      );
    }

    throw error;
  }
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

  const { id: documentId } = await params;
  const document = await getAuthorizedDocument(
    documentId,
    getActiveOrgId(session)
  );

  if (document === null) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  if (document === "wrong_template") {
    return NextResponse.json({ error: "Неверный тип документа" }, { status: 400 });
  }

  if (document.status === "closed") {
    return NextResponse.json({ error: "Документ закрыт" }, { status: 400 });
  }

  if (!(await canWriteJournal(aclActorFromSession(session), PEST_CONTROL_TEMPLATE_CODE))) {
    return NextResponse.json({ error: "Нет доступа к этому журналу" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { ids?: string[] } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "Нужно передать ids" }, { status: 400 });
  }

  const result = await db.journalDocumentEntry.deleteMany({
    where: {
      documentId,
      id: { in: ids },
    },
  });

  return NextResponse.json({ deleted: result.count });
}
