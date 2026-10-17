"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileText, Pencil, Plus, ScrollText, Stamp, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StaffPicker, type StaffPickerOption } from "@/components/shared/staff-picker";
import { TEAM_ROLE_DUTIES, type TeamRole } from "@/lib/ppk/haccp";
import type { TeamMember } from "@/lib/ppk/records";
import { usePpkRecords, type PpkRecordRow } from "@/components/production-control/use-ppk-records";
import { PpkFolder } from "@/components/production-control/ppk-folder";
import {
  PPK_BUTTON_OUTLINE_CLASS,
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_LABEL_CLASS,
  PPK_TEXTAREA_CLASS,
  PpkBlockActionProvider,
  PpkEmptyState,
} from "@/components/production-control/ppk-ui";

type Row = PpkRecordRow<TeamMember>;

const ROLES: TeamRole[] = ["leader", "deputy", "member", "secretary"];
/** Порядок в списке: руководитель, заместитель, члены, секретарь. */
const ROLE_ORDER: Record<TeamRole, number> = { leader: 0, deputy: 1, member: 2, secretary: 3 };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.slice(0, 1).toUpperCase()).join("") || "?";
}

/**
 * Группа ХАССП: список членов, окно добавления/правки и блок документов группы
 * (приказ, положение, подписанные файлы). Записи приходят с сервера.
 */
