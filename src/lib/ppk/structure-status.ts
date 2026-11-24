/**
 * Статусы пунктов структуры ППК (1.1–3.7, приложения) по фактам из базы. Чистая
 * логика без БД: факты собирает `structure-facts.server.ts`. Пункты, которые
 * показывают блок раздела, берут его статус (`status.ts`) — одна правда на
 * блок; новые пункты считаются здесь.
 */
import type { PpkFolderKey } from "./folders";
import type { PrpTableBlock } from "./prp-tables";
import type { PpkTextBlock } from "./records";
import type { PpkBlockKey } from "./registry";
import type { PpkStatus } from "./status";
import { PPK_STRUCTURE_ITEMS, type PpkStructureItem } from "./structure";

export type PpkItemFacts = {
  /** Статусы блоков раздела (`computePpkStatuses`). */
  blocks: Record<PpkBlockKey, PpkStatus>;
  /** 1.1: сколько обязательных сведений об организации нужно и сколько нет. */
  orgInfo: { required: number; missing: number };
  /** 1.2: схемы оргструктуры и самая большая по числу блоков. */
  orgCharts: { count: number; maxNodes: number };
  /** 1.3: договоры перечня и файлы (свои и договоры лаборатории/дезслужбы). */
  contracts: { records: number; files: number };
  /** 1.4: запись сведений о производстве и сколько обязательного не хватает. */
  productionInfo: { exists: boolean; missing: number };
  /** Тексты пунктов, сохранённые непустыми. */
  texts: Partial<Record<PpkTextBlock, boolean>>;
  /** Файлы в папках пунктов (сканы, прежние загрузки). */
  folders: Partial<Record<PpkFolderKey, number>>;
  /** 2.7, 2.8: опасности анализа. */
  hazards: number;
  /** 2.4: оформлен приказ «О группе ХАССП» в «Приказах». */
  teamOrder: boolean;
  /** 3.1–3.4: строки таблиц. */
  prp: Partial<Record<PrpTableBlock, number>>;
  /** 3.5: сотрудники объекта. */
  staff: number;
  /** 3.7: ознакомление с утверждённой программой (нет версии — недоступно). */
  acquaintance: { available: boolean; acknowledged: number; total: number };
  /** Прил. № 1: оборудование объекта. */
  equipment: number;
  /** Прил. № 4: включённые журналы. */
  journals: number;
};

const doneIf = (condition: boolean): PpkStatus => (condition ? "done" : "empty");

function itemStatus(item: PpkStructureItem, f: PpkItemFacts): PpkStatus {
  const folder = (key: PpkFolderKey | undefined) => (key ? (f.folders[key] ?? 0) : 0);
  const text = item.text ? Boolean(f.texts[item.text.block]) : false;
  switch (item.id) {
    case "1-1":
      return f.orgInfo.missing === 0 ? "done" : f.orgInfo.missing < f.orgInfo.required ? "started" : "empty";
    case "1-2":
      return f.orgCharts.maxNodes >= 2 ? "done" : f.orgCharts.count >= 1 ? "started" : "empty";
    case "1-3":
      return f.contracts.records >= 1 ? "done" : f.contracts.files >= 1 ? "started" : "empty";
    case "1-4":
      return f.productionInfo.exists ? (f.productionInfo.missing === 0 ? "done" : "started") : "empty";
    case "2-1": {
      // Скан своей политики заменяет текст: пункт заполнен.
      const block = f.blocks.policy;
      return folder(item.scanFolder) >= 1 ? "done" : block;
    }
    case "2-2":
    case "2-3":
      if (text || folder(item.scanFolder) >= 1) return "done";
      // Прежние сканы группы и состав группы — начато: шаблон заполнится из состава.
      return folder(item.legacyFolder) >= 1 || (item.id === "2-2" && f.blocks.team !== "empty") ? "started" : "empty";
    case "2-4":
      if (f.teamOrder || folder(item.scanFolder) >= 1) return "done";
      return folder(item.legacyFolder) >= 1 ? "started" : "empty";
    case "2-7":
    case "2-8":
      return doneIf(f.hazards >= 1);
    case "3-5":
      return doneIf(f.staff >= 1);
    case "3-7": {
      const a = f.acquaintance;
      if (!a.available || a.acknowledged === 0) return "empty";
      return a.total > 0 && a.acknowledged >= a.total ? "done" : "started";
    }
    case "app-1":
      return doneIf(f.equipment >= 1);
    case "app-3":
      return doneIf(text || folder(item.scanFolder) >= 1);
    case "app-4":
      return doneIf(f.journals >= 1);
    default:
      break;
  }
  if (item.table) return doneIf((f.prp[item.table] ?? 0) >= 1);
  if (item.text) return doneIf(text);
  if (item.block) return f.blocks[item.block];
  return "empty";
}

/** Статус каждого пункта структуры по id. */
export function ppkItemStatuses(facts: PpkItemFacts): Record<string, PpkStatus> {
  return Object.fromEntries(PPK_STRUCTURE_ITEMS.map((item) => [item.id, itemStatus(item, facts)]));
}

/** Прогресс по пунктам: сколько заполнено из всех (справочных среди пунктов нет). */
export function ppkItemProgress(statuses: Record<string, PpkStatus>): { done: number; total: number } {
  return {
    done: PPK_STRUCTURE_ITEMS.filter((item) => statuses[item.id] === "done").length,
    total: PPK_STRUCTURE_ITEMS.length,
  };
}

/** Первый незаполненный пункт в порядке документа; всё заполнено — null. */
export function ppkNextItem(statuses: Record<string, PpkStatus>): PpkStructureItem | null {
  return PPK_STRUCTURE_ITEMS.find((item) => statuses[item.id] !== "done") ?? null;
}
