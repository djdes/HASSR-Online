import { rulesFor } from "@/lib/sphere-journal-rules";
import type { OrgSphere } from "@/lib/org-profile";

/**
 * Фаза «Документы» начальной настройки: приказы и чек-листы.
 *
 * Чистая функция без обращения к базе — её считают и страница
 * `/settings/onboarding`, и карточка на дашборде (через
 * `getCoreSetupStatus`), и тесты. Правило одно: обязательные приказы
 * сферы оформлены все, а чек-листы руководитель хотя бы раз просмотрел
 * и отметил «Чек-листы проверены».
 */

export type DocumentsPhaseInput = {
  sphere: OrgSphere;
  /** `templateCode` всех приказов организации (повторы допустимы). */
  issuedOrderCodes: Iterable<string>;
  checklistsReviewedAt: Date | null;
};

export type DocumentsPhaseStatus = {
  /** Коды обязательных приказов сферы — в порядке правил. */
  ordersRequired: string[];
  /** Сколько из обязательных уже оформлено. */
  ordersIssuedCount: number;
  ordersDone: boolean;
  checklistsDone: boolean;
  /** Обе части закрыты — фаза пройдена. */
  done: boolean;
};

export function computeDocumentsPhase(
  input: DocumentsPhaseInput,
): DocumentsPhaseStatus {
  const ordersRequired = [...rulesFor(input.sphere).ordersRequired];
  const issued = new Set(input.issuedOrderCodes);
  const ordersIssuedCount = ordersRequired.filter((code) =>
    issued.has(code),
  ).length;
  const ordersDone = ordersIssuedCount === ordersRequired.length;
  const checklistsDone = input.checklistsReviewedAt !== null;
  return {
    ordersRequired,
    ordersIssuedCount,
    ordersDone,
    checklistsDone,
    done: ordersDone && checklistsDone,
  };
}

/**
 * Журналы, для которых фаза «Документы» предлагает чек-лист: из
 * `checklistJournals` сферы — только включённые у организации. Выключенный
 * журнал никто не заполняет, и настраивать ему чек-лист незачем.
 */
export function checklistJournalsForOrg(
  sphere: OrgSphere,
  enabledCodes: ReadonlySet<string>,
): string[] {
  return rulesFor(sphere).checklistJournals.filter((code) =>
    enabledCodes.has(code),
  );
}
