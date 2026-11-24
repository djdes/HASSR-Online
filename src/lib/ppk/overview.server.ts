import { db } from "@/lib/db";
import { effectiveObjectCategory } from "@/lib/object-categories";
import { orgTodayKey } from "@/lib/timezone";
import { ppkReviewState, revisionItems } from "./overview-view";
import { addMonths, latestDocVersion } from "./review";
import { loadDocVersions } from "./review.server";
import { revisionDocKey } from "./revisions";
import { loadRevisionStates } from "./revisions.server";
import type { PpkScope } from "./scope";
import { isStarterSphere, type StarterSphere } from "./starter-packs";
import type { PpkItemId } from "./structure";

/**
 * Данные обзора ППК (2026-11-24): сфера объекта для «Заполнить типовыми» и
 * сигналы нового вида — номера редакций документов пунктов и срок
 * пересмотра программы.
 */

/** Сфера «Заполнить типовыми» по умолчанию: сфера объекта из шапки, иначе — организации; без сферы — общепит. */
export async function loadStarterSphere(scope: PpkScope): Promise<StarterSphere> {
  const [org, building] = await Promise.all([
    db.organization.findUnique({ where: { id: scope.organizationId }, select: { type: true } }),
    scope.buildingId
      ? db.building.findFirst({ where: { id: scope.buildingId, organizationId: scope.organizationId }, select: { sphere: true } })
      : Promise.resolve(null),
  ]);
  const category = effectiveObjectCategory(building?.sphere, org?.type);
  return category && isStarterSphere(category) ? category : "food";
}

export type ItemRevision = { code: string | null; pending: boolean };

export type OverviewSignals = {
  /** Пункт → утверждённая редакция («ППК 003») или «не утверждена»; пустые документы не попадают. */
  revisions: Partial<Record<PpkItemId, ItemRevision>>;
  docs: { total: number; pending: number };
  /** Срок пересмотра программы: последняя версия + 12 месяцев (как в напоминаниях). */
  review: { date: string; state: "ok" | "soon" | "overdue" } | null;
};

const ruDate = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;

export async function loadOverviewSignals(scope: PpkScope): Promise<OverviewSignals> {
  const items = revisionItems();
  const keys = items.map((entry) => revisionDocKey(entry.ref, scope.buildingId));
  const [org, states, versions] = await Promise.all([
    db.organization.findUnique({ where: { id: scope.organizationId }, select: { timezone: true } }),
    loadRevisionStates(scope, keys),
    loadDocVersions(scope),
  ]);

  const revisions: OverviewSignals["revisions"] = {};
  const docs = { total: 0, pending: 0 };
  items.forEach((entry, index) => {
    const state = states.get(keys[index]);
    if (!state || state.doc.empty) return;
    const approved = state.status === "approved";
    docs.total += 1;
    if (!approved) docs.pending += 1;
    revisions[entry.id] = { code: approved ? (state.latest?.code ?? null) : null, pending: !approved };
  });

  const latest = latestDocVersion(
    versions.map((row) => row.data),
    "ppk",
  );
  let review: OverviewSignals["review"] = null;
  if (latest) {
    const due = addMonths(latest.approvedAt, 12);
    review = { date: ruDate(due), state: ppkReviewState(due, orgTodayKey(org?.timezone ?? "Europe/Moscow")) };
  }
  return { revisions, docs, review };
}
