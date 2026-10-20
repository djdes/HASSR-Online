"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellRing, Briefcase, Send, ShieldCheck, Store } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  CHECKLIST_ASSIGNMENT_FREQUENCIES,
  addDays,
  assignmentRecipients,
  formatMinutes,
  isoWeekday,
  reminderMinutes,
  type ChecklistAssignmentFrequency,
  type ChecklistAssignmentTarget,
  type LocalClock,
} from "@/lib/checklist-assignments";
import { CL_BUTTON_OUTLINE, CL_BUTTON_PRIMARY, CL_INPUT, CL_LINK } from "@/components/checklists/checklist-page-ui";
import { ChecklistPicker, type PickerGroup } from "@/components/checklists/checklist-picker";
import { useChecklistFormat } from "@/components/checklists/checklist-format";

export type DialogPerson = {
  id: string;
  name: string;
  positionName: string | null;
  jobPositionId: string | null;
  buildingIds: string[];
  isActive: boolean;
  archivedAt: null;
  hasTelegram: boolean;
  canRun: boolean;
  manager: boolean;
};

export type AssignmentDraft = {
  id?: string;
  templateId: string;
  targetKind: ChecklistAssignmentTarget | null;
  targetId: string | null;
  frequency: ChecklistAssignmentFrequency;
  onceDate: string;
  weekday: number;
  monthDay: number;
  dueTime: string;
  verifierUserId: string | null;
  remindTelegram: boolean;
};

/**
 * Окно «Назначить чек-лист» по шагам: 1 шаблон → 2 кому → 3 как часто и до
 * скольки → 4 кто проверяет → 5 напоминать в Telegram. Внизу — живая
 * подсказка «Получат: N человек; напоминание придёт …» и предупреждения
 * (нет доступа к чек-листам, не привязан Telegram) со ссылками, где исправить.
 */
