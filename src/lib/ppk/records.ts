/**
 * Схемы записей реестра ППК (`PpkRecord`): какие поля у каждого блока и
 * какие пределы длины. Чистый модуль — им пользуются API и клиент.
 */
import { z } from "zod";
import type { ControlKind, DecisionAnswers, HazardType, TeamRole } from "./haccp";
import { NORM_CATALOG } from "./norm-catalog";

export const PPK_RECORD_BLOCKS = [
  "team",
  "policy",
  "products",
  "hazards",
  "control-points",
  "flowchart",
  "floor-plan",
  "pest-plan",
  "lab-plan",
  "norms",
] as const;
export type PpkRecordBlock = (typeof PPK_RECORD_BLOCKS)[number];

export function isPpkRecordBlock(v: unknown): v is PpkRecordBlock {
  return typeof v === "string" && (PPK_RECORD_BLOCKS as readonly string[]).includes(v);
}

export const PPK_RECORD_LIMITS: Record<PpkRecordBlock, number> = {
  team: 30,
  policy: 1,
  products: 300,
  hazards: 300,
  "control-points": 200,
  flowchart: 50,
  "floor-plan": 50,
  "pest-plan": 100,
  "lab-plan": 100,
  norms: 1,
};

/** Блоки, где в организации может быть одна запись (лимит 1). БД не даст второй: см. `PpkRecord.singleton`. */
export const PPK_SINGLETON_BLOCKS = ["policy", "norms"] as const satisfies readonly PpkRecordBlock[];

export const PPK_PRODUCT_CATEGORIES = [
  "ready-meals",
  "semi-finished",
  "dairy",
  "meat",
  "fish",
  "bakery",
  "drinks",
] as const;
export type ProductCategory = (typeof PPK_PRODUCT_CATEGORIES)[number];

export type TeamMember = { userId: string; role: TeamRole; duties: string };
export type PolicyData = { text: string; approvedById: string | null; approvedAt: string | null; token: string };
export type ProductData = {
  name: string;
  category: ProductCategory;
  composition: string;
  storage: string;
  shelfLife: string;
  usage: string;
  packaging: string;
  indicators: { name: string; norm: string }[];
};
export type HazardData = {
  step: string;
  hazard: string;
  type: HazardType;
  probability: 1 | 2 | 3 | 4;
  severity: 1 | 2 | 3 | 4;
  measures: string;
};
/** План дезинсекции, дератизации и дезинфекции (блок «Дезинсекция и дератизация»). */
export type PestPlanItem = {
  kind: "disinsection" | "deratization" | "disinfection";
  object: string;
  frequency: string;
  contractor: string;
  /** Даты YYYY-MM-DD. */
  lastDate: string | null;
  nextDate: string | null;
};
/** План лабораторных исследований; следующая дата считается из `lastDate` и периодичности. */
export type LabPlanItem = {
  object: "product" | "swabs" | "water" | "air" | "other";
  subject: string;
  indicator: string;
  /** Периодичность в месяцах: 1..24. */
  everyMonths: number;
  laboratory: string;
  lastDate: string | null;
};
/** Нормативные документы: выбранные id из каталога и свои документы (до 50 и 50). */
export type NormsData = { selected: string[]; custom: { title: string }[] };
export type DiagramNode = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  kind: "step" | "room";
  /** Номер ККТ/ОПП у этапа блок-схемы. */
  ccp: string | null;
  /** Помещение кабинета (`Area`) у узла плана. */
  areaId: string | null;
};
export type FlowKind = "raw" | "ready" | "waste" | "staff" | "dishes";
export type DiagramEdge = {
  id: string;
  from: string | null;
  to: string | null;
  points: { x: number; y: number }[];
  flow: FlowKind | null;
  label: string;
};
export type DiagramData = { title: string; nodes: DiagramNode[]; edges: DiagramEdge[] };
export type ControlPointData = {
  hazardId: string | null;
  kind: ControlKind;
  answers: DecisionAnswers;
  number: string;
  limits: string;
  monitoring: string;
  frequency: string;
  responsibleId: string | null;
  corrective: string;
  journalCode: string | null;
  /** Числовой предел для автосверки с журналом «Мониторинг ККТ» (необязательно). */
  limitMin: number | null;
  limitMax: number | null;
  unit: string;
};

