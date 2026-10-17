import { db } from "@/lib/db";
import { loadPpkPrintOrg, type PpkPrintOrg } from "@/components/production-control/ppk-print-sheet";
import { NORM_CATALOG } from "./norm-catalog";
import { labNextDate } from "./sanitation";
import { loadPpkStaff } from "./staff.server";
import { loadEnabledJournals } from "./journals.server";
import { loadDocVersions } from "./review.server";
import { approvalOf } from "./review";
import {
  PPK_RECORD_SCHEMAS,
  type ControlPointData,
  type DiagramData,
  type HazardData,
  type LabPlanItem,
  type NormsData,
  type PestPlanItem,
  type PolicyData,
  type ProductData,
  type TeamMember,
} from "./records";

export type BundleTeamMember = TeamMember & { name: string; title: string };

export type BundleControlPoint = ControlPointData & {
  id: string;
  /** Этап и опасность из связанной записи анализа; null, если опасность удалена. */
  hazardStep: string | null;
  hazardText: string | null;
  responsibleName: string | null;
  journalName: string | null;
};

export type BundleResponsible = { name: string; title: string; journals: string[] };

/** Всё, что нужно для сборки Программы производственного контроля и ХАССП-плана. */
export type PpkBundle = {
  /** Организация: логотип и реквизиты (в `snapshot` — директор). */
  org: PpkPrintOrg;
  /** Группа ХАССП: руководитель первым. */
  team: BundleTeamMember[];
  policy: (Omit<PolicyData, "token" | "approvedById"> & { approvedByName: string | null }) | null;
  products: ProductData[];
  flowcharts: (DiagramData & { id: string })[];
  hazards: (HazardData & { id: string })[];
  points: BundleControlPoint[];
  /** Названия нормативных документов: выбранные из каталога и свои. */
  norms: string[];
  lab: (LabPlanItem & { nextDate: string | null })[];
  pest: PestPlanItem[];
  journals: { code: string; name: string }[];
  /** Число сотрудников ростера (для листа ознакомления). */
  staffCount: number;
  /** Уникальные должности сотрудников. */
  positions: string[];
  /** Ответственные за журналы (по назначениям «Ответственные за журналы»). */
  responsibles: BundleResponsible[];
  /** Сотрудники ростера: Ф. И. О. и должности (лист ознакомления). */
  roster: { name: string; title: string }[];
  /** Последняя утверждённая версия документа (для «УТВЕРЖДАЮ» и подзаголовка) или null. */
  approvals: Record<"ppk" | "haccp-plan", BundleApproval | null>;
};

export type BundleApproval = NonNullable<ReturnType<typeof approvalOf>>;

const TEAM_ORDER: Record<TeamMember["role"], number> = { leader: 0, deputy: 1, member: 2, secretary: 3 };

/**
 * Данные всех блоков раздела одним объектом. Записи с битыми данными
 * пропускаются: одна испорченная строка не должна ломать документ.
 */
export async function loadPpkBundle(organizationId: string): Promise<PpkBundle> {
  const [org, rows, staff, journals, orgSettings, versionRows] = await Promise.all([
    loadPpkPrintOrg(organizationId),
    db.ppkRecord.findMany({
      where: { organizationId },
      select: { id: true, block: true, data: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    loadPpkStaff(organizationId),
    loadEnabledJournals(organizationId),
    db.organization.findUnique({ where: { id: organizationId }, select: { journalResponsibleUsersJson: true } }),
    loadDocVersions(organizationId),
  ]);

  const valid = <T,>(block: keyof typeof PPK_RECORD_SCHEMAS): { id: string; data: T }[] =>
    rows
      .filter((row) => row.block === block)
      .flatMap((row) => {
        const parsed = PPK_RECORD_SCHEMAS[block].safeParse(row.data);
        return parsed.success ? [{ id: row.id, data: parsed.data as T }] : [];
      });

  const people = new Map(staff.map((person) => [person.id, person]));
  const journalNames = new Map(journals.map((journal) => [journal.code, journal.name]));

  const team = valid<TeamMember>("team")
    .map(({ data }) => {
      const person = people.get(data.userId);
      return person ? { ...data, name: person.name, title: person.title } : null;
    })
    .filter((member): member is BundleTeamMember => member !== null)
    .sort((a, b) => TEAM_ORDER[a.role] - TEAM_ORDER[b.role]);

  const policyRow = valid<Omit<PolicyData, "token">>("policy")[0]?.data;
  const policy =
    policyRow && policyRow.text.trim()
      ? {
          text: policyRow.text,
          approvedAt: policyRow.approvedAt,
          approvedByName: policyRow.approvedById ? (people.get(policyRow.approvedById)?.name ?? null) : null,
        }
      : null;

  const hazards = valid<HazardData>("hazards").map(({ id, data }) => ({ id, ...data }));
  const hazardById = new Map(hazards.map((hazard) => [hazard.id, hazard]));

  const points = valid<ControlPointData>("control-points").map(({ id, data }) => {
    const hazard = data.hazardId ? hazardById.get(data.hazardId) : undefined;
    return {
      ...data,
      id,
      hazardStep: hazard?.step ?? null,
      hazardText: hazard?.hazard ?? null,
      responsibleName: data.responsibleId ? (people.get(data.responsibleId)?.name ?? null) : null,
      journalName: data.journalCode ? (journalNames.get(data.journalCode) ?? null) : null,
    };
  });

  const normsRow = valid<NormsData>("norms")[0]?.data;
  const norms = normsRow
    ? [
        ...NORM_CATALOG.filter((doc) => normsRow.selected.includes(doc.id)).map((doc) => doc.title),
        ...normsRow.custom.map((doc) => doc.title),
      ]
    : [];

  // Ответственные за журналы: пользователь → названия включённых журналов.
  const assigned = (orgSettings?.journalResponsibleUsersJson ?? {}) as Record<string, Record<string, string | null>>;
  const byUser = new Map<string, string[]>();
  for (const journal of journals) {
    const slots = assigned[journal.code];
    if (!slots || typeof slots !== "object") continue;
    for (const userId of new Set(Object.values(slots))) {
      if (typeof userId !== "string" || !people.has(userId)) continue;
      byUser.set(userId, [...(byUser.get(userId) ?? []), journal.name]);
    }
  }
  const responsibles = [...byUser.entries()]
    .map(([userId, names]) => ({ name: people.get(userId)!.name, title: people.get(userId)!.title, journals: names }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return {
    org,
    team,
    policy,
    products: valid<ProductData>("products").map(({ data }) => data),
    flowcharts: valid<DiagramData>("flowchart").map(({ id, data }) => ({ id, ...data })),
    hazards,
    points,
    norms,
    lab: valid<LabPlanItem>("lab-plan").map(({ data }) => ({ ...data, nextDate: labNextDate(data) })),
    pest: valid<PestPlanItem>("pest-plan").map(({ data }) => data),
    journals,
    staffCount: staff.length,
    positions: [...new Set(staff.map((person) => person.title).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")),
    responsibles,
    roster: staff.map((person) => ({ name: person.name, title: person.title })),
    approvals: {
      ppk: approvalOf(versionRows.map((row) => row.data), "ppk", staff),
      "haccp-plan": approvalOf(versionRows.map((row) => row.data), "haccp-plan", staff),
    },
  };
}
