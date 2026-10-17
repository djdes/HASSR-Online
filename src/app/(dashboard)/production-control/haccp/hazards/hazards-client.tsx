"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import {
  PPK_SIGNIFICANCE_THRESHOLD,
  hazardRisk,
  isSignificantHazard,
  type HazardType,
} from "@/lib/ppk/haccp";
import { TYPICAL_HAZARDS, TYPICAL_STEPS } from "@/lib/ppk/haccp-presets";
import type { HazardData } from "@/lib/ppk/records";
import { usePpkRecords, type PpkRecordRow } from "@/components/production-control/use-ppk-records";
import {
  PPK_BUTTON_OUTLINE_CLASS,
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_BUTTON_TEXT_CLASS,
  PPK_BUTTON_TEXT_DANGER_CLASS,
  PPK_FIELD_CLASS,
  PPK_LABEL_CLASS,
  PPK_TEXTAREA_CLASS,
  PpkBlockActionProvider,
  PpkEmptyState,
} from "@/components/production-control/ppk-ui";

type Row = PpkRecordRow<HazardData>;
type Level = 1 | 2 | 3 | 4;

const HAZARD_TYPES: HazardType[] = ["bio", "chem", "phys", "allergen"];
const LEVELS: Level[] = [1, 2, 3, 4];

/** Значимые сверху, потом по убыванию риска; при равном риске — порядок записей. */
function sortByRisk(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const riskA = hazardRisk(a.data.probability, a.data.severity);
    const riskB = hazardRisk(b.data.probability, b.data.severity);
    const sigA = riskA >= PPK_SIGNIFICANCE_THRESHOLD;
    const sigB = riskB >= PPK_SIGNIFICANCE_THRESHOLD;
    if (sigA !== sigB) return sigA ? -1 : 1;
    return riskB - riskA;
  });
}

/**
 * Анализ опасностей (ХАССП, шаг 5): таблица на десктопе и карточки на телефоне,
 * матрица 4×4 рядом (на телефоне — над списком), окно правки опасности.
 */
