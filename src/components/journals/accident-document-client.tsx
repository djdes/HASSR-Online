"use client";

import { useAccidentCopy } from "./use-accident-copy";
import { accidentDate, accidentDateTime, accidentTitle } from "./accident-presentation";

import { useEffect, useMemo, useState, useTransition } from "react";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import {
  Archive,
  CalendarDays,
  Plus,
  X,
} from "lucide-react";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  TimeField,
  joinTimeValue,
  splitTimeValue,
} from "@/components/journals/time-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ACCIDENT_DOCUMENT_TITLE,
  createAccidentRow,
  normalizeAccidentDocumentConfig,
  type AccidentDocumentConfig,
  type AccidentRow,
} from "@/lib/accident-document";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { GRID_CELL_CLASS, GRID_HEAD_CELL_CLASS } from "@/components/journals/journal-grid";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import { localDayKey } from "@/lib/entry-defaults";


type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  dateFrom: string;
  status: string;
  config: unknown;
  /** Design v2 toggle. */
  useV2?: boolean;
};

function RowDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  initialRow: AccidentRow | null;
  /** «(k из N)» при правке выделенных строк по очереди. */
  titleSuffix?: string;
  onSave: (row: AccidentRow) => Promise<void>;
}) {
  const { t, latest } = useAccidentCopy();
  const [row, setRow] = useState<AccidentRow>(() => createAccidentRow());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setRow(props.initialRow || createAccidentRow());
  }, [props.initialRow, props.open]);

  function setValue<K extends keyof AccidentRow>(key: K, value: AccidentRow[K]) {
    setRow((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    setSubmitting(true);
    try {
      // Окно закрывает родитель: при правке по очереди он откроет следующую строку.
      await props.onSave(row);
    } catch {
      // Без catch ошибка сохранения глохла: окно висело, тоста не было.
      toast.error(latest.current.t("errors.row"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[28px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-[30px] font-medium text-black">
              {props.initialRow ? (props.titleSuffix ? t("row.editProgress", { progress: props.titleSuffix }) : t("row.edit")) : t("row.add")}
            </DialogTitle>
            <button
              type="button"
              aria-label={t("actions.close")}
              className="rounded-xl p-2 text-[#101425]"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-5 px-8 py-6">
          <fieldset className="space-y-3 rounded-[18px] border border-[#e5e8f2] p-4">
            <legend className="px-1 text-base font-medium">{t("columns.accidentTime")}</legend>
            <div className="relative">
              <Input
                type="date"
                aria-label={t("columns.accidentTime")}
                value={row.accidentDate}
                onChange={(event) => setValue("accidentDate", event.target.value)}
                className="h-9 rounded-xl border-[#d7dbea] pr-12"
              />
              <CalendarDays className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-[#6e7387]" />
            </div>
            {/* Одно поле времени вместо двух выпадающих списков «часы» и
                «минуты» — четыре касания на аварию превращались в два
                открытия списка на каждое время. */}
            <TimeField
              label={t("columns.accidentTime")}
              value={joinTimeValue(row.accidentHour, row.accidentMinute)}
              onChange={(next) => {
                const { hour, minute } = splitTimeValue(next);
                setValue("accidentHour", hour);
                setValue("accidentMinute", minute);
              }}
            />
          </fieldset>

          <Input
            value={row.locationName}
            onChange={(event) => setValue("locationName", event.target.value)}
            className="h-9 rounded-xl border-[#d7dbea]"
            placeholder={t("row.locationPlaceholder")}
          />

          <div className="space-y-2">
            <Label className="text-base font-medium text-black">
              {t("columns.description")}</Label>
            <Textarea
              value={row.accidentDescription}
              onChange={(event) => setValue("accidentDescription", event.target.value)}
              className="min-h-32 rounded-2xl border-[#d7dbea]"
              placeholder={t("row.descriptionPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-base font-medium text-black">
              {t("columns.products")}</Label>
            <Textarea
              value={row.affectedProducts}
              onChange={(event) => setValue("affectedProducts", event.target.value)}
              className="min-h-32 rounded-2xl border-[#d7dbea]"
              placeholder={t("row.productsPlaceholder")}
            />
          </div>

          <fieldset className="space-y-3 rounded-[18px] border border-[#e5e8f2] p-4">
            <legend className="px-1 text-base font-medium">{t("row.resolvedTime")}</legend>
            <div className="relative">
              <Input
                type="date"
                aria-label={t("row.resolvedTime")}
                value={row.resolvedDate}
                onChange={(event) => setValue("resolvedDate", event.target.value)}
                className="h-9 rounded-xl border-[#d7dbea] pr-12"
              />
              <CalendarDays className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-[#6e7387]" />
            </div>
            {/* Одно поле времени вместо двух выпадающих списков «часы» и
                «минуты» — четыре касания на аварию превращались в два
                открытия списка на каждое время. */}
            <TimeField
              label={t("row.resolvedTime")}
              value={joinTimeValue(row.resolvedHour, row.resolvedMinute)}
              onChange={(next) => {
                const { hour, minute } = splitTimeValue(next);
                setValue("resolvedHour", hour);
                setValue("resolvedMinute", minute);
              }}
            />
          </fieldset>

          <div className="space-y-2">
            <Label className="text-base font-medium text-black">
              {t("columns.people")}</Label>
            <Textarea
              value={row.responsiblePeople}
              onChange={(event) => setValue("responsiblePeople", event.target.value)}
              className="min-h-28 rounded-2xl border-[#d7dbea]"
              placeholder={t("row.peoplePlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-base font-medium text-black">
              {t("columns.actions")}</Label>
            <Textarea
              value={row.correctiveActions}
              onChange={(event) => setValue("correctiveActions", event.target.value)}
              className="min-h-32 rounded-2xl border-[#d7dbea]"
              placeholder={t("row.actionsPlaceholder")}
            />
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="h-9 rounded-xl bg-[#5563ff] px-8 text-[13.5px] text-white hover:bg-[#4452ee]"
            >
              {submitting
                ? t("actions.saving")
                : props.initialRow
                  ? t("actions.save")
                  : t("actions.add")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  dateFrom: string;
  onSave: (payload: { title: string; dateFrom: string }) => Promise<void>;
  useV2?: boolean;
}) {
  const { t, locale, latest } = useAccidentCopy();
  const [title, setTitle] = useState(props.title);
  const [dateFrom, setDateFrom] = useState(props.dateFrom);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setTitle(props.title);
    setDateFrom(props.dateFrom);
  }, [props.dateFrom, props.open, props.title]);

  async function handleSave() {
    setSubmitting(true);
    try {
      await props.onSave({ title: title.trim(), dateFrom });
      props.onOpenChange(false);
    } catch {
      toast.error(latest.current.t("errors.settings"));
    } finally {
      setSubmitting(false);
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
        isSaving={submitting}
        onSave={handleSave}
        onCancel={() => props.onOpenChange(false)}
      >
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("settings.name")}</Label>
          <Input
            value={accidentTitle(title, dateFrom, locale, t)}
            onChange={(event) => setTitle(event.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("settings.start")}</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
          />
        </div>
      </JournalSettingsModal>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-[30px] font-medium text-black">
              {t("settings.title")}</DialogTitle>
            <button
              type="button"
              aria-label={t("actions.close")}
              className="rounded-xl p-2 text-[#101425]"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-5 px-8 py-6">
          <div className="space-y-2">
            <Label className="text-base text-[#6e7387]">{t("settings.name")}</Label>
            <Input
              value={accidentTitle(title, dateFrom, locale, t)}
              onChange={(event) => setTitle(event.target.value)}
              className="h-9 rounded-xl border-[#d7dbea]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-base text-[#6e7387]">{t("settings.start")}</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-9 rounded-xl border-[#d7dbea]"
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="h-9 rounded-xl bg-[#5563ff] px-8 text-[13.5px] text-white hover:bg-[#4452ee]"
            >
              {submitting ? t("actions.saving") : t("actions.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FinishDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  documentId: string;
  config: AccidentDocumentConfig;
  onFinished: () => void;
}) {
  const { t, latest } = useAccidentCopy();
  const [submitting, setSubmitting] = useState(false);

  async function handleFinish() {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/journal-documents/${props.documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Дату закрытия штампуем в конфиг тем же запросом: закрытый
        // документ править уже нельзя, а в шапке нужна реальная дата.
        body: JSON.stringify({
          status: "closed",
          config: { ...props.config, finishedAt: localDayKey() },
        }),
      });

      if (!response.ok) {
        throw new Error("ACCIDENT_CLOSE_FAILED");
      }

      props.onFinished();
      props.onOpenChange(false);
    } catch {
      toast.error(latest.current.t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-[30px] font-medium text-black">
              {t("finish.title", { title: props.title })}
            </DialogTitle>
            <button
              type="button"
              aria-label={t("actions.close")}
              className="rounded-xl p-2 text-[#101425]"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-5 px-8 py-6">
          <p className="text-sm text-[#6e7387]">
            {t("finish.description")}</p>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleFinish}
              disabled={submitting}
              className="h-9 rounded-xl bg-[#5563ff] px-8 text-[13.5px] text-white hover:bg-[#4452ee]"
            >
              {submitting ? t("actions.finishing") : t("actions.finish")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AccidentDocumentClient(props: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [config, setConfig] = useState(() =>
    normalizeAccidentDocumentConfig(props.config)
  );
  const { t, locale, latest } = useAccidentCopy();
  const [title, setTitle] = useState(props.title);
  const [dateFrom, setDateFrom] = useState(props.dateFrom);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [rowDialogOpen, setRowDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<AccidentRow | null>(null);

  const rows = useMemo(() => config.rows, [config.rows]);
  const isActive = props.status === "active";
  const allSelected = rows.length > 0 && selectedRowIds.length === rows.length;
  const { mobileView, switchMobileView } = useMobileView("accident_journal");

  const cardItems: RecordCardItem[] = rows.map((row, index) => ({
    id: row.id,
    title: `№${index + 1} · ${accidentDateTime(row.accidentDate, row.accidentHour, row.accidentMinute, locale).replace("\n", " ")}`,
    subtitle: row.locationName || "—",
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
      { label: t("row.descriptionPlaceholder"), value: row.accidentDescription, hideIfEmpty: true },
      { label: t("cards.products"), value: row.affectedProducts, hideIfEmpty: true },
      {
        label: t("cards.resolved"),
        value: accidentDateTime(row.resolvedDate, row.resolvedHour, row.resolvedMinute, locale).replace(
          "\n",
          " "
        ),
      },
      { label: t("cards.people"), value: row.responsiblePeople, hideIfEmpty: true },
      { label: t("cards.actions"), value: row.correctiveActions, hideIfEmpty: true },
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

  async function persist(
    nextTitle: string,
    nextDateFrom: string,
    nextConfig: AccidentDocumentConfig
  ) {
    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: nextTitle,
        dateFrom: nextDateFrom,
        dateTo: nextDateFrom,
        config: nextConfig,
      }),
    });
    await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error("ACCIDENT_SAVE_FAILED");
    }
    setTitle(nextTitle);
    setDateFrom(nextDateFrom);
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

  async function handleSaveRow(row: AccidentRow) {
    const nextRows = editingRow
      ? config.rows.map((item) => (item.id === editingRow.id ? row : item))
      : [...config.rows, row];
    await persist(title, dateFrom, { ...config, rows: nextRows });
    if (editingRow) {
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
      await persist(title, dateFrom, {
        ...config,
        rows: config.rows.filter((row) => !selectedRowIds.includes(row.id)),
      });
      setSelectedRowIds([]);
      toast.success(latest.current.t("delete.success", { count }));
    } catch {
      toast.error(latest.current.t("errors.deleteRows"));
    }
  }

  async function handleSaveSettings(payload: { title: string; dateFrom: string }) {
    await persist(payload.title || ACCIDENT_DOCUMENT_TITLE, payload.dateFrom, config);
  }

  return (
    <div className="bg-white text-black">
      {selectedRowIds.length > 0 ? (
        <JournalSelectionBar
          count={selectedRowIds.length}
          onClear={() => setSelectedRowIds([])}
          onDelete={() => {
            handleDeleteSelected().catch(() =>
              toast.error(latest.current.t("errors.generic"))
            );
          }}
          hint={t("delete.hint")}
        >
          <SelectionEditButton count={selectedRowIds.length} disabled={!isActive} onClick={() => seq.start(selectedRowIds)} />
        </JournalSelectionBar>
      ) : null}

      <div className="space-y-8 py-4 sm:py-6">
        <FocusTodayScroller selector="[data-focus-today]" emptyTitle={t("empty.title")} emptyBody={t("empty.body")} />

        <JournalDocumentShell
          title={accidentTitle(title, dateFrom, locale, t)}
          subtitle={t("started", { date: accidentDate(dateFrom, locale) })}
          documentId={props.documentId}
          backHref="/journals/accident_journal"
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
              finishedAt={isActive ? null : config.finishedAt || dateFrom}
            />
          }
          sheetTitle={t("title")}
          sheetMinWidth={1650}
          toolbar={
            isActive ? (
              <Button
                type="button"
                className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4452ee]"
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
                      setSelectedRowIds(checked === true ? rows.map((row) => row.id) : [])
                    }
                    disabled={!isActive || rows.length === 0}
                  />
                </th>
                <th className={`w-[72px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>{t("columns.number")}</th>
                <th className={`w-[150px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {t("columns.accidentTime")}</th>
                <th className={`w-[210px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {t("columns.location")}</th>
                <th className={`w-[300px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {t("columns.description")}</th>
                <th className={`w-[280px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {t("columns.products")}</th>
                <th className={`w-[180px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {t("columns.resolvedTime")}</th>
                <th className={`w-[210px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {t("columns.people")}</th>
                <th className={`w-[320px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {t("columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.id}
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
                    />
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{index + 1}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight whitespace-pre-line`}>
                    <button
                      type="button"
                      className="w-full text-center hover:text-[#5563ff]"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isActive) return;
                        setEditingRow(row);
                        setRowDialogOpen(true);
                      }}
                    >
                      {accidentDateTime(row.accidentDate, row.accidentHour, row.accidentMinute, locale)}
                    </button>
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.locationName}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.accidentDescription}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.affectedProducts}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight whitespace-pre-line`}>
                    {accidentDateTime(row.resolvedDate, row.resolvedHour, row.resolvedMinute, locale)}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.responsiblePeople}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.correctiveActions}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className={`${GRID_CELL_CLASS} px-2 py-6 text-center text-[#80849a]`}>
                    {t("empty.rows")}</td>
                </tr>
              ) : null}
              {isActive ? (
                <JournalAddRow
                  // Галочка + № п/п — leading, подпись растянута на «Дата и
                  // время аварии» + «Наименование помещения», остальные
                  // 5 колонок остаются пустыми ячейками.
                  leading={2}
                  labelSpan={2}
                  trailing={5}
                  label={t("actions.add")}
                  onClick={() => {
                    setEditingRow(null);
                    setRowDialogOpen(true);
                  }}
                />
              ) : null}
              {/* Пустая строка бланка — раньше висела на экране всегда и
                  выглядела как ещё одна (нерабочая) строка таблицы. Теперь
                  единственная пустая строка на экране — кликабельная
                  JournalAddRow выше, а эта остаётся только для печати. */}
              <tr className="hidden print:table-row">
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                  <Checkbox checked={false} disabled />
                </td>
                <td colSpan={8} className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`} />
              </tr>
            </tbody>
          </table>
        </JournalDocumentShell>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={title}
        dateFrom={dateFrom}
        onSave={handleSaveSettings}
        useV2={props.useV2}
      />

      <RowDialog
        open={rowDialogOpen}
        onOpenChange={(value) => {
          if (value) {
            setRowDialogOpen(true);
            return;
          }
          // Закрытие без сохранения прерывает очередь («Изменено k из N»).
          seq.cancelled();
        }}
        initialRow={editingRow}
        titleSuffix={seq.progress ?? undefined}
        onSave={handleSaveRow}
      />

      <FinishDialog
        open={finishOpen}
        onOpenChange={setFinishOpen}
        title={accidentTitle(title, dateFrom, locale, t)}
        documentId={props.documentId}
        config={config}
        onFinished={() => startTransition(() => router.refresh())}
      />
    </div>
  );
}