/** Короткие поля: обрезаются, до 200 символов. */
const short = (max = 200) => z.string().trim().max(max);
/** Длинные поля: обрезаются, до 4000 символов. */
const long = () => z.string().trim().max(4000);
/** Идентификатор записи (сотрудник, опасность, журнал). */
const id = () => z.string().trim().min(1).max(64);
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "дата")
  .refine((v) => !Number.isNaN(Date.parse(v)), "дата")
  .nullable();
const score = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const answer = z.boolean().nullable();

const teamSchema = z.object({
  userId: id(),
  role: z.enum(["leader", "deputy", "member", "secretary"]),
  duties: long(),
});

/** Политика клиенту без токена: токен ставит сервер. */
const policySchema = z.object({
  text: z.string().trim().max(12000),
  approvedById: id().nullable(),
  approvedAt: dateOnly,
});

const productSchema = z.object({
  name: short().min(1),
  category: z.enum(PPK_PRODUCT_CATEGORIES),
  composition: long(),
  storage: short(),
  shelfLife: short(),
  usage: short(),
  packaging: short(),
  indicators: z
    .array(z.object({ name: short(), norm: short() }))
    .max(30),
});

const hazardSchema = z.object({
  step: short().min(1),
  hazard: short().min(1),
  type: z.enum(["bio", "chem", "phys", "allergen"]),
  probability: score,
  severity: score,
  measures: long(),
});

const controlPointSchema = z
  .object({
    hazardId: id().nullable(),
    kind: z.enum(["ccp", "oprp", "prp", "none"]),
    answers: z.object({ q1: answer, q2: answer, q3: answer, q4: answer }),
    number: short(20),
    limits: long(),
    monitoring: long(),
    frequency: short(),
    responsibleId: id().nullable(),
    corrective: long(),
    journalCode: short(64).nullable(),
    // Старые записи без числовых пределов остаются валидными.
    limitMin: z.number().finite().nullable().default(null),
    limitMax: z.number().finite().nullable().default(null),
    unit: short(16).default(""),
  })
  .superRefine((value, ctx) => {
    if (value.limitMin !== null && value.limitMax !== null && value.limitMin > value.limitMax) {
      ctx.addIssue({ code: "custom", path: ["limitMin"], message: "Нижний предел больше верхнего" });
    }
    // У ККТ и ОПП номер обязателен: по нему ссылаются журнал и рабочий лист.
    if ((value.kind === "ccp" || value.kind === "oprp") && value.number.length === 0) {
      ctx.addIssue({ code: "custom", path: ["number"], message: "Укажите номер ККТ или ОПП" });
    }
  });

const pestPlanSchema = z.object({
  kind: z.enum(["disinsection", "deratization", "disinfection"]),
  object: short(200).min(1),
  frequency: short(100),
  contractor: short(200),
  lastDate: dateOnly,
  nextDate: dateOnly,
});

const labPlanSchema = z.object({
  object: z.enum(["product", "swabs", "water", "air", "other"]),
  subject: short(200).min(1),
  indicator: short(300),
  everyMonths: z.number().int().min(1).max(24),
  laboratory: short(200),
  lastDate: dateOnly,
});

const NORM_IDS = new Set(NORM_CATALOG.map((doc) => doc.id));
const normsSchema = z.object({
  selected: z
    .array(z.string().refine((value) => NORM_IDS.has(value), "Нет такого документа в каталоге"))
    .max(50),
  custom: z.array(z.object({ title: short(300).min(1) })).max(50),
});

const coord = z.number().min(0).max(4000);
const size = z.number().min(40).max(2000);

const diagramNodeSchema = z.object({
  id: id(),
  x: coord,
  y: coord,
  w: size,
  h: size,
  label: short(120),
  kind: z.enum(["step", "room"]),
  ccp: short(20).nullable(),
  areaId: id().nullable(),
});

const diagramEdgeSchema = z.object({
  id: id(),
  from: id().nullable(),
  to: id().nullable(),
  points: z.array(z.object({ x: coord, y: coord })).max(50),
  flow: z.enum(["raw", "ready", "waste", "staff", "dishes"]).nullable(),
  label: short(120),
});

const diagramBase = z.object({
  title: short(120),
  nodes: z.array(diagramNodeSchema).max(150),
  edges: z.array(diagramEdgeSchema).max(300),
});

