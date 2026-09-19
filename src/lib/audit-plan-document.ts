import { getUserRoleLabel, normalizeUserRole, pickPrimaryManager } from "@/lib/user-roles";
import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";

export const AUDIT_PLAN_TEMPLATE_CODE = "audit_plan";
export const AUDIT_PLAN_SOURCE_SLUG = "auditplan";

export const AUDIT_PLAN_HEADING = "План-программа внутренних аудитов";
export const AUDIT_PLAN_DOCUMENT_TITLE = "План-программа аудитов";

export type AuditPlanColumn = {
  id: string;
  title: string;
  auditorName: string;
};

export type AuditPlanSection = {
  id: string;
  title: string;
};

export type AuditPlanRow = {
  id: string;
  sectionId: string;
  text: string;
  checked: boolean;
  values: Record<string, string>;
};

export type AuditPlanConfig = {
  year: number;
  documentDate: string;
  approveRole: string;
  approveEmployeeId?: string | null;
  approveEmployee: string;
  columns: AuditPlanColumn[];
  sections: AuditPlanSection[];
  rows: AuditPlanRow[];
};

type UserLike = {
  name: string;
  role: string;
};

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function safeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function safeYear(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
}

function resolveRoleLabel(role: string) {
  return getUserRoleLabel(role);
}

function pickApproveUser(users: UserLike[]) {
  return pickPrimaryManager(users);
}

function pickAuditors(users: UserLike[]) {
  const primary = pickPrimaryManager(users);
  const secondary =
    users.find((user) => normalizeUserRole(user.role) === "head_chef") ||
    users.find((user) => user.name !== primary?.name) ||
    primary;

  return [primary, secondary].filter((item): item is UserLike => item !== null);
}

function buildDefaultColumns(organizationName: string, users: UserLike[]): AuditPlanColumn[] {
  const auditors = pickAuditors(users);

  return [
    {
      id: "audit-1",
      title: `Аудит 1 ${organizationName}`,
      auditorName: auditors[0]?.name || "",
    },
    {
      id: "audit-2",
      title: `Аудит 2 ${organizationName}`,
      auditorName: auditors[1]?.name || auditors[0]?.name || "",
    },
  ];
}

function buildDefaultSections(): AuditPlanSection[] {
  return [
    { id: "general", title: "ОБЩИЕ ТРЕБОВАНИЯ" },
    {
      id: "special-each-audit",
      title: "ОСОБЫЕ ТРЕБОВАНИЯ (ПРОВЕРЯЮТСЯ ПРИ КАЖДОМ ВНУТРЕННЕМ АУДИТЕ)",
    },
    { id: "special", title: "СПЕЦИАЛЬНЫЕ ТРЕБОВАНИЯ" },
  ];
}

