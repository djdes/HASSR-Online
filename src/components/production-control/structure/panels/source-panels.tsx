import { getLocale, getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { db } from "@/lib/db";
import { loadEnabledJournals } from "@/lib/ppk/journals.server";
import { ppkEquipmentWhere } from "@/lib/ppk/structure-facts.server";
import { PpkFolder } from "@/components/production-control/ppk-folder";
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

/** Приложение № 5 «Документированные процедуры» — папка процедур (текст с шапкой или скан). */
export async function ProceduresPanel(_props: PpkPanelProps) {
  const t = await getTranslations("productionControl.structure.procedures");
  return (
    <div className="space-y-4">
      <PanelNote>{t("note")}</PanelNote>
      <PpkFolder folder="procedures" canManage />
    </div>
  );
}

/** Приложение № 6 «Рабочие инструкции» — документы «Рабочих инструкций» (база знаний). */
export async function InstructionsPanel({ scope }: PpkPanelProps) {
  const [docs, t, locale] = await Promise.all([
    db.knowledgeDocument.findMany({
      where: { organizationId: scope.organizationId, kind: null, folder: null },
      select: { id: true, title: true, fileName: true, updatedAt: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    getTranslations("productionControl.structure.instructions"),
    getLocale(),
  ]);
  if (docs.length === 0) {
    return <PanelEmpty title={t("empty")} hint={t("emptyHint")} action={<SourceLink href="/knowledge">{t("open")}</SourceLink>} />;
  }
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {docs.map((doc, index) => (
          <li key={doc.id}>
            <a
              href={`/api/knowledge-documents/${doc.id}/file`}
              className="flex items-center gap-3 rounded-2xl bg-[var(--app-veil)] px-4 py-3 transition-colors duration-150 hover:bg-[var(--app-veil-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <span className="w-6 shrink-0 text-right text-[13px] tabular-nums text-[#6f7282]">{index + 1}.</span>
              <FileText className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-[#0b1024] [overflow-wrap:anywhere]">{doc.title}</span>
                <span className="block text-[12.5px] text-[#6f7282] [overflow-wrap:anywhere]">
                  {doc.fileName} · {doc.updatedAt.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <SourceLink href="/knowledge">{t("open")}</SourceLink>
    </div>
  );
}