export function AssignmentDialog({
  initial,
  templates,
  buildings,
  positions,
  people,
  today,
  onClose,
  onSaved,
}: {
  initial: AssignmentDraft;
  templates: { id: string; title: string }[];
  buildings: { id: string; name: string }[];
  positions: { id: string; name: string }[];
  people: DialogPerson[];
  today: LocalClock;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("checklistPages.assignments.dialog");
  const common = useTranslations("checklistPages.common");
  const format = useChecklistFormat();
  const [draft, setDraft] = useState<AssignmentDraft>(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof AssignmentDraft>(key: K, value: AssignmentDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const buildingIds = useMemo(() => buildings.map((building) => building.id), [buildings]);
  const countFor = (kind: ChecklistAssignmentTarget, id: string) => assignmentRecipients({ kind, id }, people, buildingIds).length;

  const targetGroups: PickerGroup[] = [
    ...(buildings.length > 0
      ? [{
          key: "buildings",
          title: t("target.buildings"),
          tone: "plain" as const,
          items: buildings.map((building) => ({
            id: `building:${building.id}`,
            label: building.name,
            sub: t("target.buildingSub"),
            hint: common("people", { count: countFor("building", building.id) }),
            icon: <Store className="size-3.5" />,
          })),
        }]
      : []),
    {
      key: "positions",
      title: t("target.positions"),
      tone: "plain",
      items: positions.map((position) => {
        const count = countFor("position", position.id);
        return {
          id: `position:${position.id}`,
          label: position.name,
          sub: t("target.positionSub"),
          hint: common("people", { count }),
          hintTone: count === 0 ? ("warn" as const) : ("muted" as const),
          icon: <Briefcase className="size-3.5" />,
        };
      }),
    },
    {
      key: "people",
      title: t("target.people"),
      tone: "plain",
      items: people.map((person) => ({
        id: `user:${person.id}`,
        label: person.name,
        sub: person.positionName ?? t("noPosition"),
        ...(person.hasTelegram ? {} : { hint: t("noTelegramShort"), hintTone: "warn" as const }),
      })),
    },
  ];

  const managers = people.filter((person) => person.manager);
  const others = people.filter((person) => !person.manager);
  const verifierGroups = ([
    {
      key: "recommended",
      title: t("verifier.recommended"),
      tone: "recommended",
      items: managers.map((person) => ({
        id: person.id,
        label: person.name,
        sub: person.positionName ?? t("noPosition"),
        hint: person.hasTelegram ? undefined : t("noTelegramShort"),
        hintTone: "warn" as const,
      })),
    },
    {
      key: "ok",
      title: t("verifier.others"),
      tone: "ok",
      items: others.map((person) => ({
        id: person.id,
        label: person.name,
        sub: person.positionName ?? t("noPosition"),
        hint: person.hasTelegram ? undefined : t("noTelegramShort"),
        hintTone: "warn" as const,
      })),
    },
  ] as PickerGroup[]).filter((group) => group.items.length > 0);

  const recipients = draft.targetKind && draft.targetId ? assignmentRecipients({ kind: draft.targetKind, id: draft.targetId }, people, buildingIds) : [];
  const noAccess = recipients.filter((person) => !person.canRun);
  const noTelegram = draft.remindTelegram ? recipients.filter((person) => !person.hasTelegram) : [];
  const remindAt = formatMinutes(reminderMinutes(draft.dueTime || "12:00"));
  const names = (list: DialogPerson[]) => list.slice(0, 4).map((person) => person.name).join(", ") + (list.length > 4 ? ` ${t("andMore", { count: String(list.length - 4) })}` : "");
  const firstDay = (() => {
    if (draft.frequency === "once") return draft.onceDate;
    for (let offset = 0; offset < 62; offset++) {
      const day = addDays(today.dayKey, offset);
      const [y, m, d] = day.split("-").map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const fits =
        draft.frequency === "daily" ||
        (draft.frequency === "weekly" && isoWeekday(day) === draft.weekday) ||
        (draft.frequency === "monthly" && d === Math.min(draft.monthDay, lastDay));
      const [h, min] = (draft.dueTime || "12:00").split(":").map(Number);
      if (fits && (offset > 0 || h * 60 + min >= today.minutes)) return day;
    }
    return today.dayKey;
  })();

  const canSave = !!draft.templateId && !!draft.targetKind && !!draft.targetId && /^\d{2}:\d{2}$/.test(draft.dueTime) && (draft.frequency !== "once" || !!draft.onceDate);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const body = {
        templateId: draft.templateId,
        targetKind: draft.targetKind,
        targetId: draft.targetId,
        frequency: draft.frequency,
        onceDate: draft.frequency === "once" ? draft.onceDate : null,
        weekday: draft.frequency === "weekly" ? draft.weekday : null,
        monthDay: draft.frequency === "monthly" ? draft.monthDay : null,
        dueTime: draft.dueTime,
        verifierUserId: draft.verifierUserId,
        remindTelegram: draft.remindTelegram,
      };
      const response = await fetch(draft.id ? `/api/checklists/assignments/${draft.id}` : "/api/checklists/assignments", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || t("saveFailed"));
      toast.success(draft.id ? t("updated") : t("created", { count: recipients.length }));
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const frequencyLabel: Record<ChecklistAssignmentFrequency, string> = {
    once: t("frequency.once"),
    daily: t("frequency.daily"),
    weekly: t("frequency.weekly"),
    monthly: t("frequency.monthly"),
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-[640px]" data-assignment-dialog>
        <DialogHeader className="shrink-0 border-b border-[#ececf4] px-5 pb-4 pt-5 text-left sm:px-6">
          <DialogTitle className="text-[20px] font-semibold tracking-[-0.01em] text-[#0b1024]">{draft.id ? t("editTitle") : t("title")}</DialogTitle>
          <DialogDescription className="text-[13.5px] text-[#6f7282]">{t("subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <Step number={1} title={t("steps.template")} hint={t("steps.templateHint")}>
            {templates.length === 0 ? (
              <p className="rounded-2xl bg-[#fff8eb] p-3 text-[13px] text-[#9a5b00]">
                {t("noTemplates")}{" "}
                <Link href="/checklists/templates" className={CL_LINK}>{t("openTemplates")}</Link>
              </p>
            ) : (
              <Select value={draft.templateId || undefined} onValueChange={(value) => set("templateId", value)}>
                <SelectTrigger className="h-11 w-full rounded-2xl" data-field="template">
                  <SelectValue placeholder={t("templatePlaceholder")} />
                </SelectTrigger>
                <SelectContent position="popper" align="start" sideOffset={6}>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>{template.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Step>

          <Step number={2} title={t("steps.target")} hint={t("steps.targetHint")}>
            <ChecklistPicker
              testId="target"
              value={draft.targetKind && draft.targetId ? `${draft.targetKind}:${draft.targetId}` : null}
              groups={targetGroups}
              onChange={(value) => {
                if (!value) return;
                const [kind, ...rest] = value.split(":");
                setDraft((current) => ({ ...current, targetKind: kind as ChecklistAssignmentTarget, targetId: rest.join(":") }));
              }}
              placeholder={t("target.placeholder")}
              searchPlaceholder={t("target.search")}
              emptyText={t("nothingFound")}
            />
          </Step>

          <Step number={3} title={t("steps.schedule")} hint={t("steps.scheduleHint")}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={t("steps.schedule")}>
              {CHECKLIST_ASSIGNMENT_FREQUENCIES.map((frequency) => (
                <button
                  key={frequency}
                  type="button"
                  role="radio"
                  aria-checked={draft.frequency === frequency}
                  data-frequency={frequency}
                  onClick={() => set("frequency", frequency)}
                  className={cn(
                    "h-11 rounded-2xl border px-3 text-[14px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                    draft.frequency === frequency ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]" : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
                  )}
                >
                  {frequencyLabel[frequency]}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {draft.frequency === "once" ? (
                <label className="block text-[13px] font-medium text-[#3c4053]">
                  {t("onceDate")}
                  <input type="date" className={cn(CL_INPUT, "mt-1")} min={today.dayKey} value={draft.onceDate} onChange={(event) => set("onceDate", event.target.value)} data-field="onceDate" />
                </label>
              ) : null}
              {draft.frequency === "weekly" ? (
                <div className="sm:col-span-2">
                  <div className="text-[13px] font-medium text-[#3c4053]">{t("weekday")}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={draft.weekday === day}
                        onClick={() => set("weekday", day)}
                        className={cn(
                          "h-10 min-w-[44px] rounded-xl border px-2.5 text-[13px] font-medium capitalize transition-colors duration-150",
                          draft.weekday === day ? "border-[#5566f6] bg-[#5566f6] text-white" : "border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#f5f6ff]",
                        )}
                      >
                        {format.weekday(day).slice(0, 2)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {draft.frequency === "monthly" ? (
                <label className="block text-[13px] font-medium text-[#3c4053]">
                  {t("monthDay")}
                  <Select value={String(draft.monthDay)} onValueChange={(value) => set("monthDay", Number(value))}>
                    <SelectTrigger className="mt-1 h-11 w-full rounded-2xl" data-field="monthDay">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start" sideOffset={6} className="max-h-[260px]">
                      {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                        <SelectItem key={day} value={String(day)}>{day}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {draft.monthDay > 28 ? <span className="mt-1 block text-[12px] font-normal text-[#6f7282]">{t("monthDayShort")}</span> : null}
                </label>
              ) : null}
              <label className="block text-[13px] font-medium text-[#3c4053]">
                {t("dueTime")}
                <input type="time" className={cn(CL_INPUT, "mt-1")} value={draft.dueTime} onChange={(event) => set("dueTime", event.target.value)} data-field="dueTime" required />
              </label>
            </div>
          </Step>

          <Step number={4} title={t("steps.verifier")} hint={t("steps.verifierHint")}>
            <ChecklistPicker
              testId="verifier"
              value={draft.verifierUserId}
              groups={verifierGroups}
              onChange={(value) => set("verifierUserId", value)}
              placeholder={t("verifier.placeholder")}
              searchPlaceholder={t("verifier.search")}
              emptyText={t("nothingFound")}
              noneLabel={t("verifier.none")}
            />
          </Step>

          <Step number={5} title={t("steps.remind")} hint={t("steps.remindHint")}>
            <label className="flex items-start gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
              <Switch checked={draft.remindTelegram} onCheckedChange={(value) => set("remindTelegram", value)} data-field="remind" />
              <span className="text-[13.5px] leading-[1.5] text-[#3c4053]">
                <span className="block font-medium text-[#0b1024]">{t("remindLabel")}</span>
                {t("remindExplain", { time: remindAt })}
              </span>
            </label>
          </Step>
        </div>

        <div className="shrink-0 space-y-3 border-t border-[#ececf4] bg-[#fafbff] px-5 py-4 sm:px-6" data-live-hint>
          <div className="flex items-start gap-2 text-[13.5px] leading-[1.5] text-[#0b1024]">
            <Send className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
            <span>
              {draft.targetKind && draft.targetId ? (
                <>
                  <b>{t("live.recipients", { count: recipients.length })}</b>
                  {recipients.length > 0 ? ` (${names(recipients)})` : ""}
                  {". "}
                  {t("live.first", { date: format.day(firstDay), time: draft.dueTime || "—" })}
                  {draft.remindTelegram ? ` ${t("live.remind", { date: format.day(firstDay), time: remindAt })}` : ` ${t("live.noRemind")}`}
                </>
              ) : (
                t("live.chooseTarget")
              )}
            </span>
          </div>
          {noAccess.length > 0 ? (
            <Warning icon={<ShieldCheck className="size-4" />} data-warning="access">
              {t("warn.noAccess", { count: noAccess.length, names: names(noAccess) })}{" "}
              <Link href="/settings/journal-access" className={CL_LINK}>{t("warn.fixAccess")}</Link>
            </Warning>
          ) : null}
          {noTelegram.length > 0 ? (
            <Warning icon={<BellRing className="size-4" />} data-warning="telegram">
              {t("warn.noTelegram", { count: noTelegram.length, names: names(noTelegram) })}{" "}
              <Link href="/settings/users" className={CL_LINK}>{t("warn.fixTelegram")}</Link>
            </Warning>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={CL_BUTTON_OUTLINE} onClick={onClose} disabled={saving}>{t("cancel")}</button>
            <button type="button" className={CL_BUTTON_PRIMARY} onClick={() => void save()} disabled={!canSave || saving} data-action="save-assignment">
              {saving ? t("saving") : draft.id ? t("save") : t("assign")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Step({ number, title, hint, children }: { number: number; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="space-y-2" data-step={number}>
      <div className="flex items-start gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#5566f6] text-[13px] font-semibold text-white tabular-nums">{number}</span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-tight text-[#0b1024]">{title}</div>
          <div className="mt-0.5 text-[12.5px] leading-[1.45] text-[#6f7282]">{hint}</div>
        </div>
      </div>
      <div className="pl-0 sm:pl-[38px]">{children}</div>
    </section>
  );
}

function Warning({ icon, children, ...rest }: { icon: ReactNode; children: ReactNode; "data-warning"?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-[#fff8eb] px-3 py-2 text-[13px] leading-[1.5] text-[#7a4a00]" {...rest}>
      <span className="mt-0.5 shrink-0 text-[#c98a00]">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