function buildDefaultRows(columnIds: string[]): AuditPlanRow[] {
  const [firstColumnId, secondColumnId] = columnIds;
  const values = (first: string, second: string) => ({
    [firstColumnId]: first,
    [secondColumnId]: second,
  });

  return [
    {
      id: "row-1",
      sectionId: "general",
      text: "Наличие и управление документацией",
      checked: true,
      values: values("30-10-2021", "27-11-2021"),
    },
    {
      id: "row-2",
      sectionId: "general",
      text: "Ведение регистрационно-учетной документации (записей) и управление записями",
      checked: false,
      values: values("X", "27-11-2021"),
    },
    {
      id: "row-3",
      sectionId: "general",
      text: "Анализ претензий потребителей. Изъятия продукции",
      checked: false,
      values: values("30-10-2021", "X"),
    },
    {
      id: "row-4",
      sectionId: "general",
      text: "Оценка соответствия информации (в маркировке, сопроводительной документации и др.)",
      checked: false,
      values: values("01-04-2022", "01-04-2022"),
    },
    {
      id: "row-5",
      sectionId: "general",
      text: "Анализ и актуализация системы ХАССП (своевременность, необходимость)",
      checked: true,
      values: values("X", "12-04-2022"),
    },
    {
      id: "row-6",
      sectionId: "general",
      text: "Внутренние аудиты (своевременность, полнота)",
      checked: false,
      values: values("22-04-2022", "22-04-2022"),
    },
    {
      id: "row-7",
      sectionId: "general",
      text: "Документация для анализа рисков, результаты анализа",
      checked: false,
      values: values("22-04-2022", "X"),
    },
    {
      id: "row-8",
      sectionId: "general",
      text: "Компетентность и подготовка персонала",
      checked: false,
      values: values("29-05-2023", "X"),
    },
    {
      id: "row-9",
      sectionId: "special-each-audit",
      text: "Устранение ранее выявленных несоответствий",
      checked: true,
      values: values("29-10-2021", "X"),
    },
    {
      id: "row-10",
      sectionId: "special-each-audit",
      text: "Ведение рабочих листов ХАССП",
      checked: false,
      values: values("29-10-2021", "X"),
    },
    {
      id: "row-11",
      sectionId: "special",
      text: "Требования к территории, зданиям, производственным и вспомогательным помещениям",
      checked: false,
      values: values("17-03-2022", "X"),
    },
    {
      id: "row-12",
      sectionId: "special",
      text: "Требования к водоснабжению, канализации, освещению, вентиляции и удалению отходов",
      checked: false,
      values: values("17-03-2022", "X"),
    },
    {
      id: "row-13",
      sectionId: "special",
      text: "Требования к оборудованию, инвентарю",
      checked: false,
      values: values("X", "22-04-2022"),
    },
    {
      id: "row-14",
      sectionId: "special",
      text: "Требования к средствам измерения",
      checked: false,
      values: values("29-05-2023", "X"),
    },
    {
      id: "row-15",
      sectionId: "special",
      text: "Требования к технологическим процессам",
      checked: false,
      values: values("X", "29-05-2023"),
    },
    {
      id: "row-16",
      sectionId: "special",
      text: "Требования к обращению с пищевой продукцией, приемке сырья и контролю готовой продукции, хранению, перемещению и отгрузке",
      checked: false,
      values: values("X", "29-05-2023"),
    },
    {
      id: "row-17",
      sectionId: "special",
      text: "Требования к личной гигиене персонала",
      checked: false,
      values: values("29-05-2023", "29-05-2023"),
    },
    {
      id: "row-18",
      sectionId: "special",
      text: "Требования к работе с посетителями производственной зоны",
      checked: false,
      values: values("29-05-2023", "29-05-2023"),
    },
    {
      id: "row-19",
      sectionId: "special",
      text: "Требования к санитарной обработке, дезинсекции и дератизации",
      checked: false,
      values: values("29-05-2023", "29-05-2023"),
    },
    {
      id: "row-20",
      sectionId: "special",
      text: "Требования к обращению со стеклом, хрупким пластиком, деревом, металлом. Предотвращение посторонних попаданий в пищевую продукцию",
      checked: false,
      values: values("29-05-2023", "29-05-2023"),
    },
    {
      id: "row-21",
      sectionId: "special",
      text: "Требования к обращению с несоответствующей продукцией",
      checked: false,
      values: values("29-05-2023", "29-05-2023"),
    },
    {
      id: "row-22",
      sectionId: "special",
      text: "Обмен информацией (с сотрудниками и внешними сторонами)",
      checked: false,
      values: values("29-05-2023", "29-05-2023"),
    },
    {
      id: "row-23",
      sectionId: "special",
      text: "Закупки сырья и оценка поставщиков",
      checked: false,
      values: values("29-05-2023", "29-05-2023"),
    },
  ];
}

export function getAuditPlanDefaultConfig(params?: {
  organizationName?: string;
  users?: UserLike[];
  date?: Date;
}): AuditPlanConfig {
  const date = params?.date || new Date();
  const year = date.getUTCFullYear();
  const documentDate = `${year}-01-15`;
  const organizationName = params?.organizationName || ORG_NAME_FALLBACK;
  const users = params?.users || [];
  const approveUser = pickApproveUser(users);
  const columns = buildDefaultColumns(organizationName, users);

  return {
    year,
    documentDate,
    approveRole: resolveRoleLabel(approveUser?.role || "owner"),
    approveEmployeeId: (approveUser as { id?: string } | undefined)?.id || null,
    approveEmployee: approveUser?.name || "",
    columns,
    sections: buildDefaultSections(),
    rows: buildDefaultRows(columns.map((column) => column.id)),
  };
}

