"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ContractData } from "@/lib/ppk/records";
import { usePpkRecords, type PpkRecordRow } from "@/components/production-control/use-ppk-records";
import {
  PPK_BUTTON_OUTLINE_CLASS,
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_FIELD_CLASS,
  PPK_ICON_BUTTON_CLASS,
  PPK_LABEL_CLASS,
} from "@/components/production-control/ppk-ui";

type Row = PpkRecordRow<ContractData>;

const EMPTY: ContractData = {
  title: "",
  counterparty: "",
  number: "",
  date: null,
  validUntil: null,
  visibleToInspector: false,
};

/** Перечень договоров: таблица по шаблону, окно правки, удаление с подтверждением. */
export function ContractsClient({ initial }: { initial: Row[] }) {
  const t = useTranslations("productionControl.structure.contracts");
  const locale = useLocale();
  const { records, create, update, remove } = usePpkRecords<ContractData>("contracts", initial);
  const [editing, setEditing] = useState<{ row: Row | null } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Row | null>(null);

  const date = (value: string | null) =>
    value ? new Date(`${value}T12:00:00Z`).toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

  return (
    <section className="space-y-3" data-ppk-contracts>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15.5px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("listTitle")}</h3>
        <button type="button" onClick={() => setEditing({ row: null })} className={PPK_BUTTON_PRIMARY_CLASS}>
          <Plus className="size-4" aria-hidden />
          {t("add")}
        </button>
      </div>

      {records.length === 0 ? (
        <div className="rounded-2xl bg-[var(--app-veil)] px-5 py-8 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">{t("emptyTitle")}</div>
          <p className="mx-auto mt-1 max-w-[420px] text-[13px] text-[#6f7282]">{t("emptyHint")}</p>
        </div>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[640px] border-collapse text-[13.5px]">
            <thead>
              <tr className="text-left text-[12.5px] text-[#6f7282]">
                <th className="border-b border-[#ececf4] px-2 py-2 font-medium">{t("fields.title")}</th>
                <th className="border-b border-[#ececf4] px-2 py-2 font-medium">{t("fields.counterparty")}</th>
                <th className="border-b border-[#ececf4] px-2 py-2 font-medium">{t("fields.number")}</th>
                <th className="border-b border-[#ececf4] px-2 py-2 font-medium">{t("fields.date")}</th>
                <th className="border-b border-[#ececf4] px-2 py-2 font-medium">{t("fields.validUntil")}</th>
                <th className="w-[96px] border-b border-[#ececf4] px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {records.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="border-b border-[#ececf4] px-2 py-2 font-medium text-[#0b1024] [overflow-wrap:anywhere]">
                    {row.data.title}
                    {row.data.visibleToInspector ? (
                      <span className="mt-0.5 flex items-center gap-1 text-[12px] font-normal text-[#6f7282]">
                        <Eye className="size-3.5" aria-hidden />
                        {t("visibleShort")}
                      </span>
                    ) : null}
                  </td>
                  <td className="border-b border-[#ececf4] px-2 py-2 [overflow-wrap:anywhere]">{row.data.counterparty || "—"}</td>
                  <td className="border-b border-[#ececf4] px-2 py-2">{row.data.number || "—"}</td>
                  <td className="border-b border-[#ececf4] px-2 py-2 tabular-nums">{date(row.data.date)}</td>
                  <td className="border-b border-[#ececf4] px-2 py-2 tabular-nums">{date(row.data.validUntil)}</td>
                  <td className="border-b border-[#ececf4] px-1 py-1">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing({ row })}
                        aria-label={t("edit")}
                        title={t("edit")}
                        className="inline-flex size-9 items-center justify-center rounded-xl text-[#6f7282] transition-colors duration-150 hover:bg-[var(--app-veil-hover)] hover:text-[#0b1024] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <ContractDialog
          row={editing.row}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            const ok = editing.row ? await update(editing.row.id, data) : await create(data);
            if (ok) setEditing(null);
            return ok;
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={async () => {
          if (pendingRemove) await remove(pendingRemove.id);
          setPendingRemove(null);
        }}
        title={t("removeTitle", { name: pendingRemove?.data.title ?? "" })}
        description={t("removeBody")}
        confirmLabel={t("remove")}
        cancelLabel={t("cancel")}
        variant="danger"
      />
    </section>
  );
}

function ContractDialog({
  row,
  onClose,
  onSave,
}: {
  row: Row | null;
  onClose: () => void;
  onSave: (data: ContractData) => Promise<boolean>;
}) {
  const t = useTranslations("productionControl.structure.contracts");
  const [draft, setDraft] = useState<ContractData>(row ? row.data : EMPTY);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ContractData>(key: K, value: ContractData[K]) => setDraft((prev) => ({ ...prev, [key]: value }));
  const valid = draft.title.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader className="text-left">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
            {row ? t("editTitle") : t("addTitle")}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!valid || saving) return;
            setSaving(true);
            await onSave({
              ...draft,
              title: draft.title.trim(),
              counterparty: draft.counterparty.trim(),
              number: draft.number.trim(),
            });
            setSaving(false);
          }}
        >
          <label className="block">
            <span className={PPK_LABEL_CLASS}>
              {t("fields.title")}
              <span className="text-[#a13a32]"> *</span>
            </span>
            <input
              value={draft.title}
              maxLength={300}
              autoFocus
              placeholder={t("titlePlaceholder")}
              onChange={(event) => set("title", event.target.value)}
              className={PPK_FIELD_CLASS}
            />
          </label>
          <label className="block">
            <span className={PPK_LABEL_CLASS}>{t("fields.counterparty")}</span>
            <input
              value={draft.counterparty}
              maxLength={300}
              onChange={(event) => set("counterparty", event.target.value)}
              className={PPK_FIELD_CLASS}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className={PPK_LABEL_CLASS}>{t("fields.number")}</span>
              <input value={draft.number} maxLength={100} onChange={(event) => set("number", event.target.value)} className={PPK_FIELD_CLASS} />
            </label>
            <label className="block">
              <span className={PPK_LABEL_CLASS}>{t("fields.date")}</span>
              <input
                type="date"
                value={draft.date ?? ""}
                onChange={(event) => set("date", event.target.value || null)}
                className={PPK_FIELD_CLASS}
              />
            </label>
            <label className="block">
              <span className={PPK_LABEL_CLASS}>{t("fields.validUntil")}</span>
              <input
                type="date"
                value={draft.validUntil ?? ""}
                onChange={(event) => set("validUntil", event.target.value || null)}
                className={PPK_FIELD_CLASS}
              />
            </label>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-[var(--app-veil)] px-4 py-3">
            <input
              type="checkbox"
              checked={draft.visibleToInspector}
              onChange={(event) => set("visibleToInspector", event.target.checked)}
              className="mt-0.5 size-4 accent-[#5566f6]"
            />
            <span>
              <span className="block text-[14px] font-medium text-[#0b1024]">{t("fields.visibleToInspector")}</span>
              <span className="block text-[12.5px] text-[#6f7282]">{t("visibleHint")}</span>
            </span>
          </label>
          <DialogFooter className="gap-2">
            <button type="button" onClick={onClose} className={PPK_BUTTON_OUTLINE_CLASS}>
              {t("cancel")}
            </button>
            <button type="submit" disabled={!valid || saving} className={PPK_BUTTON_PRIMARY_CLASS}>
              {t("save")}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
