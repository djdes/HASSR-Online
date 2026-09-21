"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { GRID_CELL_CLASS, GRID_HEAD_CELL_CLASS } from "@/components/journals/journal-grid";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";
import { usePositionEmployeeCascade } from "@/components/shared/position-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  buildDailyRange,
  formatRuDateDash,
  getGlassControlResponsibleOptions,
  GLASS_CONTROL_DEFAULT_FREQUENCY,
  GLASS_CONTROL_DOCUMENT_TITLE,
  GLASS_CONTROL_PAGE_TITLE,
  normalizeGlassControlConfig,
  normalizeGlassControlEntryData,
  toIsoDate,
  type GlassControlEntryData,
} from "@/lib/glass-control-document";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import { localDayKey } from "@/lib/entry-defaults";
import { NO_ROW_EMPLOYEE_MESSAGE, useRosterViewerId } from "@/components/journals/use-roster-viewer";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
import { isBlankEntryData } from "@/lib/journal-entry-blank";
type UserItem = {
  id: string;
  name: string;
  role: string;
};

type EntryItem = {
  id: string;
  employeeId: string;
  date: string;
  data: Record<string, unknown>;
};

type RowItem = {
  id: string;
  employeeId: string;
  date: string;
  data: GlassControlEntryData;
  /**
   * Запись за этот день есть в БД, но человек в неё ничего не вносил
   * (заготовка `{_autoSeeded:true}` от сидера или пустой объект).
   * Такую строку нельзя показывать как «осмотрено, повреждений нет».
   */
  blank?: boolean;
};

type RowDialogState = {
  open: boolean;
  row: RowItem;
  originalRow: RowItem | null;
};

type Props = {
  routeCode: string;
  documentId: string;
  title: string;
  organizationName: string;
  dateFrom: string;
  dateTo: string;
  responsibleTitle?: string | null;
  responsibleUserId?: string | null;
  status: string;
  autoFill: boolean;
  users: UserItem[];
  config: unknown;
  initialEntries: EntryItem[];
  itemSuggestions?: string[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

function emptyEntryData(): GlassControlEntryData {
  return {
    damagesDetected: false,
    itemName: "",
    quantity: "",
    damageInfo: "",
  };
}

function createVirtualRow(
  date: string,
  employeeId: string,
  data: Partial<GlassControlEntryData> = {}
): RowItem {
  return {
    id: `virtual:${date}:${employeeId || "none"}`,
    date,
    employeeId,
    data: { ...emptyEntryData(), ...data },
  };
}

function normalizeEntry(entry: EntryItem): RowItem {
  return {
    id: entry.id,
    employeeId: entry.employeeId,
    date: entry.date,
    data: normalizeGlassControlEntryData(entry.data),
    blank: isBlankEntryData(entry.data),
  };
}

function sortRows(rows: RowItem[]) {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.employeeId.localeCompare(b.employeeId);
  });
}

function rowKey(row: { employeeId: string; date: string }) {
  return `${row.employeeId}:${row.date}`;
}

/**
 * Виртуальная строка — день периода, за который записи в БД НЕТ.
 * Она рисуется, чтобы в бланке была строка на каждый день, но
 * заполненной считаться не должна: журнал предъявляют инспектору.
 */
function isVirtualRow(row: { id: string }) {
  return row.id.startsWith("virtual:");
}

/**
 * Строка «контроль не проводился»: либо дня вообще нет в БД
 * (виртуальная), либо запись есть, но пустая (заготовка сидера).
 * На экране и в печати такая строка обязана быть пустой — без «V» в
 * колонке «Нет» и без фамилии.
 */
function isUnfilledRow(row: RowItem) {
  return isVirtualRow(row) || row.blank === true;
}

function buildRows(params: {
  dateFrom: string;
  dateTo: string;
  status: string;
  entries: EntryItem[];
  fallbackEmployeeId: string;
}) {
  const today = localDayKey();
  const effectiveTo =
    params.status === "closed" && params.dateTo ? params.dateTo : today;
  const days = buildDailyRange(params.dateFrom, effectiveTo);
  const existing = new Map(
    params.entries.map((entry) => [entry.date, normalizeEntry(entry)])
  );

  return sortRows(
    days.map(
      (day) => existing.get(day) || createVirtualRow(day, params.fallbackEmployeeId)
    )
  );
}

function GlassControlSettingsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: UserItem[];
  initialState: {
    title: string;
    dateFrom: string;
    controlFrequency: string;
    responsibleTitle: string;
    responsibleUserId: string;
  };
  onSave: (payload: {
    title: string;
    dateFrom: string;
    controlFrequency: string;
    responsibleTitle: string;
    responsibleUserId: string;
  }) => Promise<void>;
  useV2?: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState(props.initialState.title);
  const [dateFrom, setDateFrom] = useState(props.initialState.dateFrom);
  const [controlFrequency, setControlFrequency] = useState(
    props.initialState.controlFrequency
  );
  const [responsibleTitle, setResponsibleTitle] = useState(
    props.initialState.responsibleTitle
  );
  const [responsibleUserId, setResponsibleUserId] = useState(
    props.initialState.responsibleUserId
  );
  const options = useMemo(
    () => getGlassControlResponsibleOptions(props.users),
    [props.users]
  );
  const cascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: responsibleTitle,
    userId: responsibleUserId,
    onChange: (next) => {
      setResponsibleTitle(next.positionTitle);
      setResponsibleUserId(next.userId);
    },
    autoPick: "first",
  });
  const employeeCandidates = responsibleTitle ? cascade.candidates : props.users;

  useEffect(() => {
    if (!props.open) return;
    setTitle(props.initialState.title);
    setDateFrom(props.initialState.dateFrom);
    setControlFrequency(props.initialState.controlFrequency);
    setResponsibleTitle(props.initialState.responsibleTitle);
    setResponsibleUserId(props.initialState.responsibleUserId);
  }, [props.initialState, props.open]);

  async function handleSave() {
    setSubmitting(true);
    try {
      await props.onSave({
        title,
        dateFrom,
        controlFrequency,
        responsibleTitle,
        responsibleUserId,
      });
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
        title="Настройки документа"
        description="Название документа, частота контроля и ответственный сотрудник."
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
        <div className="grid gap-4 md:grid-cols-2">
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
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Частота контроля
            </Label>
            <Input
              value={controlFrequency}
              onChange={(event) => setControlFrequency(event.target.value)}
              placeholder="Например: 1 раз в смену"
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Должность ответственного
          </Label>
          <Select
            value={responsibleTitle}
            onValueChange={cascade.handlePositionChange}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue placeholder="— Выберите —" />
            </SelectTrigger>
            <SelectContent>
              {Array.from(new Set(options.titles)).map((titleItem) => (
                <SelectItem key={titleItem} value={titleItem}>
                  {titleItem}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Сотрудник
          </Label>
          <Select
            value={responsibleUserId}
            onValueChange={cascade.handleEmployeeChange}
            open={cascade.employeeOpen}
            onOpenChange={cascade.setEmployeeOpen}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue placeholder="— Выберите —" />
            </SelectTrigger>
            <SelectContent>
              {employeeCandidates.map(
                (user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
      </JournalSettingsModal>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
          <DialogTitle className="text-[24px] font-semibold tracking-[-0.03em] text-black">
            Настройки документа
          </DialogTitle>
          <button
            type="button"
            className="rounded-md p-1 text-black/80 hover:bg-black/5"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="size-6" />
          </button>
        </DialogHeader>

        <div className="space-y-4 px-7 py-6">
          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Название документа</Label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Дата начала</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Частота контроля</Label>
            <Input
              value={controlFrequency}
              onChange={(event) => setControlFrequency(event.target.value)}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Должность ответственного</Label>
            <Select
              value={responsibleTitle}
              onValueChange={cascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                <SelectValue placeholder="Выберите должность" />
              </SelectTrigger>
              <SelectContent>
                {Array.from(new Set(options.titles)).map((titleItem) => (
                  <SelectItem key={titleItem} value={titleItem}>
                    {titleItem}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Сотрудник</Label>
            <Select
              value={responsibleUserId}
              onValueChange={cascade.handleEmployeeChange}
              open={cascade.employeeOpen}
              onOpenChange={cascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                <SelectValue placeholder="Выберите сотрудника" />
              </SelectTrigger>
              <SelectContent>
                {employeeCandidates.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end pt-1">
            <Button
              type="button"
              disabled={submitting}
              onClick={handleSave}
              className="h-9 rounded-xl bg-[#5863f8] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4b57f3]"
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RowDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: RowItem;
  originalRow: RowItem | null;
  users: UserItem[];
  itemSuggestions: string[];
  responsibleTitle: string;
  onSave: (row: RowItem, originalRow: RowItem | null) => Promise<void>;
  /** «(k из N)» при правке выделенных строк по очереди. */
  titleSuffix?: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<RowItem>(props.row);
  // Локальный draft для должности (не часть RowItem — она хранится
  // в JournalDocument.responsibleTitle, не в row data). Manager может
  // сменить должность в этом диалоге временно для текущего row'а.
  const [draftTitle, setDraftTitle] = useState<string>(props.responsibleTitle);
  const options = useMemo(
    () => getGlassControlResponsibleOptions(props.users),
    [props.users]
  );
  // P0-fix: keepUserId (дефолт хука) сохраняет уже выбранного сотрудника в
  // dropdown даже если его должность не совпадает с filter'ом.
  // Без этого после сохранения row'а с employee≠title — dialog
  // показывал пустое значение «Сотрудник», и manager думал
  // что данные не сохранились.
  const rowCascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: draftTitle,
    userId: draft.employeeId,
    onChange: (next) => {
      setDraftTitle(next.positionTitle);
      setDraft((prev) => ({ ...prev, employeeId: next.userId }));
    },
    autoPick: "none",
  });
  const employeeCandidates = draftTitle ? rowCascade.candidates : props.users;

  useEffect(() => {
    if (!props.open) return;
    setDraft(props.row);
    setDraftTitle(props.responsibleTitle);
  }, [props.open, props.row, props.responsibleTitle]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[24px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
          <DialogTitle className="text-[24px] font-semibold tracking-[-0.03em] text-black">
            {props.originalRow ? `Редактирование строки${props.titleSuffix ? ` ${props.titleSuffix}` : ""}` : "Добавление новой строки"}
          </DialogTitle>
          <button
            type="button"
            className="rounded-md p-1 text-black/80 hover:bg-black/5"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="size-6" />
          </button>
        </DialogHeader>

        <div className="space-y-4 px-7 py-6">
          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Дата</Label>
            <Input
              type="date"
              value={draft.date}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, date: event.target.value }))
              }
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>

          <div className="space-y-3">
            <Label className="text-[16px] font-semibold text-black">
              Состояние: повреждения обнаружены
            </Label>
            <div className="flex flex-wrap gap-6 text-[18px]">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={draft.data.damagesDetected === true}
                  onChange={() =>
                    setDraft((prev) => ({
                      ...prev,
                      data: { ...prev.data, damagesDetected: true },
                    }))
                  }
                  className="size-4 accent-[#5863f8]"
                />
                Да
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={draft.data.damagesDetected === false}
                  onChange={() =>
                    setDraft((prev) => ({
                      ...prev,
                      data: {
                        ...prev.data,
                        damagesDetected: false,
                        itemName: "",
                        quantity: "",
                        damageInfo: "",
                      },
                    }))
                  }
                  className="size-4 accent-[#5863f8]"
                />
                Нет
              </label>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Должность ответственного</Label>
            <Select
              value={draftTitle}
              onValueChange={rowCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                <SelectValue placeholder="Выберите должность" />
              </SelectTrigger>
              <SelectContent>
                {Array.from(new Set(options.titles)).map((titleItem) => (
                  <SelectItem key={titleItem} value={titleItem}>
                    {titleItem}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Сотрудник</Label>
            <Select
              value={draft.employeeId}
              onValueChange={rowCascade.handleEmployeeChange}
              open={rowCascade.employeeOpen}
              onOpenChange={rowCascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                <SelectValue placeholder="Выберите сотрудника" />
              </SelectTrigger>
              <SelectContent>
                {employeeCandidates.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {draft.data.damagesDetected && (
            <>
              <div className="space-y-1">
                <Label className="text-[16px] text-[#6f7282]">Наименование</Label>
                <Input
                  list="glass-control-item-suggestions"
                  value={draft.data.itemName}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      data: { ...prev.data, itemName: event.target.value },
                    }))
                  }
                  className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
                />
                <datalist id="glass-control-item-suggestions">
                  {Array.from(new Set(props.itemSuggestions)).map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1">
                <Label className="text-[16px] text-[#6f7282]">Кол-во</Label>
                <Input
                  value={draft.data.quantity}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      data: { ...prev.data, quantity: event.target.value },
                    }))
                  }
                  className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[16px] text-[#6f7282]">
                  Информация о повреждениях / замены
                </Label>
                <Input
                  value={draft.data.damageInfo}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      data: { ...prev.data, damageInfo: event.target.value },
                    }))
                  }
                  className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
                />
              </div>
            </>
          )}

          <div className="flex justify-end pt-1">
            <Button
              type="button"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true);
                try {
                  await props.onSave(draft, props.originalRow);
                  props.onOpenChange(false);
                } finally {
                  setSubmitting(false);
                }
              }}
              className="h-9 rounded-xl bg-[#5863f8] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4b57f3]"
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GlassControlDocumentClient(props: Props) {
  const router = useRouter();
  const config = useMemo(() => normalizeGlassControlConfig(props.config), [props.config]);
  // Строки без автора записываются на ответственного, иначе на вошедшего —
  // не на «первого в списке».
  const viewerId = useRosterViewerId(props.users);
  const fallbackEmployeeId = props.responsibleUserId || viewerId;
  const [rows, setRows] = useState(() =>
    buildRows({
      dateFrom: props.dateFrom,
      dateTo: props.dateTo,
      status: props.status,
      entries: props.initialEntries,
      fallbackEmployeeId,
    })
  );
  const [autoFill, setAutoFill] = useState(props.autoFill);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [rowDialog, setRowDialog] = useState<RowDialogState>({
    open: false,
    row: createVirtualRow(localDayKey(), fallbackEmployeeId),
    originalRow: null,
  });

  const responsibleOptions = useMemo(
    () => getGlassControlResponsibleOptions(props.users),
    [props.users]
  );
  const isClosed = props.status === "closed";
  const selectedCount = selectedRowIds.length;
  const allSelected = rows.length > 0 && selectedCount === rows.length && !isClosed;
  const { mobileView, switchMobileView } = useMobileView("glass_control");
  const itemSuggestions = useMemo(
    () => [...new Set(props.itemSuggestions || [])].filter(Boolean),
    [props.itemSuggestions]
  );

  const documentTitle = config.documentName || props.title || GLASS_CONTROL_DOCUMENT_TITLE;

  const cardItems: RecordCardItem[] = rows.map((row, index) => {
    const userName = props.users.find((user) => user.id === row.employeeId)?.name || "";
    const virtual = isUnfilledRow(row);
    return {
      id: row.id,
      title: `№${index + 1} · ${formatRuDateDash(row.date)}`,
      // Виртуальная строка не подписана человеком — записи за день нет.
      subtitle: virtual ? undefined : userName || undefined,
      badge: virtual ? (
        <span
          title="Контроль за этот день не внесён"
          className="rounded-full bg-[#f2f3f8] px-2 py-0.5 text-[11px] font-semibold text-[#6f7282]"
        >
          Не заполнено
        </span>
      ) : row.data.damagesDetected ? (
        <span className="rounded-full bg-[#fff2f1] px-2 py-0.5 text-[11px] font-semibold text-[#d2453d]">
          Повреждения
        </span>
      ) : (
        // Короткая подпись: длинная «Без повреждений» на телефоне
        // съедала строку заголовка и дата обрезалась («№2 · 02-09-20…»).
        <span
          title="Повреждений не обнаружено"
          className="rounded-full bg-[#e6f8ec] px-2 py-0.5 text-[11px] font-semibold text-[#1f7a3c]"
        >
          Норма
        </span>
      ),
      leading: !isClosed ? (
        <Checkbox
          checked={selectedRowIds.includes(row.id)}
          onCheckedChange={(checked) =>
            setSelectedRowIds((current) =>
              checked === true
                ? [...new Set([...current, row.id])]
                : current.filter((id) => id !== row.id)
            )
          }
          className="size-5"
        />
      ) : null,
      fields: [
        { label: "Наименование предмета", value: row.data.itemName, hideIfEmpty: true },
        { label: "Количество", value: row.data.quantity, hideIfEmpty: true },
        { label: "Информация о повреждениях", value: row.data.damageInfo, hideIfEmpty: true },
      ],
      onClick: !isClosed ? () => setRowDialog({ open: true, row, originalRow: row }) : undefined,
    };
  });

  /** Правка выделенных строк по очереди — тем же окном. */
  const seq = useSequentialEdit({
    open: (id) => {
      const row = rows.find((item) => item.id === id);
      // Виртуальная строка (день без записи) — не правится, пропускаем.
      if (!row || isVirtualRow(row) || isClosed) return false;
      setRowDialog({ open: true, row, originalRow: row });
      return true;
    },
    close: () => setRowDialog((prev) => ({ ...prev, open: false })),
  });
  // RowDialog сам зовёт onOpenChange(false) после сохранения — этот вызов
  // не должен прерывать очередь, поэтому помечаем «уже сохранено».
  const seqSavedRef = useRef(false);

  async function upsertRow(nextRow: RowItem, originalRow: RowItem | null) {
    const response = await fetch(`/api/journal-documents/${props.documentId}/entries`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: nextRow.employeeId,
        date: nextRow.date,
        data: nextRow.data,
      }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.entry) {
      toast.error("Не удалось сохранить строку");
      throw new Error("save_row_failed");
    }

    const savedRow = normalizeEntry({
      id: result.entry.id,
      employeeId: result.entry.employeeId,
      date: toIsoDate(new Date(result.entry.date)),
      data: result.entry.data as Record<string, unknown>,
    });

    if (
      originalRow &&
      !originalRow.id.startsWith("virtual:") &&
      rowKey(originalRow) !== rowKey(nextRow)
    ) {
      await fetch(`/api/journal-documents/${props.documentId}/entries`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [originalRow.id] }),
      });
    }

    setRows((current) => {
      const filtered = current.filter((row) => {
        if (originalRow && row.id === originalRow.id) return false;
        return rowKey(row) !== rowKey(savedRow);
      });

      return sortRows([...filtered, savedRow]);
    });
    if (originalRow) {
      // Очередь правок откроет следующую строку или закроет окно.
      seqSavedRef.current = true;
      seq.saved();
    }
  }

  async function deleteSelectedRows() {
    const ids = selectedRowIds.filter((id) => !id.startsWith("virtual:"));
    if (selectedRowIds.length === 0) return;
    const count = selectedRowIds.length;
    if (!(await confirmAsync({ title: "Удалить выбранные строки?", description: `Будет удалено строк: ${count}. Восстановить нельзя.`, variant: "danger", confirmLabel: "Удалить" }))) return;

    try {
      if (ids.length > 0) {
        const response = await fetch(`/api/journal-documents/${props.documentId}/entries`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });

        if (!response.ok) {
          throw new Error("Не удалось удалить строки");
        }
      }

      setRows((current) => current.filter((row) => !selectedRowIds.includes(row.id)));
      setSelectedRowIds([]);
      toast.success(`Удалено строк: ${count}`);
    } catch (error) {
      toast.error(humanizeFetchError(error, "Не удалось удалить выбранные строки"));
    }
  }

  async function syncAutoFill(nextValue: boolean) {
    // Проверяем до записи флага: иначе автозаполнение включилось бы на
    // сервере, а ночной cron подписал бы строки кем попало.
    if (nextValue && !fallbackEmployeeId) {
      toast.error(NO_ROW_EMPLOYEE_MESSAGE);
      return;
    }

    const patchResponse = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoFill: nextValue }),
    });

    if (!patchResponse.ok) {
      toast.error("Не удалось обновить автозаполнение");
      return;
    }

    if (nextValue) {
      const dates = buildDailyRange(props.dateFrom, localDayKey());
      // ПОЧЕМУ только реальные: `rows` содержит виртуальную строку на
      // каждый день периода, поэтому «уже есть» было верно всегда и
      // автозаполнение не записывало НИЧЕГО.
      // Пустая заготовка сидера — это НЕ заполненный день: её тоже надо
      // дозаполнить, иначе автозаполнение молча пропускало весь период.
      const existingDates = new Set(
        rows.filter((row) => !isUnfilledRow(row)).map((row) => row.date)
      );

      for (const date of dates) {
        if (existingDates.has(date)) continue;
        const response = await fetch(`/api/journal-documents/${props.documentId}/entries`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: fallbackEmployeeId,
            date,
            data: emptyEntryData(),
          }),
        });

        if (!response.ok) {
          toast.error("Не удалось автозаполнить журнал");
          return;
        }
      }
    }

    setAutoFill(nextValue);
    router.refresh();
  }

  async function saveSettings(payload: {
    title: string;
    dateFrom: string;
    controlFrequency: string;
    responsibleTitle: string;
    responsibleUserId: string;
  }) {
    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title.trim() || GLASS_CONTROL_DOCUMENT_TITLE,
        dateFrom: payload.dateFrom,
        responsibleTitle: payload.responsibleTitle || null,
        responsibleUserId: payload.responsibleUserId || null,
        config: {
          ...config,
          documentName: payload.title.trim() || GLASS_CONTROL_DOCUMENT_TITLE,
          controlFrequency: payload.controlFrequency.trim() || GLASS_CONTROL_DEFAULT_FREQUENCY,
        },
      }),
    });

    if (!response.ok) {
      toast.error("Не удалось сохранить настройки документа");
      throw new Error("save_settings_failed");
    }

    router.refresh();
  }

  async function closeJournal() {
    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed", dateTo: localDayKey() }),
    });

    if (!response.ok) {
      toast.error("Не удалось закончить журнал");
      return;
    }

    setCloseOpen(false);
    router.refresh();
  }

  return (
    <div className="space-y-6 text-black">
      <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />
      {selectedCount > 0 && !isClosed && (
        <JournalSelectionBar
          count={selectedCount}
          onClear={() => setSelectedRowIds([])}
          onDelete={() => deleteSelectedRows().catch(() => undefined)}
          hint="Записи контроля будут удалены без возможности отмены"
        >
          <SelectionEditButton count={selectedCount} disabled={isClosed} onClick={() => seq.start(selectedRowIds)} />
        </JournalSelectionBar>
      )}

      <JournalDocumentShell
        title={documentTitle}
        subtitle={`Начат ${formatRuDateDash(props.dateFrom)}`}
        documentId={props.documentId}
        backHref="/journals/glass_control"
        onSettings={isClosed ? undefined : () => setSettingsOpen(true)}
        closed={isClosed}
        closedHint="Откройте журнал заново, чтобы добавлять и править записи контроля."
        menuItems={
          !isClosed
            ? [
                {
                  key: "close-journal",
                  label: "Закончить журнал",
                  icon: <Archive className="size-4" />,
                  onSelect: () => setCloseOpen(true),
                },
              ]
            : []
        }
        autoFill={{
          checked: autoFill,
          onChange: (next) => {
            void syncAutoFill(next);
          },
          disabled: isClosed,
          label: "Автоматически заполнять журнал",
        }}
        mobileView={mobileView}
        onMobileView={switchMobileView}
        cards={
          <RecordCardsView items={cardItems} emptyLabel="Контролей пока не проведено." />
        }
        paperHeader={
          <JournalDocumentHeader
            orgName={props.organizationName}
            title={GLASS_CONTROL_PAGE_TITLE.toUpperCase()}
            startedAt={props.dateFrom}
            finishedAt={isClosed ? props.dateTo : null}
            controlPeriodicity={config.controlFrequency}
          />
        }
        sheetTitle={GLASS_CONTROL_PAGE_TITLE}
        sheetMinWidth={1100}
        toolbar={
          !isClosed ? (
            <Button
              type="button"
              className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4957fb]"
              onClick={() =>
                setRowDialog({
                  open: true,
                  row: createVirtualRow(localDayKey(), fallbackEmployeeId),
                  originalRow: null,
                })
              }
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
              {!isClosed && (
                <th rowSpan={2} className={`w-[34px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelectedRowIds(checked === true ? rows.map((row) => row.id) : [])
                    }
                  />
                </th>
              )}
              <th rowSpan={2} className={`w-[130px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Дата</th>
              <th colSpan={2} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                Состояние: повреждения обнаружены
              </th>
              <th colSpan={3} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                Предмет, на котором обнаружены повреждения
              </th>
              <th rowSpan={2} className={`w-[170px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                Фамилия ответственного лица
              </th>
            </tr>
            <tr>
              <th className={`w-[70px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Да</th>
              <th className={`w-[70px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Нет</th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Наименование</th>
              <th className={`w-[100px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Кол-во</th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Информация о повреждениях / замены</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const userName = props.users.find((user) => user.id === row.employeeId)?.name || "";
              const virtual = isUnfilledRow(row);
              return (
                <tr
                  key={row.id}
                  className={!isClosed ? "cursor-pointer hover:bg-[#fbfbff]" : undefined}
                  onClick={(event) => {
                    if (isClosed) return;
                    if ((event.target as HTMLElement).closest("button")) return;
                    if ((event.target as HTMLElement).closest("[role='checkbox']")) return;
                    setRowDialog({ open: true, row, originalRow: row });
                  }}
                >
                  {!isClosed && (
                    <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                      <Checkbox
                        checked={selectedRowIds.includes(row.id)}
                        onCheckedChange={(checked) =>
                          setSelectedRowIds((current) =>
                            checked === true
                              ? [...new Set([...current, row.id])]
                              : current.filter((id) => id !== row.id)
                          )
                        }
                      />
                    </td>
                  )}
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{formatRuDateDash(row.date)}</td>
                  {/* Записи за день нет — ни отметки, ни фамилии: строка
                      «не заполнено», а не «осмотрено, повреждений нет». */}
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{!virtual && row.data.damagesDetected ? "V" : ""}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{!virtual && !row.data.damagesDetected ? "V" : ""}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>{row.data.itemName}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.data.quantity}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>{row.data.damageInfo}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{virtual ? "" : userName}</td>
                </tr>
              );
            })}
            {/* Последняя строка — кликабельная «пустая»: то же окно, что и
                «Добавить» в toolbar над таблицей. Галочка — leading, «Дата»
                — под подпись (виден, когда !isClosed), остальные 6 колонок
                бланка — пустые ячейки. */}
            {!isClosed ? (
              <JournalAddRow
                leading={1}
                labelSpan={1}
                trailing={6}
                label="Добавить"
                onClick={() =>
                  setRowDialog({
                    open: true,
                    row: createVirtualRow(localDayKey(), fallbackEmployeeId),
                    originalRow: null,
                  })
                }
              />
            ) : null}
            {/* Пустая строка-заготовка бланка — только для печати: на
                бумаге инспектор дописывает запись от руки. На экране она
                была некликабельной заглушкой, теперь кликабельность даёт
                JournalAddRow выше. */}
            <tr className="hidden print:table-row">
              {!isClosed && <td className={`${GRID_CELL_CLASS} px-2 py-4 print:hidden`} />}
              <td className={`${GRID_CELL_CLASS} px-2 py-4`} />
              <td className={`${GRID_CELL_CLASS} px-2 py-4`} />
              <td className={`${GRID_CELL_CLASS} px-2 py-4`} />
              <td className={`${GRID_CELL_CLASS} px-2 py-4`} />
              <td className={`${GRID_CELL_CLASS} px-2 py-4`} />
              <td className={`${GRID_CELL_CLASS} px-2 py-4`} />
              <td className={`${GRID_CELL_CLASS} px-2 py-4`} />
            </tr>
          </tbody>
        </table>
      </JournalDocumentShell>

      <GlassControlSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        users={props.users}
        initialState={{
          title: documentTitle,
          dateFrom: props.dateFrom,
          controlFrequency: config.controlFrequency || GLASS_CONTROL_DEFAULT_FREQUENCY,
          responsibleTitle: props.responsibleTitle || responsibleOptions.titles[0] || "Управляющий",
          responsibleUserId: props.responsibleUserId || "",
        }}
        onSave={saveSettings}
        useV2={props.useV2}
      />

      <RowDialog
        open={rowDialog.open}
        onOpenChange={(open) => {
          if (open) {
            setRowDialog((prev) => ({ ...prev, open: true }));
            return;
          }
          if (seqSavedRef.current) {
            seqSavedRef.current = false;
            return;
          }
          // Закрытие без сохранения прерывает очередь («Изменено k из N»).
          seq.cancelled();
        }}
        row={rowDialog.row}
        originalRow={rowDialog.originalRow}
        users={props.users}
        itemSuggestions={itemSuggestions}
        responsibleTitle={props.responsibleTitle || "Управляющий"}
        onSave={upsertRow}
        titleSuffix={seq.progress ?? undefined}
      />

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
          <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
            <DialogTitle className="text-[24px] font-semibold tracking-[-0.03em] text-black">
              Закончить журнал &quot;{documentTitle}&quot;
            </DialogTitle>
            <button
              type="button"
              className="rounded-md p-1 text-black/80 hover:bg-black/5"
              onClick={() => setCloseOpen(false)}
            >
              <X className="size-6" />
            </button>
          </DialogHeader>
          <div className="flex justify-end px-7 py-6">
            <Button
              type="button"
              onClick={() => void closeJournal()}
              className="h-9 rounded-xl bg-[#5863f8] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4b57f3]"
            >
              Закончить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
