import { redirect } from "next/navigation";
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

const ROLE_RU = {
  leader: "Руководитель",
  deputy: "Заместитель руководителя",
  member: "Член группы",
  secretary: "Секретарь",
} as const;
const HAZARD_TYPE_RU = { bio: "Биологическая", chem: "Химическая", phys: "Физическая", allergen: "Аллерген" } as const;
const KIND_RU = { ccp: "ККТ", oprp: "ОПП", prp: "ПРП", none: "—" } as const;

/** План ХАССП: собирается из заполненных блоков группы, политики, продукции, схем, опасностей и ККТ. */
export default async function HaccpPlanPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);

  const [bundle, versionRows, staff, t, nav] = await Promise.all([
    loadPpkBundle(organizationId),
    loadDocVersions(organizationId),
    loadPpkStaff(organizationId),
    getTranslations("productionControl.program"),
    getTranslations("navigation"),
  ]);
  const { org } = bundle;
  const banner = (key: PpkBlockKey): PpkEmptyBanner => ({
    href: ppkBlock(key).href,
    text: t("emptySection", { block: nav(`shell.items.${key}`) }),
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
        title="План ХАССП"
        subtitle={approval ? `Версия ${approval.version} от ${ruDate(approval.approvedAt)}` : org.orgName}
      >
        {approval?.approver ? <PpkApproveBlock org={org} approval={approval} /> : null}
        <PpkDocSection title="1. Группа ХАССП" empty={bundle.team.length === 0 ? banner("team") : null}>
          <PpkDocTable
            heads={["Ф. И. О.", "Должность", "Роль в группе", "Обязанности"]}
            rows={bundle.team.map((member) => [member.name, member.title || "—", ROLE_RU[member.role], member.duties || "—"])}
          />
        </PpkDocSection>

        <PpkDocSection title="2. Политика в области качества и безопасности" empty={bundle.policy ? null : banner("policy")}>
          {bundle.policy ? (
            <>
              {bundle.policy.text.split(/\n{2,}/).map((paragraph) => (
                <p key={paragraph} className="mb-1.5 text-justify">
                  {paragraph}
                </p>
              ))}
              <p className="mt-2 text-[13px]">
                {bundle.policy.approvedByName
                  ? `Утвердил: ${bundle.policy.approvedByName}${bundle.policy.approvedAt ? `, ${ruDate(bundle.policy.approvedAt)}` : ""}`
                  : "Утверждение: ______________________"}
              </p>
            </>
          ) : null}
        </PpkDocSection>

        <PpkDocSection title="3. Описание продукции" empty={bundle.products.length === 0 ? banner("products") : null}>
          <div className="space-y-4">
            {bundle.products.map((product, index) => (
              <div key={`${product.name}-${index}`} className="break-inside-avoid">
                <h3 className="mb-1 text-[14px] font-semibold">{product.name}</h3>
                <PpkDocTable
                  heads={["Показатель", "Значение"]}
                  rows={[
                    ["Состав", product.composition || "—"],
                    ["Условия хранения", product.storage || "—"],
                    ["Срок годности", product.shelfLife || "—"],
                    ["Назначение и использование", product.usage || "—"],
                    ["Упаковка", product.packaging || "—"],
                    ...product.indicators.map((item) => [`Показатель: ${item.name}`, item.norm || "—"]),
                  ]}
                />
              </div>
            ))}
          </div>
        </PpkDocSection>

        <PpkDocSection title="4. Блок-схемы" empty={bundle.flowcharts.length === 0 ? banner("flowcharts") : null}>
          <div className="space-y-6">
            {bundle.flowcharts.map((chart) => {
              const box = diagramBounds(chart);
              return (
                <figure key={chart.id} className="break-inside-avoid">
                  <figcaption className="mb-1 text-[14px] font-semibold">{chart.title || "Блок-схема"}</figcaption>
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

        <PpkDocSection title="5. Анализ опасностей" empty={bundle.hazards.length === 0 ? banner("hazards") : null}>
          <PpkDocTable
            small
            heads={["Этап", "Опасность", "Вид", "Вероятность", "Тяжесть", "Риск", "Значимая", "Меры управления"]}
            rows={bundle.hazards.map((hazard) => [
              hazard.step,
              hazard.hazard,
              HAZARD_TYPE_RU[hazard.type],
              String(hazard.probability),
              String(hazard.severity),
              String(hazardRisk(hazard.probability, hazard.severity)),
              isSignificantHazard(hazard.probability, hazard.severity) ? "Да" : "Нет",
              hazard.measures || "—",
            ])}
          />
        </PpkDocSection>

        <PpkDocSection title="6. Критические контрольные точки и операционные программы" empty={controlPoints.length === 0 ? banner("control-points") : null}>
          <PpkDocTable
            small
            heads={[
              "№",
              "Этап",
              "Опасность",
              "Критические пределы",
              "Мониторинг",
              "Периодичность",
              "Ответственный",
              "Корректирующие действия",
              "Записи",
            ]}
            rows={controlPoints.map((point) => [
              point.number || KIND_RU[point.kind],
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

        <PpkDocSection title="7. Верификация">
          <p className="text-justify">
            Верификация системы ХАССП проводится не реже раза в год и при любых изменениях продукции или процессов: группа ХАССП
            организует внутренний аудит, результаты фиксируются в журналах внутреннего аудита (план, протокол и отчёт аудита), а
            выявленные несоответствия устраняются корректирующими действиями.
          </p>
        </PpkDocSection>
      </PpkPrintSheet>
      </div>
    </>
  );
}
