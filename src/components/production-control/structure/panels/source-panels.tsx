import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { loadEnabledJournals } from "@/lib/ppk/journals.server";
import { ppkEquipmentWhere } from "@/lib/ppk/structure-facts.server";
import { PpkDocsList, type DocRow } from "@/components/production-control/ppk-docs-list";
import { hasCapability } from "@/lib/permission-presets";
import { ppkWhere } from "@/lib/ppk/scope";
import type { PpkPanelProps } from "../item-panel";
import { PanelEmpty, PanelNote, PanelTable, SourceLink } from "./panel-ui";

/** Приложение № 1 «Список технологического оборудования производства» — из «Оборудования» объекта. */
export async function EquipmentPanel({ scope }: PpkPanelProps) {
  const [equipment, t] = await Promise.all([
    db.equipment.findMany({
      where: ppkEquipmentWhere(scope),
      select: {
        id: true,
        name: true,
        type: true,
        serialNumber: true,
        tempMin: true,
        tempMax: true,
        area: { select: { name: true } },
      },
      orderBy: [{ area: { name: "asc" } }, { name: "asc" }],
      take: 1000,
    }),
    getTranslations("productionControl.structure.equipment"),
  ]);
  if (equipment.length === 0) {
    return (
      <PanelEmpty title={t("empty")} hint={t("emptyHint")} action={<SourceLink href="/settings/equipment">{t("open")}</SourceLink>} />
    );
  }
  const range = (min: number | null, max: number | null) =>
    min === null && max === null ? "—" : `${min ?? "…"} … ${max ?? "…"} °C`;
  return (
    <div className="space-y-3">
      <PanelTable
        heads={["№", t("colName"), t("colType"), t("colArea"), t("colSerial"), t("colRange")]}
        rows={equipment.map((item, index) => [
          String(index + 1),
          <span key="n" className="font-medium">
            {item.name}
          </span>,
          item.type || "—",
          item.area.name,
          item.serialNumber || "—",
          range(item.tempMin, item.tempMax),
        ])}
      />
      <SourceLink href="/settings/equipment">{t("open")}</SourceLink>
    </div>
  );
}

/** Приложение № 4 «Перечень журналов по системе ХАССП» — включённые журналы объекта. */
export async function JournalsPanel({ scope }: PpkPanelProps) {
  const [journals, t] = await Promise.all([
    loadEnabledJournals(scope.organizationId, scope.buildingId),
    getTranslations("productionControl.structure.journals"),
  ]);
  if (journals.length === 0) {
    return <PanelEmpty title={t("empty")} hint={t("emptyHint")} action={<SourceLink href="/settings/journals">{t("open")}</SourceLink>} />;
  }
  return (
    <div className="space-y-3">
      <PanelNote>{t("note", { count: String(journals.length) })}</PanelNote>
      <ol className="grid gap-x-6 gap-y-1.5 text-[14px] text-[#0b1024] sm:grid-cols-2">
        {journals.map((journal, index) => (
          <li key={journal.code} className="flex gap-2">
            <span className="w-7 shrink-0 text-right tabular-nums text-[#6f7282]">{index + 1}.</span>
            <span className="min-w-0">{journal.name}</span>
          </li>
        ))}
      </ol>
      <SourceLink href="/settings/journals">{t("open")}</SourceLink>
    </div>
  );
}

const DOC_SELECT = { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true } as const;
const docRow = (row: { id: string; title: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: Date }): DocRow => ({
  ...row,
  title: row.title || row.fileName,
  createdAt: row.createdAt.toISOString(),
});

/** Приложение № 5 «Документированные процедуры» — текстом с нашей шапкой или файлом, у каждого — редакция. */
export async function ProceduresPanel({ scope }: PpkPanelProps) {
  const [t, org, docs] = await Promise.all([
    getTranslations("productionControl.structure.procedures"),
    db.organization.findUnique({ where: { id: scope.organizationId }, select: { timezone: true } }),
    db.knowledgeDocument.findMany({ where: { ...ppkWhere(scope), folder: "procedures" }, select: DOC_SELECT, orderBy: { createdAt: "desc" }, take: 500 }),
  ]);
  return (
    <div className="space-y-4">
      <PanelNote>{t("note")}</PanelNote>
      {/* Окно пункта открывает тот, кто ведёт ППК, — он же правит процедуры. */}
      <PpkDocsList source="procedures" timeZone={org?.timezone || "Europe/Moscow"} canManage initial={docs.map(docRow)} />
    </div>
  );
}

/** Приложение № 6 «Рабочие инструкции» — документы базы знаний: текстом или файлом, у каждого — редакция. */
export async function InstructionsPanel({ scope, session }: PpkPanelProps) {
  const [t, org, docs] = await Promise.all([
    getTranslations("productionControl.structure.instructions"),
    db.organization.findUnique({ where: { id: scope.organizationId }, select: { timezone: true } }),
    db.knowledgeDocument.findMany({
      where: { organizationId: scope.organizationId, kind: null, folder: null },
      select: DOC_SELECT,
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);
  return (
    <div className="space-y-4">
      <PanelNote>{t("note")}</PanelNote>
      <PpkDocsList
        source="knowledge"
        timeZone={org?.timezone || "Europe/Moscow"}
        canManage={hasCapability(session.user, "admin.full")}
        initial={docs.map(docRow)}
      />
      <SourceLink href="/knowledge">{t("open")}</SourceLink>
    </div>
  );
}
