import { getTranslations } from "next-intl/server";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import type { PpkPanelProps } from "../item-panel";
import { PanelEmpty, PanelNote, PanelTable, SourceLink } from "./panel-ui";

/**
 * 3.5 «Перечень персонала по должностям, подлежащий медицинским осмотрам,
 * профессиональной гигиенической подготовке и аттестации»: должности и люди
 * подтягиваются из «Сотрудников» объекта. В общепите это все работники
 * производства — отметки «да» у каждой должности.
 */
export async function StaffPanel({ scope }: PpkPanelProps) {
  const [staff, t] = await Promise.all([loadPpkStaff(scope), getTranslations("productionControl.structure.staff")]);
  if (staff.length === 0) {
    return <PanelEmpty title={t("empty")} hint={t("emptyHint")} action={<SourceLink href="/staff">{t("openStaff")}</SourceLink>} />;
  }
  const byTitle = new Map<string, string[]>();
  for (const person of staff) {
    const title = person.title || t("noPosition");
    byTitle.set(title, [...(byTitle.get(title) ?? []), person.name]);
  }
  const positions = [...byTitle.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru"));
  return (
    <div className="space-y-4">
      <PanelNote>{t("note")}</PanelNote>
      <PanelTable
        heads={[t("colPosition"), t("colPeople"), t("colMedical"), t("colHygiene")]}
        rows={positions.map(([title, names]) => [
          <span key="t" className="font-medium">
            {title}
            <span className="ml-1.5 text-[12.5px] font-normal tabular-nums text-[#6f7282]">{names.length}</span>
          </span>,
          names.join(", "),
          t("yes"),
          t("yes"),
        ])}
      />
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <SourceLink href="/staff">{t("openStaff")}</SourceLink>
        <SourceLink href="/settings/staff-health">{t("openMedBooks")}</SourceLink>
      </div>
    </div>
  );
}
