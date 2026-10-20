"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellOff, BellRing, CalendarRange, CheckCircle2, Pause, Pencil, Play, Plus, ShieldAlert, Trash2, UserCheck, Users } from "lucide-react";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { addDays, isoWeekday, type ChecklistAssignmentFrequency, type ChecklistAssignmentTarget, type ChecklistPeriodState, type LocalClock } from "@/lib/checklist-assignments";
import {
  CL_BUTTON_DANGER,
  CL_BUTTON_OUTLINE,
  CL_BUTTON_PRIMARY,
  ChecklistCard,
  ChecklistEmptyState,
  Pill,
} from "@/components/checklists/checklist-page-ui";
import { AssignmentDialog, type AssignmentDraft, type DialogPerson } from "@/components/checklists/assignment-dialog";
import { useChecklistFormat } from "@/components/checklists/checklist-format";

export type AssignmentListRow = {
  id: string;
  templateId: string;
  templateTitle: string;
  templateArchived: boolean;
  targetKind: ChecklistAssignmentTarget;
  targetId: string;
  targetName: string | null;
  recipients: { id: string; name: string; hasTelegram: boolean; canRun: boolean }[];
  frequency: ChecklistAssignmentFrequency;
  onceDate: string | null;
  weekday: number | null;
  monthDay: number | null;
  dueTime: string;
  verifierUserId: string | null;
  verifierName: string | null;
  remindTelegram: boolean;
  active: boolean;
  state: ChecklistPeriodState;
};

