"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BadgeCheck, CalendarRange, CheckCircle2, Download, ExternalLink, ListChecks, ShieldAlert, TriangleAlert } from "lucide-react";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CHECKLIST_RESULT_PERIODS, type ChecklistResultFilters, type ChecklistResultSummary } from "@/lib/checklist-results";
import { CHECKLIST_ASSIGNMENT_FREQUENCIES } from "@/lib/checklist-assignments";
import { CL_BUTTON_OUTLINE, CL_BUTTON_PRIMARY, ChecklistCard, ChecklistEmptyState, Pill } from "@/components/checklists/checklist-page-ui";
import { useChecklistFormat } from "@/components/checklists/checklist-format";

type ResultRow = {
  id: string;
  title: string;
  templateVersion: number;
  status: "completed" | "draft";
  createdAt: string;
  completedAt: string | null;
  createdByName: string;
  completedByName: string | null;
  summary: ChecklistResultSummary | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  assignment: { targetKind: string; targetName: string | null; frequency: string; verifierIsMe: boolean } | null;
  canReview: boolean;
};

const ALL = "__all__";
const frequencyKey = (value: string) => (CHECKLIST_ASSIGNMENT_FREQUENCIES as readonly string[]).includes(value) ? (value as (typeof CHECKLIST_ASSIGNMENT_FREQUENCIES)[number]) : "daily";

