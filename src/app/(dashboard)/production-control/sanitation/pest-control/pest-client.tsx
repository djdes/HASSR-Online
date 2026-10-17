"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CircleCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { PestPlanItem } from "@/lib/ppk/records";
import { dueState, pestNextDate, todayKey } from "@/lib/ppk/sanitation";
import { MarkDoneDialog } from "@/components/production-control/mark-done-dialog";
import { usePpkRecords, type PpkRecordRow } from "@/components/production-control/use-ppk-records";
import {
  PPK_BUTTON_OUTLINE_CLASS,
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_BUTTON_TEXT_CLASS,
  PPK_BUTTON_TEXT_DANGER_CLASS,
  PPK_FIELD_CLASS,
  PPK_LABEL_CLASS,
  PpkBlockActionProvider,
  PpkEmptyState,
} from "@/components/production-control/ppk-ui";
import { DueDate, PlanPill, formatPlanDate, ppkSegmentClass } from "@/components/production-control/sanitation-ui";

type Row = PpkRecordRow<PestPlanItem>;
type Kind = PestPlanItem["kind"];

const KINDS: Kind[] = ["disinsection", "deratization", "disinfection"];
/** Подсказки периодичности; значение поля — свободный текст. */
const FREQUENCY_KEYS = ["monthly", "quarterly", "halfYear", "onRequest"] as const;

/**
 * План дезинсекции, дератизации и дезинфекции: таблица на десктопе, карточки на
 * телефоне. Следующая дата подсвечивается по сроку (просрочено / скоро). Записи
 * приходят с сервера (`initial`), изменения идут через `usePpkRecords`.
 */
