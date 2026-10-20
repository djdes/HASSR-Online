"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellRing, CalendarRange, CheckCircle2, ClipboardCheck, Pencil, Play, Plus, ShieldAlert } from "lucide-react";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";
import { cn } from "@/lib/utils";
import {
  CL_BUTTON_OUTLINE,
  CL_BUTTON_PRIMARY,
  CL_LINK,
  ChecklistCard,
  ChecklistEmptyState,
  Pill,
} from "@/components/checklists/checklist-page-ui";
import { useChecklistFormat } from "@/components/checklists/checklist-format";

type Typical = {
  key: string;
  title: string;
  summary: string;
  sections: number;
  questions: number;
  criticalQuestions: number;
  addedId: string | null;
};
type OrgTemplate = { id: string; title: string; version: number; sections: number; questions: number };
type Assigned = {
  id: string;
  templateId: string;
  templateTitle: string;
  dueTime: string;
  dueDayKey: string;
  dueToday: boolean;
  status: "pending" | "done" | "overdue";
  draftId: string | null;
};

/**
 * «Шаблоны» раздела «Чек-листы»: «Назначено вам», типовые и шаблоны
 * организации. Проверка начинается сразу (`POST /api/checklists/inspections`),
 * правка — в конструкторе (`/checklists?edit=<id>`), назначение — на
 * странице «Назначение».
 */
