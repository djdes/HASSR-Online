/**
 * Статусы блоков ППК по фактам из базы. Чистая логика без БД: факты собирает
 * `facts.server.ts`, здесь только правила перевода фактов в статус.
 */
import { PPK_BLOCKS, ppkBlock, type PpkBlock, type PpkBlockKey } from "./registry";
import type { PpkFolderKey } from "./folders";

export type PpkStatus = "done" | "started" | "empty" | "info";

export type PpkFacts = {
  knowledgeDocs: number;
  folders: Partial<Record<PpkFolderKey, number>>;
  orders: { total: number; ppkApproval: boolean };
  team: { members: number; hasLeader: boolean };
  policy: { hasText: boolean; approved: boolean };
  products: number;
  flowcharts: { count: number; maxSteps: number };
  hazards: { total: number; significant: number; significantDecided: number };
  controlPoints: { ccpOrOprp: number; withResponsible: number };
  audit: { recentRecords: number; checklistRuns: number };
  floorPlans: { count: number; complete: boolean };
  pest: { planItems: number; contract: boolean };
  lab: { planItems: number; contract: boolean };
  norms: { selected: number };
};

export function emptyPpkFacts(): PpkFacts {
  return {
    knowledgeDocs: 0,
    folders: {},
    orders: { total: 0, ppkApproval: false },
    team: { members: 0, hasLeader: false },
    policy: { hasText: false, approved: false },
    products: 0,
    flowcharts: { count: 0, maxSteps: 0 },
    hazards: { total: 0, significant: 0, significantDecided: 0 },
    controlPoints: { ccpOrOprp: 0, withResponsible: 0 },
    audit: { recentRecords: 0, checklistRuns: 0 },
    floorPlans: { count: 0, complete: false },
    pest: { planItems: 0, contract: false },
    lab: { planItems: 0, contract: false },
    norms: { selected: 0 },
  };
}

/** Справочные блоки всегда «info»; остальные — по фактам. */
export function computePpkStatuses(facts: PpkFacts): Record<PpkBlockKey, PpkStatus> {
  const f = facts;
  const hz = f.hazards;
  const cp = f.controlPoints;
  const pestLike = (x: { planItems: number; contract: boolean }): PpkStatus =>
    x.planItems >= 1 && x.contract ? "done" : x.planItems >= 1 || x.contract ? "started" : "empty";

  // Готово, когда все значимые опасности решены и у каждой ККТ/ОПП есть ответственный;
  // самих ККТ/ОПП может не быть вовсе (всё решено как ПП или «не требуется»).
  let controlPoints: PpkStatus;
  if (hz.total >= 1 && hz.significantDecided >= hz.significant && cp.withResponsible >= cp.ccpOrOprp) {
    controlPoints = "done";
  } else if (cp.ccpOrOprp >= 1) {
    controlPoints = "started";
  } else {
    controlPoints = "empty";
  }

  return {
    // «Программа» — справочный блок: своего статуса у него нет.
    program: "info",
    team: f.team.members >= 2 && f.team.hasLeader ? "done" : f.team.members >= 1 ? "started" : "empty",
    policy: f.policy.hasText && f.policy.approved ? "done" : f.policy.hasText ? "started" : "empty",
    products: f.products >= 1 ? "done" : "empty",
    flowcharts: f.flowcharts.maxSteps >= 3 ? "done" : f.flowcharts.count >= 1 ? "started" : "empty",
    hazards:
      hz.total >= 1 && hz.significantDecided >= hz.significant
        ? "done"
        : hz.total >= 1
          ? "started"
          : "empty",
    "control-points": controlPoints,
    // Журнал аудита включён у всех по умолчанию, поэтому «начат» не показываем.
    audit: f.audit.recentRecords >= 1 || f.audit.checklistRuns >= 1 ? "done" : "empty",
    instructions: f.knowledgeDocs >= 1 ? "done" : "empty",
    procedures: (f.folders.procedures ?? 0) >= 1 ? "done" : "empty",
    orders: f.orders.ppkApproval ? "done" : f.orders.total >= 1 ? "started" : "empty",
    posters: "info",
    storage: "info",
    package: "info",
    "floor-plans": f.floorPlans.complete ? "done" : f.floorPlans.count >= 1 ? "started" : "empty",
    "pest-control": pestLike(f.pest),
    lab: pestLike(f.lab),
    "norm-documents": f.norms.selected >= 1 ? "done" : "empty",
  };
}

/** Прогресс только по готовым и счётным блокам. */
export function ppkProgress(statuses: Record<PpkBlockKey, PpkStatus>): { done: number; total: number } {
  const counted = PPK_BLOCKS.filter((block) => block.ready && block.counted);
  return {
    done: counted.filter((block) => statuses[block.key] === "done").length,
    total: counted.length,
  };
}

/** Первый готовый счётный блок, который ещё не «done»; null, если всё готово. */
export function ppkNextStep(statuses: Record<PpkBlockKey, PpkStatus>): PpkBlock | null {
  const next = PPK_BLOCKS.find(
    (block) => block.ready && block.counted && statuses[block.key] !== "done",
  );
  return next ? ppkBlock(next.key) : null;
}
