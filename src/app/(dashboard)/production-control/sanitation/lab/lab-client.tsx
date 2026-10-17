"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CircleCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { LabPlanItem } from "@/lib/ppk/records";
import { dueState, labNextDate, todayKey } from "@/lib/ppk/sanitation";
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

type Row = PpkRecordRow<LabPlanItem>;
type ObjectKey = LabPlanItem["object"];

const OBJECTS: ObjectKey[] = ["product", "swabs", "water", "air", "other"];
/** Предел периодичности — тот же, что в схеме записи. */
const MONTHS_MIN = 1;
const MONTHS_MAX = 24;

/**
 * План лабораторных исследований: объект, что исследуем, показатели, периодичность
 * «раз в N мес.» и следующая дата, которую система считает сама из последнего
 * исследования. Просрочка и «скоро» подсвечиваются. Записи приходят с сервера
 * (`initial`), изменения идут через `usePpkRecords`.
 */
export function LabClient({ initial, header }: { initial: Row[]; header: ReactNode }) {
  const t = useTranslations("productionControl.lab");
  const locale = useLocale();
  const { records, create, update, remove } = usePpkRecords<LabPlanItem>("lab-plan", initial);

  /** `null` — окно закрыто; `{ row: null }` — создание; иначе — правка строки. */
  const [dialog, setDialog] = useState<{ row: Row | null } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Row | null>(null);
  const [marking, setMarking] = useState<Row | null>(null);
  const [filling, setFilling] = useState(false);
  const today = todayKey();

  const openCreate = () => setDialog({ row: null });

  /** Типовой план для общепита: продукция, смывы с оборудования и рук, питьевая вода. */
  const fillTypical = async () => {
    setFilling(true);
    const typical: LabPlanItem[] = [
      { object: "product", subject: t("typical.ready.subject"), indicator: t("typical.ready.indicator"), everyMonths: 3, laboratory: "", lastDate: null },
      { object: "swabs", subject: t("typical.equipment.subject"), indicator: t("typical.equipment.indicator"), everyMonths: 3, laboratory: "", lastDate: null },
      { object: "swabs", subject: t("typical.hands.subject"), indicator: t("typical.hands.indicator"), everyMonths: 3, laboratory: "", lastDate: null },
      { object: "water", subject: t("typical.water.subject"), indicator: t("typical.water.indicator"), everyMonths: 6, laboratory: "", lastDate: null },
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

  /** Следующая дата: считается из последнего исследования; подсветка — по сроку. */
  const nextOf = (item: LabPlanItem) => labNextDate(item);
  const dueOf = (item: LabPlanItem) => dueState(nextOf(item), today);

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
                    <th className="px-4 py-3 font-medium">{t("object")}</th>
                    <th className="px-4 py-3 font-medium">{t("subject")}</th>
                    <th className="px-4 py-3 font-medium">{t("indicator")}</th>
                    <th className="px-4 py-3 font-medium">{t("everyMonthsLabel")}</th>
                    <th className="px-4 py-3 font-medium">{t("laboratory")}</th>
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
                        <PlanPill>{t(`objects.${row.data.object}`)}</PlanPill>
                      </td>
                      <td className="px-4 py-3 font-medium text-[#0b1024]">{row.data.subject}</td>
                      <td className="px-4 py-3">{row.data.indicator || "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{t("everyMonths", { count: String(row.data.everyMonths) })}</td>
                      <td className="px-4 py-3">{row.data.laboratory || "—"}</td>
                      <td className="px-4 py-3 tabular-nums">{formatPlanDate(row.data.lastDate, locale)}</td>
                      <td className="px-4 py-3">
                        <DueDate
                          value={nextOf(row.data)}
                          state={dueOf(row.data)}
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
                    <PlanPill>{t(`objects.${row.data.object}`)}</PlanPill>
                    <span className="min-w-0 font-semibold text-[#0b1024] [overflow-wrap:anywhere]">{row.data.subject}</span>
                  </div>
                  <dl className="grid gap-1.5 text-[13px]">
                    <div className="flex gap-2">
                      <dt className="w-[130px] shrink-0 text-[#9b9fb3]">{t("indicator")}</dt>
                      <dd className="min-w-0 text-[#3c4053]">{row.data.indicator || "—"}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-[130px] shrink-0 text-[#9b9fb3]">{t("everyMonthsLabel")}</dt>
                      <dd className="min-w-0 text-[#3c4053]">{t("everyMonths", { count: String(row.data.everyMonths) })}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-[130px] shrink-0 text-[#9b9fb3]">{t("laboratory")}</dt>
                      <dd className="min-w-0 text-[#3c4053]">{row.data.laboratory || "—"}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-[130px] shrink-0 text-[#9b9fb3]">{t("lastDate")}</dt>
                      <dd className="min-w-0 text-[#3c4053]">{formatPlanDate(row.data.lastDate, locale)}</dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-[130px] shrink-0 text-[#9b9fb3]">{t("nextDate")}</dt>
                      <dd className="min-w-0">
                        <DueDate
                          value={nextOf(row.data)}
                          state={dueOf(row.data)}
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
        <LabDialog
          key={dialog.row?.id ?? "new"}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onSave={(data) => (dialog.row ? update(dialog.row.id, data) : create(data))}
        />
      ) : null}

      {marking ? (
        <MarkDoneDialog
          key={marking.id}
          computeNext={(date) => labNextDate({ lastDate: date, everyMonths: marking.data.everyMonths })}
          editableNext={false}
          fileKind="protocol"
          folder="lab-protocols"
          onClose={() => setMarking(null)}
          onSubmit={(date) => update(marking.id, { ...marking.data, lastDate: date })}
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

/** Окно исследования: объект, что исследуем, показатели, периодичность в месяцах, лаборатория, дата. */
function LabDialog({
  row,
  onClose,
  onSave,
}: {
  row: Row | null;
  onClose: () => void;
  onSave: (data: LabPlanItem) => Promise<boolean>;
}) {
  const t = useTranslations("productionControl.lab");
  const [form, setForm] = useState({
    object: (row?.data.object ?? "product") as ObjectKey,
    subject: row?.data.subject ?? "",
    indicator: row?.data.indicator ?? "",
    everyMonths: String(row?.data.everyMonths ?? 3),
    laboratory: row?.data.laboratory ?? "",
    lastDate: row?.data.lastDate ?? "",
  });
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const months = Number(form.everyMonths);
  const monthsValid = Number.isInteger(months) && months >= MONTHS_MIN && months <= MONTHS_MAX;
  const canSave = form.subject.trim().length > 0 && monthsValid && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    const saved = await onSave({
      object: form.object,
      subject: form.subject.trim(),
      indicator: form.indicator.trim(),
      everyMonths: months,
      laboratory: form.laboratory.trim(),
      lastDate: form.lastDate || null,
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
            <span className={PPK_LABEL_CLASS}>{t("object")}</span>
            <div role="group" aria-label={t("object")} className="flex flex-wrap gap-2">
              {OBJECTS.map((object) => (
                <button
                  key={object}
                  type="button"
                  aria-pressed={form.object === object}
                  onClick={() => setField("object", object)}
                  className={ppkSegmentClass(form.object === object)}
                >
                  {t(`objects.${object}`)}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className={PPK_LABEL_CLASS}>{t("subject")}</span>
            <input
              value={form.subject}
              onChange={(event) => setField("subject", event.target.value)}
              autoFocus
              className={PPK_FIELD_CLASS}
            />
          </label>

          <label className="block">
            <span className={PPK_LABEL_CLASS}>{t("indicator")}</span>
            <input
              value={form.indicator}
              onChange={(event) => setField("indicator", event.target.value)}
              className={PPK_FIELD_CLASS}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={PPK_LABEL_CLASS}>{t("everyMonthsLabel")}</span>
              <input
                type="number"
                inputMode="numeric"
                min={MONTHS_MIN}
                max={MONTHS_MAX}
                value={form.everyMonths}
                aria-invalid={!monthsValid}
                onChange={(event) => setField("everyMonths", event.target.value)}
                className={PPK_FIELD_CLASS}
              />
            </label>
            <label className="block">
              <span className={PPK_LABEL_CLASS}>{t("laboratory")}</span>
              <input
                value={form.laboratory}
                onChange={(event) => setField("laboratory", event.target.value)}
                className={PPK_FIELD_CLASS}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className={PPK_LABEL_CLASS}>{t("lastDate")}</span>
              <input
                type="date"
                value={form.lastDate}
                onChange={(event) => setField("lastDate", event.target.value)}
                className={PPK_FIELD_CLASS}
              />
            </label>
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