export function TemplatesPageClient({
  typical,
  templates,
  assigned,
  highlightAssignmentId,
  canManage,
  canAssign,
  canRun,
}: {
  typical: Typical[];
  templates: OrgTemplate[];
  assigned: Assigned[];
  highlightAssignmentId: string | null;
  canManage: boolean;
  canAssign: boolean;
  canRun: boolean;
}) {
  const t = useTranslations("checklistPages.templates");
  const common = useTranslations("checklistPages.common");
  const format = useChecklistFormat();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function start(templateId: string, assignmentId?: string) {
    setBusy(assignmentId ?? templateId);
    try {
      const response = await fetch("/api/checklists/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assignmentId ? { templateId, assignmentId } : { templateId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t("startFailed"));
      router.push(`/checklists/inspections/${body.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("startFailed"));
      setBusy(null);
    }
  }

  async function addTypical(key: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/checklists/templates/typical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t("addFailed"));
      toast.success(body.created ? t("added", { title: body.template.title }) : t("alreadyAdded", { title: body.template.title }));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("addFailed"));
    } finally {
      setBusy(null);
    }
  }

  const statusPill = (status: Assigned["status"]) =>
    status === "done" ? (
      <Pill tone="ok"><CheckCircle2 className="size-3.5" />{common("status.done")}</Pill>
    ) : status === "overdue" ? (
      <Pill tone="danger"><ShieldAlert className="size-3.5" />{common("status.overdue")}</Pill>
    ) : (
      <Pill tone="indigo">{common("status.pending")}</Pill>
    );

  return (
    <div className="space-y-5" data-checklists-page="templates">
      <SectionPageHeader
        description={t("description")}
        actions={
          <>
            <Link href="/checklists" className={CL_BUTTON_OUTLINE}>
              <Pencil className="size-4 text-[#5566f6]" />
              {t("openBuilder")}
            </Link>
            {canAssign ? (
              <Link href="/checklists/assignments" className={CL_BUTTON_OUTLINE}>
                <CalendarRange className="size-4 text-[#5566f6]" />
                {t("openAssignments")}
              </Link>
            ) : null}
            {/* У повара один раздел — сайдбара нет, поэтому переходы по разделу есть и в шапке. */}
            <Link href="/checklists/results" className={CL_BUTTON_OUTLINE}>
              <ClipboardCheck className="size-4 text-[#5566f6]" />
              {t("openResults")}
            </Link>
          </>
        }
      />
      <PageGuide
        storageKey="checklists-templates"
        title={t("guide.title")}
        bullets={[
          { title: t("guide.typicalTitle"), body: t("guide.typicalBody") },
          { title: t("guide.runTitle"), body: t("guide.runBody") },
          { title: t("guide.assignTitle"), body: t("guide.assignBody") },
          { title: t("guide.resultsTitle"), body: t("guide.resultsBody") },
        ]}
        qa={[
          { q: t("guide.q1"), a: t("guide.a1") },
          { q: t("guide.q2"), a: t("guide.a2") },
        ]}
      />

      {assigned.length > 0 ? (
        <ChecklistCard
          id="assigned"
          title={t("assigned.title")}
          description={t("assigned.description")}
          className="border-[#5566f6]/30 bg-[#fafbff]"
        >
          <ul className="space-y-2">
            {assigned.map((item) => (
              <li
                key={item.id}
                data-assigned={item.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-2xl border border-[#ececf4] bg-white p-3 sm:p-4",
                  item.id === highlightAssignmentId && "border-[#5566f6] ring-4 ring-[#5566f6]/15",
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
                  <BellRing className="size-5" />
                </span>
                <div className="min-w-0 flex-1 basis-[200px]">
                  <div className="text-[15px] font-medium leading-snug text-[#0b1024]">{item.templateTitle}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-[#6f7282]">
                    <span>{format.dueLabel(item.dueDayKey, item.dueTime, item.dueToday)}</span>
                    {statusPill(item.status)}
                  </div>
                </div>
                {item.status === "done" ? (
                  <Link href="/checklists/results" className={CL_BUTTON_OUTLINE}>
                    <ClipboardCheck className="size-4 text-[#5566f6]" />
                    {t("assigned.results")}
                  </Link>
                ) : canRun ? (
                  <button type="button" className={CL_BUTTON_PRIMARY} disabled={busy !== null} onClick={() => void start(item.templateId, item.id)}>
                    <Play className="size-4" />
                    {item.draftId ? t("continue") : t("start")}
                  </button>
                ) : (
                  <span className="text-[12.5px] text-[#a13a32]">{t("noRunRight")}</span>
                )}
              </li>
            ))}
          </ul>
        </ChecklistCard>
      ) : null}

      <ChecklistCard
        id="typical"
        number={1}
        title={t("typical.title")}
        description={t("typical.description")}
      >
        <div className="grid gap-3 md:grid-cols-2">
          {typical.map((item) => (
            <article key={item.key} data-typical={item.key} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="min-w-0 text-[15px] font-semibold leading-snug text-[#0b1024]">{item.title}</h3>
                  {item.addedId ? <Pill tone="ok"><CheckCircle2 className="size-3.5" />{t("typical.added")}</Pill> : null}
                </div>
                <p className="mt-1 line-clamp-3 text-[13px] leading-[1.5] text-[#3c4053]">{item.summary}</p>
                <p className="mt-2 text-[12.5px] text-[#6f7282] tabular-nums">
                  {t("typical.counts", { sections: String(item.sections), questions: String(item.questions), critical: String(item.criticalQuestions) })}
                </p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                {item.addedId ? (
                  <>
                    {canRun ? (
                      <button type="button" className={CL_BUTTON_PRIMARY} disabled={busy !== null} onClick={() => void start(item.addedId!)}>
                        <Play className="size-4" />
                        {t("start")}
                      </button>
                    ) : null}
                    {canManage ? (
                      <Link href={`/checklists?edit=${item.addedId}`} className={CL_BUTTON_OUTLINE}>
                        <Pencil className="size-4 text-[#5566f6]" />
                        {t("openInBuilder")}
                      </Link>
                    ) : null}
                  </>
                ) : canManage ? (
                  <button type="button" className={CL_BUTTON_OUTLINE} disabled={busy !== null} onClick={() => void addTypical(item.key)}>
                    <Plus className="size-4 text-[#5566f6]" />
                    {busy === item.key ? t("adding") : t("typical.add")}
                  </button>
                ) : (
                  <span className="text-[12.5px] text-[#6f7282]">{t("typical.managerAdds")}</span>
                )}
              </div>
            </article>
          ))}
        </div>
      </ChecklistCard>

      <ChecklistCard
        id="organization"
        number={2}
        title={t("organization.title")}
        description={t("organization.description")}
        aside={
          canManage ? (
            <Link href="/checklists?edit=new" className={CL_BUTTON_OUTLINE}>
              <Plus className="size-4 text-[#5566f6]" />
              {t("organization.create")}
            </Link>
          ) : null
        }
      >
        {templates.length === 0 ? (
          <ChecklistEmptyState title={t("organization.emptyTitle")} hint={canManage ? t("organization.emptyHintManager") : t("organization.emptyHint")} />
        ) : (
          <ul className="divide-y divide-[#ececf4] rounded-2xl border border-[#ececf4]">
            {templates.map((template) => (
              <li key={template.id} data-org-template={template.id} className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
                <div className="min-w-0 flex-1 basis-[220px]">
                  <div className="text-[15px] font-medium leading-snug text-[#0b1024]">{template.title}</div>
                  <div className="mt-0.5 text-[12.5px] text-[#6f7282] tabular-nums">
                    {t("organization.meta", { version: String(template.version), sections: String(template.sections), questions: String(template.questions) })}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canRun ? (
                    <button type="button" className={CL_BUTTON_PRIMARY} disabled={busy !== null} onClick={() => void start(template.id)}>
                      <Play className="size-4" />
                      {t("start")}
                    </button>
                  ) : null}
                  {canManage ? (
                    <Link href={`/checklists?edit=${template.id}`} className={CL_BUTTON_OUTLINE}>
                      <Pencil className="size-4 text-[#5566f6]" />
                      {t("editInBuilder")}
                    </Link>
                  ) : null}
                  {canAssign ? (
                    <Link href={`/checklists/assignments?template=${template.id}`} className={CL_BUTTON_OUTLINE}>
                      <CalendarRange className="size-4 text-[#5566f6]" />
                      {t("assign")}
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <Link href="/checklists/results" className={CL_LINK}>
            <ClipboardCheck className="size-4" />
            {t("allResults")}
          </Link>
        </div>
      </ChecklistCard>
    </div>
  );
}
