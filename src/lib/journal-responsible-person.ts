import { db } from "@/lib/db";
import { getPrimarySlotId } from "@/lib/journal-responsible-schemas";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { getUserDisplayTitle } from "@/lib/user-roles";
import { buildingWhere } from "@/lib/building-scope";
import { effectiveJournalSlots } from "@/lib/journal-responsibles-points";

/**
 * Кто отвечает за журнал — чтобы сотрудник у QR-кода знал, к кому идти,
 * когда журнал не настроен (нет оборудования, нет документа, пустой
 * документ). Раньше экран говорил «попросите руководителя», и никто не
 * понимал, кого именно.
 *
 * Порядок поиска:
 *   1. ответственный документа, из которого пришёл скан;
 *   2. ответственный активного сегодня документа;
 *   3. главный слот журнала в «Ответственных за журналы» — точки
 *      документа, если у неё свои (2026-10-31);
 *   4. ответственный последнего документа журнала.
 * Только активные сотрудники этой организации. Никого — «руководитель».
 */

export type JournalResponsiblePerson = { id: string; name: string; positionTitle: string | null };

/** «Иванова Мария, заведующая» / «руководитель». */
export function formatResponsiblePerson(person: { name: string; positionTitle: string | null } | null): string {
  if (!person) return "руководитель";
  const name = person.name.trim();
  const title = (person.positionTitle ?? "").trim();
  if (!title) return name;
  // «Заведующая» → «заведующая», но аббревиатуры («ИП», «ПТО») не трогаем.
  const lowered = title.length > 1 && title[1] === title[1].toLowerCase() ? title[0].toLowerCase() + title.slice(1) : title;
  return `${name}, ${lowered}`;
}

export async function findJournalResponsiblePerson(params: {
  organizationId: string;
  templateCode: string;
  todayKey: string;
  documentId?: string | null;
}): Promise<JournalResponsiblePerson | null> {
  const { organizationId, templateCode } = params;
  const day = new Date(`${params.todayKey}T00:00:00.000Z`);
  const templateWhere = { organizationId, template: { code: templateCode } };
  const tokenDoc = params.documentId
    ? await db.journalDocument.findFirst({ where: { ...templateWhere, id: params.documentId }, select: { responsibleUserId: true, buildingId: true } })
    : null;
  // Точка документа скана: её документы и её ответственные, не другой точки.
  const pointId = tokenDoc?.buildingId ?? null;
  const [activeDoc, slots, latestDoc] = await Promise.all([
    db.journalDocument.findFirst({
      where: { ...templateWhere, ...buildingWhere(pointId), status: "active", dateFrom: { lte: day }, dateTo: { gte: day }, responsibleUserId: { not: null } },
      orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
      select: { responsibleUserId: true },
    }),
    effectiveJournalSlots(organizationId, pointId, templateCode),
    db.journalDocument.findFirst({
      where: { ...templateWhere, ...buildingWhere(pointId), responsibleUserId: { not: null } },
      orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
      select: { responsibleUserId: true },
    }),
  ]);
  const order = [
    tokenDoc?.responsibleUserId ?? null,
    activeDoc?.responsibleUserId ?? null,
    slots[getPrimarySlotId(templateCode)] ?? null,
    latestDoc?.responsibleUserId ?? null,
  ].filter((id): id is string => Boolean(id));
  if (order.length === 0) return null;
  const users = await db.user.findMany({
    where: { id: { in: Array.from(new Set(order)) }, organizationId, ...ORG_ROSTER_WHERE },
    select: { id: true, name: true, role: true, positionTitle: true, jobPosition: { select: { name: true } } },
  });
  for (const id of order) {
    const user = users.find((item) => item.id === id);
    if (user) return { id: user.id, name: user.name, positionTitle: getUserDisplayTitle(user) || null };
  }
  return null;
}

/** Готовая подпись для экрана QR: «Иванова Мария, заведующая» или «руководитель». */
export async function journalResponsibleLabel(params: Parameters<typeof findJournalResponsiblePerson>[0]): Promise<string> {
  const person = await findJournalResponsiblePerson(params).catch((error) => {
    console.warn("[journal-responsible-person] lookup failed", error);
    return null;
  });
  return formatResponsiblePerson(person);
}
