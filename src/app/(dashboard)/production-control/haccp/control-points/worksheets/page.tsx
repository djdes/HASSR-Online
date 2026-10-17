import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import type { ControlPointData, HazardData } from "@/lib/ppk/records";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { loadEnabledJournals } from "@/lib/ppk/journals.server";
import { PpkPrintSheet, loadPpkPrintOrg } from "@/components/production-control/ppk-print-sheet";
import { PpkEmptyState, PPK_BUTTON_OUTLINE_CLASS } from "@/components/production-control/ppk-ui";

export const dynamic = "force-dynamic";

/** Рабочие листы ККТ и ОПП: по листу A4 на точку; `?id=` — только один лист. */
export default async function ControlPointWorksheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);
  const { id } = await searchParams;
  const onlyId = typeof id === "string" ? id.slice(0, 64) : null;

  const select = { id: true, data: true } as const;
  const orderBy = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }];
  const [pointRows, hazardRows, staff, journals, org, t, tw, th] = await Promise.all([
    db.ppkRecord.findMany({ where: { organizationId, block: "control-points" }, select, orderBy }),
    db.ppkRecord.findMany({ where: { organizationId, block: "hazards" }, select }),
    loadPpkStaff(organizationId),
    loadEnabledJournals(organizationId),
    loadPpkPrintOrg(organizationId),
    getTranslations("productionControl.controlPoints"),
    getTranslations("productionControl.worksheet"),
    getTranslations("productionControl.hazards"),
  ]);

  const hazards = new Map(hazardRows.map((row) => [row.id, row.data as unknown as HazardData]));
  const journalNames = new Map(journals.map((journal) => [journal.code, journal.name]));
  const people = new Map(staff.map((person) => [person.id, person]));
  const sheets = pointRows
    .map((row) => ({ id: row.id, data: row.data as unknown as ControlPointData }))
    .filter((point) => (point.data.kind === "ccp" || point.data.kind === "oprp") && (!onlyId || point.id === onlyId));

  if (sheets.length === 0) {
    return (
      <PpkEmptyState title={tw("emptyHint")} hint={t("emptyHint")}>
        <Link href="/production-control/haccp/control-points" className={PPK_BUTTON_OUTLINE_CLASS}>
          {tw("toPoints")}
        </Link>
      </PpkEmptyState>
    );
  }

  return (
    <div className="space-y-8">
      {sheets.map(({ id: pointId, data }) => {
        const hazard = data.hazardId ? hazards.get(data.hazardId) : undefined;
        const person = data.responsibleId ? people.get(data.responsibleId) : undefined;
        const rows: [string, string][] = [
          [tw("step"), hazard?.step ?? "—"],
          [tw("hazard"), hazard ? `${hazard.hazard} (${th(`types.${hazard.type}`)})` : t("hazardDeleted")],
          [tw("kind"), t(`kinds.${data.kind}`)],
          [tw("limits"), data.limits || "—"],
          [tw("monitoring"), data.monitoring || "—"],
          [tw("frequency"), data.frequency || "—"],
          [tw("responsible"), person ? `${person.name}${person.title ? `, ${person.title}` : ""}` : "—"],
          [tw("corrective"), data.corrective || "—"],
          [tw("records"), (data.journalCode && journalNames.get(data.journalCode)) || "—"],
        ];
        return (
          <div key={pointId} className="print:break-after-page print:last:break-after-auto">
            <PpkPrintSheet org={org} title={tw("title", { number: data.number })}>
              <table className="w-full border-collapse text-[13.5px]">
                <tbody>
                  {rows.map(([label, value]) => (
                    <tr key={label} className="align-top">
                      <th className="w-[34%] border border-[#cfd3e6] bg-[#fafbff] px-3 py-2 text-left font-medium text-[#3c4053] print:bg-transparent">
                        {label}
                      </th>
                      <td className="whitespace-pre-line border border-[#cfd3e6] px-3 py-2">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-10 text-[13.5px]">
                {tw("acquainted")}: ____________ / ____________ / {tw("date")} ____________
              </p>
            </PpkPrintSheet>
          </div>
        );
      })}
    </div>
  );
}
