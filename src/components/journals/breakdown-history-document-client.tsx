"use client";

import { useBreakdownCopy } from "./use-breakdown-copy";
import { breakdownDate, breakdownTitle, breakdownTime, breakdownEnd } from "./breakdown-history-presentation";

import { useMemo, useState, useTransition } from "react";
import { Archive, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  TimeField,
  joinTimeValue,
  splitTimeValue,
} from "@/components/journals/time-field";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createBreakdownRow,
  getBreakdownRowDateError,
  normalizeBreakdownHistoryDocumentConfig,
  type BreakdownHistoryDocumentConfig,
  type BreakdownRow,
} from "@/lib/breakdown-history-document";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { EquipmentDirectoryField } from "@/components/journals/equipment-directory-field";
import {
  resolveEquipmentRowName,
  type EquipmentDirectoryOption,
} from "@/lib/equipment-directory-link";
import { GRID_CELL_CLASS, GRID_HEAD_CELL_CLASS } from "@/components/journals/journal-grid";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";

type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  dateFrom: string;
  status: string;
  config: unknown;
  /** Справочник «Оборудование» организации — источник имён для записей. */
  equipmentDirectory?: EquipmentDirectoryOption[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Row Dialog                                                        */
/* ------------------------------------------------------------------ */

function RowDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRow: BreakdownRow | null;
  /** «(k из N)» при правке выделенных строк по очереди. */
  titleSuffix?: string;
  onSave: (row: BreakdownRow) => Promise<void>;
  documentId: string;
  directory: readonly EquipmentDirectoryOption[];
}) {
  const { t, latest } = useBreakdownCopy();
  const [row, setRow] = useState<BreakdownRow>(() => props.initialRow || createBreakdownRow());
  const [isSubmitting, setIsSubmitting] = useState(false);

  function setValue<K extends keyof BreakdownRow>(key: K, value: BreakdownRow[K]) {
    setRow((current) => ({ ...current, [key]: value }));
  }

  const dateError = getBreakdownRowDateError(row) ? t("row.dateError") : null;

  async function handleSave() {
    if (dateError) {
      toast.error(dateError);
      return;
    }
    setIsSubmitting(true);
    try {
      // Окно закрывает родитель: при правке по очереди он откроет следующую строку.
      await props.onSave(row);
    } catch {
      // ПОЧЕМУ: окно закрывалось в finally — сотрудник видел «сохранено»,
      // хотя сервер отказал, и запись о поломке терялась.
      toast.error(
        latest.current.t("errors.row")
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] overflow-hidden rounded-[24px] border-0 p-0 sm:max-w-[640px]">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {props.initialRow ? (props.titleSuffix ? t("row.editProgress", { progress: props.titleSuffix }) : t("row.edit")) : t("row.add")}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
          {/* Start date + time */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              {t("columns.startTime")}</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1.6fr]">
              <Input
                type="date"
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                aria-label={t("columns.startTime")}
              value={row.startDate}
                onChange={(e) => setValue("startDate", e.target.value)}
              />
              {/* Одно поле времени вместо пары селектов «часы» и «минуты»:
                  на телефоне это было два раскрытия списка там, где нужно
                  одно значение. В конфиге части по-прежнему хранятся врозь. */}
              <TimeField
                value={joinTimeValue(row.startHour, row.startMinute)}
                onChange={(next) => {
                  const { hour, minute } = splitTimeValue(next);
                  setValue("startHour", hour);
                  setValue("startMinute", minute);
                }}
              />
            </div>
          </div>

          <EquipmentDirectoryField
            label={t("columns.equipment")}
            value={row.equipmentName}
            sourceEquipmentId={row.sourceEquipmentId}
            directory={props.directory}
            documentId={props.documentId}
            onChange={(name, sourceId) =>
              setRow((current) => ({
                ...current,
                equipmentName: name,
                sourceEquipmentId: sourceId,
              }))
            }
          />

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("columns.description")}</Label>
            <textarea
              className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[15px] text-[#0b1024] focus:outline-none"
              rows={3}
              aria-label={t("columns.description")}
              value={row.breakdownDescription}
              onChange={(e) => setValue("breakdownDescription", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("columns.repair")}</Label>
            <textarea
              className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[15px] text-[#0b1024] focus:outline-none"
              rows={3}
              aria-label={t("columns.repair")}
              value={row.repairPerformed}
              onChange={(e) => setValue("repairPerformed", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("columns.parts")}</Label>
            <textarea
              className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[15px] text-[#0b1024] focus:outline-none"
              rows={2}
              aria-label={t("columns.parts")}
              value={row.partsReplaced}
              onChange={(e) => setValue("partsReplaced", e.target.value)}
            />
          </div>

          {/* End date + time */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              {t("columns.endTime")}<span className="ml-1 font-normal text-[#6f7282]">
                {t("row.endHint")}
              </span>
            </Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1.6fr]">
              <Input
                type="date"
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                aria-label={t("columns.endTime")}
              value={row.endDate}
                onChange={(e) => setValue("endDate", e.target.value)}
              />
              {/* Одно поле времени вместо пары селектов «часы» и «минуты»:
                  на телефоне это было два раскрытия списка там, где нужно
                  одно значение. В конфиге части по-прежнему хранятся врозь. */}
              <TimeField
                value={joinTimeValue(row.endHour, row.endMinute)}
                onChange={(next) => {
                  const { hour, minute } = splitTimeValue(next);
                  setValue("endHour", hour);
                  setValue("endMinute", minute);
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("columns.downtime")}</Label>
            <Input
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
              aria-label={t("columns.downtime")}
              value={row.downtimeHours}
              onChange={(e) => setValue("downtimeHours", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("columns.responsible")}</Label>
            <Input
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
              aria-label={t("columns.responsible")}
              value={row.responsiblePerson}
              onChange={(e) => setValue("responsiblePerson", e.target.value)}
            />
          </div>

          {dateError ? (
            <p className="rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#ff3b30]">
              {dateError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff] sm:w-auto"
            onClick={() => props.onOpenChange(false)}
          >
            {t("actions.cancel")}</Button>
          <Button
            type="button"
            className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
            onClick={handleSave}
            disabled={isSubmitting || dateError !== null}
          >
            {isSubmitting ? t("actions.saving") : props.initialRow ? t("actions.save") : t("actions.add")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings Dialog                                                   */
/* ------------------------------------------------------------------ */

function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  dateFrom: string;
  onSave: (params: { title: string; dateFrom: string }) => Promise<void>;
  useV2?: boolean;
}) {
  const { t, locale, latest } = useBreakdownCopy();
  const [title, setTitle] = useState(props.title);
  const [dateFrom, setDateFrom] = useState(props.dateFrom);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSave() {
    setIsSubmitting(true);
    try {
      await props.onSave({ title: title.trim(), dateFrom });
      props.onOpenChange(false);
    } catch {
      // Не закрываем окно при отказе сервера — иначе правка теряется молча.
      toast.error(
        latest.current.t("errors.settings")
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (props.useV2) {
    return (
      <JournalSettingsModal
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={t("settings.title")}
        description={t("settings.description")}
        size="md"
        isSaving={isSubmitting}
        onSave={handleSave}
        onCancel={() => props.onOpenChange(false)}
      >
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("settings.name")}</Label>
          <Input
            value={breakdownTitle(title, dateFrom, locale, t)}
            onChange={(e) => setTitle(e.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("settings.start")}</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
          />
        </div>
      </JournalSettingsModal>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b px-8 py-6">
          <DialogTitle className="text-[30px] font-medium text-black">
            {t("settings.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-8 py-6">
          <div className="space-y-2">
            <Label>{t("settings.name")}</Label>
            <Input value={breakdownTitle(title, dateFrom, locale, t)} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("settings.start")}</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              className="bg-[#5563ff] hover:bg-[#4452ee]"
              onClick={handleSave}
              disabled={isSubmitting}
            >
              {isSubmitting ? t("actions.saving") : t("actions.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Finish Journal Dialog                                             */
/* ------------------------------------------------------------------ */

function FinishDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  documentId: string;
  onFinished: () => void;
}) {
  const { t, latest } = useBreakdownCopy();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleFinish() {
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/journal-documents/${props.documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });
      if (!response.ok) {
        throw new Error("BREAKDOWN_CLOSE_FAILED");
      }
      props.onFinished();
      props.onOpenChange(false);
    } catch {
      toast.error(latest.current.t("errors.generic"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[480px]">
        <DialogHeader className="border-b px-8 py-6">
          <DialogTitle className="text-[24px] font-medium text-black">
            {t("finish.title", { title: props.title })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-8 py-6">
          <p className="text-sm text-[#80849a]">
            {t("finish.description")}
          </p>
          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onOpenChange(false)}
            >
              {t("actions.cancel")}</Button>
            <Button
              type="button"
              className="bg-[#5563ff] hover:bg-[#4452ee]"
              onClick={handleFinish}
              disabled={isSubmitting}
            >
              {isSubmitting ? t("actions.finishing") : t("actions.finishShort")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                    */
/* ------------------------------------------------------------------ */

export function BreakdownHistoryDocumentClient(props: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [config, setConfig] = useState(() =>
    normalizeBreakdownHistoryDocumentConfig(props.config)
  );
  const { t, locale, latest } = useBreakdownCopy();
  const [title, setTitle] = useState(props.title);
  const [dateFrom, setDateFrom] = useState(props.dateFrom);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [rowDialogOpen, setRowDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<BreakdownRow | null>(null);
  const { mobileView, switchMobileView } = useMobileView("breakdown_history");
  const rows = useMemo(() => config.rows, [config.rows]);
  const directory = useMemo(
    () => props.equipmentDirectory ?? [],
    [props.equipmentDirectory]
  );
  /** Имя: у связанных — из справочника, у остальных — сохранённое. */
  const rowName = (row: BreakdownRow) =>
    resolveEquipmentRowName(row, directory);
  const allSelected = rows.length > 0 && selectedRowIds.length === rows.length;
  const isActive = props.status === "active";

  const cardItems: RecordCardItem[] = rows.map((row, index) => ({
    id: row.id,
    title: t("cards.title", { number: index + 1, date: breakdownDate(row.startDate, locale), time: breakdownTime(row.startHour, row.startMinute) }),
    subtitle: rowName(row) || "—",
    leading: (
      <Checkbox
        aria-label={t("actions.selectRow", { number: index + 1 })}
        checked={selectedRowIds.includes(row.id)}
        onCheckedChange={(checked) =>
          setSelectedRowIds((current) =>
            checked === true
              ? [...new Set([...current, row.id])]
              : current.filter((item) => item !== row.id)
          )
        }
        disabled={!isActive}
        className="size-5"
      />
    ),
    fields: [
      { label: t("columns.description"), value: row.breakdownDescription, hideIfEmpty: true },
      { label: t("columns.repair"), value: row.repairPerformed, hideIfEmpty: true },
      { label: t("cards.parts"), value: row.partsReplaced, hideIfEmpty: true },
      // Пустое окончание — «ремонт идёт», а не «закончен 00:00».
      { label: t("cards.end"), value: breakdownEnd(row, locale), hideIfEmpty: true },
      { label: t("columns.downtime"), value: row.downtimeHours, hideIfEmpty: true },
      { label: t("cards.responsible"), value: row.responsiblePerson, hideIfEmpty: true },
    ],
    onClick: isActive
      ? () => {
          setEditingRow(row);
          setRowDialogOpen(true);
        }
      : undefined,
    actions: isActive ? (
      <button
        type="button"
        onClick={() => {
          setEditingRow(row);
          setRowDialogOpen(true);
        }}
        className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#5563ff] px-4 text-[14px] font-medium text-white hover:bg-[#4452ee]"
      >
        {t("actions.edit")}</button>
    ) : null,
  }));

  /* Persist helper */
  async function persist(
    nextTitle: string,
    nextDateFrom: string,
    nextConfig: BreakdownHistoryDocumentConfig
  ) {
    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: nextTitle,
        dateFrom: nextDateFrom,
        config: nextConfig,
      }),
    });
    await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error("BREAKDOWN_SAVE_FAILED");
    }
    setTitle(nextTitle);
    setDateFrom(nextDateFrom);
    setConfig(nextConfig);
    startTransition(() => router.refresh());
  }

  /**
   * Запись строк шлёт ТОЛЬКО `config`: `title`/`dateFrom` — поля шапки,
   * они management-only, и у рядового сотрудника такой PATCH падал 403.
   */
  async function persistConfig(nextConfig: BreakdownHistoryDocumentConfig) {
    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: nextConfig }),
    });
    await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error("BREAKDOWN_SAVE_FAILED");
    }
    setConfig(nextConfig);
    startTransition(() => router.refresh());
  }

  /** Правка выделенных строк по очереди — тем же окном. */
  const seq = useSequentialEdit({
    open: (id) => {
      const row = config.rows.find((item) => item.id === id);
      if (!row || !isActive) return false;
      setEditingRow(row);
      setRowDialogOpen(true);
      return true;
    },
    close: () => {
      setRowDialogOpen(false);
      setEditingRow(null);
    },
  });

  async function handleSaveRow(row: BreakdownRow) {
    const editingId = editingRow?.id ?? null;
    await persistConfig({
      ...config,
      rows: config.rows.some((item) => item.id === editingId)
        ? config.rows.map((item) => (item.id === editingId ? row : item))
        : [...config.rows, row],
    });
    if (editingId) {
      // Очередь правок откроет следующую строку или закроет окно.
      seq.saved();
      return;
    }
    setEditingRow(null);
    setRowDialogOpen(false);
  }

  async function handleDeleteSelected() {
    if (selectedRowIds.length === 0) return;
    const count = selectedRowIds.length;
    if (!(await confirmAsync({ locale, title: t("delete.rowsTitle"), description: t("delete.description", { count }), variant: "danger", confirmLabel: t("actions.delete") }))) return;
    try {
      await persistConfig({
        ...config,
        rows: config.rows.filter((row) => !selectedRowIds.includes(row.id)),
      });
      setSelectedRowIds([]);
      toast.success(latest.current.t("delete.success", { count }));
    } catch {
      toast.error(latest.current.t("errors.deleteRows"));
    }
  }

  async function handleSaveSettings(params: { title: string; dateFrom: string }) {
    await persist(params.title, params.dateFrom, config);
  }

  return (
    <div className="bg-white text-black">
      {selectedRowIds.length > 0 && isActive ? (
        <JournalSelectionBar
          count={selectedRowIds.length}
          onClear={() => setSelectedRowIds([])}
          onDelete={() => {
            handleDeleteSelected().catch(() =>
              toast.error(
                latest.current.t("errors.deleteRows")
              )
            );
          }}
          hint={t("delete.hint")}
        >
          <SelectionEditButton count={selectedRowIds.length} onClick={() => seq.start(selectedRowIds)} />
        </JournalSelectionBar>
      ) : null}

      <div className="space-y-6 py-4 sm:py-6">
        {/* Скроллер из ?focus=today: для event-driven журнала
           «история поломок» нет «сегодня» — поэтому селектор —
           самая свежая запись, либо если записей нет — пустой
           dialog с подсказкой добавить новую. */}
        <FocusTodayScroller
          selector="[data-focus-today]"
          createLabel={t("empty.add")}
          emptyTitle={t("empty.title")}
          emptyBody={t("empty.body")}
        />
        <JournalDocumentShell
          title={breakdownTitle(title, dateFrom, locale, t)}
          subtitle={t("started", { date: breakdownDate(dateFrom, locale) })}
          documentId={props.documentId}
          backHref="/journals/breakdown_history"
          onSettings={() => setSettingsOpen(true)}
          closed={!isActive}
          closedHint={t("finish.closedHint")}
          menuItems={
            isActive
              ? [
                  {
                    key: "close-journal",
                    label: t("actions.finish"),
                    icon: <Archive className="size-4" />,
                    onSelect: () => setFinishOpen(true),
                  },
                ]
              : []
          }
          mobileView={mobileView}
          onMobileView={switchMobileView}
          cards={
            <RecordCardsView items={cardItems} emptyLabel={t("empty.cards")} />
          }
          paperHeader={
            <JournalDocumentHeader
              orgName={props.organizationName || t("organization")}
              title={t("title")}
              startedAt={dateFrom}
              finishedAt={isActive ? null : new Date()}
            />
          }
          sheetTitle={t("title")}
          sheetMinWidth={1600}
          toolbar={
            isActive ? (
              <Button
                type="button"
                className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] hover:bg-[#4452ee]"
                onClick={() => {
                  setEditingRow(null);
                  setRowDialogOpen(true);
                }}
              >
                <Plus className="size-5" />
                {t("actions.add")}</Button>
            ) : undefined
          }
        >
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`w-[44px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                  <Checkbox
                    aria-label={t("actions.selectAll")}
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelectedRowIds(
                        checked === true ? rows.map((r) => r.id) : []
                      )
                    }
                    disabled={rows.length === 0 || !isActive}
                  />
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>{t("columns.startTime")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>{t("columns.equipment")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>{t("columns.description")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>{t("columns.repair")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                  {t("columns.parts")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>{t("columns.endTime")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>{t("columns.downtime")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                  {t("columns.responsible")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={row.id}
                  // Самая свежая запись (последняя в массиве) — целевая
                  // для «Перейти к сегодня»/?focus=today, т.к. журнал
                  // event-driven, у него нет «сегодня».
                  data-focus-today={idx === rows.length - 1 ? "" : undefined}
                  className={isActive ? "cursor-pointer hover:bg-[#f5f6ff]" : undefined}
                  onClick={() => {
                    if (!isActive) return;
                    setEditingRow(row);
                    setRowDialogOpen(true);
                  }}
                >
                  <td
                    className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      aria-label={t("actions.selectRow", { number: idx + 1 })}
                      checked={selectedRowIds.includes(row.id)}
                      onCheckedChange={(checked) =>
                        setSelectedRowIds((current) =>
                          checked === true
                            ? [...new Set([...current, row.id])]
                            : current.filter((item) => item !== row.id)
                        )
                      }
                      disabled={!isActive}
                    />
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                    <button
                      type="button"
                      className="text-left hover:text-[#5563ff]"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isActive) return;
                        setEditingRow(row);
                        setRowDialogOpen(true);
                      }}
                    >
                      {breakdownDate(row.startDate, locale)}{" "}
                      {breakdownTime(row.startHour, row.startMinute)}
                    </button>
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                    {rowName(row) || "—"}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                    {row.breakdownDescription || "—"}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                    {row.repairPerformed || "—"}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                    {row.partsReplaced || "—"}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                    {breakdownEnd(row, locale) || "—"}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                    {row.downtimeHours || "—"}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                    {row.responsiblePerson || "—"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className={`${GRID_CELL_CLASS} px-2 py-6 text-center text-[#80849a]`}
                  >
                    {t("empty.rows")}</td>
                </tr>
              )}

              {/* Кликабельная пустая строка — то же окно, что и кнопка
                  «Добавить» в StickyActionBar над таблицей. leading=1
                  (чекбокс), labelSpan=2 — подпись растянута на «Дата и
                  время начала работ» + «Наименование оборудования»: вместе
                  они опознают поломку (когда и что сломалось), остальные
                  6 колонок (описание, ремонт, замена частей, дата
                  окончания, часы простоя, ответственный) — данные,
                  которые появятся только после заполнения (trailing=6).
                  Сумма 1+2+6=9 — тот же colSpan, что был раньше. */}
              {isActive ? (
                <JournalAddRow
                  leading={1}
                  labelSpan={2}
                  trailing={6}
                  label={t("empty.add")}
                  onClick={() => {
                    setEditingRow(null);
                    setRowDialogOpen(true);
                  }}
                />
              ) : null}
            </tbody>
          </table>
        </JournalDocumentShell>
      </div>

      {/* Dialogs */}
      {settingsOpen && (
        <SettingsDialog
          key={`${title}:${dateFrom}`}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title={title}
          dateFrom={dateFrom}
          onSave={handleSaveSettings}
          useV2={props.useV2}
        />
      )}

      {rowDialogOpen && (
        <RowDialog
          key={editingRow?.id || "new-breakdown-row"}
          open={rowDialogOpen}
          onOpenChange={(open) => {
            if (open) {
              setRowDialogOpen(true);
              return;
            }
            // Закрытие без сохранения прерывает очередь («Изменено k из N»).
            seq.cancelled();
          }}
          initialRow={editingRow}
          titleSuffix={seq.progress ?? undefined}
          onSave={handleSaveRow}
          documentId={props.documentId}
          directory={directory}
        />
      )}

      <FinishDialog
        open={finishOpen}
        onOpenChange={setFinishOpen}
        title={breakdownTitle(title, dateFrom, locale, t)}
        documentId={props.documentId}
        onFinished={() => startTransition(() => router.refresh())}
      />
    </div>
  );
}
