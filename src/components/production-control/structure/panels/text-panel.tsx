import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { loadDocumentOrgBlock } from "@/lib/document-org-block.server";
import { parsePpkRecords, type PpkTextBlock } from "@/lib/ppk/records";
import { ppkWhere, type PpkScope } from "@/lib/ppk/scope";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { ppkTextTemplate, type RegulationMember } from "@/lib/ppk/structure-templates";
import { revisionDocKey, type RevisionTextBlock } from "@/lib/ppk/revisions";
import { clientRevisionState, loadRevisionStates } from "@/lib/ppk/revisions.server";
import { PpkFolder } from "@/components/production-control/ppk-folder";
import { RevisionBar } from "@/components/production-control/revision-control";
import type { PpkPanelProps } from "../item-panel";
import { PanelNote, PanelSection, SourceLink } from "./panel-ui";
import { TextDocEditor } from "./text-doc-editor";

const ROLE_ORDER = { leader: 0, deputy: 1, member: 2, secretary: 3 } as const;

/** Состав группы ХАССП области: руководитель первым; уволенные не попадают. */
async function loadTeamMembers(scope: PpkScope): Promise<RegulationMember[]> {
  const [rows, staff] = await Promise.all([
    db.ppkRecord.findMany({
      where: { ...ppkWhere(scope), block: "team" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    loadPpkStaff(scope),
  ]);
  const people = new Map(staff.map((person) => [person.id, person]));
  return parsePpkRecords("team", rows)
    .map((row) => row.data)
    .filter((member) => people.has(member.userId))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
    .map((member) => ({ name: people.get(member.userId)!.name, title: people.get(member.userId)!.title, role: member.role }));
}

/**
 * Текстовые пункты: 1.8 «Основные принципы ХАССП», 2.9 «Методика…» (шаблон,
 * можно исправить или написать своё), 2.2 и 2.3 — положения (шаблон или скан
 * своего документа; в 2.2 — с составом группы), 1.9 и приложение № 3 — пустое
 * поле для своего текста.
 */
export async function TextPanel({ item, scope }: PpkPanelProps) {
  const text = item.text!;
  const [row, orgBlock, org, members, t] = await Promise.all([
    db.ppkRecord.findFirst({
      where: { ...ppkWhere(scope), block: text.block },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
    }),
    loadDocumentOrgBlock(scope.organizationId, { buildingId: scope.buildingId }),
    db.organization.findUnique({ where: { id: scope.organizationId }, select: { timezone: true } }),
    text.template === "team-regulation" ? loadTeamMembers(scope) : Promise.resolve<RegulationMember[]>([]),
    getTranslations("productionControl.structure.text"),
  ]);
  const record = row ? (parsePpkRecords(text.block as PpkTextBlock, [row])[0] ?? null) : null;
  const orgName = orgBlock?.org.shortName || orgBlock?.org.fullName || "";
  const template = ppkTextTemplate(text.template, orgName, members);
  // Редакция документа: «ППК NNN», после правки — вопрос о новой редакции.
  const docKey = revisionDocKey({ kind: "text", block: text.block as RevisionTextBlock }, scope.buildingId);
  const revision = (await loadRevisionStates(scope, [docKey])).get(docKey) ?? null;
  const timeZone = org?.timezone || "Europe/Moscow";

  return (
    <div className="space-y-8">
      {text.template === "team-regulation" ? <TeamSummary members={members} /> : null}
      {item.id === "app-3" ? (
        <PanelNote>
          {t("flowScheduleHint")}{" "}
          <SourceLink href="/production-control/sanitation/floor-plans">{t("openFloorPlans")}</SourceLink>
        </PanelNote>
      ) : null}

      <PanelSection title={t("revisionTitle")} hint={t("revisionHint")}>
        <RevisionBar
          docKey={docKey}
          timeZone={timeZone}
          initial={revision ? clientRevisionState(revision) : null}
        />
      </PanelSection>

      <TextDocEditor
        block={text.block}
        record={record ? { id: record.id, text: record.data.text, updatedAt: record.updatedAt.toISOString() } : null}
        template={template}
        scanFolder={item.scanFolder ?? null}
        timeZone={timeZone}
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

/** 2.2: состав группы ХАССП — он же раздел «Состав группы» в шаблоне положения. */
async function TeamSummary({ members }: { members: RegulationMember[] }) {
  const t = await getTranslations("productionControl.structure.text");
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
            <li key={`${member.name}:${member.role}`} className="rounded-xl bg-[var(--app-veil)] px-3 py-2">
              <span className="font-medium">{member.name}</span>
              <span className="text-[#6f7282]"> · {t(`roles.${member.role}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  );
}
