"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarClock, FileText, Pencil, Plus, Trash2, Users } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { StaffPicker, type StaffPickerOption } from "@/components/shared/staff-picker";
import type { TeamMeeting } from "@/lib/ppk/records";
import { nextMeetingDate } from "@/lib/ppk/review";
import { daysBetween } from "@/lib/ppk/reminders";
import { usePpkRecords, type PpkRecordRow } from "@/components/production-control/use-ppk-records";
import {
  PPK_BUTTON_OUTLINE_CLASS,
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_FIELD_CLASS,
  PPK_ICON_BUTTON_CLASS,
  PPK_LABEL_CLASS,
  PPK_TEXTAREA_CLASS,
  PpkBlockActionProvider,
  PpkEmptyState,
} from "@/components/production-control/ppk-ui";

type Row = PpkRecordRow<TeamMeeting>;

/** Присутствующих в одном протоколе не больше этого числа (лимит схемы). */
const ATTENDEES_MAX = 30;

/** ГГГГ-ММ-ДД → ДД.ММ.ГГГГ. */
function ruDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

/**
 * Заседания группы ХАССП: срок следующего заседания, список протоколов, окно записи
 * заседания и ссылка на протокол для печати.
 */
export function MeetingsClient({
  initial,
  staff,
  memberIds,
  today,
  header,
}: {
  initial: Row[];
  staff: StaffPickerOption[];
  /** Члены группы — по умолчанию отмечены присутствующими. */
  memberIds: string[];
  /** Сегодня YYYY-MM-DD по Москве. */
  today: string;
  header: ReactNode;
}) {
  const t = useTranslations("productionControl.meetings");
  const { records, create, update, remove } = usePpkRecords<TeamMeeting>("team-meetings", initial);
  const [dialog, setDialog] = useState<{ row: Row | null } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Row | null>(null);

  const openCreate = () => setDialog({ row: null });
  const sorted = [...records].sort((a, b) => b.data.date.localeCompare(a.data.date));
  const next = nextMeetingDate(records.map((row) => row.data));
  const overdue = next !== null && daysBetween(today, next) < 0;

  const addButton = (
    <button type="button" onClick={openCreate} className={PPK_BUTTON_PRIMARY_CLASS}>
      <Plus className="size-4" />
      {t("add")}
    </button>
  );

  return (
    <PpkBlockActionProvider openCreate={openCreate}>
      {header}

      <div
        className={`flex items-center gap-2.5 rounded-2xl px-4 py-3 text-[14px] ${
          overdue ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#f5f6ff] text-[#3848c7]"
        }`}
      >
        <CalendarClock className="size-4 shrink-0" aria-hidden />
        <span className="font-medium">
          {next === null
            ? t("nextNone")
            : overdue
              ? t("nextOverdue", { date: ruDate(next) })
              : t("nextDue", { date: ruDate(next) })}
        </span>
      </div>

      {records.length === 0 ? (
        <PpkEmptyState title={t("emptyTitle")} hint={t("emptyHint")}>
          {addButton}
        </PpkEmptyState>
      ) : (
        <ul className="grid gap-3">
          {sorted.map((row) => (
            <li key={row.id} className="flex flex-wrap gap-3.5 rounded-2xl border border-[#ececf4] bg-white p-4 sm:flex-nowrap">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
                <Users className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                  <span className="font-semibold text-[#0b1024]">{ruDate(row.data.date)}</span>
                  <span className="text-[13px] text-[#6f7282]">
                    {t("attended", { count: String(row.data.attendeeIds.length) })}
                  </span>
                </div>
                <p className="mt-0.5 text-[14px] text-[#3c4053]">{row.data.topic}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Link
                  href={`/production-control/haccp/team/meetings/${row.id}`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  <FileText className="size-4" aria-hidden />
                  {t("protocol")}
                </Link>
                <button
                  type="button"
                  onClick={() => setDialog({ row })}
                  aria-label={t("edit")}
                  title={t("edit")}
                  className="inline-flex size-9 items-center justify-center rounded-xl text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#3848c7] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingRemove(row)}
                  aria-label={t("remove")}
                  title={t("remove")}
                  className={PPK_ICON_BUTTON_CLASS}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog ? (
        <MeetingDialog
          key={dialog.row?.id ?? "new"}
          row={dialog.row}
          staff={staff}
          memberIds={memberIds}
          today={today}
          onClose={() => setDialog(null)}
          onSave={(data) => (dialog.row ? update(dialog.row.id, data) : create(data))}
        />
      ) : null}

      <ConfirmDialog
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={async () => {
          if (pendingRemove) await remove(pendingRemove.id);
        }}
        title={pendingRemove ? t("removeTitle", { date: ruDate(pendingRemove.data.date) }) : ""}
        description={t("removeBody")}
        variant="danger"
        confirmLabel={t("remove")}
        cancelLabel={t("cancel")}
      />
    </PpkBlockActionProvider>
  );
}

/** Окно заседания: дата, тема, решения и отметки присутствовавших. */
function MeetingDialog({
  row,
  staff,
  memberIds,
  today,
  onClose,
  onSave,
}: {
  row: Row | null;
  staff: StaffPickerOption[];
  memberIds: string[];
  today: string;
  onClose: () => void;
  onSave: (data: TeamMeeting) => Promise<boolean>;
}) {
  const t = useTranslations("productionControl.meetings");
  const [date, setDate] = useState(row?.data.date ?? today);
  const [topic, setTopic] = useState(row?.data.topic ?? "");
  const [decisions, setDecisions] = useState(row?.data.decisions ?? "");
  /** Кто присутствовал: новое заседание — вся группа, правка — как записано. */
  const [attendees, setAttendees] = useState<string[]>(row ? row.data.attendeeIds : memberIds);
  /** Сотрудники вне группы, добавленные вручную, — остаются в списке, пока окно открыто. */
  const [extraIds, setExtraIds] = useState<string[]>(
    row ? row.data.attendeeIds.filter((userId) => !memberIds.includes(userId)) : [],
  );
  const [saving, setSaving] = useState(false);

  const byId = new Map(staff.map((person) => [person.id, person]));
  const listed = [...memberIds, ...extraIds];
  const outsiders = staff.filter((person) => !listed.includes(person.id));
  const canSave = date !== "" && topic.trim() !== "" && !saving;

  function toggle(userId: string, checked: boolean) {
    setAttendees((current) =>
      checked ? (current.includes(userId) ? current : [...current, userId]) : current.filter((id) => id !== userId),
    );
  }

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    const saved = await onSave({
      date,
      topic: topic.trim(),
      decisions: decisions.trim(),
      attendeeIds: attendees.slice(0, ATTENDEES_MAX),
    });
    setSaving(false);
    if (saved) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-[560px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 gap-0 border-b border-[#ececf4] px-6 py-4 pr-14 text-left">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
            {row ? t("dialogEdit") : t("dialogAdd")}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <label className="block">
            <span className={PPK_LABEL_CLASS}>{t("date")}</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={PPK_FIELD_CLASS} />
          </label>

          <label className="block">
            <span className={PPK_LABEL_CLASS}>{t("topic")}</span>
            <input
              type="text"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              maxLength={200}
              placeholder={t("topicPlaceholder")}
              className={PPK_FIELD_CLASS}
            />
          </label>

          <label className="block">
            <span className={PPK_LABEL_CLASS}>{t("decisions")}</span>
            <textarea
              value={decisions}
              onChange={(event) => setDecisions(event.target.value)}
              rows={5}
              maxLength={4000}
              placeholder={t("decisionsPlaceholder")}
              className={PPK_TEXTAREA_CLASS}
            />
          </label>

          <div>
            <span className={PPK_LABEL_CLASS}>{t("attendees")}</span>
            {listed.length === 0 ? (
              <p className="rounded-2xl bg-[#fff7e6] px-4 py-3 text-[13.5px] text-[#8a5a00]">{t("noMembers")}</p>
            ) : (
              <ul className="space-y-1">
                {listed.map((userId) => {
                  const person = byId.get(userId);
                  const checked = attendees.includes(userId);
                  return (
                    <li key={userId}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-150 hover:bg-[#f5f6ff]">
                        <Checkbox checked={checked} onCheckedChange={(value) => toggle(userId, value === true)} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-medium text-[#0b1024]">
                            {person?.name ?? t("formerEmployee")}
                          </span>
                          {person?.title ? (
                            <span className="block text-[12.5px] text-[#6f7282]">{person.title}</span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}

            {outsiders.length > 0 ? (
              <div className="mt-3">
                <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("addOther")}</span>
                <StaffPicker
                  value={null}
                  onChange={(userId) => {
                    if (!userId) return;
                    setExtraIds((current) => [...current, userId]);
                    toggle(userId, true);
                  }}
                  staff={outsiders}
                  placeholder={t("otherPlaceholder")}
                />
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-[#ececf4] px-6 py-4">
          <button type="button" onClick={onClose} className={PPK_BUTTON_OUTLINE_CLASS}>
            {t("cancel")}
          </button>
          <button type="button" onClick={submit} disabled={!canSave} className={PPK_BUTTON_PRIMARY_CLASS}>
            {t("save")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
