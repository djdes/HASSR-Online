import { db } from "@/lib/db";
import { normalizeSphere, type OrgSphere } from "@/lib/org-profile";
import {
  computeDocumentsPhase,
  type DocumentsPhaseStatus,
} from "@/lib/onboarding-documents";

/**
 * Состояние начальной настройки организации — три этапа быстрого старта,
 * документы журналов и фаза «Документы» (приказы и чек-листы).
 *
 * ПОЧЕМУ отдельный модуль. Раньше это считалось в двух местах и по разным
 * правилам: страница `/settings/onboarding` строила свои три этапа, а
 * карточка «Начальная настройка» на дашборде — свой чек-лист из
 * шестнадцати пунктов, включая продукты, пайплайны и Telegram. Они даже
 * помещения считали по разным моделям: онбординг по `Building`/`Room`,
 * карточка по `Area`. В результате владелец видел три «ГОТОВО» на одной
 * странице и «71%, завершите настройку» на другой — и не понимал, кому
 * верить.
 *
 * Теперь условие одно. Всё остальное, что раньше держало карточку на
 * дашборде (продукты, оборудование сверх минимума, пайплайны, чек-листы,
 * TasksFlow, Telegram, автосоздание, расписание), живёт на
 * `/settings/onboarding/advanced` — это тонкая настройка, и звать в неё
 * с главной каждый день незачем.
 */

export type CoreItemState = "complete" | "partial" | "empty";

export type CoreSetupStatus = {
  buildings: { buildingsCount: number; roomsCount: number; state: CoreItemState };
  equipment: { count: number; state: CoreItemState };
  positions: { count: number; state: CoreItemState };
  users: { count: number; state: CoreItemState };
  journals: { enabledCount: number; state: CoreItemState };
  /** Активных `JournalDocument` — то, во что реально вносят записи. */
  activeDocumentsCount: number;
  /** Все три этапа (объект / команда / журналы) закрыты. */
  coreComplete: boolean;
  sphere: OrgSphere;
  /**
   * Фаза «Документы»: обязательные приказы сферы оформлены
   * (`ordersDone`) и чек-листы отмечены проверенными (`checklistsDone`).
   */
  documents: DocumentsPhaseStatus;
  /**
   * Настройка закончена: этапы пройдены, документы журналов созданы,
   * приказы оформлены и чек-листы проверены. Ровно по этому признаку
   * карточка уходит с дашборда. У существующих организаций без приказов
   * карточка вернётся — это намеренно: к проверке без приказов не готов.
   */
  setupFinished: boolean;
};

export async function getCoreSetupStatus(
  organizationId: string,
): Promise<CoreSetupStatus> {
  const [
    org,
    positionsCount,
    activeUsersCount,
    buildingsCount,
    roomsCount,
    equipmentCount,
    activeTemplates,
    activeDocumentsCount,
    issuedOrders,
  ] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: {
        disabledJournalCodes: true,
        type: true,
        checklistsReviewedAt: true,
      },
    }),
    db.jobPosition.count({ where: { organizationId } }),
    db.user.count({
      where: { organizationId, isActive: true, archivedAt: null },
    }),
    db.building.count({ where: { organizationId } }),
    db.room.count({ where: { building: { organizationId } } }),
    db.equipment.count({ where: { area: { organizationId } } }),
    db.journalTemplate.findMany({
      where: { isActive: true },
      select: { code: true },
    }),
    db.journalDocument.count({
      where: { organizationId, status: "active" },
    }),
    db.companyOrder.findMany({
      where: { organizationId },
      select: { templateCode: true },
      distinct: ["templateCode"],
    }),
  ]);

  const disabledCodes = new Set<string>(
    Array.isArray(org?.disabledJournalCodes)
      ? (org.disabledJournalCodes as string[])
      : [],
  );
  const enabledCount = activeTemplates.filter(
    (t) => !disabledCodes.has(t.code),
  ).length;

  const buildings = {
    buildingsCount,
    roomsCount,
    state: (buildingsCount === 0
      ? "empty"
      : roomsCount === 0
        ? "partial"
        : "complete") as CoreItemState,
  };
  const equipment = {
    count: equipmentCount,
    state: (equipmentCount === 0 ? "empty" : "complete") as CoreItemState,
  };
  const positions = {
    count: positionsCount,
    state: (positionsCount === 0 ? "empty" : "complete") as CoreItemState,
  };
  // Меньше двух — работать некому, два-три — уже можно, но график смен
  // не построить. Пороги те же, что были на странице онбординга.
  const users = {
    count: activeUsersCount,
    state: (activeUsersCount < 2
      ? "empty"
      : activeUsersCount < 4
        ? "partial"
        : "complete") as CoreItemState,
  };
  // Достаточно одного включённого журнала. Раньше здесь стояло «меньше
  // пяти — жёлтый», и у ресторана с четырьмя обязательными журналами шаг
  // не закрывался никогда.
  const journals = {
    enabledCount,
    state: (enabledCount === 0 ? "empty" : "complete") as CoreItemState,
  };

  const coreComplete =
    buildings.state === "complete" &&
    equipment.state === "complete" &&
    positions.state === "complete" &&
    users.state === "complete" &&
    journals.state === "complete";

  const sphere = normalizeSphere(org?.type);
  const documents = computeDocumentsPhase({
    sphere,
    issuedOrderCodes: issuedOrders.map((order) => order.templateCode),
    checklistsReviewedAt: org?.checklistsReviewedAt ?? null,
  });

  return {
    buildings,
    equipment,
    positions,
    users,
    journals,
    activeDocumentsCount,
    coreComplete,
    sphere,
    documents,
    setupFinished:
      coreComplete && activeDocumentsCount >= 1 && documents.done,
  };
}
