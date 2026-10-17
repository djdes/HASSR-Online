import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  normalizeFryerOilDocumentConfig,
  normalizeFryerOilEntryData,
  FRYER_OIL_TEMPLATE_CODE,
} from "@/lib/fryer-oil-document";
import { withFryerSource } from "@/lib/fryer-oil-equipment-link";
import { MAX_BATCH_ITEMS, isValidDate, reserveUniqueDates } from "@/lib/fryer-oil-entries";
import { getServerSession } from "@/lib/server-session";
import { canWriteJournal } from "@/lib/journal-acl";

async function resolveEmployeeId(
  sessionUserId: string,
  organizationId: string
): Promise<string | null> {
  // Прежде всего — текущий юзер. Раньше API всегда выбирал
  // alphabetically-first сотрудника, и записи приписывались
  // не тому, кто реально менял масло. Теперь — сам автор
  // как employee.
  const me = await db.user.findFirst({
    where: { id: sessionUserId, organizationId, isActive: true },
    select: { id: true },
  });
  if (me) return me.id;
  // ROOT-impersonation fallback: ROOT (organizationId="platform")
  // не относится к импер-org-е, поэтому ставим первого активного
  // сотрудника, чтобы запись жила.
  const fallback = await db.user.findFirst({
    where: { organizationId, isActive: true },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  return fallback?.id ?? null;
}

async function getDocument(documentId: string, organizationId: string) {
  return db.journalDocument.findFirst({
    where: { id: documentId, organizationId },
    include: { template: { select: { code: true } } },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const orgId = getActiveOrgId(session);
  const document = await getDocument(documentId, orgId);
  if (!document || document.template?.code !== FRYER_OIL_TEMPLATE_CODE) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  if (document.status === "closed") {
    return NextResponse.json({ error: "Документ закрыт" }, { status: 400 });
  }
  const aclActor = {
    id: session.user.id,
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  };
  if (!(await canWriteJournal(aclActor, FRYER_OIL_TEMPLATE_CODE))) {
    return NextResponse.json({ error: "Нет доступа к этому журналу" }, { status: 403 });
  }

  // Две формы тела. `items` — пачка строк за один день (несколько
  // фритюрниц), `data` — одна строка. Старая форма осталась рабочей:
  // на неё завязаны прежние вызовы клиента.
  const body = (await request.json().catch(() => null)) as
    | { data?: unknown; items?: unknown }
    | null;
  const rawItems = Array.isArray(body?.items) ? body.items : [body?.data];
  if (rawItems.length === 0) {
    return NextResponse.json({ error: "Нет записей для сохранения" }, { status: 400 });
  }
  if (rawItems.length > MAX_BATCH_ITEMS) {
    return NextResponse.json(
      { error: `За один раз можно создать не больше ${MAX_BATCH_ITEMS} записей` },
      { status: 400 }
    );
  }
  // Строка помнит фритюрницу справочника по имени из списка документа.
  const links = normalizeFryerOilDocumentConfig(document.config).equipmentLinks;
  const items = rawItems.map((item) => withFryerSource(normalizeFryerOilEntryData(item), links));
  const employeeId = await resolveEmployeeId(session.user.id, orgId);
  if (!employeeId) {
    return NextResponse.json({ error: "Нет активных сотрудников для создания записи" }, { status: 400 });
  }

  const dates = await reserveUniqueDates(documentId, employeeId, items);
  if (dates.some((date) => !isValidDate(date))) {
    return NextResponse.json({ error: "Некорректная дата записи" }, { status: 400 });
  }

  // Транзакцией: полусохранённый день хуже несохранённого — человек не
  // поймёт, какие фритюрницы уже записаны, а какие нет.
  const entries = await db.$transaction(
    items.map((data, index) =>
      db.journalDocumentEntry.create({
        data: { documentId, employeeId, date: dates[index], data },
      })
    )
  );

  // `entry` — для прежних вызовов, которые ждут одну запись.
  return NextResponse.json({ entries, entry: entries[0] });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const document = await getDocument(documentId, getActiveOrgId(session));
  if (!document || document.template?.code !== FRYER_OIL_TEMPLATE_CODE) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  if (document.status === "closed") {
    return NextResponse.json({ error: "Документ закрыт" }, { status: 400 });
  }
  const aclActor = {
    id: session.user.id,
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  };
  if (!(await canWriteJournal(aclActor, FRYER_OIL_TEMPLATE_CODE))) {
    return NextResponse.json({ error: "Нет доступа к этому журналу" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { id?: string; data?: unknown } | null;
  if (!body?.id) return NextResponse.json({ error: "Не указан идентификатор записи" }, { status: 400 });

  const current = await db.journalDocumentEntry.findFirst({
    where: { id: body.id, documentId },
    select: { id: true, employeeId: true },
  });
  if (!current) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });

  const data = withFryerSource(
    normalizeFryerOilEntryData(body.data),
    normalizeFryerOilDocumentConfig(document.config).equipmentLinks
  );
  const [date] = await reserveUniqueDates(
    documentId,
    current.employeeId,
    [data],
    current.id
  );
  if (!isValidDate(date)) {
    return NextResponse.json({ error: "Некорректная дата записи" }, { status: 400 });
  }
  const entry = await db.journalDocumentEntry.update({
    where: { id: current.id },
    data: { date, data },
  });

  return NextResponse.json({ entry });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const document = await getDocument(documentId, getActiveOrgId(session));
  if (!document || document.template?.code !== FRYER_OIL_TEMPLATE_CODE) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  if (document.status === "closed") {
    return NextResponse.json({ error: "Документ закрыт" }, { status: 400 });
  }
  // Удаление только при canWrite — read-only доступ не должен пускать
  // через DELETE.
  const aclActor = {
    id: session.user.id,
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  };
  if (!(await canWriteJournal(aclActor, FRYER_OIL_TEMPLATE_CODE))) {
    return NextResponse.json({ error: "Нет доступа к этому журналу" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: "Нужно передать ids" }, { status: 400 });
  }

  const result = await db.journalDocumentEntry.deleteMany({
    where: { documentId, id: { in: body.ids } },
  });

  return NextResponse.json({ deleted: result.count });
}
