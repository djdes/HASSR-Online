import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadPpkBundle } from "@/lib/ppk/assemble.server";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { loadDocVersions } from "@/lib/ppk/review.server";
import { approvalOf } from "@/lib/ppk/review";
import { moscowToday } from "@/lib/ppk/plan-done";
import { EMERGENCIES, MEDICAL_PHRASE } from "@/lib/ppk/program-content";
import { ppkBlock, type PpkBlockKey } from "@/lib/ppk/registry";
import { ppkGeneralInfoRows } from "@/lib/ppk/print-org";
import { PpkPrintSheet } from "@/components/production-control/ppk-print-sheet";
import { PpkDocVersions } from "@/components/production-control/ppk-doc-versions";
import {
  PpkApproveBlock,
  PpkDocSection,
  PpkDocTable,
  ruDate,
  type PpkEmptyBanner,
} from "@/components/production-control/ppk-doc-ui";
import { ppkPageScope } from "@/lib/ppk/access.server";

export const dynamic = "force-dynamic";

/** Лист ознакомления: строк не больше этого числа. */
const ACQUAINTANCE_MAX = 30;

/** Программа производственного контроля: собирается из заполненных блоков раздела. */
export default async function ProgramPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  // ППК на точку (2026-11-01): ППК точки из шапки или организации.
  const scope = await ppkPageScope(session);

  const [bundle, versionRows, staff, t, nav, u] = await Promise.all([
    loadPpkBundle(scope),
    loadDocVersions(scope),
    loadPpkStaff(scope),
    getTranslations("productionControl.program"),
    getTranslations("navigation"),
    getTranslations("productionControlUi"),
  ]);
  const { org } = bundle;
  const roleLabel = (role: "leader" | "deputy" | "member" | "secretary") => {
    switch (role) {
      case "leader": return u("programPage.roleLeader");
      case "deputy": return u("programPage.roleDeputy");
      case "member": return u("programPage.roleMember");
      case "secretary": return u("programPage.roleSecretary");
    }
  };
  const pestKindLabel = (kind: "disinsection" | "deratization" | "disinfection") => {
    switch (kind) {
      case "disinsection": return u("programPage.pestDisinsection");
      case "deratization": return u("programPage.pestDeratization");
      case "disinfection": return u("programPage.pestDisinfection");
    }
  };
  const labObjectLabel = (object: "product" | "swabs" | "water" | "air" | "other") => {
    switch (object) {
      case "product": return u("programPage.labProduct");
      case "swabs": return u("programPage.labSwabs");
      case "water": return u("programPage.labWater");
      case "air": return u("programPage.labAir");
      case "other": return u("programPage.labOther");
    }
  };
  const banner = (key: PpkBlockKey): PpkEmptyBanner => ({
    href: ppkBlock(key).href,
    text: t("emptySection", { block: nav(`shell.menus.productionControl.items.${key}`) }),
    linkText: t("fill"),
  });

  const approval = approvalOf(versionRows.map((row) => row.data), "ppk", staff);
  const leader = bundle.team.find((member) => member.role === "leader");
  // Лист ознакомления: Ф. И. О. и должности — из списка сотрудников, даты и подписи ставят от руки.
  const acquaintanceRows = staff.slice(0, ACQUAINTANCE_MAX);

  return (
    <div className="space-y-4">
    <PpkDocVersions
      doc="ppk"
      initial={versionRows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))}
      staff={staff}
      today={moscowToday()}
    />
    <PpkPrintSheet
      pdfHref="/api/production-control/program/pdf"
      pdfLabel={t("downloadPdf")}
      org={org}
      title={u("programPage.title")}
      subtitle={approval ? u("programPage.versionFrom", { version: String(approval.version), date: ruDate(approval.approvedAt) }) : org.orgName}
    >
      <PpkApproveBlock org={org} approval={approval} />

      <PpkDocSection title={u("programPage.s1")}>
        <PpkDocTable heads={[u("programPage.colIndicator"), u("programPage.colValue")]} rows={ppkGeneralInfoRows(org, leader)} />
      </PpkDocSection>

      <PpkDocSection
        title={u("programPage.s2")}
        empty={bundle.norms.length === 0 ? banner("norm-documents") : null}
      >
        <ol className="list-decimal space-y-1 pl-6">
          {bundle.norms.map((title) => (
            <li key={title}>{title}</li>
          ))}
        </ol>
      </PpkDocSection>

      <PpkDocSection
        title={u("programPage.s3")}
        empty={bundle.team.length === 0 && bundle.responsibles.length === 0 ? banner("team") : null}
      >
        <PpkDocTable
          heads={[u("programPage.colFullName"), u("programPage.colPosition"), u("programPage.colFunction")]}
          rows={[
            ...bundle.team.map((member) => [
              member.name,
              member.title || "—",
              `${roleLabel(member.role)}${member.duties ? `. ${member.duties}` : ""}`,
            ]),
            ...bundle.responsibles.map((person) => [
              person.name,
              person.title || "—",
              u("programPage.journalsResponsible", { journals: person.journals.join(", ") }),
            ]),
          ]}
        />
      </PpkDocSection>

      <PpkDocSection title={u("programPage.s4")} empty={bundle.lab.length === 0 ? banner("lab") : null}>
        <PpkDocTable
          heads={[u("programPage.colObject"), u("programPage.colSubject"), u("programPage.colIndicators"), u("programPage.colFrequency"), u("programPage.colLaboratory")]}
          rows={bundle.lab.map((item) => [
            labObjectLabel(item.object),
            item.subject,
            item.indicator || "—",
            `${u("programPage.everyMonths", { months: item.everyMonths })}${item.nextDate ? u("programPage.nextSuffix", { date: ruDate(item.nextDate) }) : ""}`,
            item.laboratory || "—",
          ])}
        />
      </PpkDocSection>

      <PpkDocSection
        title={u("programPage.s5")}
        empty={bundle.positions.length === 0 ? banner("team") : null}
      >
        <ul className="list-disc space-y-1 pl-6">
          {bundle.positions.map((title) => (
            <li key={title}>{title}</li>
          ))}
        </ul>
        <p className="mt-2">{MEDICAL_PHRASE}</p>
      </PpkDocSection>

      <PpkDocSection
        title={u("programPage.s6")}
        empty={bundle.pest.length === 0 ? banner("pest-control") : null}
      >
        <PpkDocTable
          heads={[u("programPage.colKind"), u("programPage.colObject"), u("programPage.colFrequency"), u("programPage.colPerformer"), u("programPage.colLast"), u("programPage.colNext")]}
          rows={bundle.pest.map((item) => [
            pestKindLabel(item.kind),
            item.object,
            item.frequency || "—",
            item.contractor || "—",
            ruDate(item.lastDate),
            ruDate(item.nextDate),
          ])}
        />
      </PpkDocSection>

      <PpkDocSection
        title={u("programPage.s7")}
        empty={bundle.journals.length === 0 ? banner("instructions") : null}
      >
        <ol className="list-decimal space-y-0.5 pl-6">
          {bundle.journals.map((journal) => (
            <li key={journal.code}>{journal.name}</li>
          ))}
        </ol>
      </PpkDocSection>

      <PpkDocSection title={u("programPage.s8")}>
        <ol className="list-decimal space-y-2 pl-6">
          {EMERGENCIES.map((item) => (
            <li key={item.title}>
              <span className="font-semibold">{item.title}.</span> {item.actions}
            </li>
          ))}
        </ol>
      </PpkDocSection>

      <PpkDocSection title={u("programPage.s9")}>
        <PpkDocTable
          heads={[u("programPage.colFullName"), u("programPage.colPosition"), u("programPage.colDate"), u("programPage.colSignature")]}
          rows={
            acquaintanceRows.length
              ? acquaintanceRows.map((person) => [person.name, person.title, "", ""])
              : [[<span key="gap" className="block h-5" />, "", "", ""]]
          }
        />
      </PpkDocSection>
    </PpkPrintSheet>
    </div>
  );
}
