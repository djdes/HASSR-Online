"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { disinfectantQuantity, disinfectantQuantityTotal } from "@/lib/disinfectant-document-presentation";
import { CalendarDays, Plus, X } from "lucide-react";
import {
  DOC_PRIMARY_BUTTON_CLASS,
  JOURNAL_TABLE_SCROLL_CLASS,
} from "@/components/journals/journal-responsive";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { useTodayKey } from "@/lib/use-today-key";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getDistinctRoleLabels,
  getRowEmployeeTitle,
  getUsersForRoleLabel,
} from "@/lib/user-roles";
import { buildStaffOptionLabel } from "@/lib/journal-staff-binding";
import { usePositionEmployeeCascade } from "@/components/shared/position-select";
import {
  normalizeDisinfectantConfig,
  computeNeedPerTreatment,
  computeNeedPerMonth,
  computeNeedPerYear,
  resolveSolutionPerTreatment,
  formatNumber,
  createEmptySubdivision,
  createEmptyReceipt,
  createEmptyConsumption,
  type DisinfectantDocumentConfig,
  type SubdivisionRow,
  type ReceiptRow,
  type ConsumptionRow,
  type MeasureUnit,
} from "@/lib/disinfectant-document";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  GRID_CELL_CLASS,
  GRID_HEAD_CELL_CLASS,
} from "@/components/journals/journal-grid";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { localDayKey } from "@/lib/entry-defaults";

/**
 * Screen ↔ print duality (см. `cleaning-document-client.tsx`).
 * На экране — скруглённый viewport дизайн-системы; в печати wrapper
 * становится прозрачным, а рамки таблиц — чёрными («бумага» для РПН).
 */

// Должность из карточки (как в UserLike) — её пишем в строки.
type UserItem = {
  id: string;
  name: string;
  role: string;
  positionTitle?: string | null;
  jobPosition?: { name: string; categoryKey: string } | null;
};

type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  status: string;
  users: UserItem[];
  config: unknown;
  /** Design v2 toggle. */
  useV2?: boolean;
};

function roleOptionsFromUsers(users: UserItem[]) {
  return getDistinctRoleLabels(users);
}

function usersForRole(users: UserItem[], roleLabel: string) {
  return getUsersForRoleLabel(users, roleLabel);
}

function toIsoDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    return localDayKey();
  return date.toISOString().slice(0, 10);
}