function normalizeColumns(value: unknown, fallback: AuditPlanColumn[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const source = item as Record<string, unknown>;
      const id = safeText(source.id, `audit-${index + 1}`);
      const title = safeText(source.title);
      if (!title) return null;
      return {
        id,
        title,
        auditorName: safeText(source.auditorName),
      };
    })
    .filter((item): item is AuditPlanColumn => item !== null);

  // ПОЧЕМУ не `items.length > 0 ? items : fallback`: сохранённый пустой
  // массив — это осознанное «в документе ничего нет». Fallback воскрешал
  // демо-строки, и сервер записывал их обратно в документ.
  return items;
}

function normalizeSections(value: unknown, fallback: AuditPlanSection[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const source = item as Record<string, unknown>;
      const title = safeText(source.title);
      if (!title) return null;
      return {
        id: safeText(source.id, `section-${index + 1}`),
        title,
      };
    })
    .filter((item): item is AuditPlanSection => item !== null);

  // Пустой сохранённый массив остаётся пустым (см. normalizeColumns).
  return items;
}

function normalizeRows(
  value: unknown,
  sectionIds: string[],
  columnIds: string[],
  fallback: AuditPlanRow[]
) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const source = item as Record<string, unknown>;
      const sectionId = safeText(source.sectionId);
      if (!sectionIds.includes(sectionId)) return null;
      const valuesSource =
        source.values && typeof source.values === "object" && !Array.isArray(source.values)
          ? (source.values as Record<string, unknown>)
          : {};
      const values = Object.fromEntries(
        columnIds.map((columnId) => [columnId, safeText(valuesSource[columnId])])
      );
      return {
        id: safeText(source.id, `row-${index + 1}`),
        sectionId,
        text: safeText(source.text),
        checked: source.checked === true,
        values,
      };
    })
    .filter((item): item is AuditPlanRow => item !== null && item.text.length > 0);

  // Пустой сохранённый массив остаётся пустым (см. normalizeColumns).
  return items;
}

export function normalizeAuditPlanConfig(
  value: unknown,
  params?: { organizationName?: string; users?: UserLike[]; date?: Date }
): AuditPlanConfig {
  const fallback = getAuditPlanDefaultConfig(params);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const source = value as Record<string, unknown>;
  const columns = normalizeColumns(source.columns, fallback.columns);
  const sections = normalizeSections(source.sections, fallback.sections);

  return {
    year: safeYear(source.year, fallback.year),
    documentDate: safeText(source.documentDate, fallback.documentDate),
    approveRole: safeText(source.approveRole, fallback.approveRole),
    approveEmployeeId: safeText(source.approveEmployeeId) || fallback.approveEmployeeId || null,
    approveEmployee: safeText(source.approveEmployee, fallback.approveEmployee),
    columns,
    sections,
    rows: normalizeRows(
      source.rows,
      sections.map((section) => section.id),
      columns.map((column) => column.id),
      fallback.rows
    ),
  };
}

export function createAuditPlanRow(sectionId: string, text: string, columnIds: string[]): AuditPlanRow {
  return {
    id: createId("audit-row"),
    sectionId,
    text,
    checked: false,
    values: Object.fromEntries(columnIds.map((columnId) => [columnId, ""])),
  };
}

export function createAuditPlanSection(title: string): AuditPlanSection {
  return {
    id: createId("audit-section"),
    title,
  };
}

export function getAuditPlanDocumentDateLabel(dateKey: string) {
  if (!dateKey) return "—";
  const [year, month, day] = dateKey.split("-");
  if (!year || !month || !day) return dateKey;
  return `${day}-${month}-${year}`;
}

export function getAuditPlanApproveLabel(role: string, employee: string) {
  return `${role ? `${role}: ` : ""}${employee || ""}`.trim();
}

export function getAuditPlanPrintDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  if (!year || !month || !day) return dateKey;
  // Без дня локаль ru-RU даёт именительный падеж («январь»), а бланк
  // требует родительный («января»): форматируем дату целиком и отрезаем день.
  const monthName = new Date(`${year}-${month}-${day}T00:00:00`)
    .toLocaleDateString("ru-RU", { day: "numeric", month: "long" })
    .replace(/^\d+\s+/, "");
  return `« ${day} » ${monthName} ${year} г.`;
}