export function PestClient({ initial, header }: { initial: Row[]; header: ReactNode }) {
  const t = useTranslations("productionControl.pest");
  const locale = useLocale();
  const { records, create, update, remove } = usePpkRecords<PestPlanItem>("pest-plan", initial);

  /** `null` — окно закрыто; `{ row: null }` — создание; иначе — правка строки. */
  const [dialog, setDialog] = useState<{ row: Row | null } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Row | null>(null);
  const [marking, setMarking] = useState<Row | null>(null);
  const [filling, setFilling] = useState(false);
  const today = todayKey();

  const openCreate = () => setDialog({ row: null });

  /** Типовой план для общепита: три записи, исполнитель не заполнен. */
  const fillTypical = async () => {
    setFilling(true);
    const typical: PestPlanItem[] = [
      { kind: "disinsection", object: t("typicalObject"), frequency: t("freq.monthly"), contractor: "", lastDate: null, nextDate: null },
      { kind: "deratization", object: t("typicalObject"), frequency: t("freq.monthly"), contractor: "", lastDate: null, nextDate: null },
      { kind: "disinfection", object: t("typicalObject"), frequency: t("freq.quarterly"), contractor: "", lastDate: null, nextDate: null },
    ];
    for (const item of typical) {
      if (!(await create(item))) break;
    }
    setFilling(false);
  };

  const actions = (row: Row) => (
    <>
      <button type="button" onClick={() => setMarking(row)} className={PPK_BUTTON_TEXT_CLASS}>
        <CircleCheck className="size-4" />
        {t("done")}
      </button>
      <button type="button" onClick={() => setDialog({ row })} className={PPK_BUTTON_TEXT_CLASS}>
        <Pencil className="size-4" />
        {t("edit")}
      </button>
      <button type="button" onClick={() => setPendingRemove(row)} className={PPK_BUTTON_TEXT_DANGER_CLASS}>
        <Trash2 className="size-4" />
        {t("remove")}
      </button>
    </>
  );

  return (
    <PpkBlockActionProvider openCreate={openCreate}>
      {header}

      <section className="space-y-4">
        <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("plan")}</h2>

        {records.length === 0 ? (
          <PpkEmptyState title={t("emptyTitle")} hint={t("emptyHint")}>
            <button type="button" onClick={fillTypical} disabled={filling} className={PPK_BUTTON_OUTLINE_CLASS}>
              {t("fillTypical")}
            </button>
            <button type="button" onClick={openCreate} className={PPK_BUTTON_PRIMARY_CLASS}>
              <Plus className="size-4" />
              {t("add")}
            </button>
          </PpkEmptyState>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-3xl border border-[#ececf4] bg-white md:block">
              <table className="w-full text-left text-[14px]">
                <thead className="bg-[#fafbff] text-[12px] font-medium text-[#9b9fb3]">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t("kind")}</th>
                    <th className="px-4 py-3 font-medium">{t("object")}</th>
                    <th className="px-4 py-3 font-medium">{t("frequency")}</th>
                    <th className="px-4 py-3 font-medium">{t("contractor")}</th>
                    <th className="px-4 py-3 font-medium">{t("lastDate")}</th>
                    <th className="px-4 py-3 font-medium">{t("nextDate")}</th>
                    <th className="px-4 py-3">
                      <span className="sr-only">{t("edit")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ececf4]">
                  {records.map((row) => (
                    <tr key={row.id} className="align-middle text-[#3c4053] transition-colors duration-150 hover:bg-[#fafbff]">
                      <td className="px-4 py-3">
                        <PlanPill>{t(`kinds.${row.data.kind}`)}</PlanPill>
                      </td>
                      <td className="px-4 py-3 font-medium text-[#0b1024]">{row.data.object}</td>
                      <td className="px-4 py-3">{row.data.frequency || "—"}</td>
                      <td className="px-4 py-3">{row.data.contractor || "—"}</td>
                      <td className="px-4 py-3 tabular-nums">{formatPlanDate(row.data.lastDate, locale)}</td>
                      <td className="px-4 py-3">
                        <DueDate
                          value={row.data.nextDate}
                          state={dueState(row.data.nextDate, today)}
                          locale={locale}
                          overdueLabel={t("overdue")}
                          soonLabel={t("soon")}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">{actions(row)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="grid gap-3 md:hidden">
              {records.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <PlanPill>{t(`kinds.${row.data.kind}`)}</PlanPill>
                    <span className="min-w-0 font-semibold text-[#0b1024] [overflow-wrap:anywhere]">{row.data.object}</span>
                  </div>
                  <dl className="grid gap-1.5 text-[13px]">
                    <div className="flex gap-2">
                      <dt className="w-[130px] shrink-0 text-[#9b9fb3]">{t("frequency")}</dt>
                      <dd className="min-w-0 text-[#3c4053]">{row.data.frequency || "—"}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-[130px] shrink-0 text-[#9b9fb3]">{t("contractor")}</dt>
                      <dd className="min-w-0 text-[#3c4053]">{row.data.contractor || "—"}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-[130px] shrink-0 text-[#9b9fb3]">{t("lastDate")}</dt>
                      <dd className="min-w-0 text-[#3c4053]">{formatPlanDate(row.data.lastDate, locale)}</dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-[130px] shrink-0 text-[#9b9fb3]">{t("nextDate")}</dt>
                      <dd className="min-w-0">
                        <DueDate
                          value={row.data.nextDate}
                          state={dueState(row.data.nextDate, today)}
                          locale={locale}
                          overdueLabel={t("overdue")}
                          soonLabel={t("soon")}
                        />
                      </dd>
                    </div>
                  </dl>
                  <div className="flex items-center justify-end gap-1 border-t border-[#ececf4] pt-3">{actions(row)}</div>
                </li>
              ))}
            </ul>

            <button type="button" onClick={openCreate} className={`${PPK_BUTTON_OUTLINE_CLASS} md:hidden`}>
              <Plus className="size-4" />
              {t("add")}
            </button>
          </>
        )}
      </section>

      {dialog ? (
        <PestDialog
          key={dialog.row?.id ?? "new"}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onSave={(data) => (dialog.row ? update(dialog.row.id, data) : create(data))}
        />
      ) : null}

      {marking ? (
        <MarkDoneDialog
          key={marking.id}
          computeNext={(date) => pestNextDate(marking.data.frequency, date)}
          editableNext
          fileKind="act"
          folder="pest-acts"
          onClose={() => setMarking(null)}
          onSubmit={(date, nextDate) => update(marking.id, { ...marking.data, lastDate: date, nextDate })}
        />
      ) : null}

      <ConfirmDialog
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={async () => {
          if (pendingRemove) await remove(pendingRemove.id);
        }}
        title={t("removeTitle")}
        description={t("removeBody")}
        variant="danger"
        confirmLabel={t("remove")}
        cancelLabel={t("cancel")}
      />
    </PpkBlockActionProvider>
  );
}

/** Окно мероприятия: вид, объект, периодичность с подсказками, исполнитель и две даты. */
function PestDialog({
  row,
  onClose,
  onSave,
}: {
  row: Row | null;
  onClose: () => void;
  onSave: (data: PestPlanItem) => Promise<boolean>;
}) {
  const t = useTranslations("productionControl.pest");
  const [form, setForm] = useState({
    kind: (row?.data.kind ?? "disinsection") as Kind,
    object: row?.data.object ?? "",
    frequency: row?.data.frequency ?? "",
    contractor: row?.data.contractor ?? "",
    lastDate: row?.data.lastDate ?? "",
    nextDate: row?.data.nextDate ?? "",
  });
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (!form.object.trim() || saving) return;
    setSaving(true);
    const saved = await onSave({
      kind: form.kind,
      object: form.object.trim(),
      frequency: form.frequency.trim(),
      contractor: form.contractor.trim(),
      lastDate: form.lastDate || null,
      nextDate: form.nextDate || null,
    });
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-[560px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 gap-0 border-b border-[#ececf4] px-6 py-4 pr-14 text-left">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
            {row ? t("edit") : t("add")}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <span className={PPK_LABEL_CLASS}>{t("kind")}</span>
            <div role="group" aria-label={t("kind")} className="flex flex-wrap gap-2">
              {KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={form.kind === kind}
                  onClick={() => setField("kind", kind)}
                  className={ppkSegmentClass(form.kind === kind)}
                >
                  {t(`kinds.${kind}`)}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className={PPK_LABEL_CLASS}>{t("object")}</span>
            <input
              value={form.object}
              onChange={(event) => setField("object", event.target.value)}
              autoFocus
              className={PPK_FIELD_CLASS}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={PPK_LABEL_CLASS}>{t("frequency")}</span>
              <input
                value={form.frequency}
                list="pest-frequency-options"
                onChange={(event) => setField("frequency", event.target.value)}
                className={PPK_FIELD_CLASS}
              />
              <datalist id="pest-frequency-options">
                {FREQUENCY_KEYS.map((key) => (
                  <option key={key} value={t(`freq.${key}`)} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className={PPK_LABEL_CLASS}>{t("contractor")}</span>
              <input
                value={form.contractor}
                onChange={(event) => setField("contractor", event.target.value)}
                className={PPK_FIELD_CLASS}
              />
            </label>
            <label className="block">
              <span className={PPK_LABEL_CLASS}>{t("lastDate")}</span>
              <input
                type="date"
                value={form.lastDate}
                onChange={(event) => setField("lastDate", event.target.value)}
                className={PPK_FIELD_CLASS}
              />
            </label>
            <label className="block">
              <span className={PPK_LABEL_CLASS}>{t("nextDate")}</span>
              <input
                type="date"
                value={form.nextDate}
                onChange={(event) => setField("nextDate", event.target.value)}
                className={PPK_FIELD_CLASS}
              />
            </label>
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-[#ececf4] px-6 py-4">
          <button type="button" onClick={onClose} className={PPK_BUTTON_OUTLINE_CLASS}>
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!form.object.trim() || saving}
            className={PPK_BUTTON_PRIMARY_CLASS}
          >
            {t("save")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
