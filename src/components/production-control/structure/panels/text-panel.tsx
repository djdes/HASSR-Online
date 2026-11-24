import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { loadDocumentOrgBlock } from "@/lib/document-org-block.server";
import { parsePpkRecords, type PpkTextBlock } from "@/lib/ppk/records";
import { ppkWhere } from "@/lib/ppk/scope";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { ppkTextTemplate } from "@/lib/ppk/structure-templates";
import { PpkFolder } from "@/components/production-control/ppk-folder";
import type { PpkPanelProps } from "../item-panel";
import { PanelNote, PanelSection, SourceLink } from "./panel-ui";
import { TextDocEditor } from "./text-doc-editor";

const ROLE_ORDER = { leader: 0, deputy: 1, member: 2, secretary: 3 } as const;

/**
 * Текстовые пункты: 1.8 «Основные принципы ХАССП», 2.9 «Методика…» (шаблон,
 * можно исправить или написать своё), 2.2 и 2.3 — положения (шаблон или скан
 * своего документа), 1.9 и приложение № 3 — пустое поле для своего текста.
 */
export async function TextPanel({ item, scope }: PpkPanelProps) {
  const text = item.text!;
  const [row, orgBlock, t] = await Promise.all([
    db.ppkRecord.findFirst({
      where: { ...ppkWhere(scope), block: text.block },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
    }),
    loadDocumentOrgBlock(scope.organizationId, { buildingId: scope.buildingId }),
    getTranslations("productionControl.structure.text"),
  ]);
  const record = row ? (parsePpkRecords(text.block as PpkTextBlock, [row])[0] ?? null) : null;
  const orgName = orgBlock?.org.shortName || orgBlock?.org.fullName || "";
  const template = ppkTextTemplate(text.template, orgName);

  return (
    <div className="space-y-8">
      {item.id === "2-2" ? <TeamSummary scope={scope} /> : null}
      {item.id === "app-3" ? (
        <PanelNote>
          {t("flowScheduleHint")}{" "}
          <SourceLink href="/production-control/sanitation/floor-plans">{t("openFloorPlans")}</SourceLink>
        </PanelNote>
      ) : null}

      <TextDocEditor
        block={text.block}
        record={record ? { id: record.id, text: record.data.text, updatedAt: record.updatedAt.toISOString() } : null}
        template={template}
        scanFolder={item.scanFolder ?? null}
      />

      {item.scanFolder ? (
        <PanelSection title={t("scanTitle")} hint={t("scanHint")}>
          <PpkFolder folder={item.scanFolder} canManage />
        </PanelSection>
      ) : null}

      {item.legacyFolder ? (
        <PanelSection title={t("legacyTitle")} hint={t("legacyHint")}>
          <PpkFolder folder={item.legacyFolder} canManage />
        </PanelSection>
      ) : null}
    </div>
  );
}

/** 2.2: состав группы ХАССП — шаблон положения ссылается на него. */
async function TeamSummary({ scope }: { scope: PpkPanelProps["scope"] }) {
  const [rows, staff, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { ...ppkWhere(scope), block: "team" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    loadPpkStaff(scope),
    getTranslations("productionControl.structure.text"),
  ]);
  const people = new Map(staff.map((person) => [person.id, person]));
  const members = parsePpkRecords("team", rows)
    .map((row) => row.data)
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  return (
    <PanelSection
      title={t("teamTitle")}
      actions={
        <>
          <SourceLink href="/production-control/haccp/team">{t("editTeam")}</SourceLink>
          <SourceLink href="/production-control/haccp/team/regulation">{t("printRegulation")}</SourceLink>
        </>
      }
    >
      {members.length === 0 ? (
        <PanelNote tone="warn">{t("teamEmpty")}</PanelNote>
      ) : (
        <ul className="grid gap-1.5 text-[14px] text-[#0b1024] sm:grid-cols-2">
          {members.map((member) => (
            <li key={member.userId} className="rounded-xl bg-[var(--app-veil)] px-3 py-2">
              <span className="font-medium">{people.get(member.userId)?.name ?? "—"}</span>
              <span className="text-[#6f7282]"> · {t(`roles.${member.role}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  );
}
