"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Plus } from "lucide-react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  formatComplaintDate,
  getComplaintDecisionCell,
  normalizeComplaintConfig,
  type ComplaintDocumentConfig,
} from "@/lib/complaint-document";
import {
  type RegisterDocumentConfig,
  type RegisterDocumentRow,
} from "@/lib/register-document";
import { useMobileView } from "@/lib/use-mobile-view";
import { formatCardDateTime } from "@/lib/journal-card-date";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import { localDayKey } from "@/lib/entry-defaults";
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
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: RegisterDocumentRow | null;
  /** «(k из N)» при правке выделенных строк по очереди. */
  titleSuffix?: string;
  onSave: (row: RegisterDocumentRow) => Promise<void>;
}) {
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
    setSubmitting(true);
    try {
      // Окно закрывает родитель: при правке по очереди он откроет следующую строку.
      await onSave(draft);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка сохранения строки");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-12 py-10">
          <DialogTitle className="text-[22px] font-medium text-black">
            {row ? `Редактирование строки${titleSuffix ? ` ${titleSuffix}` : ""}` : "Добавление новой строки"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6 px-12 py-10">
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Дата поступления</Label>
            <Input
              type="date"
              value={draft.values.receiptDate || ""}
              onChange={(event) => setValue("receiptDate", event.target.value)}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            {/* Подпись была только для скринридера, и поле стояло без
                заголовка — в отличие от соседних. */}
            <Label className="text-[14px] text-[#73738a]">ФИО заявителя</Label>
            <Input
              value={draft.values.applicantName || ""}
              onChange={(event) => setValue("applicantName", event.target.value)}
              placeholder="Введите ФИО заявителя"
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Форма поступления жалобы</Label>
            <Select
              value={draft.values.complaintReceiptForm || ""}
              onValueChange={(value) => setValue("complaintReceiptForm", value)}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                <SelectValue placeholder="- Выберите значение -" />
              </SelectTrigger>
              <SelectContent>
                {COMPLAINT_RECEIPT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Реквизиты заявителя</Label>
            <Textarea
              value={draft.values.applicantDetails || ""}
              onChange={(event) => setValue("applicantDetails", event.target.value)}
              className="min-h-[160px] rounded-[18px] border-[#dfe1ec] px-6 py-4 text-[18px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Содержание жалобы</Label>
            <Textarea
              value={draft.values.complaintContent || ""}
              onChange={(event) => setValue("complaintContent", event.target.value)}
              className="min-h-[160px] rounded-[18px] border-[#dfe1ec] px-6 py-4 text-[18px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Дата решения</Label>
            <Input
              type="date"
              value={draft.values.decisionDate || ""}
              onChange={(event) => setValue("decisionDate", event.target.value)}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Решение, краткое содержание</Label>
            <Textarea
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
              {submitting ? "Сохранение..." : row ? "Сохранить" : "Добавить"}
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка сохранения настроек");
    } finally {
      setSubmitting(false);
    }
  }

  if (useV2) {
    return (
      <JournalSettingsModal
        open={open}
        onOpenChange={onOpenChange}
        title="Настройки документа"
        description="Название журнала и дата начала."
        size="md"
        isSaving={submitting}
        onSave={handleSave}
        onCancel={() => onOpenChange(false)}
      >
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Название документа
          </Label>
          <Input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Дата начала
          </Label>
          <Input
            type="date"
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
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-14 py-12">
          <DialogTitle className="text-[22px] font-medium text-black">
            Настройки документа
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-8 px-14 py-12">
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Название документа</Label>
            <Input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Дата начала</Label>
            <Input
              type="date"
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
              {submitting ? "Сохранение..." : "Сохранить"}
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
  const [submitting, setSubmitting] = useState(false);

  async function handleFinish() {
    setSubmitting(true);
    try {
      await onFinish();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка завершения журнала");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-14 py-10">
          <DialogTitle className="pr-14 text-[22px] font-medium leading-[1.15] text-black">
            {`Закончить журнал "${title}"`}
          </DialogTitle>
        </DialogHeader>
        <div className="flex justify-end px-14 py-12">
          <Button
            type="button"
            onClick={handleFinish}
            disabled={submitting}
            className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]"
          >
            {submitting ? "Завершение..." : "Закончить"}
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
  status,
  initialConfig,
  useV2 = false,
}: Props) {
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
    title: `№${index + 1} · ${row.values.applicantName || "—"}`,
    // Общий формат карточек «дд.мм.гггг» (в бланке — через дефис).
    subtitle: formatCardDateTime(row.values.receiptDate || "") || undefined,
    leading: (
      <Checkbox
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
      { label: "Форма поступления", value: row.values.complaintReceiptForm, hideIfEmpty: true },
      { label: "Реквизиты заявителя", value: row.values.applicantDetails, hideIfEmpty: true },
      { label: "Содержание жалобы", value: row.values.complaintContent, hideIfEmpty: true },
      { label: "Решение", value: getComplaintDecisionCell(row), hideIfEmpty: true },
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
        Редактировать
      </button>
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

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.error || "Не удалось сохранить журнал");
    }

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
      title: "Удалить выбранные строки?",
      description: "Записи из реестра обращений исчезнут безвозвратно.",
      variant: "danger",
      confirmLabel: "Удалить",
      bullets: [
        { label: `Строк будет удалено: ${count}`, tone: "warn" },
        { label: `Останется строк: ${config.rows.length - count}`, tone: "default" },
      ],
    });
    if (!confirmed) return;
    const nextConfig = {
      ...config,
      rows: config.rows.filter((row) => !selectedRowIds.includes(row.id)),
    };
    await persist(documentTitle, nextConfig);
    setSelectedRowIds([]);
    toast.success(`Удалено строк: ${count}`);
  }

  async function handleSaveSettings(params: { title: string; dateFrom: string }) {
    await persist(
      params.title.trim() || COMPLAINT_REGISTER_TITLE,
      config,
      { dateFrom: params.dateFrom, dateTo: params.dateFrom }
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
        <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />
        {selectedRowIds.length > 0 && status === "active" && (
          <JournalSelectionBar
            count={selectedRowIds.length}
            onClear={() => setSelectedRowIds([])}
            onDelete={() =>
              handleDeleteSelected().catch((error) =>
                toast.error(error instanceof Error ? error.message : "Ошибка удаления строк")
              )
            }
            deleting={isPending}
            hint="Записи реестра обращений будут удалены без возможности отмены"
          >
            <SelectionEditButton count={selectedRowIds.length} onClick={() => seq.start(selectedRowIds)} />
          </JournalSelectionBar>
        )}

        <JournalDocumentShell
          title={documentTitle}
          subtitle={`Начат ${formatComplaintDate(dateFrom)}`}
          documentId={documentId}
          backHref={`/journals/${COMPLAINT_REGISTER_TEMPLATE_CODE}`}
          onSettings={() => setSettingsOpen(true)}
          closed={status !== "active"}
          closedHint="Откройте журнал заново, чтобы добавлять и редактировать жалобы."
          menuItems={
            status === "active"
              ? [
                  {
                    key: "close-journal",
                    label: "Закончить журнал",
                    icon: <Archive className="size-4" />,
                    onSelect: () => setFinishOpen(true),
                  },
                ]
              : []
          }
          mobileView={mobileView}
          onMobileView={switchMobileView}
          cards={
            <RecordCardsView items={cardItems} emptyLabel="Жалоб пока не зарегистрировано." />
          }
          paperHeader={
            <JournalDocumentHeader
              orgName={organizationName}
              title="Журнал регистрации жалоб"
              startedAt={dateFrom}
              finishedAt={status === "closed" ? config.finishedAt : null}
            />
          }
          sheetTitle="Журнал регистрации жалоб"
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
                Добавить
              </Button>
            ) : undefined
          }
        >
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`w-[42px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelectedRowIds(checked === true ? config.rows.map((row) => row.id) : [])
                    }
                    disabled={status !== "active" || config.rows.length === 0}
                  />
                </th>
                <th className={`w-[90px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Рег. № п/п</th>
                <th className={`w-[150px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Дата поступления</th>
                <th className={`w-[190px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>ФИО заявителя</th>
                <th className={`w-[260px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Форма поступления жалобы (по почте, по телефону, по факсу, по электронной почте, в книге отзывов и предложений)
                </th>
                <th className={`w-[290px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Реквизиты заявителя, указанные в жалобе заявителя для отправки ответа
                </th>
                <th className={`w-[360px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Содержание жалобы</th>
                <th className={`w-[260px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Решение, дата, краткое содержание
                </th>
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
                      {formatComplaintDate(row.values.receiptDate || "") || "—"}
                    </button>
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>{row.values.applicantName || "—"}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>{row.values.complaintReceiptForm || "—"}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight whitespace-pre-wrap`}>{row.values.applicantDetails || "—"}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight whitespace-pre-wrap`}>{row.values.complaintContent || "—"}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight whitespace-pre-wrap`}>
                    {getComplaintDecisionCell(row) || "—"}
                  </td>
                </tr>
              ))}
              {config.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className={`${GRID_CELL_CLASS} px-4 py-10 text-center text-[18px] text-[#666a80]`}>
                    Записей пока нет
                  </td>
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
                  label="Добавить"
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
        title={documentTitle}
        onFinish={handleFinish}
      />
    </>
  );
}