/** Блок-схема: только этапы, связи ссылаются на этапы этой же схемы. */
const flowchartSchema = diagramBase.superRefine((value, ctx) => {
  const ids = new Set(value.nodes.map((n) => n.id));
  if (ids.size !== value.nodes.length) {
    ctx.addIssue({ code: "custom", path: ["nodes"], message: "Повторяется id этапа" });
  }
  value.nodes.forEach((n, i) => {
    if (n.kind !== "step") ctx.addIssue({ code: "custom", path: ["nodes", i, "kind"], message: "Только этапы" });
  });
  value.edges.forEach((e, i) => {
    if (!e.from || !ids.has(e.from)) ctx.addIssue({ code: "custom", path: ["edges", i, "from"], message: "Нет этапа" });
    if (!e.to || !ids.has(e.to)) ctx.addIssue({ code: "custom", path: ["edges", i, "to"], message: "Нет этапа" });
  });
});

/** План помещений: только помещения, потоки — ломаные от двух точек с видом потока. */
const floorPlanSchema = diagramBase.superRefine((value, ctx) => {
  const ids = new Set(value.nodes.map((n) => n.id));
  if (ids.size !== value.nodes.length) {
    ctx.addIssue({ code: "custom", path: ["nodes"], message: "Повторяется id помещения" });
  }
  value.nodes.forEach((n, i) => {
    if (n.kind !== "room") ctx.addIssue({ code: "custom", path: ["nodes", i, "kind"], message: "Только помещения" });
  });
  value.edges.forEach((e, i) => {
    if (e.points.length < 2) ctx.addIssue({ code: "custom", path: ["edges", i, "points"], message: "Нужно две точки" });
    if (!e.flow) ctx.addIssue({ code: "custom", path: ["edges", i, "flow"], message: "Укажите вид потока" });
  });
});

export const PPK_RECORD_SCHEMAS: Record<PpkRecordBlock, z.ZodTypeAny> = {
  team: teamSchema,
  policy: policySchema,
  products: productSchema,
  hazards: hazardSchema,
  "control-points": controlPointSchema,
  flowchart: flowchartSchema,
  "floor-plan": floorPlanSchema,
  "pest-plan": pestPlanSchema,
  "lab-plan": labPlanSchema,
  norms: normsSchema,
};

/** Тип данных записи по блоку. */
export type PpkRecordDataMap = {
  team: TeamMember;
  policy: PolicyData;
  products: ProductData;
  hazards: HazardData;
  "control-points": ControlPointData;
  flowchart: DiagramData;
  "floor-plan": DiagramData;
  "pest-plan": PestPlanItem;
  "lab-plan": LabPlanItem;
  norms: NormsData;
};

export type ParsedPpkRecord<B extends PpkRecordBlock> = {
  id: string;
  data: PpkRecordDataMap[B];
  sortOrder: number;
  updatedAt: Date;
};

/**
 * Оставляет строки, данные которых проходят схему блока, и отдаёт их с типизированным
 * `data`: одна испорченная запись не должна ронять страницу. У политики сохраняется
 * `token` (схема клиента его отбрасывает, а странице он нужен для QR).
 */
export function parsePpkRecords<B extends PpkRecordBlock>(
  block: B,
  rows: { id: string; data: unknown; sortOrder: number; updatedAt: Date }[],
): ParsedPpkRecord<B>[] {
  const out: ParsedPpkRecord<B>[] = [];
  for (const row of rows) {
    const parsed = PPK_RECORD_SCHEMAS[block].safeParse(row.data);
    if (!parsed.success) continue;
    let data = parsed.data as Record<string, unknown>;
    if (block === "policy") {
      const token = (row.data as { token?: unknown } | null)?.token;
      data = { ...data, token: typeof token === "string" ? token : "" };
    }
    out.push({
      id: row.id,
      data: data as PpkRecordDataMap[B],
      sortOrder: row.sortOrder,
      updatedAt: row.updatedAt,
    });
  }
  return out;
}

/**
 * Проверка состава группы ХАССП: один руководитель, сотрудник не повторяется.
 * `others` — остальные записи группы (при правке — без самой записи).
 */
export function checkTeamGroup(others: TeamMember[], candidate: TeamMember): string | null {
  if (others.some((member) => member.userId === candidate.userId)) return "Сотрудник уже в группе";
  if (candidate.role === "leader" && others.some((member) => member.role === "leader")) {
    return "Руководитель группы уже назначен";
  }
  return null;
}