export function TeamClient({
  initial,
  staff,
  header,
  order,
  ack,
}: {
  initial: Row[];
  staff: StaffPickerOption[];
  header: ReactNode;
  /** Последний изданный приказ о группе (дата уже отформатирована). */
  order: { id: string; number: string; date: string } | null;
  /** Сводка ознакомления с положением о группе. */
  ack?: ReactNode;
}) {
  const t = useTranslations("productionControl.team");
  const { records, create, update, remove } = usePpkRecords<TeamMember>("team", initial);
  const [dialog, setDialog] = useState<{ row: Row | null } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Row | null>(null);

  const staffById = new Map(staff.map((person) => [person.id, person]));
  const sorted = [...records].sort((a, b) => ROLE_ORDER[a.data.role] - ROLE_ORDER[b.data.role]);
  const hasLeader = records.some((row) => row.data.role === "leader");
  const openCreate = () => setDialog({ row: null });

  const addButton = (
    <button type="button" onClick={openCreate} className={PPK_BUTTON_PRIMARY_CLASS}>
      <Plus className="size-4" />
      {t("add")}
    </button>
  );

  return (
    <PpkBlockActionProvider openCreate={openCreate}>
      {header}

      {records.length > 0 && !hasLeader ? (
        <div className="rounded-2xl bg-[#fff7e6] px-4 py-3 text-[14px] text-[#8a5a00]">{t("noLeader")}</div>
      ) : null}

      {records.length === 0 ? (
        <PpkEmptyState title={t("emptyTitle")} hint={t("emptyHint")}>
          {addButton}
        </PpkEmptyState>
      ) : (
        <ul className="grid gap-3">
          {sorted.map((row) => {
            const person = staffById.get(row.data.userId);
            const isLeader = row.data.role === "leader";
            return (
              <li key={row.id} className="flex gap-3.5 rounded-2xl border border-[#ececf4] bg-white p-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[13px] font-semibold text-[#3848c7]">
                  {initials(person?.name ?? "")}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {person ? (
                      <span className="font-semibold text-[#0b1024]">{person.name}</span>
                    ) : (
                      <span className="font-semibold text-[#9b9fb3]">{t("formerEmployee")}</span>
                    )}
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] ${
                        isLeader ? "bg-[#5566f6] text-white" : "bg-[#f5f6ff] text-[#3848c7]"
                      }`}
                    >
                      {t(`roles.${row.data.role}`)}
                    </span>
                  </div>
                  {person?.title ? <div className="text-[13px] text-[#6f7282]">{person.title}</div> : null}
                  {row.data.duties ? (
                    <p className="mt-1.5 line-clamp-2 text-[13.5px] text-[#3c4053]">{row.data.duties}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-start gap-1">
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
                    className="inline-flex size-9 items-center justify-center rounded-xl text-[#6f7282] transition-colors duration-150 hover:bg-[#fff4f2] hover:text-[#a13a32] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a13a32]/15"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {ack}

      <section className="space-y-4 rounded-3xl border border-[#ececf4] bg-white p-5">
        <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("docsTitle")}</h2>

        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
            <Stamp className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] font-medium text-[#0b1024]">{t("order")}</div>
            {order ? (
              <div className="text-[13px] text-[#6f7282]">
                {t("orderIssued", { number: order.number, date: order.date })}
              </div>
            ) : !hasLeader ? (
              <div className="text-[13px] text-[#8a5a00]">{t("orderNeedsLeader")}</div>
            ) : null}
          </div>
          {order ? (
            <Link href={`/orders/haccp-team?id=${order.id}`} className={PPK_BUTTON_OUTLINE_CLASS}>
              {t("open")}
            </Link>
          ) : hasLeader ? (
            <Link href="/orders/haccp-team?prefill=ppk-team" className={PPK_BUTTON_PRIMARY_CLASS}>
              {t("orderCreate")}
            </Link>
          ) : (
            <button type="button" disabled className={PPK_BUTTON_PRIMARY_CLASS}>
              {t("orderCreate")}
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-[#ececf4] pt-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
            <ScrollText className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 text-[14.5px] font-medium text-[#0b1024]">{t("regulation")}</div>
          <Link href="/production-control/haccp/team/regulation" className={PPK_BUTTON_OUTLINE_CLASS}>
            {t("openPrint")}
          </Link>
        </div>

        <div className="space-y-3 border-t border-[#ececf4] pt-4">
          <h3 className="flex items-center gap-2 text-[14.5px] font-medium text-[#0b1024]">
            <FileText className="size-4 text-[#3848c7]" aria-hidden />
            {t("signed")}
          </h3>
          <PpkFolder folder="team-signed" canManage />
        </div>
      </section>

      {dialog ? (
        <MemberDialog
          key={dialog.row?.id ?? "new"}
          row={dialog.row}
          staff={staff}
          takenIds={records.filter((row) => row.id !== dialog.row?.id).map((row) => row.data.userId)}
          leaderTaken={records.some((row) => row.id !== dialog.row?.id && row.data.role === "leader")}
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
        title={
          pendingRemove
            ? t("removeTitle", { name: staffById.get(pendingRemove.data.userId)?.name ?? t("formerEmployee") })
            : ""
        }
        description={t("removeBody")}
        variant="danger"
        confirmLabel={t("remove")}
        cancelLabel={t("cancel")}
      />
    </PpkBlockActionProvider>
  );
}

/** Окно члена группы: сотрудник, роль сегментами и обязанности. */
function MemberDialog({
  row,
  staff,
  takenIds,
  leaderTaken,
  onClose,
  onSave,
}: {
  row: Row | null;
  staff: StaffPickerOption[];
  takenIds: string[];
  leaderTaken: boolean;
  onClose: () => void;
  onSave: (data: TeamMember) => Promise<boolean>;
}) {
  const t = useTranslations("productionControl.team");
  const firstRole: TeamRole = row?.data.role ?? (leaderTaken ? "member" : "leader");
  const [userId, setUserId] = useState<string | null>(row?.data.userId ?? null);
  const [role, setRole] = useState<TeamRole>(firstRole);
  const [duties, setDuties] = useState(row?.data.duties ?? TEAM_ROLE_DUTIES[firstRole]);
  /** Обязанности правили руками — при смене роли их не подменяем. */
  const [dutiesTouched, setDutiesTouched] = useState(Boolean(row));
  const [saving, setSaving] = useState(false);

  const available = staff.filter((person) => !takenIds.includes(person.id));

  function pickRole(next: TeamRole) {
    setRole(next);
    if (!dutiesTouched) setDuties(TEAM_ROLE_DUTIES[next]);
  }

  async function submit() {
    if (!userId || saving) return;
    setSaving(true);
    const saved = await onSave({ userId, role, duties: duties.trim() });
    setSaving(false);
    if (saved) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-[560px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 gap-0 border-b border-[#ececf4] px-6 py-4 pr-14 text-left">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
            {row ? t("edit") : t("add")}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div>
            <span className={PPK_LABEL_CLASS}>{t("employee")}</span>
            <StaffPicker
              value={userId}
              onChange={setUserId}
              staff={available}
              recommendedIds={available.filter((person) => person.isManager).map((person) => person.id)}
              placeholder={t("employee")}
              disabled={Boolean(row)}
            />
          </div>

          <div>
            <span className={PPK_LABEL_CLASS}>{t("role")}</span>
            <div role="radiogroup" aria-label={t("role")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ROLES.map((item) => {
                const blocked = item === "leader" && leaderTaken;
                const selected = role === item;
                return (
                  <button
                    key={item}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={blocked}
                    title={blocked ? t("leaderTaken") : undefined}
                    onClick={() => pickRole(item)}
                    className={`min-h-10 rounded-2xl border px-2 py-2 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-40 ${
                      selected
                        ? "border-[#5566f6]/40 bg-[#eef1ff] text-[#3848c7]"
                        : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                    }`}
                  >
                    {t(`roles.${item}`)}
                  </button>
                );
              })}
            </div>
            {leaderTaken ? <p className="mt-1.5 text-[12.5px] text-[#9b9fb3]">{t("leaderTaken")}</p> : null}
          </div>

          <label className="block">
            <span className={PPK_LABEL_CLASS}>{t("duties")}</span>
            <textarea
              value={duties}
              onChange={(event) => {
                setDuties(event.target.value);
                setDutiesTouched(true);
              }}
              rows={5}
              className={PPK_TEXTAREA_CLASS}
            />
          </label>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-[#ececf4] px-6 py-4">
          <button type="button" onClick={onClose} className={PPK_BUTTON_OUTLINE_CLASS}>
            {t("cancel")}
          </button>
          <button type="button" onClick={submit} disabled={!userId || saving} className={PPK_BUTTON_PRIMARY_CLASS}>
            {t("save")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
