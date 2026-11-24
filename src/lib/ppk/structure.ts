/**
 * Структура «Электронной программы производственного контроля, основанной на
 * принципах ХАССП» — документ владельца (2026-11-24, спека
 * `.agent/tasks/ppk-structure-2026-11-24/spec.md`): три раздела и приложения.
 *
 * Один источник правды для обзора `/production-control` (нумерованный список
 * пунктов-ссылок), окна пункта (`/production-control/item/<id>`), статусов и
 * тестов. Названия пунктов — в каталогах (`productionControl.structure.items`).
 *
 * Чистый модуль: без React, БД и Next.
 */
import type { PpkFolderKey } from "./folders";
import type { PrpTableBlock } from "./prp-tables";
import type { PpkTextBlock } from "./records";
import type { PpkBlockKey } from "./registry";

export type PpkSectionKey = "primary" | "plan" | "prp" | "appendix";

/** Id пунктов в адресе: номер документа через дефис, приложения — `app-N`. */
export type PpkItemId =
  | "1-1" | "1-2" | "1-3" | "1-4" | "1-5" | "1-6" | "1-7" | "1-8" | "1-9"
  | "2-1" | "2-2" | "2-3" | "2-4" | "2-5" | "2-6" | "2-7" | "2-8" | "2-9" | "2-10"
  | "3-1" | "3-2" | "3-3" | "3-4" | "3-5" | "3-6" | "3-7"
  | "app-1" | "app-2" | "app-3" | "app-4" | "app-5" | "app-6";

/** Что рисует окно пункта. */
export type PpkPanelKind =
  | "org-info"
  | "org-chart"
  | "contracts"
  | "production-info"
  | "products"
  | "floor-plans"
  | "norms"
  | "text"
  | "policy"
  | "team-order"
  | "flowcharts"
  | "hazards"
  | "significant"
  | "probability"
  | "control-points"
  | "prp-table"
  | "staff"
  | "lab"
  | "acquaintance"
  | "equipment"
  | "worksheets"
  | "journals"
  | "procedures"
  | "instructions";

/** Шаблон текста пункта (`structure-templates.ts`); null — пустое поле для своего текста. */
export type PpkTextTemplate = "haccp-principles" | "team-regulation" | "team-leader" | "ccp-method";

export type PpkStructureItem = {
  /** Часть адреса `/production-control/item/<id>`: без точек. */
  id: PpkItemId;
  /** Номер как в документе: «1.1», «2.10»; у приложения — «1»…«6». */
  number: string;
  section: PpkSectionKey;
  panel: PpkPanelKind;
  /** Блок раздела с тем же содержанием: его статус и ссылка «Открыть раздел». */
  block?: PpkBlockKey;
  /** Текстовый пункт: запись текста и шаблон. */
  text?: { block: PpkTextBlock; template: PpkTextTemplate | null };
  /** Папка «Скан своего документа» / файлов пункта. */
  scanFolder?: PpkFolderKey;
  /** Папка прежних загрузок, которые теперь видны в этом пункте. */
  legacyFolder?: PpkFolderKey;
  /** Таблица программы ПОПМ. */
  table?: PrpTableBlock;
};

export type PpkStructureSection = {
  key: PpkSectionKey;
  /** Номер раздела; у «Приложений» номера нет. */
  number: string | null;
  items: readonly PpkStructureItem[];
};

const primary = (id: PpkItemId, panel: PpkPanelKind, extra: Partial<PpkStructureItem> = {}): PpkStructureItem => ({
  id,
  number: id.replace("-", "."),
  section: "primary",
  panel,
  ...extra,
});
const plan = (id: PpkItemId, panel: PpkPanelKind, extra: Partial<PpkStructureItem> = {}): PpkStructureItem => ({
  id,
  number: id.replace("-", "."),
  section: "plan",
  panel,
  ...extra,
});
const prp = (id: PpkItemId, panel: PpkPanelKind, extra: Partial<PpkStructureItem> = {}): PpkStructureItem => ({
  id,
  number: id.replace("-", "."),
  section: "prp",
  panel,
  ...extra,
});
const appendix = (n: 1 | 2 | 3 | 4 | 5 | 6, panel: PpkPanelKind, extra: Partial<PpkStructureItem> = {}): PpkStructureItem => ({
  id: `app-${n}`,
  number: String(n),
  section: "appendix",
  panel,
  ...extra,
});