export function HazardsClient({ initial, header }: { initial: Row[]; header: ReactNode }) {
  const t = useTranslations("productionControl.hazards");
  const { records, create, update, remove } = usePpkRecords<HazardData>("hazards", initial);

  /** `null` — окно закрыто; `{ row: null }` — создание; иначе — правка строки. */
  const [dialog, setDialog] = useState<{ row: Row | null } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Row | null>(null);
  const [filling, setFilling] = useState(false);

  const sorted = useMemo(() => sortByRisk(records), [records]);

  const openCreate = () => setDialog({ row: null });

  /** Типовые опасности создаются по одной: каждая — отдельная запись с идемпотентным ответом API. */
  const fillTypical = async () => {
    if (filling) return;
    setFilling(true);
    let added = 0;
    for (const hazard of TYPICAL_HAZARDS) {
      if (await create(hazard)) added += 1;
    }
    setFilling(false);
    if (added > 0) toast.success(t("filled", { count: String(added) }));
  };

  return (
    <PpkBlockActionProvider openCreate={openCreate}>
      {header}

      {records.length === 0 ? (
        <PpkEmptyState title={t("emptyTitle")} hint={t("emptyHint")}>
          <button type="button" onClick={openCreate} className={PPK_BUTTON_PRIMARY_CLASS}>
            <Plus className="size-4" />
            {t("add")}
          </button>
          <button
            type="button"
            onClick={fillTypical}
            disabled={filling}
            className={PPK_BUTTON_OUTLINE_CLASS}
          >
            <Sparkles className="size-4 text-[#5566f6]" />
            {t("fillTypical")}
          </button>
        </PpkEmptyState>
      ) : (
        <div className="space-y-6">
          {/* Матрица риска над таблицей: таблица занимает всю ширину. */}
          <HazardMatrix rows={records} />

          <div className="min-w-0">
            <div className="hidden overflow-x-auto rounded-3xl border border-[#ececf4] bg-white md:block">
              <table className="w-full min-w-[720px] border-collapse text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-[#ececf4] text-[12px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]">
                    <th className="px-4 py-3 font-semibold">{t("step")}</th>
                    <th className="px-4 py-3 font-semibold">{t("hazard")}</th>
                    <th className="px-4 py-3 font-semibold">{t("type")}</th>
                    <th className="px-4 py-3 font-semibold">{t("risk")}</th>
                    <th className="px-4 py-3 font-semibold">{t("measures")}</th>
                    <th className="w-px px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => (
                    <tr key={row.id} className="border-b border-[#ececf4] align-top last:border-0 hover:bg-[#fafbff]">
                      <td className="px-4 py-3 text-[#3c4053]">{row.data.step}</td>
                      <td className="min-w-[180px] px-4 py-3 font-medium text-[#0b1024]">{row.data.hazard}</td>
                      <td className="px-4 py-3 text-[#3c4053]">{t(`types.${row.data.type}`)}</td>
                      <td className="px-4 py-3">
                        <RiskCell row={row} />
                      </td>
                      <td className="min-w-[160px] px-4 py-3 text-[#3c4053]">{row.data.measures || "—"}</td>
                      <td className="w-px whitespace-nowrap px-4 py-3">
                        <RowActions stacked onEdit={() => setDialog({ row })} onRemove={() => setPendingRemove(row)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="grid gap-3 md:hidden">
              {sorted.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12.5px] text-[#6f7282]">{row.data.step}</span>
                    <RiskCell row={row} />
                  </div>
                  <div className="font-semibold text-[#0b1024]">{row.data.hazard}</div>
                  <div className="text-[13px] text-[#3c4053]">
                    <span className="text-[#9b9fb3]">{t("type")}: </span>
                    {t(`types.${row.data.type}`)}
                  </div>
                  {row.data.measures ? (
                    <div className="text-[13px] leading-[1.55] text-[#3c4053]">
                      <span className="text-[#9b9fb3]">{t("measures")}: </span>
                      {row.data.measures}
                    </div>
                  ) : null}
                  <div className="border-t border-[#ececf4] pt-3">
                    <RowActions onEdit={() => setDialog({ row })} onRemove={() => setPendingRemove(row)} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {dialog ? (
        <HazardDialog
          key={dialog.row?.id ?? "new"}
          row={dialog.row}
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
        title={t("removeTitle")}
        description={t("removeBody")}
        variant="danger"
        confirmLabel={t("remove")}
        cancelLabel={t("cancel")}
      />
    </PpkBlockActionProvider>
  );
}

/** Пилюля риска «p × s = r»; значимая — красная, с подписью и ссылкой на ККТ. */
function RiskCell({ row }: { row: Row }) {
  const t = useTranslations("productionControl.hazards");
  const { probability, severity } = row.data;
  const risk = hazardRisk(probability, severity);
  const significant = isSignificantHazard(probability, severity);
  return (
    <div className="flex flex-col items-start gap-1">
      <span
        className={cn(
          "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[12.5px] font-medium tabular-nums",
          significant ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#eef1ff] text-[#3848c7]",
        )}
      >
        {`${probability} × ${severity} = ${risk}`}
      </span>
      {significant ? (
        <span className="whitespace-nowrap px-1 text-[11.5px] font-medium leading-none text-[#a13a32]">{t("significant")}</span>
      ) : null}
      {significant ? (
        <Link
          href={`/production-control/haccp/control-points?hazard=${row.id}`}
          className="inline-flex items-center gap-1 rounded-xl px-2 py-0.5 text-[12.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          {t("toCcp")} ›
        </Link>
      ) : null}
    </div>
  );
}

function RowActions({
  onEdit,
  onRemove,
  stacked = false,
}: {
  onEdit: () => void;
  onRemove: () => void;
  /** В таблице кнопки друг под другом: колонка узкая и не сжимается. */
  stacked?: boolean;
}) {
  const t = useTranslations("productionControl.hazards");
  return (
    <div className={cn("flex shrink-0 gap-1 whitespace-nowrap", stacked ? "flex-col items-start" : "items-center")}>
      <button type="button" onClick={onEdit} className={PPK_BUTTON_TEXT_CLASS}>
        <Pencil className="size-4" />
        {t("edit")}
      </button>
      <button type="button" onClick={onRemove} className={PPK_BUTTON_TEXT_DANGER_CLASS}>
        <Trash2 className="size-4" />
        {t("remove")}
      </button>
    </div>
  );
}

/**
 * Матрица 4×4: строки — вероятность (4 сверху вниз до 1), столбцы — тяжесть
 * (1 слева направо до 4). Значимая зона окрашена, в клетке — число опасностей.
 */
function HazardMatrix({ rows }: { rows: Row[] }) {
  const t = useTranslations("productionControl.hazards");
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.data.probability}-${row.data.severity}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  return (
    <div className="flex w-fit max-w-full flex-wrap items-center gap-x-6 gap-y-3 rounded-3xl border border-[#ececf4] bg-white px-5 py-3 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="text-[13px] font-semibold text-[#0b1024]">{t("matrix")}</div>
      <div
        role="table"
        aria-label={t("matrix")}
        className="inline-grid grid-cols-[auto_repeat(4,2rem)] gap-1"
      >
        {[4, 3, 2, 1].map((probability) => (
          <div key={`row-${probability}`} role="row" className="contents">
            <div role="columnheader" className="flex items-center pr-1 text-[11px] text-[#9b9fb3]">
              {probability}
            </div>
            {LEVELS.map((severity) => {
              const count = counts.get(`${probability}-${severity}`) ?? 0;
              const significant = hazardRisk(probability, severity) >= PPK_SIGNIFICANCE_THRESHOLD;
              return (
                <div
                  key={`${probability}-${severity}`}
                  role="cell"
                  title={`${t("probability")} ${probability}, ${t("severity")} ${severity}`}
                  className={cn(
                    "grid size-8 place-items-center rounded-lg text-[12px] font-semibold tabular-nums",
                    significant ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#eef1ff] text-[#3848c7]",
                  )}
                >
                  {count > 0 ? count : ""}
                </div>
              );
            })}
          </div>
        ))}
        <div />
        {LEVELS.map((severity) => (
          <div key={`col-${severity}`} className="pt-1 text-center text-[11px] text-[#9b9fb3]">
            {severity}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-0.5 text-[11px] text-[#9b9fb3]">
        <span>{`${t("probability")} ↓`}</span>
        <span>{`${t("severity")} →`}</span>
      </div>
    </div>
  );
}

/** Окно опасности: этап с подсказками, вид, вероятность и тяжесть сегментами, живой риск. */
function HazardDialog({
  row,
  onClose,
  onSave,
}: {
  row: Row | null;
  onClose: () => void;
  onSave: (data: HazardData) => Promise<boolean>;
}) {
  const t = useTranslations("productionControl.hazards");
  const [form, setForm] = useState<HazardData>(() =>
    row
      ? { ...row.data }
      : { step: "", hazard: "", type: "bio", probability: 2, severity: 2, measures: "" },
  );
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof HazardData>(key: K, value: HazardData[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const canSave = form.step.trim().length > 0 && form.hazard.trim().length > 0 && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    const saved = await onSave({
      ...form,
      step: form.step.trim(),
      hazard: form.hazard.trim(),
      measures: form.measures.trim(),
    });
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-[640px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 gap-0 border-b border-[#ececf4] px-6 py-4 pr-14 text-left">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
            {row ? t("edit") : t("add")}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <label className="block">
            <span className={PPK_LABEL_CLASS}>{t("step")}</span>
            <input
              value={form.step}
              onChange={(event) => setField("step", event.target.value)}
              list="ppk-hazard-steps"
              autoFocus
              className={PPK_FIELD_CLASS}
            />
            <datalist id="ppk-hazard-steps">
              {TYPICAL_STEPS.map((step) => (
                <option key={step} value={step} />
              ))}
            </datalist>
          </label>

          <label className="block">
            <span className={PPK_LABEL_CLASS}>{t("hazard")}</span>
            <textarea
              value={form.hazard}
              onChange={(event) => setField("hazard", event.target.value)}
              rows={2}
              className={PPK_TEXTAREA_CLASS}
            />
          </label>

          <fieldset>
            <legend className={PPK_LABEL_CLASS}>{t("type")}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {HAZARD_TYPES.map((type) => (
                <Segment key={type} active={form.type === type} onClick={() => setField("type", type)}>
                  {t(`types.${type}`)}
                </Segment>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={PPK_LABEL_CLASS}>{t("probability")}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {LEVELS.map((level) => (
                <Segment
                  key={level}
                  active={form.probability === level}
                  onClick={() => setField("probability", level)}
                >
                  <span className="block font-semibold tabular-nums">{level}</span>
                  <span className="block text-[12px] opacity-80">{t(`probabilityLevels.${level}`)}</span>
                </Segment>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={PPK_LABEL_CLASS}>{t("severity")}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {LEVELS.map((level) => (
                <Segment
                  key={level}
                  active={form.severity === level}
                  onClick={() => setField("severity", level)}
                >
                  <span className="block font-semibold tabular-nums">{level}</span>
                  <span className="block text-[12px] opacity-80">{t(`severityLevels.${level}`)}</span>
                </Segment>
              ))}
            </div>
          </fieldset>

          <LiveRisk probability={form.probability} severity={form.severity} />

          <label className="block">
            <span className={PPK_LABEL_CLASS}>{t("measures")}</span>
            <textarea
              value={form.measures}
              onChange={(event) => setField("measures", event.target.value)}
              rows={3}
              className={PPK_TEXTAREA_CLASS}
            />
          </label>
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

/** Сегмент выбора: активный — залит индиго, остальные — рамка с подсветкой при наведении. */
function Segment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-2xl border px-3 py-2 text-left text-[13.5px] leading-snug transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
        active
          ? "border-[#5566f6] bg-[#5566f6] text-white"
          : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
      )}
    >
      {children}
    </button>
  );
}

/** Живая пилюля риска под полями: меняется при каждом выборе. */
function LiveRisk({ probability, severity }: { probability: Level; severity: Level }) {
  const t = useTranslations("productionControl.hazards");
  const risk = hazardRisk(probability, severity);
  const significant = isSignificantHazard(probability, severity);
  return (
    <div className="flex items-center gap-2 text-[13px] text-[#6f7282]">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 font-medium tabular-nums transition-colors duration-150",
          significant ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#eef1ff] text-[#3848c7]",
        )}
      >
        {`${probability} × ${severity} = ${risk}`}
        {significant ? <span className="font-normal">· {t("significant")}</span> : null}
      </span>
    </div>
  );
}
