"use client";

import { useComplaintCopy } from "./use-complaint-copy";
import { complaintDate, complaintTitle, complaintReceipt, complaintDecision } from "./complaint-presentation";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Archive, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DOC_PRIMARY_BUTTON_CLASS } from "@/components/journals/journal-responsive";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { GRID_CELL_CLASS, GRID_HEAD_CELL_CLASS } from "@/components/journals/journal-grid";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  buildComplaintRow,
  COMPLAINT_RECEIPT_OPTIONS,
  COMPLAINT_REGISTER_TEMPLATE_CODE,
  COMPLAINT_REGISTER_TITLE,
  normalizeComplaintConfig,
  type ComplaintDocumentConfig,
} from "@/lib/complaint-document";
import {
  type RegisterDocumentConfig,
  type RegisterDocumentRow,
} from "@/lib/register-document";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import { localDayKey } from "@/lib/entry-defaults";
import { resolveJournalPeriodForDate } from "@/lib/journal-period";
import { confirmDateInPeriod } from "@/components/journals/confirm-date-in-period";
type EmployeeItem = {
  id: string;
  name: string;
  role: string;
};

type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  dateFrom: string;
  /** Конец периода документа — для предупреждения «дата вне периода». */
  dateTo?: string;
  status: string;
  initialConfig: RegisterDocumentConfig;
  users: EmployeeItem[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

function ComplaintRowDialog({
  open,
  onOpenChange,
  row,
  titleSuffix,
  period,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: RegisterDocumentRow | null;
  /** Период документа: дата поступления вне его — предупреждаем. */
  period: { dateFrom: string; dateTo: string };
  /** «(k из N)» при правке выделенных строк по очереди. */
  titleSuffix?: string;
  onSave: (row: RegisterDocumentRow) => Promise<void>;
}) {
  const { t, locale, latest } = useComplaintCopy();
  const periodT = useTranslations("journalControls.dateInPeriod");
  const today = localDayKey();
  const [draft, setDraft] = useState<RegisterDocumentRow>(() =>
    buildComplaintRow({ receiptDate: today, decisionDate: today })
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(
      row ||
        buildComplaintRow({
          receiptDate: today,
          decisionDate: today,
        })
    );
  }, [open, row, today]);

  function setValue(key: string, value: string) {
    setDraft((current) => ({
      ...current,
      values: {
        ...current.values,
        [key]: value,
      },
    }));
  }

  async function handleSave() {
    // Дата вне периода не запрещена, но молча уезжала в чужой бланк
    // (жалоба за 21.09.2026 — в документ на 2027 год). Спрашиваем.
    if (!(await confirmDateInPeriod(draft.values.receiptDate, period, { locale, t: periodT }))) return;
    setSubmitting(true);
    try {
      // Окно закрывает родитель: при правке по очереди он откроет следующую строку.
      await onSave(draft);
    } catch {
      toast.error(latest.current.t("errors.row"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
        <DialogClose className="absolute right-4 top-4 rounded-full p-2" aria-label={t("actions.close")}><X className="size-5" /></DialogClose>
        <DialogHeader className="border-b px-12 py-10">
          <DialogTitle className="text-[22px] font-medium text-black">
            {row ? titleSuffix ? t("row.editProgress", { progress: titleSuffix }) : t("row.edit") : t("row.add")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6 px-12 py-10">
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">{t("fields.receiptDate")}</Label>
            <Input
              type="date"
              aria-label={t("fields.receiptDate")}
              value={draft.values.receiptDate || ""}
              onChange={(event) => setValue("receiptDate", event.target.value)}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            {/* Подпись была только для скринридера, и поле стояло без
                заголовка — в отличие от соседних. */}
            <Label className="text-[14px] text-[#73738a]">{t("fields.applicantName")}</Label>
            <Input
              aria-label={t("fields.applicantName")}
              value={draft.values.applicantName || ""}
              onChange={(event) => setValue("applicantName", event.target.value)}
              placeholder={t("row.applicantPlaceholder")}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">{t("fields.complaintReceiptForm")}</Label>
            <Select
              value={draft.values.complaintReceiptForm || ""}
              onValueChange={(value) => setValue("complaintReceiptForm", value)}
            >
              <SelectTrigger aria-label={t("fields.complaintReceiptForm")} className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                <SelectValue placeholder={t("row.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {draft.values.complaintReceiptForm && !COMPLAINT_RECEIPT_OPTIONS.some(option => option.value === draft.values.complaintReceiptForm) ? <SelectItem value={draft.values.complaintReceiptForm}>{draft.values.complaintReceiptForm}</SelectItem> : null}
                {COMPLAINT_RECEIPT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {complaintReceipt(option.value, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">{t("fields.applicantDetails")}</Label>
            <Textarea
              aria-label={t("fields.applicantDetails")}
              value={draft.values.applicantDetails || ""}
              onChange={(event) => setValue("applicantDetails", event.target.value)}
              className="min-h-[160px] rounded-[18px] border-[#dfe1ec] px-6 py-4 text-[18px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">{t("fields.complaintContent")}</Label>
            <Textarea
              aria-label={t("fields.complaintContent")}
              value={draft.values.complaintContent || ""}
              onChange={(event) => setValue("complaintContent", event.target.value)}
              className="min-h-[160px] rounded-[18px] border-[#dfe1ec] px-6 py-4 text-[18px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">{t("fields.decisionDate")}</Label>
            <Input
              type="date"
              aria-label={t("fields.decisionDate")}
              value={draft.values.decisionDate || ""}
              onChange={(event) => setValue("decisionDate", event.target.value)}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">{t("fields.decisionSummary")}</Label>
            <Textarea
              aria-label={t("fields.decisionSummary")}
              value={draft.values.decisionSummary || ""}
              onChange={(event) => setValue("decisionSummary", event.target.value)}
              className="min-h-[160px] rounded-[18px] border-[#dfe1ec] px-6 py-4 text-[18px]"
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]"
            >
              {submitting ? t("actions.saving") : row ? t("actions.save") : t("actions.add")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
  title,
  dateFrom,
  onSave,
  useV2 = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  dateFrom: string;
  onSave: (params: { title: string; dateFrom: string }) => Promise<void>;
  useV2?: boolean;
}) {
  const { t, locale, latest } = useComplaintCopy();
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftDate, setDraftDate] = useState(dateFrom);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraftTitle(title);
    setDraftDate(dateFrom);
  }, [dateFrom, open, title]);

  async function handleSave() {
    setSubmitting(true);
    try {
      await onSave({ title: draftTitle, dateFrom: draftDate });
      onOpenChange(false);
    } catch {
      toast.error(latest.current.t("errors.settings"));
    } finally {
      setSubmitting(false);
    }
  }

  if (useV2) {
    return (
      <JournalSettingsModal
        open={open}
        onOpenChange={onOpenChange}
        title={t("settings.title")}
        description={t("settings.description")}
        size="md"
        isSaving={submitting}
        onSave={handleSave}
        onCancel={() => onOpenChange(false)}
      >
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("settings.name")}</Label>
          <Input
            aria-label={t("settings.name")}
            value={complaintTitle(draftTitle, draftDate, locale, t)}
            onChange={(event) => setDraftTitle(event.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("settings.start")}</Label>
          <Input
            type="date"
            aria-label={t("settings.start")}
            value={draftDate}
            onChange={(event) => setDraftDate(event.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
          />
        </div>
      </JournalSettingsModal>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
        <DialogClose className="absolute right-4 top-4 rounded-full p-2" aria-label={t("actions.close")}><X className="size-5" /></DialogClose>
        <DialogHeader className="border-b px-14 py-12">
          <DialogTitle className="text-[22px] font-medium text-black">
            {t("settings.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-8 px-14 py-12">
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">{t("settings.name")}</Label>
            <Input
              aria-label={t("settings.name")}
            value={complaintTitle(draftTitle, draftDate, locale, t)}
              onChange={(event) => setDraftTitle(event.target.value)}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">{t("settings.start")}</Label>
            <Input
              type="date"
              aria-label={t("settings.start")}
            value={draftDate}
              onChange={(event) => setDraftDate(event.target.value)}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]"
            >
              {submitting ? t("actions.saving") : t("actions.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FinishDialog({
  open,
  onOpenChange,
  title,
  onFinish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onFinish: () => Promise<void>;
}) {
  const { t, latest } = useComplaintCopy();
  const [submitting, setSubmitting] = useState(false);

  async function handleFinish() {
    setSubmitting(true);
    try {
      await onFinish();
      onOpenChange(false);
    } catch {
      toast.error(latest.current.t("errors.finish"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
        <DialogClose className="absolute right-4 top-4 rounded-full p-2" aria-label={t("actions.close")}><X className="size-5" /></DialogClose>
        <DialogHeader className="border-b px-14 py-10">
          <DialogTitle className="pr-14 text-[22px] font-medium leading-[1.15] text-black">
            {t("finish.title", { title })}
          </DialogTitle>
        </DialogHeader>
        <div className="flex justify-end px-14 py-12">
          <Button
            type="button"
            onClick={handleFinish}
            disabled={submitting}
            className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]"
          >
            {submitting ? t("actions.finishing") : t("actions.finishShort")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ComplaintDocumentClient({
  documentId,
  title,
  organizationName,
  dateFrom,
  dateTo,
  status,
  initialConfig,
  useV2 = false,
}: Props) {
  const { t, locale, latest } = useComplaintCopy();
  // Период документа для предупреждения «дата вне периода». Конец —
  // из документа, а если его не передали — по правилу журнала (годовой).
  const documentPeriod = useMemo(
    () =>
      dateTo
        ? { dateFrom, dateTo }
        : resolveJournalPeriodForDate(COMPLAINT_REGISTER_TEMPLATE_CODE, dateFrom),
    [dateFrom, dateTo]
  );
  const router = useRouter();
  const [config, setConfig] = useState(() => normalizeComplaintConfig(initialConfig));
  const [documentTitle, setDocumentTitle] = useState(title || COMPLAINT_REGISTER_TITLE);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [rowDialogOpen, setRowDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<RegisterDocumentRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setConfig(normalizeComplaintConfig(initialConfig));
  }, [initialConfig]);

  useEffect(() => {
    setDocumentTitle(title || COMPLAINT_REGISTER_TITLE);
  }, [title]);

  const allSelected =
    config.rows.length > 0 && selectedRowIds.length === config.rows.length;
  const { mobileView, switchMobileView } = useMobileView("complaint_register");

  const cardItems: RecordCardItem[] = config.rows.map((row, index) => ({
    id: row.id,
    title: t("cards.title", { number: index + 1, name: row.values.applicantName || "—" }),
    // Общий формат карточек «дд.мм.гггг» (в бланке — через дефис).
    subtitle: complaintDate(row.values.receiptDate || "", locale) || undefined,
    leading: (
      <Checkbox
        aria-label={t("actions.selectRow", { number: index + 1 })}
        checked={selectedRowIds.includes(row.id)}
        onCheckedChange={(checked) =>
          setSelectedRowIds((current) =>
            checked === true
              ? [...new Set([...current, row.id])]
              : current.filter((id) => id !== row.id)
          )
        }
        disabled={status !== "active"}
        className="size-5"
      />
    ),
    fields: [
      { label: t("cards.receiptForm"), value: complaintReceipt(row.values.complaintReceiptForm || "", t), hideIfEmpty: true },
      { label: t("fields.applicantDetails"), value: row.values.applicantDetails, hideIfEmpty: true },
      { label: t("fields.complaintContent"), value: row.values.complaintContent, hideIfEmpty: true },
      { label: t("cards.decision"), value: complaintDecision(row, locale, t), hideIfEmpty: true },
    ],
    onClick: status === "active"
      ? () => {
          setEditingRow(row);
          setRowDialogOpen(true);
        }
      : undefined,
    actions: status === "active" ? (
      <button
        type="button"
        onClick={() => {
          setEditingRow(row);
          setRowDialogOpen(true);
        }}
        className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white hover:bg-[#4b57ff]"
      >
        {t("actions.edit")}</button>
    ) : null,
  }));

  async function persist(nextTitle: string, nextConfig: ComplaintDocumentConfig, patch?: Record<string, unknown>) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: nextTitle,
        config: nextConfig,
        ...patch,
      }),
    });

    await response.json().catch(() => null);
    if (!response.ok) throw new Error("COMPLAINT_SAVE_FAILED");

    setDocumentTitle(nextTitle);
    setConfig(nextConfig);
    startTransition(() => router.refresh());
  }

  /** Правка выделенных строк по очереди — тем же окном. */
  const seq = useSequentialEdit({
    open: (id) => {
      const row = config.rows.find((item) => item.id === id);
      if (!row || status !== "active") return false;
      setEditingRow(row);
      setRowDialogOpen(true);
      return true;
    },
    close: () => {
      setRowDialogOpen(false);
      setEditingRow(null);
    },
  });

  async function handleSaveRow(row: RegisterDocumentRow) {
    const nextRows = editingRow
      ? config.rows.map((item) => (item.id === editingRow.id ? row : item))
      : [...config.rows, row];

    await persist(documentTitle, {
      ...config,
      rows: nextRows,
    });
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
    const confirmed = await confirmAsync({
      locale,
      title: t("delete.rowsTitle"),
      description: t("delete.description"),
      variant: "danger",
      confirmLabel: t("actions.delete"),
      bullets: [
        { label: t("delete.count", { count }), tone: "warn" },
        { label: t("delete.remaining", { count: config.rows.length - count }), tone: "default" },
      ],
    });
    if (!confirmed) return;
    const nextConfig = {
      ...config,
      rows: config.rows.filter((row) => !selectedRowIds.includes(row.id)),
    };
    await persist(documentTitle, nextConfig);
    setSelectedRowIds([]);
    toast.success(latest.current.t("delete.success", { count }));
  }

  async function handleSaveSettings(params: { title: string; dateFrom: string }) {
    // Период — по правилу журнала (годовой), как при создании. Раньше
    // сохранение настроек сжимало документ до одного дня (dateTo = dateFrom),
    // и любая жалоба за другой день оказывалась «вне периода».
    await persist(
      params.title.trim() || COMPLAINT_REGISTER_TITLE,
      config,
      resolveJournalPeriodForDate(COMPLAINT_REGISTER_TEMPLATE_CODE, params.dateFrom)
    );
  }

  async function handleFinish() {
    await persist(
      documentTitle,
      {
        ...config,
        finishedAt: localDayKey(),
      },
      { status: "closed" }
    );
    router.push(`/journals/${COMPLAINT_REGISTER_TEMPLATE_CODE}?tab=closed`);
  }

  return (
    <>
      <div className="space-y-6 text-black">
        <FocusTodayScroller selector="[data-focus-today]" emptyTitle={t("empty.title")} emptyBody={t("empty.body")} />
        {selectedRowIds.length > 0 && status === "active" && (
          <JournalSelectionBar
            count={selectedRowIds.length}
            onClear={() => setSelectedRowIds([])}
            onDelete={() =>
              handleDeleteSelected().catch(() =>
                toast.error(latest.current.t("errors.deleteRows"))
              )
            }
            deleting={isPending}
            hint={t("delete.hint")}
          >
            <SelectionEditButton count={selectedRowIds.length} onClick={() => seq.start(selectedRowIds)} />
          </JournalSelectionBar>
        )}

        <JournalDocumentShell
          title={complaintTitle(documentTitle, dateFrom, locale, t)}
          subtitle={t("started", { date: complaintDate(dateFrom, locale) })}
          documentId={documentId}
          backHref={`/journals/${COMPLAINT_REGISTER_TEMPLATE_CODE}`}
          onSettings={() => setSettingsOpen(true)}
          closed={status !== "active"}
          closedHint={t("finish.closedHint")}
          menuItems={
            status === "active"
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
              orgName={organizationName}
              title={t("title")}
              startedAt={dateFrom}
              finishedAt={status === "closed" ? config.finishedAt : null}
            />
          }
          sheetTitle={t("title")}
          sheetMinWidth={1520}
          toolbar={
            status === "active" ? (
              <Button
                type="button"
                onClick={() => {
                  setEditingRow(null);
                  setRowDialogOpen(true);
                }}
                className={DOC_PRIMARY_BUTTON_CLASS}
              >
                <Plus className="size-5" />
                {t("actions.add")}</Button>
            ) : undefined
          }
        >
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`w-[42px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  <Checkbox
                    aria-label={t("actions.selectAll")}
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelectedRowIds(checked === true ? config.rows.map((row) => row.id) : [])
                    }
                    disabled={status !== "active" || config.rows.length === 0}
                  />
                </th>
                <th className={`w-[90px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>{t("columns.number")}</th>
                <th className={`w-[150px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>{t("fields.receiptDate")}</th>
                <th className={`w-[190px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>{t("fields.applicantName")}</th>
                <th className={`w-[260px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {t("columns.receiptForm")}</th>
                <th className={`w-[290px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {t("columns.applicantDetails")}</th>
                <th className={`w-[360px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>{t("fields.complaintContent")}</th>
                <th className={`w-[260px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {t("columns.decision")}</th>
              </tr>
            </thead>
            <tbody>
              {config.rows.map((row, index) => (
                <tr
                  key={row.id}
                  className={status === "active" ? "cursor-pointer hover:bg-[#f5f6ff]" : undefined}
                  onClick={() => {
                    if (status !== "active") return;
                    setEditingRow(row);
                    setRowDialogOpen(true);
                  }}
                >
                  <td
                    className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-top leading-tight`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      aria-label={t("actions.selectRow", { number: index + 1 })}
        checked={selectedRowIds.includes(row.id)}
                      onCheckedChange={(checked) =>
                        setSelectedRowIds((current) =>
                          checked === true
                            ? [...new Set([...current, row.id])]
                            : current.filter((id) => id !== row.id)
                        )
                      }
                      disabled={status !== "active"}
                    />
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-top leading-tight`}>{index + 1}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>
                    <button
                      type="button"
                      disabled={status !== "active"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (status !== "active") return;
                        setEditingRow(row);
                        setRowDialogOpen(true);
                      }}
                      className="w-full text-left disabled:cursor-default"
                    >
                      {complaintDate(row.values.receiptDate || "", locale) || "—"}
                    </button>
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>{row.values.applicantName || "—"}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>{complaintReceipt(row.values.complaintReceiptForm || "", t) || "—"}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight whitespace-pre-wrap`}>{row.values.applicantDetails || "—"}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight whitespace-pre-wrap`}>{row.values.complaintContent || "—"}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight whitespace-pre-wrap`}>
                    {complaintDecision(row, locale, t) || "—"}
                  </td>
                </tr>
              ))}
              {config.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className={`${GRID_CELL_CLASS} px-4 py-10 text-center text-[18px] text-[#666a80]`}>
                    {t("empty.title")}</td>
                </tr>
              )}
              {status === "active" ? (
                <JournalAddRow
                  // Галочка + «Рег. № п/п» — leading, подпись растянута на
                  // «Дата поступления» + «ФИО заявителя», остальные
                  // 4 колонки жалобы остаются пустыми ячейками.
                  leading={2}
                  labelSpan={2}
                  trailing={4}
                  label={t("actions.add")}
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

      <ComplaintRowDialog
        open={rowDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setRowDialogOpen(true);
            return;
          }
          // Закрытие без сохранения прерывает очередь («Изменено k из N»).
          seq.cancelled();
        }}
        row={editingRow}
        titleSuffix={seq.progress ?? undefined}
        period={documentPeriod}
        onSave={handleSaveRow}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={documentTitle}
        dateFrom={dateFrom}
        onSave={handleSaveSettings}
        useV2={useV2}
      />

      <FinishDialog
        open={finishOpen}
        onOpenChange={setFinishOpen}
        title={complaintTitle(documentTitle, dateFrom, locale, t)}
        onFinish={handleFinish}
      />
    </>
  );
}
