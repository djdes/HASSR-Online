"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ListPlus, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PRP_TABLES, emptyPrpRow, type PrpRow, type PrpTableBlock } from "@/lib/ppk/prp-tables";
import { usePpkRecords, type PpkRecordRow } from "@/components/production-control/use-ppk-records";
import {
  PPK_BUTTON_OUTLINE_CLASS,
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_FIELD_CLASS,
  PPK_ICON_BUTTON_CLASS,
  PPK_LABEL_CLASS,
  PPK_TEXTAREA_CLASS,
} from "@/components/production-control/ppk-ui";

type Row = PpkRecordRow<PrpRow>;

/** Таблица ПОПМ: строки, окно правки строки, удаление, «Заполнить типовыми». */
export function PrpTableClient({
  block,
  initial,
  template,
}: {
  block: PrpTableBlock;
  initial: Row[];
  template: PrpRow[];
}) {
  const t = useTranslations("productionControl.structure.prp");
  const { records, create, update, remove, reload } = usePpkRecords<PrpRow>(block, initial);
  const columns = PRP_TABLES[block];
  const [editing, setEditing] = useState<{ row: Row | null } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Row | null>(null);
  const [filling, setFilling] = useState(false);
  // Подписи колонок есть у каждой таблицы во всех словарях (structure.test.ts).
  const label = (key: string) => t(`columns.${block}.${key}` as "columns.prp-medical.kind");
  const firstKey = columns[0].key;
  const taken = new Set(records.map((row) => (row.data[firstKey] ?? "").trim().toLowerCase()));
  const missingTemplate = template.filter((row) => !taken.has((row[firstKey] ?? "").trim().toLowerCase())).length;

  async function fill() {
    if (filling) return;
    setFilling(true);
    try {
      const response = await fetch("/api/production-control/prp/fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block }),
      });
      const body = (await response.json().catch(() => null)) as { added?: number; error?: string } | null;
      if (!response.ok || typeof body?.added !== "number") {
        toast.error(body?.error || t("fillFailed"));
        return;
      }
      toast.success(t("filled", { count: String(body.added) }));
      window.dispatchEvent(new Event("ppk:changed"));
      await reload();
    } catch {
      toast.error(t("fillFailed"));
    } finally {
      setFilling(false);
    }
  }

  return (
    <section className="space-y-3" data-ppk-prp={block}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setEditing({ row: null })} className={PPK_BUTTON_PRIMARY_CLASS}>
          <Plus className="size-4" aria-hidden />
          {t("addRow")}
        </button>
        {missingTemplate > 0 ? (
          <button type="button" onClick={() => void fill()} disabled={filling} className={PPK_BUTTON_OUTLINE_CLASS}>
            {filling ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ListPlus className="size-4 text-[#5566f6]" aria-hidden />}
            {records.length === 0 && block === "prp-emergencies" ? t("takeTemplate") : t("fillTypical", { count: String(missingTemplate) })}
          </button>
        ) : null}
      </div>

      {records.length === 0 ? (
        block === "prp-emergencies" ? (
          <div className="space-y-2">
            <p className="text-[13px] text-[#6f7282]">{t("templatePreview")}</p>
            <ol className="space-y-2">
              {template.map((row, index) => (
                <li key={index} className="rounded-2xl bg-[var(--app-veil)] px-4 py-3 text-[13.5px] leading-[1.5]">
                  <div className="font-medium text-[#0b1024]">{row.situation}</div>
                  <div className="mt-0.5 text-[#3c4053]">{row.actions}</div>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="rounded-2xl bg-[var(--app-veil)] px-5 py-8 text-center">
            <div className="text-[15px] font-medium text-[#0b1024]">{t("emptyTitle")}</div>
            <p className="mx-auto mt-1 max-w-[420px] text-[13px] text-[#6f7282]">{t("emptyHint")}</p>
          </div>
        )
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[640px] border-collapse text-[13.5px]">
            <thead>
              <tr className="text-left text-[12.5px] text-[#6f7282]">
                <th className="w-8 border-b border-[#ececf4] px-2 py-2 font-medium">№</th>
                {columns.map((column) => (
                  <th key={column.key} className="border-b border-[#ececf4] px-2 py-2 font-medium">
                    {label(column.key)}
                  </th>
                ))}
                <th className="w-[88px] border-b border-[#ececf4] px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {records.map((row, index) => (
                <tr key={row.id} className="align-top">
                  <td className="border-b border-[#ececf4] px-2 py-2 tabular-nums text-[#6f7282]">{index + 1}</td>
                  {columns.map((column, columnIndex) => (
                    <td
                      key={column.key}
                      className={
                        columnIndex === 0
                          ? "border-b border-[#ececf4] px-2 py-2 font-medium text-[#0b1024] [overflow-wrap:anywhere]"
                          : "border-b border-[#ececf4] px-2 py-2 text-[#3c4053] [overflow-wrap:anywhere]"
                      }
                    >
                      {row.data[column.key] || "—"}
                    </td>
                  ))}
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
        <RowDialog
          block={block}
          row={editing.row}
          label={label}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            const ok = editing.row ? await update(editing.row.id, data) : await create(data);
            if (ok) setEditing(null);
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
        title={t("removeTitle")}
        description={pendingRemove ? (pendingRemove.data[firstKey] ?? "") : ""}
        confirmLabel={t("remove")}
        cancelLabel={t("cancel")}
        variant="danger"
      />
    </section>
  );
}

function RowDialog({
  block,
  row,
  label,
  onClose,
  onSave,
}: {
  block: PrpTableBlock;
  row: Row | null;
  label: (key: string) => string;
  onClose: () => void;
  onSave: (data: PrpRow) => Promise<void>;
}) {
  const t = useTranslations("productionControl.structure.prp");
  const columns = PRP_TABLES[block];
  const [draft, setDraft] = useState<PrpRow>(row ? { ...emptyPrpRow(block), ...row.data } : emptyPrpRow(block));
  const [saving, setSaving] = useState(false);
  const valid = columns.every((column) => !column.required || (draft[column.key] ?? "").trim().length > 0);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader className="text-left">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
            {row ? t("editRow") : t("addRow")}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!valid || saving) return;
            setSaving(true);
            await onSave(Object.fromEntries(columns.map((column) => [column.key, (draft[column.key] ?? "").trim()])));
            setSaving(false);
          }}
        >
          {columns.map((column, index) => (
            <label key={column.key} className="block">
              <span className={PPK_LABEL_CLASS}>
                {label(column.key)}
                {column.required ? <span className="text-[#a13a32]"> *</span> : null}
              </span>
              {column.multiline ? (
                <textarea
                  value={draft[column.key] ?? ""}
                  maxLength={column.max}
                  autoFocus={index === 0}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [column.key]: event.target.value }))}
                  className={PPK_TEXTAREA_CLASS}
                />
              ) : (
                <input
                  value={draft[column.key] ?? ""}
                  maxLength={column.max}
                  autoFocus={index === 0}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [column.key]: event.target.value }))}
                  className={PPK_FIELD_CLASS}
                />
              )}
            </label>
          ))}
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
