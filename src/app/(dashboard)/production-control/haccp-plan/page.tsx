import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadPpkBundle } from "@/lib/ppk/assemble.server";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { loadDocVersions } from "@/lib/ppk/review.server";
import { approvalOf } from "@/lib/ppk/review";
import { moscowToday } from "@/lib/ppk/plan-done";
import { diagramBounds } from "@/lib/ppk/diagram";
import { hazardRisk, isSignificantHazard } from "@/lib/ppk/haccp";
import { ppkBlock, type PpkBlockKey } from "@/lib/ppk/registry";
import { PpkPrintSheet } from "@/components/production-control/ppk-print-sheet";
import { PpkDocVersions } from "@/components/production-control/ppk-doc-versions";
import { DiagramSvg } from "@/components/production-control/diagram-svg";
import {
  PpkApproveBlock,
  PpkDocSection,
  PpkDocTable,
  ruDate,
  type PpkEmptyBanner,
} from "@/components/production-control/ppk-doc-ui";

export const dynamic = "force-dynamic";


/** План ХАССП: собирается из заполненных блоков группы, политики, продукции, схем, опасностей и ККТ. */
export default async function HaccpPlanPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);

  const [bundle, versionRows, staff, t, nav, u] = await Promise.all([
    loadPpkBundle(organizationId),
    loadDocVersions(organizationId),
    loadPpkStaff(organizationId),
    getTranslations("productionControl.program"),
    getTranslations("navigation"),
    getTranslations("productionControlUi"),
  ]);
  const { org } = bundle;
  const roleLabel = (role: "leader" | "deputy" | "member" | "secretary") => {
    switch (role) {
      case "leader": return u("haccpPlanPage.roleLeader");
      case "deputy": return u("haccpPlanPage.roleDeputy");
      case "member": return u("haccpPlanPage.roleMember");
      case "secretary": return u("haccpPlanPage.roleSecretary");
    }
  };
  const hazardTypeLabel = (type: "bio" | "chem" | "phys" | "allergen") => {
    switch (type) {
      case "bio": return u("haccpPlanPage.hazardBio");
      case "chem": return u("haccpPlanPage.hazardChem");
      case "phys": return u("haccpPlanPage.hazardPhys");
      case "allergen": return u("haccpPlanPage.hazardAllergen");
    }
  };
  const kindLabel = (kind: "ccp" | "oprp" | "prp" | "none") => {
    switch (kind) {
      case "ccp": return u("haccpPlanPage.kindCcp");
      case "oprp": return u("haccpPlanPage.kindOprp");
      case "prp": return u("haccpPlanPage.kindPrp");
      case "none": return "—";
    }
  };
  const banner = (key: PpkBlockKey): PpkEmptyBanner => ({
    href: ppkBlock(key).href,
    text: t("emptySection", { block: nav(`shell.menus.productionControl.items.${key}`) }),
    linkText: t("fill"),
  });

  const approval = approvalOf(versionRows.map((row) => row.data), "haccp-plan", staff);

  // Только ККТ и ОПП — у ПРП нет пределов и мониторинга.
  const controlPoints = bundle.points.filter((point) => point.kind === "ccp" || point.kind === "oprp");

  return (
    <>
      <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
      <div className="space-y-4">
      <PpkDocVersions
        doc="haccp-plan"
        initial={versionRows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))}
        staff={staff}
        today={moscowToday()}
      />
      <PpkPrintSheet
        pdfHref="/api/production-control/haccp-plan/pdf"
        pdfLabel={t("downloadPdf")}
        org={org}
        title={u("haccpPlanPage.title")}
        subtitle={approval ? u("haccpPlanPage.versionFrom", { version: String(approval.version), date: ruDate(approval.approvedAt) }) : org.orgName}
      >
        {approval?.approver ? <PpkApproveBlock org={org} approval={approval} /> : null}
        <PpkDocSection title={u("haccpPlanPage.s1")} empty={bundle.team.length === 0 ? banner("team") : null}>
          <PpkDocTable
            heads={[u("haccpPlanPage.colFullName"), u("haccpPlanPage.colPosition"), u("haccpPlanPage.colRole"), u("haccpPlanPage.colDuties")]}
            rows={bundle.team.map((member) => [member.name, member.title || "—", roleLabel(member.role), member.duties || "—"])}
          />
        </PpkDocSection>

        <PpkDocSection title={u("haccpPlanPage.s2")} empty={bundle.policy ? null : banner("policy")}>
          {bundle.policy ? (
            <>
              {bundle.policy.text.split(/\n{2,}/).map((paragraph) => (
                <p key={paragraph} className="mb-1.5 text-justify">
                  {paragraph}
                </p>
              ))}
              <p className="mt-2 text-[13px]">
                {bundle.policy.approvedByName
                  ? `${u("haccpPlanPage.approvedBy", { name: bundle.policy.approvedByName })}${bundle.policy.approvedAt ? `, ${ruDate(bundle.policy.approvedAt)}` : ""}`
                  : u("haccpPlanPage.approvalBlank")}
              </p>
            </>
          ) : null}
        </PpkDocSection>

        <PpkDocSection title={u("haccpPlanPage.s3")} empty={bundle.products.length === 0 ? banner("products") : null}>
          <div className="space-y-4">
            {bundle.products.map((product, index) => (
              <div key={`${product.name}-${index}`} className="break-inside-avoid">
                <h3 className="mb-1 text-[14px] font-semibold">{product.name}</h3>
                <PpkDocTable
                  heads={[u("haccpPlanPage.colIndicator"), u("haccpPlanPage.colValue")]}
                  rows={[
                    [u("haccpPlanPage.composition"), product.composition || "—"],
                    [u("haccpPlanPage.storage"), product.storage || "—"],
                    [u("haccpPlanPage.shelfLife"), product.shelfLife || "—"],
                    [u("haccpPlanPage.usage"), product.usage || "—"],
                    [u("haccpPlanPage.packaging"), product.packaging || "—"],
                    ...product.indicators.map((item) => [u("haccpPlanPage.indicatorNamed", { name: item.name }), item.norm || "—"]),
                  ]}
                />
              </div>
            ))}
          </div>
        </PpkDocSection>

        <PpkDocSection title={u("haccpPlanPage.s4")} empty={bundle.flowcharts.length === 0 ? banner("flowcharts") : null}>
          <div className="space-y-6">
            {bundle.flowcharts.map((chart) => {
              const box = diagramBounds(chart);
              return (
                <figure key={chart.id} className="break-inside-avoid">
                  <figcaption className="mb-1 text-[14px] font-semibold">{chart.title || u("haccpPlanPage.flowchartDefault")}</figcaption>
                  <DiagramSvg
                    data={chart}
                    kind="flowchart"
                    idPrefix={`plan-${chart.id}`}
                    viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
                    className="h-auto w-full"
                  />
                </figure>
              );
            })}
          </div>
        </PpkDocSection>

        <PpkDocSection title={u("haccpPlanPage.s5")} empty={bundle.hazards.length === 0 ? banner("hazards") : null}>
          <PpkDocTable
            small
            heads={[u("haccpPlanPage.colStep"), u("haccpPlanPage.colHazard"), u("haccpPlanPage.colType"), u("haccpPlanPage.colProbability"), u("haccpPlanPage.colSeverity"), u("haccpPlanPage.colRisk"), u("haccpPlanPage.colSignificant"), u("haccpPlanPage.colMeasures")]}
            rows={bundle.hazards.map((hazard) => [
              hazard.step,
              hazard.hazard,
              hazardTypeLabel(hazard.type),
              String(hazard.probability),
              String(hazard.severity),
              String(hazardRisk(hazard.probability, hazard.severity)),
              isSignificantHazard(hazard.probability, hazard.severity) ? u("haccpPlanPage.yes") : u("haccpPlanPage.no"),
              hazard.measures || "—",
            ])}
          />
        </PpkDocSection>

        <PpkDocSection title={u("haccpPlanPage.s6")} empty={controlPoints.length === 0 ? banner("control-points") : null}>
          <PpkDocTable
            small
            heads={[
              u("haccpPlanPage.colNumber"),
              u("haccpPlanPage.colStep"),
              u("haccpPlanPage.colHazard"),
              u("haccpPlanPage.colLimits"),
              u("haccpPlanPage.colMonitoring"),
              u("haccpPlanPage.colFrequency"),
              u("haccpPlanPage.colResponsible"),
              u("haccpPlanPage.colCorrective"),
              u("haccpPlanPage.colRecords"),
            ]}
            rows={controlPoints.map((point) => [
              point.number || kindLabel(point.kind),
              point.hazardStep ?? "—",
              point.hazardText ?? "—",
              point.limits || "—",
              point.monitoring || "—",
              point.frequency || "—",
              point.responsibleName ?? "—",
              point.corrective || "—",
              point.journalName ?? "—",
            ])}
          />
        </PpkDocSection>

        <PpkDocSection title={u("haccpPlanPage.s7")}>
          <p className="text-justify">
            {u("haccpPlanPage.verification")}
          </p>
        </PpkDocSection>
      </PpkPrintSheet>
      </div>
    </>
  );
}