export const PPK_STRUCTURE: readonly PpkStructureSection[] = [
  {
    key: "primary",
    number: "1",
    items: [
      primary("1-1", "org-info"),
      primary("1-2", "org-chart"),
      primary("1-3", "contracts", { scanFolder: "contracts" }),
      primary("1-4", "production-info"),
      primary("1-5", "products", { block: "products" }),
      primary("1-6", "floor-plans", { block: "floor-plans" }),
      primary("1-7", "norms", { block: "norm-documents" }),
      primary("1-8", "text", { text: { block: "text-haccp-principles", template: "haccp-principles" } }),
      primary("1-9", "text", { text: { block: "text-terms", template: null } }),
    ],
  },
  {
    key: "plan",
    number: "2",
    items: [
      plan("2-1", "policy", { block: "policy", scanFolder: "policy-scan" }),
      plan("2-2", "text", {
        block: "team",
        text: { block: "text-team-regulation", template: "team-regulation" },
        scanFolder: "team-regulation-scan",
        legacyFolder: "team-signed",
      }),
      plan("2-3", "text", {
        text: { block: "text-team-leader", template: "team-leader" },
        scanFolder: "team-leader-scan",
      }),
      plan("2-4", "team-order", { block: "team", scanFolder: "team-order-scan", legacyFolder: "team-signed" }),
      plan("2-5", "flowcharts", { block: "flowcharts" }),
      plan("2-6", "hazards", { block: "hazards" }),
      plan("2-7", "significant", { block: "hazards" }),
      plan("2-8", "probability", { block: "hazards" }),
      plan("2-9", "text", { text: { block: "text-ccp-method", template: "ccp-method" } }),
      plan("2-10", "control-points", { block: "control-points" }),
    ],
  },
  {
    key: "prp",
    number: "3",
    items: [
      prp("3-1", "prp-table", { table: "prp-infections" }),
      prp("3-2", "prp-table", { table: "prp-disinfection" }),
      prp("3-3", "prp-table", { table: "prp-emergencies" }),
      prp("3-4", "prp-table", { table: "prp-medical" }),
      prp("3-5", "staff"),
      prp("3-6", "lab", { block: "lab" }),
      prp("3-7", "acquaintance"),
    ],
  },
  {
    key: "appendix",
    number: null,
    items: [
      appendix(1, "equipment"),
      appendix(2, "worksheets", { block: "control-points" }),
      appendix(3, "text", { text: { block: "text-flow-schedule", template: null }, scanFolder: "flow-schedule" }),
      appendix(4, "journals"),
      appendix(5, "procedures", { block: "procedures" }),
      appendix(6, "instructions", { block: "instructions" }),
    ],
  },
];

/** Все пункты в порядке документа. */
export const PPK_STRUCTURE_ITEMS: readonly PpkStructureItem[] = PPK_STRUCTURE.flatMap((section) => section.items);

/** Пункт по id адреса; неизвестный — null. */
export function ppkStructureItem(id: string | null | undefined): PpkStructureItem | null {
  return PPK_STRUCTURE_ITEMS.find((item) => item.id === id) ?? null;
}

/** Адрес пункта: с обзора открывается окном, напрямую — страницей. */
export function ppkItemHref(id: PpkItemId): string {
  return `/production-control/item/${id}`;
}

/** Пункт, который показывает блок раздела (для «Следующего шага» и ссылок из блоков). */
export function ppkItemForBlock(block: PpkBlockKey): PpkStructureItem | null {
  return PPK_STRUCTURE_ITEMS.find((item) => item.block === block) ?? null;
}
