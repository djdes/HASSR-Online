/**
 * Реестр блоков раздела «Производственный контроль» (ППК).
 *
 * Один источник правды для меню раздела, плиток обзора, прогресса и
 * «следующего шага». Спецификация:
 * docs/superpowers/specs/2026-10-16-production-control-ppk-design.md (§2).
 *
 * • `menuGroup` — группа пунктов в левом меню раздела: главная (без подписи),
 *   «ХАССП» и «Документы». Порядок блоков в реестре — порядок в меню.
 * • `ready: false` — блок скрыт, пока не реализован: в меню и обзоре его нет.
 * • `counted: false` — справочный блок (программа, плакаты, хранилище): он не
 *   входит в прогресс и не становится «следующим шагом».
 * • `tabs` — вкладки внутри блока (над страницей); неготовая вкладка скрыта.
 *
 * Чистый модуль: без React и без импортов из `app-nav`.
 */

export type PpkMenuGroupKey = "main" | "haccp" | "documents";

export type PpkMenuGroup = { key: PpkMenuGroupKey; labelled: boolean };

export type PpkBlockKey =
  | "program" | "instructions" | "procedures" | "floor-plans" | "products" | "pest-control" | "lab" | "flowcharts"
  | "team" | "policy" | "hazards" | "control-points" | "audit"
  | "orders" | "posters" | "norm-documents" | "storage";

export type PpkTabKey =
  | "overview" | "program" | "haccpPlan"
  | "members" | "regulation"
  | "text" | "qrSheet"
  | "points" | "worksheets"
  | "list" | "guidelines" | "sanpin";

/** Кто видит блок: полный доступ руководства, журналы (заведующая) или путь сотрудника. */
export type PpkBlockAccess = "fullAccess" | "journalsView" | "staffPath";

export type PpkBlockTab = { id: PpkTabKey; href: string; access: PpkBlockAccess; ready: boolean };

export type PpkBlock = {
  key: PpkBlockKey;
  menuGroup: PpkMenuGroupKey;
  href: string;
  icon: string;
  counted: boolean;
  access: PpkBlockAccess;
  serviceKey?: string;
  ready: boolean;
  tabs?: PpkBlockTab[];
};

export const PPK_OVERVIEW_HREF = "/production-control" as const;

export const PPK_MENU_GROUPS: readonly PpkMenuGroup[] = [
  { key: "main", labelled: false },
  { key: "haccp", labelled: true },
  { key: "documents", labelled: true },
];

