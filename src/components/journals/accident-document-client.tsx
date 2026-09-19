"use client";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ACCIDENT_DOCUMENT_HEADING,
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
import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";
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

function formatDateLabel(date: string) {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return `${day}-${month}-${year}`;
}

function formatDateTime(date: string, hour: string, minute: string) {
  return `${formatDateLabel(date)}\n${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function hourOptions() {
  return Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
}

function minuteOptions() {
  return Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));
}

function RowDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  initialRow: AccidentRow | null;
  /** «(k из N)» при правке выделенных строк по очереди. */
  titleSuffix?: string;
  onSave: (row: AccidentRow) => Promise<void>;
}) {
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
    } catch (error) {
      // Без catch ошибка сохранения глохла: окно висело, тоста не было.
      toast.error(error instanceof Error ? error.message : "Ошибка сохранения строки");
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
              {props.initialRow ? `Редактирование строки${props.titleSuffix ? ` ${props.titleSuffix}` : ""}` : "Добавление новой строки"}
            </DialogTitle>
            <button
              type="button"
              className="rounded-xl p-2 text-[#101425]"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-5 px-8 py-6">
          <fieldset className="space-y-3 rounded-[18px] border border-[#e5e8f2] p-4">
            <legend className="px-1 text-base font-medium">Дата и время аварии</legend>
            <div className="relative">
              <Input
                type="date"
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
            placeholder="Введите наименование помещения"
          />

          <div className="space-y-2">
            <Label className="text-base font-medium text-black">
              Описание аварии (причины, возникновения, предпринятые действия для
              ликвидации аварии и т.д.)
            </Label>
            <Textarea
              value={row.accidentDescription}
              onChange={(event) => setValue("accidentDescription", event.target.value)}
              className="min-h-32 rounded-2xl border-[#d7dbea]"
              placeholder="Описание аварии"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-base font-medium text-black">
              Наличие «потенциально небезопасной» пищевой продукции, предпринятые
              действия с продукцией
            </Label>
            <Textarea
              value={row.affectedProducts}
              onChange={(event) => setValue("affectedProducts", event.target.value)}
              className="min-h-32 rounded-2xl border-[#d7dbea]"
              placeholder='Наличие «небезопасной» пищевой продукции'
            />
          </div>

          <fieldset className="space-y-3 rounded-[18px] border border-[#e5e8f2] p-4">
            <legend className="px-1 text-base font-medium">Дата и время ликвидации</legend>
            <div className="relative">
              <Input
                type="date"
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
              ФИО лиц, ответственных за ликвидацию аварии и ее последствий
            </Label>
            <Textarea
              value={row.responsiblePeople}
              onChange={(event) => setValue("responsiblePeople", event.target.value)}
              className="min-h-28 rounded-2xl border-[#d7dbea]"
              placeholder="ФИО лиц"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-base font-medium text-black">
              Мероприятия (корректирующие действия), предпринятые комиссией для
              исключения возникновения аварии
            </Label>
            <Textarea
              value={row.correctiveActions}
              onChange={(event) => setValue("correctiveActions", event.target.value)}
              className="min-h-32 rounded-2xl border-[#d7dbea]"
              placeholder="Мероприятия (корректирующие действия)"
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
                ? "Сохранение..."
                : props.initialRow
                  ? "Сохранить"
                  : "Добавить"}
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
    } finally {
      setSubmitting(false);
    }
  }

  if (props.useV2) {
    return (
      <JournalSettingsModal
        open={props.open}
        onOpenChange={props.onOpenChange}
        title="Настройки журнала"
        description="Название журнала и дата начала."
        size="md"
        isSaving={submitting}
        onSave={handleSave}
        onCancel={() => props.onOpenChange(false)}
      >
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Название документа
          </Label>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
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
              Настройки журнала
            </DialogTitle>
            <button
              type="button"
              className="rounded-xl p-2 text-[#101425]"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-5 px-8 py-6">
          <div className="space-y-2">
            <Label className="text-base text-[#6e7387]">Название документа</Label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-9 rounded-xl border-[#d7dbea]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-base text-[#6e7387]">Дата начала</Label>
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
              {submitting ? "Сохранение..." : "Сохранить"}
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
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "Не удалось закончить журнал");
      }

      props.onFinished();
      props.onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
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
              Закончить журнал &quot;{props.title}&quot;
            </DialogTitle>
            <button
              type="button"
              className="rounded-xl p-2 text-[#101425]"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-5 px-8 py-6">
          <p className="text-sm text-[#6e7387]">
            После завершения журнал перейдет в раздел закрытых и будет доступен
            только для чтения.
          </p>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleFinish}
              disabled={submitting}
              className="h-9 rounded-xl bg-[#5563ff] px-8 text-[13.5px] text-white hover:bg-[#4452ee]"
            >
              {submitting ? "Завершение..." : "Закончить журнал"}
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
    title: `№${index + 1} · ${formatDateTime(
      row.accidentDate,
      row.accidentHour,
      row.accidentMinute
    ).replace("\n", " ")}`,
    subtitle: row.locationName || "—",
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
      { label: "Описание аварии", value: row.accidentDescription, hideIfEmpty: true },
      { label: "Небезопасная продукция", value: row.affectedProducts, hideIfEmpty: true },
      {
        label: "Ликвидирована",
        value: formatDateTime(row.resolvedDate, row.resolvedHour, row.resolvedMinute).replace(
          "\n",
          " "
        ),
      },
      { label: "Ответственные", value: row.responsiblePeople, hideIfEmpty: true },
      { label: "Корректирующие действия", value: row.correctiveActions, hideIfEmpty: true },
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
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.error || "Не удалось сохранить журнал");
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
    if (!(await confirmAsync({ title: "Удалить выбранные строки?", description: `Будет удалено строк: ${count}. Восстановить нельзя.`, variant: "danger", confirmLabel: "Удалить" }))) return;
    try {
      await persist(title, dateFrom, {
        ...config,
        rows: config.rows.filter((row) => !selectedRowIds.includes(row.id)),
      });
      setSelectedRowIds([]);
      toast.success(`Удалено строк: ${count}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить выбранные строки");
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
            handleDeleteSelected().catch((error) =>
              toast.error(error instanceof Error ? error.message : "Ошибка")
            );
          }}
          hint="Записи об авариях будут удалены без возможности отмены"
        >
          <SelectionEditButton count={selectedRowIds.length} disabled={!isActive} onClick={() => seq.start(selectedRowIds)} />
        </JournalSelectionBar>
      ) : null}

      <div className="space-y-8 py-4 sm:py-6">
        <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />

        <JournalDocumentShell
          title={title || ACCIDENT_DOCUMENT_HEADING}
          subtitle={`Начат ${formatDateLabel(dateFrom)}`}
          documentId={props.documentId}
          backHref="/journals/accident_journal"
          onSettings={() => setSettingsOpen(true)}
          closed={!isActive}
          closedHint="Откройте журнал заново, чтобы добавлять и редактировать записи об авариях."
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
            <RecordCardsView items={cardItems} emptyLabel="Аварий пока не зафиксировано." />
          }
          paperHeader={
            <JournalDocumentHeader
              orgName={props.organizationName || ORG_NAME_FALLBACK}
              title={ACCIDENT_DOCUMENT_TITLE}
              startedAt={dateFrom}
              finishedAt={isActive ? null : config.finishedAt || dateFrom}
            />
          }
          sheetTitle={ACCIDENT_DOCUMENT_TITLE}
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
                Добавить
              </Button>
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
                      setSelectedRowIds(checked === true ? rows.map((row) => row.id) : [])
                    }
                    disabled={!isActive || rows.length === 0}
                  />
                </th>
                <th className={`w-[72px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>№ п/п</th>
                <th className={`w-[150px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Дата и время аварии
                </th>
                <th className={`w-[210px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Наименование помещения, в котором зафиксирована авария
                </th>
                <th className={`w-[300px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Описание аварии (причины, возникновения, предпринятые действия для
                  ликвидации аварии и т.д.)
                </th>
                <th className={`w-[280px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Наличие «потенциально небезопасной» пищевой продукции,
                  предпринятые действия с продукцией
                </th>
                <th className={`w-[180px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Дата и время ликвидации аварии, допуск к работе
                </th>
                <th className={`w-[210px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  ФИО лиц, ответственных за ликвидацию аварии и ее последствий
                </th>
                <th className={`w-[320px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Мероприятия (корректирующие действия), предпринятые комиссией для
                  исключения возникновения аварии
                </th>
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
                      {formatDateTime(row.accidentDate, row.accidentHour, row.accidentMinute)}
                    </button>
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.locationName}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.accidentDescription}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.affectedProducts}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight whitespace-pre-line`}>
                    {formatDateTime(row.resolvedDate, row.resolvedHour, row.resolvedMinute)}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.responsiblePeople}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.correctiveActions}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className={`${GRID_CELL_CLASS} px-2 py-6 text-center text-[#80849a]`}>
                    Строк пока нет
                  </td>
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
                  label="Добавить"
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
        title={title || ACCIDENT_DOCUMENT_TITLE}
        documentId={props.documentId}
        config={config}
        onFinished={() => startTransition(() => router.refresh())}
      />
    </div>
  );
}
