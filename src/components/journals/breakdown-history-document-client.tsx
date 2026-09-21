"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
  formatBreakdownEnd,
  getBreakdownRowDateError,
  normalizeBreakdownHistoryDocumentConfig,
  BREAKDOWN_HISTORY_HEADING,
  BREAKDOWN_HISTORY_DOCUMENT_TITLE,
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
import { StickyActionBar } from "@/components/journals/sticky-action-bar";
import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

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

function formatDateLabel(date: string) {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return `${day}-${month}-${year}`;
}

function formatTime(hour: string, minute: string) {
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function hourOptions() {
  return Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
}

function minuteOptions() {
  return Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
}

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
  const [row, setRow] = useState<BreakdownRow>(() => props.initialRow || createBreakdownRow());
  const [isSubmitting, setIsSubmitting] = useState(false);

  function setValue<K extends keyof BreakdownRow>(key: K, value: BreakdownRow[K]) {
    setRow((current) => ({ ...current, [key]: value }));
  }

  const dateError = getBreakdownRowDateError(row);

  async function handleSave() {
    if (dateError) {
      toast.error(dateError);
      return;
    }
    setIsSubmitting(true);
    try {
      // Окно закрывает родитель: при правке по очереди он откроет следующую строку.
      await props.onSave(row);
    } catch (error) {
      // ПОЧЕМУ: окно закрывалось в finally — сотрудник видел «сохранено»,
      // хотя сервер отказал, и запись о поломке терялась.
      toast.error(
        humanizeFetchError(error, "Не удалось сохранить строку")
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
            {props.initialRow ? `Редактирование строки${props.titleSuffix ? ` ${props.titleSuffix}` : ""}` : "Добавление новой строки"}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
          {/* Start date + time */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              Дата и время начала работ
            </Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1.6fr]">
              <Input
                type="date"
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
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
            label="Наименование оборудования"
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
            <Label className="text-[13px] font-medium text-[#3c4053]">Описание поломки</Label>
            <textarea
              className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[15px] text-[#0b1024] focus:outline-none"
              rows={3}
              value={row.breakdownDescription}
              onChange={(e) => setValue("breakdownDescription", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Выполненный ремонт</Label>
            <textarea
              className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[15px] text-[#0b1024] focus:outline-none"
              rows={3}
              value={row.repairPerformed}
              onChange={(e) => setValue("repairPerformed", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Замена частей (если произведена)</Label>
            <textarea
              className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[15px] text-[#0b1024] focus:outline-none"
              rows={2}
              value={row.partsReplaced}
              onChange={(e) => setValue("partsReplaced", e.target.value)}
            />
          </div>

          {/* End date + time */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              Дата и время окончания работ
              <span className="ml-1 font-normal text-[#6f7282]">
                — оставьте пустым, пока ремонт идёт
              </span>
            </Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1.6fr]">
              <Input
                type="date"
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
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
            <Label className="text-[13px] font-medium text-[#3c4053]">Часы простоя</Label>
            <Input
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
              value={row.downtimeHours}
              onChange={(e) => setValue("downtimeHours", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">ФИО лица, ответственного за ремонт</Label>
            <Input
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
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
            Отмена
          </Button>
          <Button
            type="button"
            className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
            onClick={handleSave}
            disabled={isSubmitting || dateError !== null}
          >
            {isSubmitting ? "Сохранение..." : props.initialRow ? "Сохранить" : "Добавить"}
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
  const [title, setTitle] = useState(props.title);
  const [dateFrom, setDateFrom] = useState(props.dateFrom);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSave() {
    setIsSubmitting(true);
    try {
      await props.onSave({ title: title.trim(), dateFrom });
      props.onOpenChange(false);
    } catch (error) {
      // Не закрываем окно при отказе сервера — иначе правка теряется молча.
      toast.error(
        humanizeFetchError(error, "Не удалось сохранить настройки")
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
        title="Настройки документа"
        description="Название документа и дата начала."
        size="md"
        isSaving={isSubmitting}
        onSave={handleSave}
        onCancel={() => props.onOpenChange(false)}
      >
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Название документа
          </Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Дата начала
          </Label>
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
            Настройки документа
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-8 py-6">
          <div className="space-y-2">
            <Label>Название документа</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Дата начала</Label>
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
              {isSubmitting ? "Сохранение..." : "Сохранить"}
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
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "Не удалось закончить журнал");
      }
      props.onFinished();
      props.onOpenChange(false);
    } catch (error) {
      toast.error(humanizeFetchError(error, "Ошибка"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[480px]">
        <DialogHeader className="border-b px-8 py-6">
          <DialogTitle className="text-[24px] font-medium text-black">
            Закончить журнал &laquo;{props.title}&raquo;
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-8 py-6">
          <p className="text-sm text-[#80849a]">
            После завершения журнал станет доступен только для чтения. Это действие нельзя отменить.
          </p>
          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              className="bg-[#5563ff] hover:bg-[#4452ee]"
              onClick={handleFinish}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Завершение..." : "Закончить"}
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
    title: `№${index + 1} · ${formatDateLabel(row.startDate)} ${formatTime(
      row.startHour,
      row.startMinute
    )}`,
    subtitle: rowName(row) || "—",
    leading: (
      <Checkbox
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
      { label: "Описание поломки", value: row.breakdownDescription, hideIfEmpty: true },
      { label: "Выполненный ремонт", value: row.repairPerformed, hideIfEmpty: true },
      { label: "Замена частей", value: row.partsReplaced, hideIfEmpty: true },
      // Пустое окончание — «ремонт идёт», а не «закончен 00:00».
      { label: "Окончание работ", value: formatBreakdownEnd(row), hideIfEmpty: true },
      { label: "Часы простоя", value: row.downtimeHours, hideIfEmpty: true },
      { label: "Ответственный", value: row.responsiblePerson, hideIfEmpty: true },
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
        Редактировать
      </button>
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
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.error || "Не удалось сохранить документ");
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
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.error || "Не удалось сохранить документ");
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
    if (!(await confirmAsync({ title: "Удалить выбранные строки?", description: `Будет удалено строк: ${count}. Восстановить нельзя.`, variant: "danger", confirmLabel: "Удалить" }))) return;
    try {
      await persistConfig({
        ...config,
        rows: config.rows.filter((row) => !selectedRowIds.includes(row.id)),
      });
      setSelectedRowIds([]);
      toast.success(`Удалено строк: ${count}`);
    } catch (error) {
      toast.error(humanizeFetchError(error, "Не удалось удалить выбранные строки"));
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
            handleDeleteSelected().catch((error) =>
              toast.error(
                humanizeFetchError(error, "Ошибка удаления")
              )
            );
          }}
          hint="Карточки поломок будут удалены без возможности отмены"
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
          createLabel="Добавить запись о поломке"
          emptyTitle="Поломок ещё нет"
          emptyBody="Если случилась поломка — добавьте новую запись через кнопку «Добавить» в таблице ниже."
        />
        <JournalDocumentShell
          title={title || BREAKDOWN_HISTORY_HEADING}
          subtitle={`Начат ${formatDateLabel(dateFrom)}`}
          documentId={props.documentId}
          backHref="/journals/breakdown_history"
          onSettings={() => setSettingsOpen(true)}
          closed={!isActive}
          closedHint="Откройте журнал заново, чтобы добавлять и править записи о поломках."
          menuItems={
            isActive
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
            <RecordCardsView items={cardItems} emptyLabel="Карточки поломок пока не добавлены." />
          }
          paperHeader={
            <JournalDocumentHeader
              orgName={props.organizationName || ORG_NAME_FALLBACK}
              title={BREAKDOWN_HISTORY_DOCUMENT_TITLE}
              startedAt={dateFrom}
              finishedAt={isActive ? null : new Date()}
            />
          }
          sheetTitle="Карточка истории поломок"
          sheetMinWidth={1600}
          toolbar={
            isActive ? (
              <StickyActionBar>
                <Button
                  type="button"
                  className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] hover:bg-[#4452ee]"
                  onClick={() => {
                    setEditingRow(null);
                    setRowDialogOpen(true);
                  }}
                >
                  <Plus className="size-5" />
                  Добавить
                </Button>
              </StickyActionBar>
            ) : undefined
          }
        >
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`w-[44px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelectedRowIds(
                        checked === true ? rows.map((r) => r.id) : []
                      )
                    }
                    disabled={rows.length === 0 || !isActive}
                  />
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Дата и время начала работ</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Наименование оборудования</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Описание поломки</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Выполненный ремонт</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                  Замена частей (если произведена)
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Дата и время окончания работ</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Часы простоя</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                  ФИО лица ответственного за ремонт
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
                      {formatDateLabel(row.startDate)}{" "}
                      {formatTime(row.startHour, row.startMinute)}
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
                    {formatBreakdownEnd(row) || "—"}
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
                    Строк пока нет
                  </td>
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
                  label="Добавить запись о поломке"
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
        title={title}
        documentId={props.documentId}
        onFinished={() => startTransition(() => router.refresh())}
      />
    </div>
  );
}