/** «Назначение»: список назначений и окно «Назначить чек-лист». */
export function AssignmentsPageClient({
  rows,
  templates,
  buildings,
  positions,
  people,
  currentUserId,
  today,
  presetTemplateId,
}: {
  rows: AssignmentListRow[];
  templates: { id: string; title: string }[];
  buildings: { id: string; name: string }[];
  positions: { id: string; name: string }[];
  people: DialogPerson[];
  currentUserId: string;
  today: LocalClock;
  presetTemplateId: string | null;
}) {
  const t = useTranslations("checklistPages.assignments");
  const common = useTranslations("checklistPages.common");
  const format = useChecklistFormat();
  const router = useRouter();
  const defaultVerifier = people.find((person) => person.id === currentUserId && person.manager)?.id ?? people.find((person) => person.manager)?.id ?? null;
  const blank = (templateId: string | null): AssignmentDraft => ({
    templateId: templateId ?? templates[0]?.id ?? "",
    targetKind: null,
    targetId: null,
    frequency: "daily",
    onceDate: addDays(today.dayKey, 1),
    weekday: isoWeekday(today.dayKey),
    monthDay: Number(today.dayKey.slice(8, 10)),
    dueTime: "12:00",
    verifierUserId: defaultVerifier,
    remindTelegram: true,
  });
  const [editing, setEditing] = useState<AssignmentDraft | null>(() => (presetTemplateId ? blank(presetTemplateId) : null));
  const [deleting, setDeleting] = useState<AssignmentListRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function edit(row: AssignmentListRow) {
    setEditing({
      id: row.id,
      templateId: row.templateId,
      targetKind: row.targetKind,
      targetId: row.targetId,
      frequency: row.frequency,
      onceDate: row.onceDate ?? addDays(today.dayKey, 1),
      weekday: row.weekday ?? isoWeekday(today.dayKey),
      monthDay: row.monthDay ?? 1,
      dueTime: row.dueTime,
      verifierUserId: row.verifierUserId,
      remindTelegram: row.remindTelegram,
    });
  }

  async function toggle(row: AssignmentListRow) {
    setBusy(row.id);
    try {
      const response = await fetch(`/api/checklists/assignments/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !row.active }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t("actionFailed"));
      toast.success(row.active ? t("paused") : t("resumed"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("actionFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: AssignmentListRow) {
    const response = await fetch(`/api/checklists/assignments/${row.id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      toast.error(body.error || t("actionFailed"));
      return;
    }
    toast.success(t("deleted", { count: String(body.inspectionsKept ?? 0) }));
    setDeleting(null);
    router.refresh();
  }

  const targetLabel = (row: AssignmentListRow) => {
    const name = row.targetName ?? t("targetMissing");
    return row.targetKind === "building" ? t("target.building", { name }) : row.targetKind === "position" ? t("target.position", { name }) : t("target.user", { name });
  };

  const statusPill = (row: AssignmentListRow) => {
    if (!row.active) return <Pill tone="muted"><Pause className="size-3.5" />{common("status.paused")}</Pill>;
    switch (row.state.status) {
      case "done":
        return <Pill tone="ok"><CheckCircle2 className="size-3.5" />{common("status.done")}</Pill>;
      case "overdue":
        return <Pill tone="danger"><ShieldAlert className="size-3.5" />{common("status.overdue")}</Pill>;
      case "pending":
        return <Pill tone="indigo">{common("status.pendingUntil", { time: row.dueTime })}</Pill>;
      case "off":
        return (
          <Pill tone="muted">
            {row.state.nextDayKey ? common("status.offNext", { date: format.day(row.state.nextDayKey) }) : common("status.off")}
          </Pill>
        );
    }
  };

  return (
    <div className="space-y-5" data-checklists-page="assignments">
      <SectionPageHeader
        description={t("description")}
        actions={
          <button type="button" className={CL_BUTTON_PRIMARY} onClick={() => setEditing(blank(null))} data-action="new-assignment">
            <Plus className="size-4" />
            {t("new")}
          </button>
        }
      />
      <PageGuide
        storageKey="checklists-assignments"
        title={t("guide.title")}
        bullets={[
          { title: t("guide.whoTitle"), body: t("guide.whoBody") },
          { title: t("guide.whenTitle"), body: t("guide.whenBody") },
          { title: t("guide.remindTitle"), body: t("guide.remindBody") },
          { title: t("guide.verifyTitle"), body: t("guide.verifyBody") },
        ]}
        qa={[
          { q: t("guide.q1"), a: t("guide.a1") },
          { q: t("guide.q2"), a: t("guide.a2") },
        ]}
      />

      <ChecklistCard id="assignments" number={1} title={t("list.title")} description={t("list.description", { count: rows.length })}>
        {rows.length === 0 ? (
          <ChecklistEmptyState title={t("list.emptyTitle")} hint={templates.length ? t("list.emptyHint") : t("list.emptyNoTemplates")}>
            {templates.length ? (
              <button type="button" className={CL_BUTTON_PRIMARY} onClick={() => setEditing(blank(null))}>
                <Plus className="size-4" />
                {t("new")}
              </button>
            ) : (
              <Link href="/checklists/templates" className={CL_BUTTON_OUTLINE}>{t("openTemplates")}</Link>
            )}
          </ChecklistEmptyState>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => {
              const noAccess = row.recipients.filter((person) => !person.canRun).length;
              const noTelegram = row.remindTelegram ? row.recipients.filter((person) => !person.hasTelegram).length : 0;
              return (
                <li
                  key={row.id}
                  data-assignment={row.id}
                  className="rounded-2xl border border-[#ececf4] bg-white p-4 transition-shadow duration-150 hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)]"
                >
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1 basis-[240px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 text-[15.5px] font-semibold leading-snug text-[#0b1024]">{row.templateTitle}</h3>
                        {statusPill(row)}
                        {row.templateArchived ? <Pill tone="warn">{t("templateArchived")}</Pill> : null}
                      </div>
                      <dl className="mt-2 grid gap-1 text-[13px] leading-[1.5] text-[#3c4053]">
                        <div className="flex items-start gap-1.5">
                          <Users className="mt-0.5 size-3.5 shrink-0 text-[#9b9fb3]" />
                          <span>
                            {targetLabel(row)} · {common("people", { count: row.recipients.length })}
                          </span>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <CalendarRange className="mt-0.5 size-3.5 shrink-0 text-[#9b9fb3]" />
                          <span>{format.schedule(row)}</span>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <UserCheck className="mt-0.5 size-3.5 shrink-0 text-[#9b9fb3]" />
                          <span>{row.verifierUserId ? t("verifier", { name: row.verifierName ?? t("targetMissing") }) : t("noVerifier")}</span>
                        </div>
                        <div className="flex items-start gap-1.5">
                          {row.remindTelegram ? <BellRing className="mt-0.5 size-3.5 shrink-0 text-[#9b9fb3]" /> : <BellOff className="mt-0.5 size-3.5 shrink-0 text-[#9b9fb3]" />}
                          <span>{row.remindTelegram ? t("remindOn") : t("remindOff")}</span>
                        </div>
                      </dl>
                      {noAccess > 0 || noTelegram > 0 ? (
                        <p className="mt-2 rounded-xl bg-[#fff8eb] px-3 py-1.5 text-[12.5px] text-[#7a4a00]" data-row-warning>
                          {[noAccess > 0 ? t("warnNoAccess", { count: noAccess }) : null, noTelegram > 0 ? t("warnNoTelegram", { count: noTelegram }) : null].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={CL_BUTTON_OUTLINE} onClick={() => edit(row)} disabled={busy !== null}>
                        <Pencil className="size-4 text-[#5566f6]" />
                        {t("edit")}
                      </button>
                      <button type="button" className={CL_BUTTON_OUTLINE} onClick={() => void toggle(row)} disabled={busy !== null} data-action="toggle">
                        {row.active ? <Pause className="size-4 text-[#5566f6]" /> : <Play className="size-4 text-[#5566f6]" />}
                        {row.active ? t("pause") : t("resume")}
                      </button>
                      <button type="button" className={CL_BUTTON_DANGER} onClick={() => setDeleting(row)} disabled={busy !== null} aria-label={t("deleteAria", { title: row.templateTitle })}>
                        <Trash2 className="size-4" />
                        <span className="hidden sm:inline">{t("delete")}</span>
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ChecklistCard>

      {editing ? (
        <AssignmentDialog
          key={editing.id ?? "new"}
          initial={editing}
          templates={templates}
          buildings={buildings}
          positions={positions}
          people={people}
          today={today}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await remove(deleting);
        }}
        variant="danger"
        title={t("confirmDelete.title")}
        description={deleting ? t("confirmDelete.description", { title: deleting.templateTitle }) : undefined}
        bullets={[
          { label: t("confirmDelete.noReminders"), tone: "warn" },
          { label: t("confirmDelete.historyKept"), tone: "info" },
        ]}
        confirmLabel={t("confirmDelete.confirm")}
      />
    </div>
  );
}
