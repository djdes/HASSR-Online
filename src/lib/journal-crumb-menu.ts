import { cache } from "react";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { aclActorFromSession, getAllowedJournalCodes } from "@/lib/journal-acl";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { getTemplatesFilledToday } from "@/lib/today-compliance";
import { getActiveBuildingId } from "@/lib/active-building";
import { buildingWhere } from "@/lib/building-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  JOURNAL_SWITCHER_SHOW_ALL_HREF,
  buildJournalSwitcherMenu,
  type CrumbMenuItem,
  type JournalSwitcherMenu,
} from "@/lib/crumb-menu";

export type { JournalSwitcherMenu } from "@/lib/crumb-menu";

/**
 * Содержимое выпадающих списков в хлебных крошках раздела журналов.
 *
 * Крошка «журнал» раскрывается в набор журналов организации, крошка
 * «документ» — в документы этого журнала. Смысл: за смену человек обходит
 * несколько журналов подряд, и переход «журнал → журнал» не должен стоить
 * возврата в список и обратно.
 *
 * В списке — только ВКЛЮЧЁННЫЕ журналы, с учётом ACL сотрудника: это
 * рабочий набор организации. Выключенные раньше висели у руководителя
 * серыми строками посреди списка и мешали искать нужный; теперь весь
 * набор — по «Показать все» (страница руководителя), а поиск, совпавший
 * с выключенным журналом, объясняет, почему его нет.
 *
 * `cache` — на один серверный рендер: страница документа спрашивает и
 * список журналов, и список документов, а её ветки могут спросить дважды.
 */

/** Набор журналов организации со статусом «заполнен сегодня». */
export const getJournalCrumbMenu = cache(
  async (session: Session, currentCode?: string): Promise<JournalSwitcherMenu> => {
    const organizationId = getActiveOrgId(session);
    const isManager = hasFullWorkspaceAccess(session.user);
    const allowedCodes = await getAllowedJournalCodes(
      aclActorFromSession(session),
    );

    const [templates, organization] = await Promise.all([
      db.journalTemplate.findMany({
        where: {
          isActive: true,
          ...(allowedCodes ? { code: { in: allowedCodes } } : {}),
        },
        orderBy: { sortOrder: "asc" },
        select: { id: true, code: true, name: true },
      }),
      db.organization.findUnique({
        where: { id: organizationId },
        select: { disabledJournalCodes: true },
      }),
    ]);

    const disabledCodes = parseDisabledCodes(organization?.disabledJournalCodes);
    const enabled = templates.filter((t) => !disabledCodes.has(t.code));

    const filledTemplateIds = await getTemplatesFilledToday(
      organizationId,
      new Date(),
      enabled.map((t) => ({ id: t.id, code: t.code })),
      disabledCodes,
      { buildingId: await getActiveBuildingId(session) },
    );

    return buildJournalSwitcherMenu({
      templates,
      disabledCodes,
      filledTemplateIds,
      currentCode,
      showAllHref: isManager ? JOURNAL_SWITCHER_SHOW_ALL_HREF : null,
    });
  },
);

/** Сколько документов журнала показываем в списке крошки. */
const DOCUMENT_MENU_LIMIT = 40;

/**
 * Документы одного журнала, свежие сверху. Точка показывает, открыт
 * документ или закрыт: закрытый заполнять уже нельзя, и это первое, что
 * нужно знать при выборе.
 */
export const getDocumentCrumbMenu = cache(
  async (
    organizationId: string,
    templateCode: string,
    currentDocumentId?: string,
    /** Точка: документы активной точки и общие; null — все. */
    buildingId: string | null = null,
  ): Promise<CrumbMenuItem[]> => {
    const documents = await db.journalDocument.findMany({
      where: {
        organizationId,
        template: { code: templateCode },
        ...buildingWhere(buildingId),
      },
      orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
      take: DOCUMENT_MENU_LIMIT,
      select: {
        id: true,
        title: true,
        status: true,
        dateFrom: true,
        building: { select: { name: true } },
      },
    });

    return documents.map((doc) => ({
      label: doc.title,
      href: `/journals/${templateCode}/documents/${doc.id}`,
      status: doc.status === "active" ? ("ok" as const) : ("muted" as const),
      hint: doc.building
        ? `${doc.building.name} · ${formatPeriodStart(doc.dateFrom)}`
        : buildingId
          ? `Общий · ${formatPeriodStart(doc.dateFrom)}`
          : formatPeriodStart(doc.dateFrom),
      current: doc.id === currentDocumentId,
    }));
  },
);

/** «сен 2026» — период документа одной короткой подписью справа. */
function formatPeriodStart(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    month: "short",
    year: "numeric",
  }).format(date);
}