/** «Результаты»: фильтры и история проверок с «Принять результат». */
export function ResultsPageClient({
  inspections,
  templates,
  filters,
  highlightId,
  timeZone,
}: {
  inspections: ResultRow[];
  templates: { id: string; title: string; archived: boolean }[];
  filters: ChecklistResultFilters;
  highlightId: string | null;
  timeZone: string;
}) {
  const t = useTranslations("checklistPages.results");
  const common = useTranslations("checklistPages.common");
  const format = useChecklistFormat();
  const router = useRouter();
  const pathname = usePathname();
  const [reviewing, setReviewing] = useState<string | null>(null);

  function applyFilters(next: Partial<ChecklistResultFilters>) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    if (merged.templateId) params.set("template", merged.templateId);
    if (merged.period !== "30") params.set("period", merged.period);
    if (merged.violationsOnly) params.set("violations", "1");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  async function review(id: string) {
    setReviewing(id);
    try {
      const response = await fetch(`/api/checklists/inspections/${id}/review`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t("reviewFailed"));
      toast.success(t("reviewed"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("reviewFailed"));
    } finally {
      setReviewing(null);
    }
  }

  const filtered = !!filters.templateId || filters.period !== "30" || filters.violationsOnly;
  const waiting = inspections.filter((row) => row.canReview).length;

  return (
    <div className="space-y-5" data-checklists-page="results">
      <SectionPageHeader
        description={t("description")}
        actions={
          <Link href="/checklists/templates" className={CL_BUTTON_OUTLINE}>
            <ListChecks className="size-4 text-[#5566f6]" />
            {t("toTemplates")}
          </Link>
        }
      />
      <PageGuide
        storageKey="checklists-results"
        title={t("guide.title")}
        bullets={[
          { title: t("guide.listTitle"), body: t("guide.listBody") },
          { title: t("guide.reviewTitle"), body: t("guide.reviewBody") },
          { title: t("guide.pdfTitle"), body: t("guide.pdfBody") },
        ]}
      />

      <ChecklistCard id="filters" number={1} title={t("filters.title")} description={t("filters.description")}>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
          <label className="block min-w-0 text-[13px] font-medium text-[#3c4053]">
            {t("filters.template")}
            <Select value={filters.templateId ?? ALL} onValueChange={(value) => applyFilters({ templateId: value === ALL ? null : value })}>
              <SelectTrigger className="mt-1 h-11 w-full rounded-2xl" data-filter="template">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start" sideOffset={6}>
                <SelectItem value={ALL}>{t("filters.allTemplates")}</SelectItem>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.title}{template.archived ? ` · ${t("filters.archived")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[#3c4053]">{t("filters.period")}</div>
            <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("filters.period")}>
              {CHECKLIST_RESULT_PERIODS.map((period) => (
                <button
                  key={period}
                  type="button"
                  role="radio"
                  aria-checked={filters.period === period}
                  data-period={period}
                  onClick={() => applyFilters({ period })}
                  className={cn(
                    "h-11 rounded-2xl border px-3.5 text-[13.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                    filters.period === period ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]" : "border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#f5f6ff]",
                  )}
                >
                  {t(`filters.periods.${period}`)}
                </button>
              ))}
            </div>
          </div>
          <label className="flex h-11 items-center gap-2.5 rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] font-medium text-[#0b1024]">
            <Switch checked={filters.violationsOnly} onCheckedChange={(value) => applyFilters({ violationsOnly: value })} data-filter="violations" />
            {t("filters.violationsOnly")}
          </label>
        </div>
      </ChecklistCard>

      <ChecklistCard
        id="history"
        number={2}
        title={t("history.title")}
        description={t("history.description", { count: inspections.length })}
        aside={waiting > 0 ? <Pill tone="warn"><BadgeCheck className="size-3.5" />{t("history.waiting", { count: String(waiting) })}</Pill> : null}
      >
        {inspections.length === 0 ? (
          <ChecklistEmptyState title={filtered ? t("history.emptyFilteredTitle") : t("history.emptyTitle")} hint={filtered ? t("history.emptyFilteredHint") : t("history.emptyHint")}>
            {filtered ? (
              <button type="button" className={CL_BUTTON_OUTLINE} onClick={() => applyFilters({ templateId: null, period: "30", violationsOnly: false })}>
                {t("history.reset")}
              </button>
            ) : (
              <Link href="/checklists/templates" className={CL_BUTTON_PRIMARY}>{t("toTemplates")}</Link>
            )}
          </ChecklistEmptyState>
        ) : (
          <ul className="space-y-2.5">
            {inspections.map((row) => {
              const summary = row.summary;
              const when = row.completedAt ?? row.createdAt;
              return (
                <li
                  key={row.id}
                  data-inspection={row.id}
                  className={cn(
                    "rounded-2xl border border-[#ececf4] bg-white p-3.5 sm:p-4",
                    row.id === highlightId && "border-[#5566f6] ring-4 ring-[#5566f6]/15",
                  )}
                >
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1 basis-[240px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 text-[15px] font-semibold leading-snug text-[#0b1024]">{row.title}</h3>
                        {row.status === "completed" ? (
                          <Pill tone="ok"><CheckCircle2 className="size-3.5" />{t("status.completed")}</Pill>
                        ) : (
                          <Pill tone="muted">{t("status.draft")}</Pill>
                        )}
                      </div>
                      <div className="mt-1 text-[12.5px] leading-[1.5] text-[#6f7282]">
                        {format.dateTime(when, timeZone)} · {row.completedByName || row.createdByName} · {t("version", { version: String(row.templateVersion) })}
                      </div>
                      {summary ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-summary>
                          <Pill tone="indigo">
                            {summary.percent !== null ? t("score", { earned: String(summary.earned), possible: String(summary.possible), percent: String(summary.percent) }) : t("scoreNone")}
                          </Pill>
                          <Pill tone={summary.violations > 0 ? "warn" : "ok"}>
                            {summary.violations > 0 ? <TriangleAlert className="size-3.5" /> : null}
                            {t("violations", { count: summary.violations })}
                          </Pill>
                          {summary.stopped ? (
                            <Pill tone="danger"><ShieldAlert className="size-3.5" />{t("stopped")}</Pill>
                          ) : null}
                        </div>
                      ) : null}
                      {row.assignment ? (
                        <div className="mt-2 flex items-start gap-1.5 text-[12.5px] text-[#3c4053]">
                          <CalendarRange className="mt-0.5 size-3.5 shrink-0 text-[#9b9fb3]" />
                          <span>
                            {t("byAssignment", { target: row.assignment.targetName ?? "—", frequency: common(`frequency.${frequencyKey(row.assignment.frequency)}`) })}
                            {row.assignment.verifierIsMe ? ` · ${t("youVerify")}` : ""}
                          </span>
                        </div>
                      ) : null}
                      {row.reviewedAt ? (
                        <div className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium text-[#116b2a]" data-reviewed>
                          <BadgeCheck className="size-4" />
                          {t("reviewedBy", { name: row.reviewedByName || "—", date: format.dateTime(row.reviewedAt, timeZone) })}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {row.canReview ? (
                        <button type="button" className={CL_BUTTON_PRIMARY} disabled={reviewing !== null} onClick={() => void review(row.id)} data-action="review">
                          <BadgeCheck className="size-4" />
                          {reviewing === row.id ? t("reviewing") : t("review")}
                        </button>
                      ) : null}
                      <Link href={`/checklists/inspections/${row.id}`} className={CL_BUTTON_OUTLINE}>
                        <ExternalLink className="size-4 text-[#5566f6]" />
                        {t("open")}
                      </Link>
                      <a href={`/api/checklists/inspections/${row.id}/pdf`} target="_blank" rel="noopener noreferrer" className={CL_BUTTON_OUTLINE} aria-label={t("pdfAria", { title: row.title })}>
                        <Download className="size-4 text-[#5566f6]" />
                        PDF
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ChecklistCard>
    </div>
  );
}