export const PPK_BLOCKS: readonly PpkBlock[] = [
  // Главная группа — левый столбец схемы владельца.
  {
    key: "program", menuGroup: "main", href: "/production-control", icon: "FileCheck2", counted: false, access: "fullAccess",
    serviceKey: "ppk-development", ready: true,
    tabs: [
      { id: "overview", href: "/production-control", access: "fullAccess", ready: true },
      { id: "program", href: "/production-control/program", access: "fullAccess", ready: true },
      { id: "haccpPlan", href: "/production-control/haccp-plan", access: "fullAccess", ready: true },
    ],
  },
  { key: "instructions", menuGroup: "main", href: "/knowledge", icon: "BookOpen", counted: true, access: "journalsView", ready: true },
  { key: "procedures", menuGroup: "main", href: "/production-control/documents/procedures", icon: "ListOrdered", counted: true, access: "fullAccess", serviceKey: "haccp-package", ready: true },
  { key: "floor-plans", menuGroup: "main", href: "/production-control/sanitation/floor-plans", icon: "Map", counted: true, access: "fullAccess", serviceKey: "layout-planning", ready: true },
  { key: "products", menuGroup: "main", href: "/production-control/haccp/products", icon: "Package", counted: true, access: "fullAccess", serviceKey: "haccp-package", ready: true },
  { key: "pest-control", menuGroup: "main", href: "/production-control/sanitation/pest-control", icon: "Bug", counted: true, access: "fullAccess", serviceKey: "pest-control-service", ready: true },
  { key: "lab", menuGroup: "main", href: "/production-control/sanitation/lab", icon: "FlaskConical", counted: true, access: "fullAccess", serviceKey: "consulting", ready: true },
  { key: "flowcharts", menuGroup: "main", href: "/production-control/haccp/flowcharts", icon: "Workflow", counted: true, access: "fullAccess", serviceKey: "haccp-package", ready: true },
  // Группа «ХАССП».
  {
    key: "team", menuGroup: "haccp", href: "/production-control/haccp/team", icon: "Users", counted: true, access: "fullAccess",
    serviceKey: "haccp-package", ready: true,
    tabs: [
      { id: "members", href: "/production-control/haccp/team", access: "fullAccess", ready: true },
      { id: "regulation", href: "/production-control/haccp/team/regulation", access: "fullAccess", ready: true },
    ],
  },
  {
    key: "policy", menuGroup: "haccp", href: "/production-control/haccp/policy", icon: "BadgeCheck", counted: true, access: "fullAccess",
    serviceKey: "haccp-package", ready: true,
    tabs: [
      { id: "text", href: "/production-control/haccp/policy", access: "fullAccess", ready: true },
      { id: "qrSheet", href: "/production-control/haccp/policy/print", access: "fullAccess", ready: true },
    ],
  },
  { key: "hazards", menuGroup: "haccp", href: "/production-control/haccp/hazards", icon: "TriangleAlert", counted: true, access: "fullAccess", serviceKey: "haccp-package", ready: true },
  {
    key: "control-points", menuGroup: "haccp", href: "/production-control/haccp/control-points", icon: "Crosshair", counted: true, access: "fullAccess",
    serviceKey: "haccp-package", ready: true,
    tabs: [
      { id: "points", href: "/production-control/haccp/control-points", access: "fullAccess", ready: true },
      { id: "worksheets", href: "/production-control/haccp/control-points/worksheets", access: "fullAccess", ready: true },
    ],
  },
  { key: "audit", menuGroup: "haccp", href: "/production-control/haccp/audit", icon: "ClipboardCheck", counted: true, access: "fullAccess", serviceKey: "pre-inspection-audit", ready: true },
  // Группа «Документы».
  { key: "orders", menuGroup: "documents", href: "/orders", icon: "Stamp", counted: true, access: "fullAccess", ready: true },
  { key: "posters", menuGroup: "documents", href: "/production-control/documents/posters", icon: "Image", counted: false, access: "fullAccess", ready: true },
  {
    key: "norm-documents", menuGroup: "documents", href: "/production-control/norms/documents", icon: "Scale", counted: true, access: "fullAccess",
    serviceKey: "norms-subscription", ready: true,
    tabs: [
      { id: "list", href: "/production-control/norms/documents", access: "fullAccess", ready: true },
      { id: "guidelines", href: "/production-control/norms/guidelines", access: "fullAccess", ready: true },
      { id: "sanpin", href: "/sanpin", access: "staffPath", ready: true },
    ],
  },
  { key: "storage", menuGroup: "documents", href: "/production-control/documents/storage", icon: "Archive", counted: false, access: "fullAccess", ready: true },
];

/** Блок по ключу; для неизвестного ключа бросает ошибку. */
export function ppkBlock(key: PpkBlockKey): PpkBlock {
  const block = PPK_BLOCKS.find((item) => item.key === key);
  if (!block) throw new Error(`Неизвестный блок ППК: ${key}`);
  return block;
}

/** Готовые блоки группы меню в порядке реестра. */
export function ppkMenuBlocks(group: PpkMenuGroupKey): PpkBlock[] {
  return PPK_BLOCKS.filter((block) => block.menuGroup === group && block.ready);
}

/** Готовые вкладки блока в порядке реестра (у блока без вкладок — пусто). */
export function ppkReadyTabs(block: PpkBlock): PpkBlockTab[] {
  return (block.tabs ?? []).filter((tab) => tab.ready);
}

/** Адрес пункта меню: первая готовая вкладка, иначе адрес самого блока. */
export function ppkBlockHref(block: PpkBlock): string {
  return ppkReadyTabs(block)[0]?.href ?? block.href;
}