function formatDateRu(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

// ---------- Subdivision Add Dialog ----------
/**
 * Подсказка под «Кол-во раб. р-ра»: объясняет, откуда берётся значение,
 * когда поле пустое, а площадь и расход на кв.м заданы.
 */
function SolutionPerTreatmentHint({ row }: { row: SubdivisionRow }) {
  const t = useTranslations();
  const derived = resolveSolutionPerTreatment(row);
  if (row.solutionPerTreatment > 0 || derived <= 0) return null;
  return (
    <p className="text-[12px] leading-[1.45] text-[#6f7282]">
      {t("journalDisinfectant.areaCalculationHint", { area: `${row.area}`, rate: `${row.solutionConsumptionPerSqm}`, derived: formatNumber(derived) })}</p>
  );
}

function AddSubdivisionDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (row: SubdivisionRow) => Promise<void>;
}) {
  const t = useTranslations();
  const [row, setRow] = useState(createEmptySubdivision);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setRow(createEmptySubdivision());
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(v) => {
        if (v) reset();
        props.onOpenChange(v);
      }}
    >
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[660px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              {t("journalDisinfectant.addRow")}</DialogTitle>
            <button
              type="button"
              aria-label={t("common.close")}
              className="rounded-xl p-2"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-4 px-8 py-6">
          <div className="space-y-2">
            <Label className="text-[16px] text-[#73738a]">
              {t("journalDisinfectant.subdivisionName")}</Label>
            <textarea
              value={row.name}
              onChange={(e) => setRow({ ...row, name: e.target.value })}
              placeholder={t("journalDisinfectant.subdivisionName")}
              className="min-h-[100px] w-full rounded-2xl border border-[#d8dae6] px-4 py-3 text-[18px] outline-none focus:border-[#5566f6]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[16px] text-[#73738a]">
              {t("journalDisinfectant.areaSqm")}</Label>
            <Input aria-label={t("journalDisinfectant.areaSqm")}
              type="number"
              inputMode="decimal"
              value={row.byCapacity ? "" : row.area ?? ""}
              onChange={(e) =>
                setRow({
                  ...row,
                  area: e.target.value ? Number(e.target.value) : null,
                })
              }
              disabled={row.byCapacity}
              placeholder={t("journalDisinfectant.areaPlaceholder")}
              className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch aria-label={t("journalDisinfectant.byCapacity")}
              checked={row.byCapacity}
              onCheckedChange={(c) =>
                setRow({ ...row, byCapacity: c, area: c ? null : row.area })
              }
            />
            <span className="text-[16px]">{t("journalDisinfectant.byCapacity")}</span>
          </div>
          <div className="space-y-2">
            <Label className="text-[16px] text-[#73738a]">{t("sanitationPestPdf.treatmentType")}</Label>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-[16px]">
                <input
                  type="radio"
                  name="treatmentType"
                  checked={row.treatmentType === "current"}
                  onChange={() =>
                    setRow({ ...row, treatmentType: "current" })
                  }
                  className="size-5 accent-[#5566f6]"
                />
                {t("sanitationPestPdf.current")}</label>
              <label className="flex items-center gap-2 text-[16px]">
                <input
                  type="radio"
                  name="treatmentType"
                  checked={row.treatmentType === "general"}
                  onChange={() =>
                    setRow({ ...row, treatmentType: "general" })
                  }
                  className="size-5 accent-[#5566f6]"
                />
                {t("sanitationPestPdf.general")}</label>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-[16px] text-[#73738a]">
              {t("journalDisinfectant.frequencyMonth")}</Label>
            <Input aria-label={t("journalDisinfectant.frequencyMonth")}
              type="number"
              inputMode="decimal"
              value={row.frequencyPerMonth || ""}
              onChange={(e) =>
                setRow({
                  ...row,
                  frequencyPerMonth: Number(e.target.value) || 0,
                })
              }
              placeholder={t("journalDisinfectant.frequencyPlaceholder")}
              className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
            />
          </div>
          {/* Средство и концентрация — здесь же: без них у только что
              добавленной строки потребность всегда была 0, пока её не
              откроют на правку. Поля те же, что в окне редактирования. */}
          <h3 className="pt-2 text-[18px] font-semibold">
            {t("journalDisinfectant.disinfectant")}</h3>
          <div className="space-y-2">
            <Label className="text-[16px] text-[#73738a]">{t("sanitationPestPdf.name")}</Label>
            <Input aria-label={t("sanitationPestPdf.name")}
              value={row.disinfectantName}
              onChange={(e) =>
                setRow({ ...row, disinfectantName: e.target.value })
              }
              placeholder={t("journalDisinfectant.disinfectantPlaceholder")}
              className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[16px] text-[#73738a]">
              {t("journalDisinfectant.concentrationPercent")}</Label>
            <Input aria-label={t("journalDisinfectant.concentrationPercent")}
              type="number"
              inputMode="decimal"
              step="0.01"
              value={row.concentration || ""}
              onChange={(e) =>
                setRow({ ...row, concentration: Number(e.target.value) || 0 })
              }
              placeholder={t("journalDisinfectant.concentrationPlaceholder")}
              className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[16px] text-[#73738a]">
              {t("journalDisinfectant.solutionSqm")}</Label>
            <Input aria-label={t("journalDisinfectant.solutionSqm")}
              type="number"
              inputMode="decimal"
              step="0.01"
              value={row.solutionConsumptionPerSqm || ""}
              onChange={(e) =>
                setRow({
                  ...row,
                  solutionConsumptionPerSqm: Number(e.target.value) || 0,
                })
              }
              className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[16px] text-[#73738a]">
              {t("journalDisinfectant.solutionTreatmentShort")}</Label>
            <Input aria-label={t("journalDisinfectant.solutionTreatmentShort")}
              type="number"
              inputMode="decimal"
              step="0.01"
              value={row.solutionPerTreatment || ""}
              onChange={(e) =>
                setRow({
                  ...row,
                  solutionPerTreatment: Number(e.target.value) || 0,
                })
              }
              className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
            />
            <SolutionPerTreatmentHint row={row} />
          </div>
          <div className="space-y-1">
            <Label className="text-[14px] text-[#73738a]">
              {t("journalDisinfectant.needTreatmentKgL")}</Label>
            <div className="h-9 rounded-xl border border-[#d8dae6] bg-[#f1f2f8] px-3.5 py-2 text-[13.5px]">
              {formatNumber(computeNeedPerTreatment(row)) || "—"}
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              disabled={submitting || !row.name.trim()}
              onClick={async () => {
                setSubmitting(true);
                try {
                  await props.onSubmit(row);
                  props.onOpenChange(false);
                } finally {
                  setSubmitting(false);
                }
              }}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4a5bf0]"
            >
              {submitting ? t("journalDisinfectant.creating") : t("journalDisinfectant.create")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Subdivision Edit Dialog ----------
function EditSubdivisionDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: SubdivisionRow | null;
  onSubmit: (row: SubdivisionRow) => Promise<void>;
  /** «(k из N)» при правке выделенных строк по очереди. */
  titleSuffix?: string;
}) {
  const t = useTranslations();
  const [row, setRow] = useState<SubdivisionRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const active = row || props.initial;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(v) => {
        if (v) setRow(props.initial);
        props.onOpenChange(v);
      }}
    >
      <DialogContent showCloseButton={false} className="max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[28px] border-0 p-0 sm:max-w-[660px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              {t("journalDisinfectant.editRow", { suffix: `${props.titleSuffix ? ` ${props.titleSuffix}` : ""}` })}
            </DialogTitle>
            <button
              type="button"
              aria-label={t("common.close")}
              className="rounded-xl p-2"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        {active && (
          <div className="space-y-4 px-8 py-6">
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("journalDisinfectant.subdivisionName")}</Label>
              <textarea
                value={active.name}
                onChange={(e) =>
                  setRow({ ...active, name: e.target.value })
                }
                className="min-h-[80px] w-full rounded-2xl border border-[#d8dae6] px-4 py-3 text-[18px] outline-none focus:border-[#5566f6]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("journalDisinfectant.areaSqm")}</Label>
              <Input aria-label={t("journalDisinfectant.areaSqm")}
                type="number"
                inputMode="decimal"
                value={active.byCapacity ? "" : active.area ?? ""}
                onChange={(e) =>
                  setRow({
                    ...active,
                    area: e.target.value ? Number(e.target.value) : null,
                  })
                }
                disabled={active.byCapacity}
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch aria-label={t("journalDisinfectant.byCapacity")}
                checked={active.byCapacity}
                onCheckedChange={(c) =>
                  setRow({
                    ...active,
                    byCapacity: c,
                    area: c ? null : active.area,
                  })
                }
              />
              <span className="text-[16px]">{t("journalDisinfectant.byCapacity")}</span>
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("sanitationPestPdf.treatmentType")}</Label>
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-[16px]">
                  <input
                    type="radio"
                    name="editTreatmentType"
                    checked={active.treatmentType === "current"}
                    onChange={() =>
                      setRow({ ...active, treatmentType: "current" })
                    }
                    className="size-5 accent-[#5566f6]"
                  />
                  {t("sanitationPestPdf.current")}</label>
                <label className="flex items-center gap-2 text-[16px]">
                  <input
                    type="radio"
                    name="editTreatmentType"
                    checked={active.treatmentType === "general"}
                    onChange={() =>
                      setRow({ ...active, treatmentType: "general" })
                    }
                    className="size-5 accent-[#5566f6]"
                  />
                  {t("sanitationPestPdf.general")}</label>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("journalDisinfectant.frequencyMonth")}</Label>
              <Input aria-label={t("journalDisinfectant.frequencyMonth")}
                type="number"
                inputMode="decimal"
                value={active.frequencyPerMonth || ""}
                onChange={(e) =>
                  setRow({
                    ...active,
                    frequencyPerMonth: Number(e.target.value) || 0,
                  })
                }
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
              />
            </div>
            <h3 className="pt-2 text-[18px] font-semibold">
              {t("journalDisinfectant.disinfectant")}</h3>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("sanitationPestPdf.name")}</Label>
              <Input aria-label={t("sanitationPestPdf.name")}
                value={active.disinfectantName}
                onChange={(e) =>
                  setRow({ ...active, disinfectantName: e.target.value })
                }
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("journalDisinfectant.concentrationPercent")}</Label>
              <Input aria-label={t("journalDisinfectant.concentrationPercent")}
                type="number"
                inputMode="decimal"
                step="0.01"
                value={active.concentration || ""}
                onChange={(e) =>
                  setRow({
                    ...active,
                    concentration: Number(e.target.value) || 0,
                  })
                }
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("journalDisinfectant.solutionSqm")}</Label>
              <Input aria-label={t("journalDisinfectant.solutionSqm")}
                type="number"
                inputMode="decimal"
                step="0.01"
                value={active.solutionConsumptionPerSqm || ""}
                onChange={(e) =>
                  setRow({
                    ...active,
                    solutionConsumptionPerSqm: Number(e.target.value) || 0,
                  })
                }
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("journalDisinfectant.solutionTreatmentShort")}</Label>
              <Input aria-label={t("journalDisinfectant.solutionTreatmentShort")}
                type="number"
                inputMode="decimal"
                step="0.01"
                value={active.solutionPerTreatment || ""}
                onChange={(e) =>
                  setRow({
                    ...active,
                    solutionPerTreatment: Number(e.target.value) || 0,
                  })
                }
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
              />
              <SolutionPerTreatmentHint row={active} />
            </div>
            <h3 className="pt-2 text-[18px] font-semibold">
              {t("journalDisinfectant.needDisinfectant")}</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-[14px] text-[#73738a]">
                  {t("journalDisinfectant.perTreatmentKgL")}</Label>
                <div className="h-9 rounded-xl border border-[#d8dae6] bg-[#f1f2f8] px-3.5 py-4 text-[13.5px]">
                  {formatNumber(computeNeedPerTreatment(active))}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[14px] text-[#73738a]">
                  {t("journalDisinfectant.perMonthKgL")}</Label>
                <div className="h-9 rounded-xl border border-[#d8dae6] bg-[#f1f2f8] px-3.5 py-4 text-[13.5px]">
                  {formatNumber(computeNeedPerMonth(active))}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[14px] text-[#73738a]">
                  {t("journalDisinfectant.perYearKgL")}</Label>
                <div className="h-9 rounded-xl border border-[#d8dae6] bg-[#f1f2f8] px-3.5 py-4 text-[13.5px]">
                  {formatNumber(computeNeedPerYear(active))}
                </div>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button
                type="button"
                disabled={submitting}
                onClick={async () => {
                  if (!active) return;
                  setSubmitting(true);
                  try {
                    await props.onSubmit(active);
                    props.onOpenChange(false);
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4a5bf0]"
              >
                {submitting ? t("journalDisinfectant.saving") : t("common.save")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Receipt Add/Edit Dialog ----------
function ReceiptDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  users: UserItem[];
  initial: ReceiptRow | null;
  onSubmit: (row: ReceiptRow) => Promise<void>;
  dialogTitle: string;
}) {
  const t = useTranslations();
  const [row, setRow] = useState<ReceiptRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const roles = useMemo(() => roleOptionsFromUsers(props.users), [props.users]);
  const active = row || props.initial;
  const cascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: active?.responsibleRole ?? "",
    userId: active?.responsibleEmployeeId ?? "",
    onChange: (next) => {
      if (!active) return;
      const user = props.users.find((item) => item.id === next.userId);
      setRow({
        ...active,
        responsibleRole: next.positionTitle,
        responsibleEmployeeId: next.userId || null,
        responsibleEmployee: user
          ? user.name
          : next.positionTitle !== active.responsibleRole
            ? active.responsibleEmployee
            : "",
      });
    },
    resolveCandidates: (roleLabel) => usersForRole(props.users, roleLabel),
    autoPick: "first",
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={(v) => {
        if (v) setRow(props.initial);
        props.onOpenChange(v);
      }}
    >
      <DialogContent showCloseButton={false} className="max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[28px] border-0 p-0 sm:max-w-[660px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              {props.dialogTitle}
            </DialogTitle>
            <button
              type="button"
              aria-label={t("common.close")}
              className="rounded-xl p-2"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        {active && (
          <div className="space-y-4 px-8 py-6">
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("sanitationPestPdf.receiptDate")}</Label>
              <div className="relative">
                <Input aria-label={t("sanitationPestPdf.receiptDate")}
                  type="date"
                  value={active.date}
                  onChange={(e) =>
                    setRow({ ...active, date: toIsoDate(e.target.value) })
                  }
                  className="h-9 rounded-xl border-[#d8dae6] px-3.5 pr-14 text-[13.5px]"
                />
                <CalendarDays className="pointer-events-none absolute right-4 top-1/2 size-6 -translate-y-1/2 text-[#6e7080]" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("sanitationPestPdf.disinfectantName")}</Label>
              <Input aria-label={t("sanitationPestPdf.disinfectantName")}
                value={active.disinfectantName}
                onChange={(e) =>
                  setRow({ ...active, disinfectantName: e.target.value })
                }
                placeholder={t("journalDisinfectant.disinfectantPlaceholder")}
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("journalDisinfectant.receiptQuantity")}</Label>
              <Input aria-label={t("journalDisinfectant.receiptQuantity")}
                type="number"
                inputMode="decimal"
                value={active.quantity || ""}
                onChange={(e) =>
                  setRow({
                    ...active,
                    quantity: Number(e.target.value) || 0,
                  })
                }
                placeholder={t("journalDisinfectant.quantityPlaceholder")}
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
              />
              <div role="radiogroup" aria-label={t("journalDisinfectant.unit")} className="flex gap-6 pt-1">
                {(["kg", "l", "bottle"] as MeasureUnit[]).map((u) => (
                  <label
                    key={u}
                    className="flex items-center gap-2 text-[16px]"
                  >
                    <input
                      type="radio"
                      checked={active.unit === u}
                      onChange={() => setRow({ ...active, unit: u })}
                      className="size-5 accent-[#5566f6]"
                    />
                    {t(`sanitationPestPdf.${u}`)}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("journalDisinfectant.expiryUntil")}</Label>
              <div className="relative">
                <Input aria-label={t("journalDisinfectant.expiryUntil")}
                  type="date"
                  value={active.expiryDate}
                  onChange={(e) =>
                    setRow({
                      ...active,
                      expiryDate: toIsoDate(e.target.value),
                    })
                  }
                  className="h-9 rounded-xl border-[#d8dae6] px-3.5 pr-14 text-[13.5px]"
                />
                <CalendarDays className="pointer-events-none absolute right-4 top-1/2 size-6 -translate-y-1/2 text-[#6e7080]" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("journalDisinfectant.responsiblePosition")}</Label>
              <Select
                value={active.responsibleRole}
                onValueChange={cascade.handlePositionChange}
              >
                <SelectTrigger aria-label={t("journalDisinfectant.responsiblePosition")} className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">{t("journalControls.positionSelect.employeeLabel")}</Label>
              <Select
                value={active.responsibleEmployeeId || "__empty__"}
                onValueChange={cascade.handleEmployeeChange}
                open={cascade.employeeOpen}
                onOpenChange={cascade.setEmployeeOpen}
              >
                <SelectTrigger aria-label={t("journalControls.positionSelect.employeeLabel")} className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__empty__">{t("journalControls.positionSelect.chooseEmployee")}</SelectItem>
                  {cascade.candidates.map(
                    (u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {buildStaffOptionLabel(u)}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end pt-2">
              <Button
                type="button"
                disabled={submitting}
                onClick={async () => {
                  if (!active) return;
                  setSubmitting(true);
                  try {
                    // Должность выбранного человека из карточки, а не копия
                    // из документа (строка засеивается его парой).
                    await props.onSubmit({
                      ...active,
                      responsibleRole: getRowEmployeeTitle(
                        props.users.find((user) => user.id === active.responsibleEmployeeId),
                        active.responsibleRole
                      ),
                    });
                    props.onOpenChange(false);
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4a5bf0]"
              >
                {submitting ? t("journalDisinfectant.saving") : t("common.save")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Consumption Add/Edit Dialog ----------
function ConsumptionDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  users: UserItem[];
  initial: ConsumptionRow | null;
  onSubmit: (row: ConsumptionRow) => Promise<void>;
  dialogTitle: string;
}) {
  const t = useTranslations();
  const [row, setRow] = useState<ConsumptionRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const roles = useMemo(() => roleOptionsFromUsers(props.users), [props.users]);
  const active = row || props.initial;
  const cascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: active?.responsibleRole ?? "",
    userId: active?.responsibleEmployeeId ?? "",
    onChange: (next) => {
      if (!active) return;
      const user = props.users.find((item) => item.id === next.userId);
      setRow({
        ...active,
        responsibleRole: next.positionTitle,
        responsibleEmployeeId: next.userId || null,
        responsibleEmployee: user
          ? user.name
          : next.positionTitle !== active.responsibleRole
            ? active.responsibleEmployee
            : "",
      });
    },
    resolveCandidates: (roleLabel) => usersForRole(props.users, roleLabel),
    autoPick: "first",
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={(v) => {
        if (v) setRow(props.initial);
        props.onOpenChange(v);
      }}
    >
      <DialogContent showCloseButton={false} className="max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[28px] border-0 p-0 sm:max-w-[660px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              {props.dialogTitle}
            </DialogTitle>
            <button
              type="button"
              aria-label={t("common.close")}
              className="rounded-xl p-2"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        {active && (
          <div className="space-y-4 px-8 py-6">
            {/* «За период с … по …» — обязательный реквизит бланка. Поля
                были в данных и в таблице, но вводить их было негде. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-[16px] text-[#73738a]">{t("journalDisinfectant.periodFrom")}</Label>
                <div className="relative">
                  <Input aria-label={t("journalDisinfectant.periodFrom")}
                    type="date"
                    value={active.periodFrom}
                    onChange={(e) =>
                      setRow({
                        ...active,
                        // Пустое значение оставляем пустым: toIsoDate("")
                        // подставил бы сегодняшнюю дату.
                        periodFrom: e.target.value ? toIsoDate(e.target.value) : "",
                      })
                    }
                    className="h-9 rounded-xl border-[#d8dae6] px-3.5 pr-14 text-[13.5px]"
                  />
                  <CalendarDays className="pointer-events-none absolute right-4 top-1/2 size-6 -translate-y-1/2 text-[#6e7080]" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[16px] text-[#73738a]">{t("journalDisinfectant.periodTo")}</Label>
                <div className="relative">
                  <Input aria-label={t("journalDisinfectant.periodTo")}
                    type="date"
                    value={active.periodTo}
                    min={active.periodFrom || undefined}
                    onChange={(e) =>
                      setRow({
                        ...active,
                        periodTo: e.target.value ? toIsoDate(e.target.value) : "",
                      })
                    }
                    className="h-9 rounded-xl border-[#d8dae6] px-3.5 pr-14 text-[13.5px]"
                  />
                  <CalendarDays className="pointer-events-none absolute right-4 top-1/2 size-6 -translate-y-1/2 text-[#6e7080]" />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("sanitationPestPdf.disinfectantName")}</Label>
              <Input aria-label={t("sanitationPestPdf.disinfectantName")}
                value={active.disinfectantName}
                onChange={(e) =>
                  setRow({ ...active, disinfectantName: e.target.value })
                }
                placeholder={t("journalDisinfectant.disinfectantPlaceholder")}
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("journalDisinfectant.totalReceived")}</Label>
              <Input aria-label={t("journalDisinfectant.totalReceived")}
                type="number"
                inputMode="decimal"
                value={active.totalReceived || ""}
                onChange={(e) =>
                  setRow({
                    ...active,
                    totalReceived: Number(e.target.value) || 0,
                  })
                }
                placeholder={t("sanitationPestPdf.quantity")}
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
              />
              <div role="radiogroup" aria-label={t("journalDisinfectant.unit")} className="flex gap-6 pt-1">
                {(["kg", "l", "bottle"] as MeasureUnit[]).map((u) => (
                  <label
                    key={u}
                    className="flex items-center gap-2 text-[16px]"
                  >
                    <input
                      type="radio"
                      checked={active.totalReceivedUnit === u}
                      onChange={() =>
                        setRow({ ...active, totalReceivedUnit: u })
                      }
                      className="size-5 accent-[#5566f6]"
                    />
                    {t(`sanitationPestPdf.${u}`)}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("journalDisinfectant.totalConsumedShort")}</Label>
              <Input aria-label={t("journalDisinfectant.totalConsumedShort")}
                type="number"
                inputMode="decimal"
                value={active.totalConsumed || ""}
                onChange={(e) =>
                  setRow({
                    ...active,
                    totalConsumed: Number(e.target.value) || 0,
                  })
                }
                placeholder={t("sanitationPestPdf.quantity")}
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
              />
              <div role="radiogroup" aria-label={t("journalDisinfectant.unit")} className="flex gap-6 pt-1">
                {(["kg", "l", "bottle"] as MeasureUnit[]).map((u) => (
                  <label
                    key={u}
                    className="flex items-center gap-2 text-[16px]"
                  >
                    <input
                      type="radio"
                      checked={active.totalConsumedUnit === u}
                      onChange={() =>
                        setRow({ ...active, totalConsumedUnit: u })
                      }
                      className="size-5 accent-[#5566f6]"
                    />
                    {t(`sanitationPestPdf.${u}`)}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("journalDisinfectant.endRemainder")}</Label>
              <Input aria-label={t("journalDisinfectant.endRemainder")}
                type="number"
                inputMode="decimal"
                value={active.remainder || ""}
                onChange={(e) =>
                  setRow({
                    ...active,
                    remainder: Number(e.target.value) || 0,
                  })
                }
                placeholder={t("sanitationPestPdf.quantity")}
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
              />
              <div role="radiogroup" aria-label={t("journalDisinfectant.unit")} className="flex gap-6 pt-1">
                {(["kg", "l", "bottle"] as MeasureUnit[]).map((u) => (
                  <label
                    key={u}
                    className="flex items-center gap-2 text-[16px]"
                  >
                    <input
                      type="radio"
                      checked={active.remainderUnit === u}
                      onChange={() =>
                        setRow({ ...active, remainderUnit: u })
                      }
                      className="size-5 accent-[#5566f6]"
                    />
                    {t(`sanitationPestPdf.${u}`)}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">
                {t("journalDisinfectant.responsiblePosition")}</Label>
              <Select
                value={active.responsibleRole}
                onValueChange={cascade.handlePositionChange}
              >
                <SelectTrigger aria-label={t("journalDisinfectant.responsiblePosition")} className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[16px] text-[#73738a]">{t("journalControls.positionSelect.employeeLabel")}</Label>
              <Select
                value={active.responsibleEmployeeId || "__empty__"}
                onValueChange={cascade.handleEmployeeChange}
                open={cascade.employeeOpen}
                onOpenChange={cascade.setEmployeeOpen}
              >
                <SelectTrigger aria-label={t("journalControls.positionSelect.employeeLabel")} className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__empty__">{t("journalControls.positionSelect.chooseEmployee")}</SelectItem>
                  {cascade.candidates.map(
                    (u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {buildStaffOptionLabel(u)}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end pt-2">
              <Button
                type="button"
                disabled={submitting}
                onClick={async () => {
                  if (!active) return;
                  setSubmitting(true);
                  try {
                    // Должность выбранного человека из карточки, а не копия
                    // из документа (строка засеивается его парой).
                    await props.onSubmit({
                      ...active,
                      responsibleRole: getRowEmployeeTitle(
                        props.users.find((user) => user.id === active.responsibleEmployeeId),
                        active.responsibleRole
                      ),
                    });
                    props.onOpenChange(false);
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4a5bf0]"
              >
                {submitting ? t("journalDisinfectant.saving") : t("common.save")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Settings Dialog ----------
function DocumentSettingsDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  users: UserItem[];
  initial: {
    title: string;
    responsibleRole: string;
    responsibleEmployeeId: string;
    responsibleEmployee: string;
  };
  onSubmit: (value: {
    title: string;
    responsibleRole: string;
    responsibleEmployeeId: string;
    responsibleEmployee: string;
  }) => Promise<void>;
  useV2?: boolean;
}) {
  const t = useTranslations();
  const [state, setState] = useState(props.initial);
  const [submitting, setSubmitting] = useState(false);
  const roles = useMemo(() => roleOptionsFromUsers(props.users), [props.users]);
  const cascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: state.responsibleRole,
    userId: state.responsibleEmployeeId,
    onChange: (next) =>
      setState((current) => {
        const user = props.users.find((item) => item.id === next.userId);
        return {
          ...current,
          responsibleRole: next.positionTitle,
          responsibleEmployeeId: next.userId,
          responsibleEmployee: user
            ? user.name
            : next.positionTitle !== current.responsibleRole
              ? current.responsibleEmployee
              : "",
        };
      }),
    resolveCandidates: (roleLabel) => usersForRole(props.users, roleLabel),
    autoPick: "first",
  });

  async function handleSave() {
    setSubmitting(true);
    try {
      await props.onSubmit(state);
      props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (props.useV2) {
    return (
      <JournalSettingsModal
        open={props.open}
        onOpenChange={(v) => {
          if (v) setState(props.initial);
          props.onOpenChange(v);
        }}
        title={t("journalDisinfectant.settingsTitle")}
        description={t("journalDisinfectant.settingsDescription")}
        size="md"
        isSaving={submitting}
        onSave={handleSave}
        onCancel={() => props.onOpenChange(false)}
      >
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("journalDisinfectant.documentTitle")}</Label>
          <Input aria-label={t("journalDisinfectant.documentTitle")}
            value={state.title}
            onChange={(e) => setState({ ...state, title: e.target.value })}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("journalDisinfectant.responsiblePosition")}</Label>
          <Select
            value={state.responsibleRole}
            onValueChange={cascade.handlePositionChange}
          >
            <SelectTrigger aria-label={t("journalDisinfectant.responsiblePosition")} className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue placeholder={t("journalDisinfectant.chooseDashed")} />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("journalControls.positionSelect.employeeLabel")}</Label>
          <Select
            value={state.responsibleEmployeeId || "__empty__"}
            onValueChange={cascade.handleEmployeeChange}
            open={cascade.employeeOpen}
            onOpenChange={cascade.setEmployeeOpen}
          >
            <SelectTrigger aria-label={t("journalControls.positionSelect.employeeLabel")} className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue placeholder={t("journalDisinfectant.chooseDashed")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__empty__">{t("journalDisinfectant.notSelectedDashed")}</SelectItem>
              {cascade.candidates.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {buildStaffOptionLabel(u)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </JournalSettingsModal>
    );
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(v) => {
        if (v) setState(props.initial);
        props.onOpenChange(v);
      }}
    >
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              {t("journalDisinfectant.settingsTitle")}</DialogTitle>
            <button
              type="button"
              aria-label={t("common.close")}
              className="rounded-xl p-2"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-8" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-4 px-8 py-6">
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">
              {t("journalDisinfectant.documentTitle")}</Label>
            <Input aria-label={t("journalDisinfectant.documentTitle")}
              value={state.title}
              onChange={(e) =>
                setState({ ...state, title: e.target.value })
              }
              className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">
              {t("journalDisinfectant.responsiblePosition")}</Label>
            <Select
              value={state.responsibleRole}
              onValueChange={cascade.handlePositionChange}
            >
              <SelectTrigger aria-label={t("journalDisinfectant.responsiblePosition")} className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">{t("journalControls.positionSelect.employeeLabel")}</Label>
            <Select
              value={state.responsibleEmployeeId || "__empty__"}
              onValueChange={cascade.handleEmployeeChange}
              open={cascade.employeeOpen}
              onOpenChange={cascade.setEmployeeOpen}
            >
              <SelectTrigger aria-label={t("journalControls.positionSelect.employeeLabel")} className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty__">{t("journalControls.positionSelect.chooseEmployee")}</SelectItem>
                {cascade.candidates.map(
                  (u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {buildStaffOptionLabel(u)}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              disabled={submitting}
              onClick={handleSave}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4a5bf0]"
            >
              {submitting ? t("journalDisinfectant.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Main Component ----------
export function DisinfectantDocumentClient({
  documentId,
  title,
  organizationName,
  status,
  users,
  config,
  useV2 = false,
}: Props) {
  const t = useTranslations();
  const locale = useLocale();
  const quantityUnitLabels = useMemo(() => ({
    kg: t("sanitationPestPdf.kg"),
    l: t("sanitationPestPdf.l"),
    bottle: t("sanitationPestPdf.bottle"),
  }), [t]);
  const committedCopy = useRef({ t, locale });
  useEffect(() => { committedCopy.current = { t, locale }; }, [t, locale]);
  const router = useRouter();
  const normalized = normalizeDisinfectantConfig(config);
  // Новая строка засеивается ответственным документа — с его должностью из
  // карточки, а не сохранённой копией (могла устареть).
  const defaultResponsibleRole = getRowEmployeeTitle(
    users.find((user) => user.id === normalized.responsibleEmployeeId),
    normalized.responsibleRole
  );
  const readOnly = status === "closed";
  const { mobileView, switchMobileView } = useMobileView("disinfectant_usage");
  // «Сегодня» в поясе организации — якорь для «Перейти к сегодня».
  const todayKey = useTodayKey();

  const [selectedSubIds, setSelectedSubIds] = useState<string[]>([]);
  const [selectedRecIds, setSelectedRecIds] = useState<string[]>([]);
  const [selectedConIds, setSelectedConIds] = useState<string[]>([]);

  const [addSubOpen, setAddSubOpen] = useState(false);
  const [editSubTarget, setEditSubTarget] = useState<SubdivisionRow | null>(
    null
  );
  const [addRecOpen, setAddRecOpen] = useState(false);
  const [editRecTarget, setEditRecTarget] = useState<ReceiptRow | null>(null);
  const [addConOpen, setAddConOpen] = useState(false);
  const [editConTarget, setEditConTarget] = useState<ConsumptionRow | null>(
    null
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Свежая пустая строка на каждое открытие «Добавить»: раньше объект
  // пересоздавался на каждый рендер, а диалог держал первый — второе
  // добавление уходило с уже использованным id.
  const emptyReceipt = useMemo(
    () =>
      createEmptyReceipt(
        defaultResponsibleRole,
        normalized.responsibleEmployee,
        normalized.responsibleEmployeeId
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      addRecOpen,
      defaultResponsibleRole,
      normalized.responsibleEmployee,
      normalized.responsibleEmployeeId,
    ]
  );
  const emptyConsumption = useMemo(
    () =>
      createEmptyConsumption(
        defaultResponsibleRole,
        normalized.responsibleEmployee,
        normalized.responsibleEmployeeId
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      addConOpen,
      defaultResponsibleRole,
      normalized.responsibleEmployee,
      normalized.responsibleEmployeeId,
    ]
  );

  // Последнее локальное состояние + очередь: быстрые правки подряд раньше
  // строили PATCH от серверного пропа и теряли друг друга.
  const configRef = useRef(normalized);
  useEffect(() => {
    // Свежие серверные данные — начинаем от них.
    configRef.current = normalized;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());

  async function patchConfig(
    nextConfig: DisinfectantDocumentConfig,
    nextTitle = title
  ) {
    const previousConfig = configRef.current;
    configRef.current = nextConfig;
    const run = saveChainRef.current.catch(() => {}).then(async () => {
      const response = await fetch(`/api/journal-documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle, config: nextConfig }),
      });
      if (!response.ok) {
        configRef.current = previousConfig;
        const body = await response.json().catch(() => null);
        toast.error(
          (body && typeof body.error === "string" && body.error) ||
            committedCopy.current.t("journalDisinfectant.saveDocumentFailed")
        );
        return;
      }
      router.refresh();
    });
    saveChainRef.current = run;
    await run;
  }

  // --- Subdivision CRUD ---
  async function addSubdivision(row: SubdivisionRow) {
    await patchConfig({
      ...configRef.current,
      subdivisions: [...configRef.current.subdivisions, row],
    });
  }

  async function updateSubdivision(row: SubdivisionRow) {
    const next = configRef.current.subdivisions.map((s) =>
      s.id === row.id ? row : s
    );
    await patchConfig({ ...configRef.current, subdivisions: next });
    // Очередь правок откроет следующую строку или закроет окно.
    seqSavedRef.current = true;
    seqSub.saved();
  }

  async function deleteSelectedSubs() {
    if (selectedSubIds.length === 0) return;
    if (
      !(await confirmAsync({
        locale: committedCopy.current.locale,
        title: committedCopy.current.t("journalDisinfectant.deleteRowsTitle", { count: `${selectedSubIds.length}` }),
        description:
          committedCopy.current.t("journalDisinfectant.deleteNeedDescription"),
        variant: "danger",
        confirmLabel: committedCopy.current.t("common.delete"),
        bullets: [
          { label: committedCopy.current.t("journalDisinfectant.deleteRowsCount", { count: `${selectedSubIds.length}` }), tone: "warn" },
          { label: committedCopy.current.t("journalDisinfectant.needRecalculated") },
        ],
      }))
    )
      return;
    const next = configRef.current.subdivisions.filter(
      (s) => !selectedSubIds.includes(s.id)
    );
    setSelectedSubIds([]);
    await patchConfig({ ...configRef.current, subdivisions: next });
  }

  // --- Receipt CRUD ---
  async function addReceipt(row: ReceiptRow) {
    await patchConfig({
      ...configRef.current,
      receipts: [...configRef.current.receipts, row],
    });
  }

  async function updateReceipt(row: ReceiptRow) {
    const next = configRef.current.receipts.map((r) => (r.id === row.id ? row : r));
    await patchConfig({ ...configRef.current, receipts: next });
    // Очередь правок откроет следующую строку или закроет окно.
    seqSavedRef.current = true;
    seqRec.saved();
  }

  async function deleteSelectedReceipts() {
    if (selectedRecIds.length === 0) return;
    if (
      !(await confirmAsync({
        locale: committedCopy.current.locale,
        title: committedCopy.current.t("journalDisinfectant.deleteRowsTitle", { count: `${selectedRecIds.length}` }),
        description:
          committedCopy.current.t("journalDisinfectant.deleteReceiptDescription"),
        variant: "danger",
        confirmLabel: committedCopy.current.t("common.delete"),
        bullets: [
          { label: committedCopy.current.t("journalDisinfectant.deleteRowsCount", { count: `${selectedRecIds.length}` }), tone: "warn" },
          { label: committedCopy.current.t("journalDisinfectant.receiptRecalculated") },
        ],
      }))
    )
      return;
    const next = configRef.current.receipts.filter(
      (r) => !selectedRecIds.includes(r.id)
    );
    setSelectedRecIds([]);
    await patchConfig({ ...configRef.current, receipts: next });
  }

  // --- Consumption CRUD ---
  async function addConsumption(row: ConsumptionRow) {
    await patchConfig({
      ...configRef.current,
      consumptions: [...configRef.current.consumptions, row],
    });
  }

  async function updateConsumption(row: ConsumptionRow) {
    const next = configRef.current.consumptions.map((c) =>
      c.id === row.id ? row : c
    );
    await patchConfig({ ...configRef.current, consumptions: next });
    // Очередь правок откроет следующую строку или закроет окно.
    seqSavedRef.current = true;
    seqCon.saved();
  }

  async function deleteSelectedConsumptions() {
    if (selectedConIds.length === 0) return;
    if (
      !(await confirmAsync({
        locale: committedCopy.current.locale,
        title: committedCopy.current.t("journalDisinfectant.deleteRowsTitle", { count: `${selectedConIds.length}` }),
        description:
          committedCopy.current.t("journalDisinfectant.deleteConsumptionDescription"),
        variant: "danger",
        confirmLabel: committedCopy.current.t("common.delete"),
        bullets: [
          { label: committedCopy.current.t("journalDisinfectant.deleteRowsCount", { count: `${selectedConIds.length}` }), tone: "warn" },
          { label: committedCopy.current.t("journalDisinfectant.workHistoryLost") },
        ],
      }))
    )
      return;
    const next = configRef.current.consumptions.filter(
      (c) => !selectedConIds.includes(c.id)
    );
    setSelectedConIds([]);
    await patchConfig({ ...configRef.current, consumptions: next });
  }

  // --- Правка выделенных строк по очереди — у каждой таблицы своё окно ---
  // Диалоги сами зовут onOpenChange(false) после сохранения — этот вызов
  // не должен прерывать очередь, поэтому помечаем «уже сохранено».
  const seqSavedRef = useRef(false);
  const seqSub = useSequentialEdit({
    open: (id) => {
      const row = configRef.current.subdivisions.find((s) => s.id === id);
      if (!row || readOnly) return false;
      setEditSubTarget(row);
      return true;
    },
    close: () => setEditSubTarget(null),
  });
  const seqRec = useSequentialEdit({
    open: (id) => {
      const row = configRef.current.receipts.find((r) => r.id === id);
      if (!row || readOnly) return false;
      setEditRecTarget(row);
      return true;
    },
    close: () => setEditRecTarget(null),
  });
  const seqCon = useSequentialEdit({
    open: (id) => {
      const row = configRef.current.consumptions.find((c) => c.id === id);
      if (!row || readOnly) return false;
      setEditConTarget(row);
      return true;
    },
    close: () => setEditConTarget(null),
  });

  /** Закрытие окна правки без сохранения — прерывает очередь. */
  function closeEdit(seq: typeof seqSub) {
    if (seqSavedRef.current) {
      seqSavedRef.current = false;
      return;
    }
    seq.cancelled();
  }

  /** Одна полоса на три таблицы: по очереди правим строки одной из них. */
  function startSelectedEdit() {
    const groups = [
      { ids: selectedSubIds, seq: seqSub },
      { ids: selectedRecIds, seq: seqRec },
      { ids: selectedConIds, seq: seqCon },
    ].filter((group) => group.ids.length > 0);
    if (groups.length > 1) {
      toast.error(committedCopy.current.t("journalDisinfectant.oneTableSelection"));
      return;
    }
    groups[0]?.seq.start(groups[0].ids);
  }

  // --- Totals ---
  const totalNeedPerTreatment = normalized.subdivisions.reduce(
    (sum, s) => sum + computeNeedPerTreatment(s),
    0
  );
  const totalNeedPerMonth = normalized.subdivisions.reduce(
    (sum, s) => sum + computeNeedPerMonth(s),
    0
  );
  const totalNeedPerYear = normalized.subdivisions.reduce(
    (sum, s) => sum + computeNeedPerYear(s),
    0
  );
  // Итог считаем ПО ЕДИНИЦАМ: раньше кг, л и флаконы складывались в одно
  // бессмысленное число. Тот же helper использует печать.
  const totalReceiptQuantity = useMemo(
    () => disinfectantQuantityTotal(normalized.receipts, quantityUnitLabels),
    [normalized.receipts, quantityUnitLabels]
  );

  const allSubsSelected =
    normalized.subdivisions.length > 0 &&
    selectedSubIds.length === normalized.subdivisions.length;
  const allRecsSelected =
    normalized.receipts.length > 0 &&
    selectedRecIds.length === normalized.receipts.length;
  const allConsSelected =
    normalized.consumptions.length > 0 &&
    selectedConIds.length === normalized.consumptions.length;

  const anySelected =
    selectedSubIds.length > 0 ||
    selectedRecIds.length > 0 ||
    selectedConIds.length > 0;

  return (
    <div className="space-y-5">
      <FocusTodayScroller selector="[data-focus-today]" emptyTitle={t("journalDisinfectant.noRecords")} emptyBody={t("journalDisinfectant.noRecordsHint")} copy={{ noCreateBody: t("journalScan.focus.noCreateBody"), later: t("journalScan.focus.later"), close: t("common.close") }} />

      {/* Selection bar */}
      {anySelected && !readOnly && (
        <JournalSelectionBar
          count={selectedSubIds.length + selectedRecIds.length + selectedConIds.length}
          onClear={() => {
            setSelectedSubIds([]);
            setSelectedRecIds([]);
            setSelectedConIds([]);
          }}
          onDelete={() => {
            // Последовательно: без await три confirmAsync открывались
            // одновременно и накладывались друг на друга.
            void (async () => {
              if (selectedSubIds.length > 0) await deleteSelectedSubs();
              if (selectedRecIds.length > 0) await deleteSelectedReceipts();
              if (selectedConIds.length > 0) await deleteSelectedConsumptions();
            })();
          }}
          hint={t("journalDisinfectant.deleteSelectionHint")}
        >
          <SelectionEditButton
            count={selectedSubIds.length + selectedRecIds.length + selectedConIds.length}
            disabled={readOnly}
            onClick={startSelectedEdit}
          />
        </JournalSelectionBar>
      )}

      <JournalDocumentShell
        title={<>{title}</>}
        documentId={documentId}
        backHref="/journals/disinfectant_usage"
        onSettings={!readOnly ? () => setSettingsOpen(true) : undefined}
        closed={readOnly}
        closedHint={t("journalDisinfectant.closedHint")}
        tablesInOwnFrames
        mobileView={mobileView}
        onMobileView={switchMobileView}
        cards={
          <div className="space-y-6">
            {!readOnly && (
              <Button
                className={DOC_PRIMARY_BUTTON_CLASS}
                onClick={() => setAddSubOpen(true)}
              >
                <Plus className="size-5" /> {t("journalDisinfectant.addSubdivision")}</Button>
            )}
            {/* Строки расчёта потребности — такие же карточки, как приход и
                расход: раньше здесь стояла заглушка «переключитесь на
                Таблица», а кнопка «Добавить подразделение» над ней работала. */}
            <RecordCardsView
              emptyLabel={t("journalDisinfectant.noSubdivisions")}
              items={normalized.subdivisions.map<RecordCardItem>((sub) => ({
                id: sub.id,
                title: sub.name || t("journalDisinfectant.unnamed"),
                subtitle: sub.disinfectantName || undefined,
                onClick: readOnly ? undefined : () => setEditSubTarget(sub),
                leading: readOnly ? null : (
                  <Checkbox
                    aria-label={t("journalDisinfectant.selectRow")}
                    checked={selectedSubIds.includes(sub.id)}
                    onCheckedChange={(c) =>
                      setSelectedSubIds((cur) =>
                        c === true
                          ? [...new Set([...cur, sub.id])]
                          : cur.filter((id) => id !== sub.id)
                      )
                    }
                    className="size-5"
                  />
                ),
                fields: [
                  {
                    label: t("journalDisinfectant.area"),
                    value: sub.byCapacity
                      ? t("journalDisinfectant.byCapacity")
                      : sub.area
                        ? t("journalDisinfectant.areaValue", { area: `${sub.area}` })
                        : "—",
                  },
                  {
                    label: t("sanitationPestPdf.treatmentType"),
                    value: sub.treatmentType === "current" ? t("journalDisinfectant.currentLong") : t("journalDisinfectant.generalLong"),
                  },
                  {
                    label: t("journalDisinfectant.frequencyMonth"),
                    value: sub.frequencyPerMonth || "—",
                  },
                  {
                    label: t("journalDisinfectant.concentration"),
                    value: sub.concentration ? `${sub.concentration} %` : "—",
                  },
                  {
                    label: t("journalDisinfectant.needTreatment"),
                    value: formatNumber(computeNeedPerTreatment(sub)) || "—",
                  },
                  {
                    label: t("journalDisinfectant.needMonth"),
                    value: formatNumber(computeNeedPerMonth(sub)) || "—",
                  },
                  {
                    label: t("journalDisinfectant.needYear"),
                    value: formatNumber(computeNeedPerYear(sub)) || "—",
                  },
                ],
              }))}
            />

            {!readOnly && (
              <Button
                className={DOC_PRIMARY_BUTTON_CLASS}
                onClick={() => setAddRecOpen(true)}
              >
                <Plus className="size-5" /> {t("journalDisinfectant.addReceipt")}</Button>
            )}
            <RecordCardsView
              emptyLabel={t("journalDisinfectant.noReceipts")}
              items={normalized.receipts.map<RecordCardItem>((rec) => ({
                id: rec.id,
                // Якорь «Перейти к сегодня» для карточек (телефон).
                title: (
                  <span data-focus-today={rec.date === todayKey ? "" : undefined}>
                    {formatDateRu(rec.date) || t("journalDisinfectant.noDate")}
                  </span>
                ),
                subtitle: rec.disinfectantName || undefined,
                onClick: readOnly ? undefined : () => setEditRecTarget(rec),
                // Без чекбокса запись нельзя было удалить с телефона.
                leading: readOnly ? null : (
                  <Checkbox
                    aria-label={t("journalDisinfectant.selectRow")}
                    checked={selectedRecIds.includes(rec.id)}
                    onCheckedChange={(c) =>
                      setSelectedRecIds((cur) =>
                        c === true
                          ? [...new Set([...cur, rec.id])]
                          : cur.filter((id) => id !== rec.id)
                      )
                    }
                    className="size-5"
                  />
                ),
                fields: [
                  {
                    label: t("sanitationPestPdf.quantity"),
                    value: disinfectantQuantity(rec.quantity, rec.unit, quantityUnitLabels) || "—",
                  },
                  {
                    label: t("sanitationPestPdf.expiry"),
                    value: formatDateRu(rec.expiryDate) || "—",
                  },
                  {
                    label: t("sanitationPestPdf.responsible"),
                    value: rec.responsibleEmployee || "—",
                  },
                ],
              }))}
            />

            {!readOnly && (
              <Button
                className={DOC_PRIMARY_BUTTON_CLASS}
                onClick={() => setAddConOpen(true)}
              >
                <Plus className="size-5" /> {t("journalDisinfectant.addConsumption")}</Button>
            )}
            <RecordCardsView
              emptyLabel={t("journalDisinfectant.noConsumption")}
              items={normalized.consumptions.map<RecordCardItem>((con) => ({
                id: con.id,
                title: `${formatDateRu(con.periodFrom) || "—"} — ${formatDateRu(con.periodTo) || "—"}`,
                subtitle: con.disinfectantName || undefined,
                onClick: readOnly ? undefined : () => setEditConTarget(con),
                leading: readOnly ? null : (
                  <Checkbox
                    aria-label={t("journalDisinfectant.selectRow")}
                    checked={selectedConIds.includes(con.id)}
                    onCheckedChange={(c) =>
                      setSelectedConIds((cur) =>
                        c === true
                          ? [...new Set([...cur, con.id])]
                          : cur.filter((id) => id !== con.id)
                      )
                    }
                    className="size-5"
                  />
                ),
                fields: [
                  {
                    label: t("sanitationPestPdf.received"),
                    value:
                      disinfectantQuantity(con.totalReceived, con.totalReceivedUnit, quantityUnitLabels) || "—",
                  },
                  {
                    label: t("sanitationPestPdf.consumed"),
                    value:
                      disinfectantQuantity(con.totalConsumed, con.totalConsumedUnit, quantityUnitLabels) || "—",
                  },
                  {
                    label: t("sanitationPestPdf.remainder"),
                    value:
                      disinfectantQuantity(con.remainder, con.remainderUnit, quantityUnitLabels) ||
                      "—",
                  },
                  {
                    label: t("sanitationPestPdf.responsible"),
                    value: con.responsibleEmployee || "—",
                  },
                ],
              }))}
            />
          </div>
        }
        paperHeader={
          <JournalDocumentHeader
            orgName={organizationName}
            title={t("journalDisinfectant.paperHeading")}
            startedAt={null}
            finishedAt={null}
          />
        }
      >
        {/* === Section 1: Needs Calculation === */}
        <h2 className="pt-4 text-center text-[18px] font-semibold uppercase leading-tight sm:text-[20px]">
          {t("journalDisinfectant.needHeading")}</h2>

        {!readOnly && (
          <Button
            className={DOC_PRIMARY_BUTTON_CLASS}
            onClick={() => setAddSubOpen(true)}
          >
            <Plus className="size-5" /> {t("journalDisinfectant.addSubdivision")}</Button>
        )}

        {/* Каждая из трёх таблиц ездит вбок в своей рамке: подзаголовки и
            кнопки между ними стоят по ширине экрана (`tablesInOwnFrames`). */}
        <div className={JOURNAL_TABLE_SCROLL_CLASS}>
        <table className="min-w-full border-collapse border border-[#ececf4] bg-white text-[13px] print:border-black">
            <thead>
              <tr>
                <th
                  rowSpan={2}
                  className={`${GRID_HEAD_CELL_CLASS} w-12 px-2 py-1.5 font-semibold leading-tight`}
                >
                  {!readOnly && (
                    <Checkbox
                    aria-label={t("journalDisinfectant.selectAllRows")}
                      checked={allSubsSelected}
                      onCheckedChange={(c) =>
                        setSelectedSubIds(
                          c === true
                            ? normalized.subdivisions.map((s) => s.id)
                            : []
                        )
                      }
                    />
                  )}
                </th>
                <th
                  rowSpan={2}
                  className={`${GRID_HEAD_CELL_CLASS} min-w-[200px] px-2 py-1.5 font-semibold leading-tight`}
                >
                  {t("journalDisinfectant.subdivisionFull")}</th>
                <th
                  rowSpan={2}
                  className={`${GRID_HEAD_CELL_CLASS} w-[80px] px-2 py-1.5 font-semibold leading-tight`}
                >
                  {t("journalDisinfectant.areaSqm")}</th>
                <th
                  rowSpan={2}
                  className={`${GRID_HEAD_CELL_CLASS} w-[60px] px-2 py-1.5 font-semibold leading-tight`}
                >
                  {t("journalDisinfectant.treatmentCodes")}</th>
                <th
                  rowSpan={2}
                  className={`${GRID_HEAD_CELL_CLASS} w-[80px] px-2 py-1.5 font-semibold leading-tight`}
                >
                  {t("journalDisinfectant.frequencyMonth")}</th>
                <th
                  colSpan={2}
                  className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}
                >
                  {t("journalDisinfectant.disinfectant")}</th>
                <th
                  rowSpan={2}
                  className={`${GRID_HEAD_CELL_CLASS} w-[80px] px-2 py-1.5 font-semibold leading-tight`}
                >
                  {t("journalDisinfectant.solutionSqm")}</th>
                <th
                  rowSpan={2}
                  className={`${GRID_HEAD_CELL_CLASS} w-[100px] px-2 py-1.5 font-semibold leading-tight`}
                >
                  {t("journalDisinfectant.solutionTreatmentFull")}</th>
                <th
                  colSpan={3}
                  className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}
                >
                  {t("journalDisinfectant.needDisinfectant")}</th>
              </tr>
              <tr>
                <th className={`${GRID_HEAD_CELL_CLASS} w-[120px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("sanitationPestPdf.name")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} w-[80px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("journalDisinfectant.concentrationPercent")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} w-[80px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("journalDisinfectant.perTreatmentKgL")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} w-[80px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("journalDisinfectant.perMonthKgL")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} w-[80px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("journalDisinfectant.perYearKgL")}</th>
              </tr>
            </thead>
            <tbody>
              {normalized.subdivisions.map((sub) => (
                <tr
                  key={sub.id}
                  className={
                    !readOnly ? "cursor-pointer hover:bg-[#f5f6ff]" : ""
                  }
                  onClick={() => !readOnly && setEditSubTarget(sub)}
                >
                  <td
                    className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!readOnly && (
                      <Checkbox
                    aria-label={t("journalDisinfectant.selectRow")}
                        checked={selectedSubIds.includes(sub.id)}
                        onCheckedChange={(c) =>
                          setSelectedSubIds((cur) =>
                            c === true
                              ? [...new Set([...cur, sub.id])]
                              : cur.filter((id) => id !== sub.id)
                          )
                        }
                      />
                    )}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                    {sub.name}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    {sub.byCapacity ? t("journalDisinfectant.byCapacityShort") : sub.area}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    {sub.treatmentType === "current" ? t("journalDisinfectant.currentCode") : t("journalDisinfectant.generalCode")}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    {sub.frequencyPerMonth}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                    {sub.disinfectantName}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    {sub.concentration || ""}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    {sub.solutionConsumptionPerSqm || ""}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    {/* Пусто и площадь×расход — показываем расчётное значение,
                        иначе колонка «потребность» выглядела взятой ниоткуда. */}
                    {formatNumber(resolveSolutionPerTreatment(sub))}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    {formatNumber(computeNeedPerTreatment(sub))}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    {formatNumber(computeNeedPerMonth(sub))}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    {formatNumber(computeNeedPerYear(sub))}
                  </td>
                </tr>
              ))}
              {/* Кликабельная «пустая» строка — то же окно, что и «Добавить
                  подразделение» над таблицей. Строка итогов ниже остаётся
                  последней визуально: она футер расчёта, а не запись. */}
              {!readOnly ? (
                <JournalAddRow
                  // Галочка — leading. Подпись растянута на «Наименование
                  // подразделения» + «Площадь объекта», чтобы плюс с
                  // текстом не жался в узкую колонку. Остальные 9 колонок
                  // расчёта (вид обработки … потребность на год) — пустые
                  // ячейки.
                  leading={1}
                  labelSpan={2}
                  trailing={9}
                  label={t("journalDisinfectant.addSubdivision")}
                  onClick={() => setAddSubOpen(true)}
                />
              ) : null}
              <tr className="font-semibold">
                <td
                  colSpan={9}
                  className={`${GRID_CELL_CLASS} text-right px-2 py-1 leading-tight`}
                >
                  {t("sanitationPestPdf.totalNeed")}</td>
                <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                  {formatNumber(totalNeedPerTreatment)}
                </td>
                <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                  {formatNumber(totalNeedPerMonth)}
                </td>
                <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                  {formatNumber(totalNeedPerYear)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* === Section 2: Receipts === */}
        <h2 className="pt-8 text-center text-[20px] font-semibold uppercase">
          {t("journalDisinfectant.receiptHeading")}</h2>

        {!readOnly && (
          <Button
            className={DOC_PRIMARY_BUTTON_CLASS}
            onClick={() => setAddRecOpen(true)}
          >
            <Plus className="size-5" /> {t("journalDisinfectant.addReceipt")}</Button>
        )}

        <div className={JOURNAL_TABLE_SCROLL_CLASS}>
        <table className="min-w-full border-collapse border border-[#ececf4] bg-white text-[13px] print:border-black">
            <thead>
              <tr>
                <th className={`${GRID_HEAD_CELL_CLASS} w-12 px-2 py-1.5 font-semibold leading-tight`}>
                  {!readOnly && (
                    <Checkbox
                    aria-label={t("journalDisinfectant.selectAllRows")}
                      checked={allRecsSelected}
                      onCheckedChange={(c) =>
                        setSelectedRecIds(
                          c === true
                            ? normalized.receipts.map((r) => r.id)
                            : []
                        )
                      }
                    />
                  )}
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} w-[120px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("sanitationPestPdf.receiptDate")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} min-w-[200px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("sanitationPestPdf.disinfectantName")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} w-[160px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("journalDisinfectant.receiptQuantityUnits")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} w-[120px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("journalDisinfectant.expiryUntil")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} w-[160px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("journalDisinfectant.receiptResponsible")}</th>
              </tr>
            </thead>
            <tbody>
              {normalized.receipts.map((rec) => (
                <tr
                  key={rec.id}
                  // Якорь «Перейти к сегодня»: раньше атрибут не ставила
                  // ни одна строка и скроллер показывал «Записей пока нет».
                  data-focus-today={rec.date === todayKey ? "" : undefined}
                  className={
                    !readOnly ? "cursor-pointer hover:bg-[#f5f6ff]" : ""
                  }
                  onClick={() => !readOnly && setEditRecTarget(rec)}
                >
                  <td
                    className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!readOnly && (
                      <Checkbox
                    aria-label={t("journalDisinfectant.selectRow")}
                        checked={selectedRecIds.includes(rec.id)}
                        onCheckedChange={(c) =>
                          setSelectedRecIds((cur) =>
                            c === true
                              ? [...new Set([...cur, rec.id])]
                              : cur.filter((id) => id !== rec.id)
                          )
                        }
                      />
                    )}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    {formatDateRu(rec.date)}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                    {rec.disinfectantName}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    {disinfectantQuantity(rec.quantity, rec.unit, quantityUnitLabels)}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    {formatDateRu(rec.expiryDate)}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                    {rec.responsibleEmployee}
                  </td>
                </tr>
              ))}
              {/* Кликабельная «пустая» строка — то же окно, что и «Добавить
                  поступление» над таблицей. Строка «Итого» остаётся
                  последней визуально: она футер, а не запись. */}
              {!readOnly ? (
                <JournalAddRow
                  // Галочка — leading. Подпись растянута на «Дата
                  // получения» + «Наименование дез. средства», остальные
                  // 3 колонки (количество, срок годности, ответственный) —
                  // пустые ячейки.
                  leading={1}
                  labelSpan={2}
                  trailing={3}
                  label={t("journalDisinfectant.addReceipt")}
                  onClick={() => setAddRecOpen(true)}
                />
              ) : null}
              <tr className="font-semibold">
                <td
                  colSpan={3}
                  className={`${GRID_CELL_CLASS} text-right px-2 py-1 leading-tight`}
                >
                  {t("sanitationPestPdf.total")}</td>
                <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                  {totalReceiptQuantity}
                </td>
                <td
                  colSpan={2}
                  className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}
                />
              </tr>
            </tbody>
          </table>
        </div>

        {/* === Section 3: Consumption === */}
        <h2 className="pt-8 text-center text-[20px] font-semibold uppercase">
          {t("journalDisinfectant.consumptionHeading")}</h2>

        {!readOnly && (
          <Button
            className={DOC_PRIMARY_BUTTON_CLASS}
            onClick={() => setAddConOpen(true)}
          >
            <Plus className="size-5" /> {t("journalDisinfectant.addConsumption")}</Button>
        )}

        <div className={JOURNAL_TABLE_SCROLL_CLASS}>
        <table className="min-w-full border-collapse border border-[#ececf4] bg-white text-[13px] print:border-black">
            <thead>
              <tr>
                <th className={`${GRID_HEAD_CELL_CLASS} w-12 px-2 py-1.5 font-semibold leading-tight`}>
                  {!readOnly && (
                    <Checkbox
                    aria-label={t("journalDisinfectant.selectAllRows")}
                      checked={allConsSelected}
                      onCheckedChange={(c) =>
                        setSelectedConIds(
                          c === true
                            ? normalized.consumptions.map((c2) => c2.id)
                            : []
                        )
                      }
                    />
                  )}
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} w-[130px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("journalDisinfectant.periodBlank")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} min-w-[180px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("sanitationPestPdf.disinfectantName")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} w-[160px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("journalDisinfectant.totalReceivedWithRemainder")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} w-[160px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("journalDisinfectant.totalConsumedUnits")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} w-[140px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("journalDisinfectant.endRemainderUnits")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} w-[140px] px-2 py-1.5 font-semibold leading-tight`}>
                  {t("journalDisinfectant.receiptResponsible")}</th>
              </tr>
            </thead>
            <tbody>
              {normalized.consumptions.map((con) => (
                <tr
                  key={con.id}
                  className={
                    !readOnly ? "cursor-pointer hover:bg-[#f5f6ff]" : ""
                  }
                  onClick={() => !readOnly && setEditConTarget(con)}
                >
                  <td
                    className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!readOnly && (
                      <Checkbox
                    aria-label={t("journalDisinfectant.selectRow")}
                        checked={selectedConIds.includes(con.id)}
                        onCheckedChange={(c) =>
                          setSelectedConIds((cur) =>
                            c === true
                              ? [...new Set([...cur, con.id])]
                              : cur.filter((id) => id !== con.id)
                          )
                        }
                      />
                    )}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    <div>{formatDateRu(con.periodFrom)}</div>
                    <div className="my-1 text-[13px] text-[#999]">—</div>
                    <div>{formatDateRu(con.periodTo)}</div>
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                    {con.disinfectantName}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    {disinfectantQuantity(con.totalReceived, con.totalReceivedUnit, quantityUnitLabels)}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    {disinfectantQuantity(con.totalConsumed, con.totalConsumedUnit, quantityUnitLabels)}
                  </td>
                  <td className={`${GRID_CELL_CLASS} text-center px-2 py-1 leading-tight`}>
                    {disinfectantQuantity(con.remainder, con.remainderUnit, quantityUnitLabels)}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                    {con.responsibleEmployee}
                  </td>
                </tr>
              ))}
              {/* Кликабельная «пустая» строка — то же окно, что и «Добавить
                  расход» над таблицей. У этой таблицы нет строки итогов,
                  поэтому она и есть последняя строка tbody. */}
              {!readOnly ? (
                <JournalAddRow
                  // Галочка — leading. Подпись растянута на «За период» +
                  // «Наименование дез. средства», остальные 4 колонки
                  // расхода — пустые ячейки.
                  leading={1}
                  labelSpan={2}
                  trailing={4}
                  label={t("journalDisinfectant.addConsumption")}
                  onClick={() => setAddConOpen(true)}
                />
              ) : null}
            </tbody>
          </table>
        </div>
      </JournalDocumentShell>

      {/* Dialogs */}
      <AddSubdivisionDialog
        open={addSubOpen}
        onOpenChange={setAddSubOpen}
        onSubmit={addSubdivision}
      />
      <EditSubdivisionDialog
        open={!!editSubTarget}
        key={`edit-sub-${editSubTarget?.id ?? "none"}`}
        onOpenChange={(v) => {
          if (!v) closeEdit(seqSub);
        }}
        initial={editSubTarget}
        onSubmit={updateSubdivision}
        titleSuffix={seqSub.progress ?? undefined}
      />
      {/* key по цели: без него диалог держал прошлую строку в useState —
          открываешь строку №2, а видишь и перезаписываешь №1. У «Добавить»
          key по флагу открытия: каждое открытие — новая запись с новым id. */}
      <ReceiptDialog
        key={`add-rec-${addRecOpen}`}
        open={addRecOpen}
        onOpenChange={setAddRecOpen}
        users={users}
        initial={emptyReceipt}
        onSubmit={addReceipt}
        dialogTitle={t("journalDisinfectant.addRow")}
      />
      <ReceiptDialog
        key={`edit-rec-${editRecTarget?.id ?? "none"}`}
        open={!!editRecTarget}
        onOpenChange={(v) => {
          if (!v) closeEdit(seqRec);
        }}
        users={users}
        initial={editRecTarget}
        onSubmit={updateReceipt}
        dialogTitle={t("journalDisinfectant.editRow", { suffix: `${seqRec.progress ? ` ${seqRec.progress}` : ""}` })}
      />
      <ConsumptionDialog
        key={`add-con-${addConOpen}`}
        open={addConOpen}
        onOpenChange={setAddConOpen}
        users={users}
        initial={emptyConsumption}
        onSubmit={addConsumption}
        dialogTitle={t("journalDisinfectant.addRow")}
      />
      <ConsumptionDialog
        key={`edit-con-${editConTarget?.id ?? "none"}`}
        open={!!editConTarget}
        onOpenChange={(v) => {
          if (!v) closeEdit(seqCon);
        }}
        users={users}
        initial={editConTarget}
        onSubmit={updateConsumption}
        dialogTitle={t("journalDisinfectant.editRow", { suffix: `${seqCon.progress ? ` ${seqCon.progress}` : ""}` })}
      />
      <DocumentSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        users={users}
        initial={{
          title,
          responsibleRole: normalized.responsibleRole,
          responsibleEmployeeId: normalized.responsibleEmployeeId || "",
          responsibleEmployee: normalized.responsibleEmployee,
        }}
        onSubmit={async (value) => {
          await patchConfig(
            {
              // configRef, а не серверный проп: настройки, открытые до
              // прилёта router.refresh(), затирали свежие строки.
              ...configRef.current,
              responsibleRole: value.responsibleRole,
              responsibleEmployeeId: value.responsibleEmployeeId || null,
              responsibleEmployee: value.responsibleEmployee,
            },
            value.title.trim() || title
          );
        }}
        useV2={useV2}
      />
    </div>
  );
}
