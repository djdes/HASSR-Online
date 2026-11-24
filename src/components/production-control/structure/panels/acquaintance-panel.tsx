import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { ackSummaryFor, ppkAckVersion } from "@/lib/ppk/acknowledge.server";
import { loadEnabledJournals } from "@/lib/ppk/journals.server";
import { journalResponsibles } from "@/lib/ppk/officials";
import { parsePpkRecords } from "@/lib/ppk/records";
import { ppkWhere } from "@/lib/ppk/scope";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { visibleStaffWhere } from "@/lib/people-scope.server";
import { AckSummary } from "@/components/production-control/ack-summary";
import type { PpkPanelProps } from "../item-panel";
import { PanelEmpty, PanelNote, PanelSection, PanelTable, SourceLink } from "./panel-ui";
import { AckPinSign } from "./ack-pin-sign";

const ROLE_ORDER = { leader: 0, deputy: 1, member: 2, secretary: 3 } as const;

/**
 * 3.7 «Список должностных лиц… (Лист ознакомления)»: группа ХАССП и
 * ответственные за журналы; лист ознакомления с отметкой «Ознакомлен и
 * согласен» — сотрудник сам в кабинете или PIN-кодом на этом устройстве.
 */
export async function AcquaintancePanel({ scope, session }: PpkPanelProps) {
  const [teamRows, staff, journals, org, version, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { ...ppkWhere(scope), block: "team" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    loadPpkStaff(scope),
    loadEnabledJournals(scope.organizationId, scope.buildingId),
    db.organization.findUnique({
      where: { id: scope.organizationId },
      select: { timezone: true, journalResponsibleUsersJson: true },
    }),
    ppkAckVersion(scope),
    getTranslations("productionControl.structure.acquaintance"),
  ]);
  const people = new Map(staff.map((person) => [person.id, person]));
  const team = parsePpkRecords("team", teamRows)
    .map((row) => row.data)
    .filter((member) => people.has(member.userId))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  const responsibles = journalResponsibles(journals, org?.journalResponsibleUsersJson, people);

  const officialRows = [
    ...team.map((member) => [
      people.get(member.userId)!.name,
      people.get(member.userId)!.title || "—",
      t(`roles.${member.role}`),
    ]),
    ...responsibles.map((person) => [person.name, person.title || "—", t("journalsDuty", { journals: person.journals.join(", ") })]),
  ];

  const summary = version
    ? await ackSummaryFor(scope, "ppk", org?.timezone ?? "Europe/Moscow", await visibleStaffWhere(session))
    : null;

  return (
    <div className="space-y-8">
      <PanelSection
        title={t("officialsTitle")}
        actions={
          <>
            <SourceLink href="/production-control/haccp/team">{t("editTeam")}</SourceLink>
            <SourceLink href="/settings/journal-responsibles">{t("editResponsibles")}</SourceLink>
          </>
        }
      >
        {officialRows.length === 0 ? (
          <PanelEmpty title={t("noOfficials")} hint={t("noOfficialsHint")} />
        ) : (
          <PanelTable heads={[t("colName"), t("colPosition"), t("colDuty")]} rows={officialRows} />
        )}
      </PanelSection>

      <PanelSection title={t("sheetTitle")} hint={t("sheetHint")}>
        {!version || !summary ? (
          <PanelNote tone="warn">
            {t("needApproval")} <SourceLink href="/production-control/program">{t("toProgram")}</SourceLink>
          </PanelNote>
        ) : (
          <div className="space-y-4">
            <AckSummary docKey="ppk" stats={summary} />
            {summary.acknowledged.length > 0 ? (
              <PanelTable
                heads={[t("colName"), t("colMark"), t("colDate")]}
                rows={summary.acknowledged.map((row) => [
                  row.name,
                  `${t("agreed")} · ${t(`method.${row.method}`)}`,
                  `${row.date} ${row.time}`,
                ])}
              />
            ) : null}
            <AckPinSign pending={summary.pending} />
          </div>
        )}
      </PanelSection>
    </div>
  );
}
