"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Copy,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
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
  CLEANING_VENTILATION_CHECKLIST_TITLE,
  buildChecklistDateKeys,
  getCleaningVentilationDescriptionLines,
  getCleaningVentilationPeriodicityLines,
  getMonthBoundsFromDate,
  normalizeCleaningVentilationConfig,
  normalizeCleaningVentilationEntryData,
  toLocalIsoDate,
  type CleaningVentilationChecklistConfig,
  type CleaningVentilationChecklistEntryData,
  type CleaningVentilationResponsible,
} from "@/lib/cleaning-ventilation-checklist-document";
import { toDateKey } from "@/lib/hygiene-document";
import { DocumentActionsBar } from "@/components/journals/document-actions-bar";
import { useJournalUndo } from "@/lib/journal-undo";
import {
  DOC_ADD_ROW_CLASS,
  DOC_HEADING_CLASS,
  JOURNAL_DIALOG_CONTENT_WIDE_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
  DOC_AUTOFILL_LABEL_CLASS,
  DOC_AUTOFILL_STRIP_CLASS,
  JOURNAL_TABLE_SCROLL_CLASS,
} from "@/components/journals/journal-responsive";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { JournalPaperHeaderRows } from "@/components/journals/journal-document-header";
import { DOC_PAPER_CANVAS_CLASS } from "@/components/journals/journal-responsive";
import {
  GRID_ADD_CELL_SOLID_CLASS,
  GRID_CELL_CLASS,
  GRID_HEAD_CELL_CLASS,
} from "@/components/journals/journal-grid";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { useCopyYesterdayAction } from "@/components/journals/copy-yesterday-button";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { JournalClosedBanner } from "@/components/journals/journal-closed-banner";
import {
  getRowEmployeeTitle,
  getUsersForRoleLabel,
  isManagementRole,
  type UserLike,
} from "@/lib/user-roles";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  MobileViewToggle,
  MobileViewTableWrapper,
} from "@/components/journals/mobile-view-toggle";
import {
  CardEditSheet,
  type CardEditFieldDef,
  type CardEditValues,
} from "@/components/journals/card-edit-sheet";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";
import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";

/**
 * Старые документы хранят должность-«корзину» «Управляющий / Сотрудник» —
 * для них список фильтруется по корзине. Для настоящей должности из
 * справочника — только люди в этой должности: раньше показывались ВСЕ, и
 * сохранялась пара «чужая должность + человек».
 */
function filterUsersByBucket<T extends UserLike & { id: string; role?: string | null }>(
  users: T[],
  bucket: string
): T[] {
  const exact = getUsersForRoleLabel(users, bucket);
  if (exact.length > 0) return exact;
  if (bucket === "Управляющий") return users.filter((u) => isManagementRole(u.role));
  if (bucket === "Сотрудник") return users.filter((u) => !isManagementRole(u.role));
  return exact;
}

import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import { useTodayKey } from "@/lib/use-today-key";
import { NO_ROW_EMPLOYEE_MESSAGE, useRosterViewerId } from "@/components/journals/use-roster-viewer";
import { TodayStripForJournal } from "@/components/journals/today-strip-for-journal";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
type UserItem = {
  id: string;
  name: string;
  role: string;
  // Должность из карточки (как в UserLike) — подпись «Должность - ФИО».
  positionTitle?: string | null;
  jobPosition?: { name: string; categoryKey: string } | null;
};

type Props = {
  documentId: string;
  routeCode: string;
  title: string;
  organizationName: string;
  /**
   * «Периодичность контроля» — вторая строка бумажной шапки документа
   * (`config.controlPeriodicity`, дефолт — из реестра шаблонов).
   * Пустая строка ⇒ строка в шапке не рендерится.
   */
  controlPeriodicity?: string;
  status: string;
  dateFrom: string;
  users: UserItem[];
  config: CleaningVentilationChecklistConfig;
  initialEntries: { id: string; date: string; data: CleaningVentilationChecklistEntryData }[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

type SettingsState = {
  title: string;
  dateFrom: string;
  ventilationEnabled: boolean;
  mainResponsibleTitle: string;
  mainResponsibleUserId: string;
};

type RowProcedure = {
  id: "disinfection" | "ventilation" | "wet_cleaning";
  label: string;
  times: string[];
  responsibleUserId: string;
};

const HOURS = Array.from({ length: 24 }, (_, index) =>
  String(index).padStart(2, "0")
);
const MINUTES = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

/**
 * Кнопка-ячейка внутри таблицы («+ Добавить периодичность» /
 * «+ Добавить ответственного»). V5: на эталоне это СПЛОШНАЯ индиго-плашка
 * во всю ширину ячейки, а не светлая призрачная ссылка — берём общий
 * токен `GRID_ADD_CELL_SOLID_CLASS` (тот же, что у климата).
 */
const CHECKLIST_ADD_CELL_CLASS = `${GRID_ADD_CELL_SOLID_CLASS} border-t border-[#333]`;

/**
 * Ячейка липкой шапки чек-листа. `border-collapse` не рисует границы у
 * sticky-ячеек (они «уезжают» вместе со скроллом), поэтому нижнюю линию
 * даём inset-тенью, а фон держим непрозрачным — иначе строки просвечивают.
 */
/**
 * V6: незаполненная обязательная ячейка бланка — розовая заливка, как в
 * спецификации УФ-установки. Инспектор сразу видит недооформленный
 * документ; на бумаге заливки нет.
 */
const CHECKLIST_EMPTY_CELL_CLASS =
  "bg-[#fdf0f0] shadow-[inset_0_0_0_1px_#f8d7da] print:bg-white print:shadow-none";

const CHECKLIST_STICKY_HEAD_CLASS =
  "max-sm:static sticky top-0 z-20 border-[#333] bg-[#f8f9fc] text-[15px] font-semibold leading-tight text-black shadow-[inset_0_-1px_0_#333] print:static print:bg-white print:shadow-none print:border-b print:border-black";

/**
 * Дата строки чек-листа. Q2-10: формат унифицирован с остальными
 * журналами и с PDF — дефисы (`10-08-2026`), а не точки. Раньше здесь
 * стоял `toLocaleDateString("ru-RU")`, и печатная версия расходилась
 * с выгрузкой по одному и тому же документу.
 */
function formatRuDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${day}-${month}-${year}`;
}

function createId() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (json && typeof json.error === "string" && json.error) || "Операция не выполнена"
    );
  }
  return json;
}

/**
 * V4: селекты времени раньше были 106px + gap 8 в 128px-ячейке — шевроны
 * выезжали за границу, «00» обрезалось. Компактный размер по образцу
 * инпутов эталона: два поля по 64px помещаются в колонку целиком.
 */
const CHECKLIST_TIME_TRIGGER_CLASS =
  "h-9 w-[64px] justify-between rounded-lg border-[#dcdfed] bg-white px-2 text-[13px]";

/** Значение «слот пустой» для Radix Select — пустая строка запрещена. */
const TIME_EMPTY = "__empty__";

function TimeSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  // Пустой слот больше не притворяется «00:00»: иначе незаполненное время
  // выглядело как реальный замер и его нельзя было стереть.
  const [hour = "", minute = ""] = value ? value.split(":") : [];

  return (
    <div className="flex items-center justify-center gap-1.5">
      <Select
        value={hour || TIME_EMPTY}
        onValueChange={(nextHour) =>
          onChange(
            nextHour === TIME_EMPTY ? "" : `${nextHour}:${minute || "00"}`
          )
        }
        disabled={disabled}
      >
        <SelectTrigger className={CHECKLIST_TIME_TRIGGER_CLASS}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TIME_EMPTY}>—</SelectItem>
          {HOURS.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={minute || TIME_EMPTY}
        onValueChange={(nextMinute) =>
          onChange(
            nextMinute === TIME_EMPTY ? "" : `${hour || "00"}:${nextMinute}`
          )
        }
        disabled={disabled}
      >
        <SelectTrigger className={CHECKLIST_TIME_TRIGGER_CLASS}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TIME_EMPTY}>—</SelectItem>
          {MINUTES.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DocumentSettingsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: UserItem[];
  initial: SettingsState;
  onSubmit: (value: SettingsState) => Promise<void>;
  useV2?: boolean;
}) {
  const [state, setState] = useState<SettingsState>(props.initial);
  const [submitting, setSubmitting] = useState(false);
  // Окно открывается снаружи (setSettingsOpen), и Radix onOpenChange(true)
  // при этом не срабатывает: без ресинка «Сохранить» затирал конфиг
  // значениями с прошлого открытия. Через ref — `initial` пересоздаётся
  // на каждый рендер родителя и в зависимостях сбрасывал бы ввод.
  const initialRef = useRef(props.initial);
  initialRef.current = props.initial;
  useEffect(() => {
    if (props.open) setState(initialRef.current);
  }, [props.open]);
  const mainCascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: state.mainResponsibleTitle,
    userId: state.mainResponsibleUserId,
    onChange: (next) =>
      setState((current) => ({
        ...current,
        mainResponsibleTitle: next.positionTitle,
        mainResponsibleUserId: next.userId,
      })),
    resolveCandidates: (bucket) => filterUsersByBucket(props.users, bucket),
    autoPick: "first",
  });
  const mainCandidates = state.mainResponsibleTitle
    ? mainCascade.candidates
    : props.users;

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
        onOpenChange={(nextOpen) => {
          if (nextOpen) setState(props.initial);
          props.onOpenChange(nextOpen);
        }}
        title="Настройки документа"
        description="Название документа, дата начала, режим проветривания и ответственный сотрудник."
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
            value={state.title}
            onChange={(event) =>
              setState((current) => ({ ...current, title: event.target.value }))
            }
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Дата начала
          </Label>
          <Input
            type="date"
            value={state.dateFrom}
            onChange={(event) =>
              setState((current) => ({ ...current, dateFrom: event.target.value }))
            }
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 transition-colors hover:bg-[#f5f6ff]">
          <Checkbox
            checked={state.ventilationEnabled}
            onCheckedChange={(checked) =>
              setState((current) => ({
                ...current,
                ventilationEnabled: checked === true,
              }))
            }
          />
          <div className="text-[14px] text-[#0b1024]">
            Проветривание
            <div className="mt-0.5 text-[12px] text-[#6f7282]">
              Включайте если помещение реально проветривается.
            </div>
          </div>
        </label>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Должность ответственного
          </Label>
          <Select
            value={state.mainResponsibleTitle}
            onValueChange={mainCascade.handlePositionChange}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue placeholder="— Выберите —" />
            </SelectTrigger>
            <SelectContent>
              <PositionSelectItems users={props.users} />
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Сотрудник
          </Label>
          <Select
            value={state.mainResponsibleUserId}
            onValueChange={mainCascade.handleEmployeeChange}
            open={mainCascade.employeeOpen}
            onOpenChange={mainCascade.setEmployeeOpen}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue placeholder="— Выберите —" />
            </SelectTrigger>
            <SelectContent>
              {mainCandidates.map(
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
    <Dialog
      open={props.open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setState(props.initial);
        }
        props.onOpenChange(nextOpen);
      }}
    >
      <DialogContent className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <div className="flex items-center justify-between">
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              Настройки документа
            </DialogTitle>
          </div>
        </DialogHeader>
        <div className="space-y-5 px-6 py-5">
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Название документа</Label>
            <Input
              value={state.title}
              onChange={(event) => setState((current) => ({ ...current, title: event.target.value }))}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Дата начала</Label>
            <div className="relative">
              <Input
                type="date"
                value={state.dateFrom}
                onChange={(event) =>
                  setState((current) => ({ ...current, dateFrom: event.target.value }))
                }
                className="h-9 rounded-xl border-[#dcdfed] px-6 pr-14 text-[13.5px]"
              />
              <CalendarDays className="pointer-events-none absolute right-5 top-1/2 size-6 -translate-y-1/2 text-[#6f7282]" />
            </div>
          </div>
          <div className="space-y-3">
            <label className="flex items-center gap-3">
              <Checkbox
                checked={state.ventilationEnabled}
                onCheckedChange={(checked) =>
                  setState((current) => ({ ...current, ventilationEnabled: checked === true }))
                }
                className="size-6 rounded-[10px]"
              />
              <span className="text-[15px] text-black">Проветривание</span>
            </label>
            <p className="text-[15px] text-black/70">
              Включайте, если помещение действительно проветривается. Без окон магия не сработает,
              даже если кожаные очень верят.
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Должность ответственного</Label>
            <Select
              value={state.mainResponsibleTitle}
              onValueChange={mainCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
                <SelectValue placeholder="Выберите должность" />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={props.users} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Сотрудник</Label>
            <Select
              value={state.mainResponsibleUserId}
              onValueChange={mainCascade.handleEmployeeChange}
              open={mainCascade.employeeOpen}
              onOpenChange={mainCascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
                <SelectValue placeholder="Выберите сотрудника" />
              </SelectTrigger>
              <SelectContent>
                {mainCandidates.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              disabled={submitting}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4a5bf0]"
              onClick={async () => {
                setSubmitting(true);
                try {
                  await props.onSubmit(state);
                  props.onOpenChange(false);
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddResponsibleDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: UserItem[];
  onAdd: (responsible: CleaningVentilationResponsible) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [userId, setUserId] = useState("");
  const cascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: title,
    userId,
    onChange: (next) => {
      setTitle(next.positionTitle);
      setUserId(next.userId);
    },
    resolveCandidates: (bucket) => filterUsersByBucket(props.users, bucket),
    autoPick: "first",
  });
  const candidates = title ? cascade.candidates : props.users;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setTitle("");
          setUserId("");
        }
        props.onOpenChange(nextOpen);
      }}
    >
      <DialogContent className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <div className="flex items-center justify-between">
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              Добавление ответственного лица
            </DialogTitle>
          </div>
        </DialogHeader>
        <div className="space-y-5 px-6 py-5">
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Должность ответственного</Label>
            <Select
              value={title}
              onValueChange={cascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
                <SelectValue placeholder="Выберите должность" />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={props.users} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Сотрудник</Label>
            <Select
              value={userId}
              onValueChange={cascade.handleEmployeeChange}
              open={cascade.employeeOpen}
              onOpenChange={cascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
                <SelectValue placeholder="Выберите сотрудника" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4a5bf0]"
              disabled={!title || !userId}
              onClick={async () => {
                // Должность выбранного человека, а не метка фильтра.
                const picked = props.users.find((user) => user.id === userId);
                await props.onAdd({
                  id: createId(),
                  title: getRowEmployeeTitle(picked, title),
                  userId,
                });
                props.onOpenChange(false);
              }}
            >
              Добавить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Диалог «Добавление периодичности». Базовые строки («Дезинфекция – 3
 * раз(а) в день») считаются от процедур; здесь управляющая дописывает свои
 * («Мытьё окон – 1 раз в неделю»).
 */
function AddPeriodicityDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (line: string) => Promise<void>;
}) {
  const [line, setLine] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setLine("");
        props.onOpenChange(nextOpen);
      }}
    >
      <DialogContent className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            Добавление периодичности
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 px-6 py-5">
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              Строка периодичности
            </Label>
            <Input
              value={line}
              autoFocus
              placeholder="Например: Мытьё окон – 1 раз в неделю"
              onChange={(event) => setLine(event.target.value)}
              className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <p className="text-[12px] leading-[1.45] text-[#6f7282]">
              Появится в блоке «Периодичность» внутри таблицы и в печатной
              форме.
            </p>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              disabled={!line.trim() || saving}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
              onClick={async () => {
                setSaving(true);
                try {
                  await props.onAdd(line.trim());
                  props.onOpenChange(false);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Добавление..." : "Добавить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Окно «Добавить дату». Даёт внести день задним числом и вернуть дату,
 * скрытую кнопкой «Удалить».
 */
function AddChecklistDateDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  min: string;
  max: string;
  suggested: string;
  hiddenDates: string[];
  onAdd: (date: string) => Promise<void>;
}) {
  const [date, setDate] = useState(props.suggested);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (props.open) setDate(props.suggested);
  }, [props.open, props.suggested]);

  const submit = async (value: string) => {
    setSaving(true);
    try {
      await props.onAdd(value);
      props.onOpenChange(false);
    } catch {
      // Сообщение уже показал вызывающий — окно оставляем открытым.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            Добавление даты
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 px-6 py-5">
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              Дата строки
            </Label>
            <Input
              type="date"
              value={date}
              min={props.min}
              max={props.max}
              onChange={(event) => setDate(event.target.value)}
              className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <p className="text-[12px] leading-[1.45] text-[#6f7282]">
              Можно внести день задним числом — в пределах периода документа
              ({formatRuDate(props.min)} — {formatRuDate(props.max)}) и не в
              будущее. Предложена ближайшая отсутствующая дата.
            </p>
          </div>
          {props.hiddenDates.length > 0 ? (
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">
                Вернуть удалённую дату
              </Label>
              <div className="flex flex-wrap gap-2">
                {props.hiddenDates.map((item) => (
                  <button
                    key={item}
                    type="button"
                    disabled={saving}
                    onClick={() => void submit(item)}
                    className="rounded-full border border-[#dcdfed] bg-white px-3 py-1.5 text-[13px] text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/50 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                  >
                    {formatRuDate(item)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              disabled={!date || saving || date < props.min || date > props.max}
              onClick={() => void submit(date)}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
            >
              {saving ? "Добавление..." : "Добавить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CleaningVentilationChecklistDocumentClient({
  documentId,
  routeCode,
  title,
  organizationName,
  controlPeriodicity = "",
  status,
  dateFrom,
  users,
  config: initialConfig,
  initialEntries,
  useV2 = false,
}: Props) {
  const router = useRouter();
  // «Сегодня» считаем после mount (см. useTodayKey): new Date() в
  // рендере давал hydration mismatch и подсветку не того дня.
  const todayKey = useTodayKey();
  const viewerId = useRosterViewerId(users);
  const [config, setConfig] = useState(() =>
    normalizeCleaningVentilationConfig(initialConfig, users)
  );
  const [entryMap, setEntryMap] = useState<
    Record<string, { id?: string; data: CleaningVentilationChecklistEntryData }>
  >(() => {
    // Уникальность в БД — (документ, сотрудник, дата), а карта ключуется
    // только по дате: несколько записей за один день надо СЛИВАТЬ,
    // иначе отметки коллег просто пропадали с экрана.
    const map: Record<
      string,
      { id?: string; data: CleaningVentilationChecklistEntryData }
    > = {};
    for (const entry of initialEntries) {
      const data = normalizeCleaningVentilationEntryData(entry.data);
      const existing = map[entry.date];
      if (!existing) {
        map[entry.date] = { id: entry.id, data };
        continue;
      }
      map[entry.date] = {
        id: existing.id,
        data: {
          ...existing.data,
          procedures: { ...existing.data.procedures, ...data.procedures },
          responsibleUserId:
            existing.data.responsibleUserId || data.responsibleUserId,
        },
      };
    }
    return map;
  });
  // Последнее состояние отметок. Два времени одной процедуры, введённые
  // подряд, читали `entryMap` из замыкания рендера — второй PUT затирал
  // первый. Ref обновляется тем же setEntryMap, что и state.
  const entryMapRef = useRef(entryMap);
  useEffect(() => {
    entryMapRef.current = entryMap;
  }, [entryMap]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addDateOpen, setAddDateOpen] = useState(false);
  const copyYesterday = useCopyYesterdayAction(documentId);
  const [responsibleDialogOpen, setResponsibleDialogOpen] = useState(false);
  const [periodicityDialogOpen, setPeriodicityDialogOpen] = useState(false);
  // По умолчанию панель автозаполнения свёрнута в тонкую полосу
  // (тумблер + резюме + «Настроить»): настройки меняют редко, а места
  // раскрытая панель занимала больше, чем сам чек-лист.
  const [panelOpen, setPanelOpen] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  // Процедура, время которой правим из карточки. Раньше карточки этого
  // журнала отправляли во вкладку «Таблица».
  const [editingProcedure, setEditingProcedure] = useState<
    { dateKey: string; procedureId: string } | null
  >(null);
  const isActive = status === "active";
  // История отмены (Ctrl+Z) — только правки этого человека в этой вкладке.
  const undoStack = useJournalUndo({ enabled: status === "active" });
  const { mobileView, switchMobileView } = useMobileView("cleaning_ventilation_checklist");
  const docTitle = title || CLEANING_VENTILATION_CHECKLIST_TITLE;

  const activeProcedures = useMemo(
    () =>
      config.procedures.filter(
        (item) => item.enabled && (item.id !== "ventilation" || config.ventilationEnabled)
      ),
    [config]
  );

  /**
   * V1: строки идут от даты начала документа. Записи, которые остались
   * от более раннего периода (дату начала перенесли уже после
   * заполнения), подмешиваем как customDates — терять данные нельзя,
   * но НОВЫХ пустых строк раньше даты начала не появляется.
   */
  const rows = useMemo(
    () =>
      buildChecklistDateKeys(
        dateFrom,
        config.skipWeekends,
        [...config.customDates, ...Object.keys(entryMap)],
        config.hiddenDates
      ).map((dateKey) => {
        const entry = entryMap[dateKey]?.data;
        return {
          dateKey,
          procedures: activeProcedures.map((procedure) => ({
            ...procedure,
            // Без записи слот пустой. Раньше подставлялось ПЛАНОВОЕ время
            // из конфига, и пустой документ печатался заполненным за весь
            // месяц, включая будущие даты.
            times: entry?.procedures[procedure.id] ?? [],
            // Сколько замеров положено по плану — для розовой подсветки
            // незаполненных слотов (в сами ячейки план НЕ подставляем).
            plannedCount: procedure.times.filter(Boolean).length,
            responsibleUserId:
              entry?.responsibleUserId ||
              procedure.responsibleUserId ||
              config.mainResponsibleUserId,
          })),
        };
      }),
    [
      activeProcedures,
      config.customDates,
      config.hiddenDates,
      config.mainResponsibleUserId,
      config.skipWeekends,
      dateFrom,
      entryMap,
    ]
  );

  const descriptionLines = useMemo(
    () =>
      getCleaningVentilationDescriptionLines().filter(
        (item) =>
          item.label !== "Рабочие помещения при проветривании" ||
          config.ventilationEnabled
      ),
    [config.ventilationEnabled]
  );

  const settingsState: SettingsState = {
    title: docTitle,
    dateFrom,
    ventilationEnabled: config.ventilationEnabled,
    mainResponsibleTitle: config.mainResponsibleTitle,
    mainResponsibleUserId: config.mainResponsibleUserId,
  };

  const userMap = useMemo(
    () => Object.fromEntries(users.map((user) => [user.id, user])),
    [users]
  );

  const persistConfig = async (
    nextConfig: CleaningVentilationChecklistConfig,
    options?: { title?: string; dateFrom?: string; dateTo?: string }
  ) => {
    const safeConfig = normalizeCleaningVentilationConfig(nextConfig, users);
    const nextDateFrom = options?.dateFrom || dateFrom;
    // V1: дату начала не выравниваем по первому числу месяца — иначе
    // документ, начатый 10.08, снова расползался бы на весь август.
    const bounds = getMonthBoundsFromDate(nextDateFrom);
    // Ручная дата может выйти за конец месяца — тогда период расширяем.
    const monthBounds = {
      dateTo:
        options?.dateTo && options.dateTo > bounds.dateTo
          ? options.dateTo
          : bounds.dateTo,
    };
    await requestJson(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: options?.title || docTitle,
        dateFrom: nextDateFrom,
        dateTo: monthBounds.dateTo,
        config: safeConfig,
        // Cron смотрит колонку JournalDocument.autoFill, а тумблер писал
        // только config.autoFillEnabled — держим оба в одном состоянии.
        autoFill: safeConfig.autoFillEnabled,
      }),
    });
    setConfig(safeConfig);
    router.refresh();
  };

  /**
   * `silent` — это откат/повтор из истории отмены: такой вызов не кладёт
   * новый шаг в стек и пробрасывает ошибку наружу, чтобы протухший шаг
   * (сервер ответил «прошлые дни закрыты») вылетел из истории.
   */
  const persistEntry = async (
    dateKey: string,
    nextData: CleaningVentilationChecklistEntryData,
    options?: { silent?: boolean }
  ) => {
    // Запись пишется на ТОГО, КТО ЗАПОЛНЯЕТ. Раньше уходила на
    // mainResponsibleUserId (управляющую), и сервер отвечал рядовому
    // сотруднику «Можно заполнять только свою строку». Ответственный за
    // процедуру остаётся в data.responsibleUserId и печатается на бланке.
    const employeeId =
      viewerId || nextData.responsibleUserId || config.mainResponsibleUserId;
    if (!employeeId) {
      toast.error(NO_ROW_EMPLOYEE_MESSAGE);
      return;
    }

    const previousData: CleaningVentilationChecklistEntryData =
      entryMapRef.current[dateKey]?.data ?? { procedures: {} };

    const result = await requestJson(`/api/journal-documents/${documentId}/entries`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId,
        date: dateKey,
        data: nextData,
      }),
    });

    // Ref обновляем СРАЗУ, не дожидаясь перерисовки: следующий ввод
    // времени может начаться раньше, чем React применит setState.
    const nextMap = {
      ...entryMapRef.current,
      [dateKey]: {
        id:
          result && result.entry && typeof result.entry.id === "string"
            ? result.entry.id
            : entryMapRef.current[dateKey]?.id,
        data: nextData,
      },
    };
    entryMapRef.current = nextMap;
    setEntryMap(nextMap);

    if (!options?.silent) {
      undoStack.push({
        undo: () => persistEntry(dateKey, previousData, { silent: true }),
        redo: () => persistEntry(dateKey, nextData, { silent: true }),
      });
    }
  };

  /** Какую процедуру какого дня правим из карточки. */
  const editProcedure = async (
    dateKey: string,
    procedure: RowProcedure,
    values: CardEditValues
  ) => {
    const existing = entryMapRef.current[dateKey]?.data || { procedures: {} };
    // Позиции слотов не сдвигаем — только обрезаем пустой хвост.
    const nextTimes = [0, 1, 2].map((index) =>
      String(values[`time${index}`] ?? "")
    );
    while (nextTimes.length > 0 && !nextTimes[nextTimes.length - 1]) {
      nextTimes.pop();
    }
    setEditingProcedure(null);
    await persistEntry(dateKey, {
      procedures: {
        ...existing.procedures,
        [procedure.id]: nextTimes,
      },
      responsibleUserId:
        existing.responsibleUserId ||
        procedure.responsibleUserId ||
        config.mainResponsibleUserId,
    });
  };

  const updateProcedureTime = async (
    dateKey: string,
    procedure: RowProcedure,
    timeIndex: number,
    value: string
  ) => {
    // Из ref, а не из замыкания рендера: два времени подряд теряли друг друга.
    const existing = entryMapRef.current[dateKey]?.data || { procedures: {} };
    // Источник — только запись: плановые времена из конфига подставлять
    // нельзя (иначе пустой документ «заполняется» сам).
    const sourceTimes = existing.procedures[procedure.id] || [];
    const nextTimes = [...sourceTimes];
    while (nextTimes.length <= timeIndex) nextTimes.push("");
    nextTimes[timeIndex] = value;
    // Позиции слотов сохраняем: filter(Boolean) сдвигал «Время 3»
    // во «Время 2», стоило очистить второй слот. Убираем только хвост.
    while (nextTimes.length > 0 && !nextTimes[nextTimes.length - 1]) {
      nextTimes.pop();
    }
    await persistEntry(dateKey, {
      procedures: {
        ...existing.procedures,
        [procedure.id]: nextTimes,
      },
      responsibleUserId:
        existing.responsibleUserId || procedure.responsibleUserId || config.mainResponsibleUserId,
    });
  };

  const clearSelectedRows = async () => {
    const ids = selection
      .map((item) => entryMap[item]?.id)
      .filter((item): item is string => Boolean(item));
    if (ids.length > 0) {
      await requestJson(`/api/journal-documents/${documentId}/entries`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    }

    const nextConfig = {
      ...config,
      hiddenDates: [...new Set([...config.hiddenDates, ...selection])],
      customDates: config.customDates.filter((item) => !selection.includes(item)),
    };
    const nextEntryMap = { ...entryMapRef.current };
    selection.forEach((item) => delete nextEntryMap[item]);
    entryMapRef.current = nextEntryMap;
    setEntryMap(nextEntryMap);
    setSelection([]);
    await persistConfig(nextConfig);
  };

  /**
   * Добавление даты строкой чек-листа. Дата приходит из окна выбора —
   * раньше кнопка молча брала «последнюю строку + сутки», и ни задним
   * числом внести день, ни вернуть скрытую («Удалить») дату было нечем.
   */
  const addManualDate = async (nextIso: string) => {
    // Новая дата может выйти за конец месяца документа — тогда расширяем
    // период, иначе запись за неё не сохранить.
    const monthEnd = getMonthBoundsFromDate(dateFrom).dateTo;
    await persistConfig(
      {
        ...config,
        hiddenDates: config.hiddenDates.filter((item) => item !== nextIso),
        customDates: [...new Set([...config.customDates, nextIso])],
      },
      nextIso > monthEnd ? { dateTo: nextIso } : undefined
    );
  };

  /** Границы выбора: от даты начала документа по сегодня (не в будущее). */
  const addDateBounds = useMemo(() => {
    const monthEnd = getMonthBoundsFromDate(dateFrom).dateTo;
    // Документ прошлого месяца: дальше его конца строки не нужны.
    const max = todayKey && todayKey < monthEnd ? todayKey : monthEnd;
    return { min: dateFrom, max: max < dateFrom ? dateFrom : max };
  }, [dateFrom, todayKey]);

  /** По умолчанию — ближайшая к сегодня отсутствующая дата. */
  const suggestedDate = useMemo(() => {
    const present = new Set(rows.map((item) => item.dateKey));
    const cursor = new Date(`${addDateBounds.max}T00:00:00`);
    const start = new Date(`${addDateBounds.min}T00:00:00`);
    while (cursor >= start) {
      const iso = toLocalIsoDate(cursor);
      if (!present.has(iso)) return iso;
      cursor.setDate(cursor.getDate() - 1);
    }
    return addDateBounds.max;
  }, [rows, addDateBounds]);

  /** Скрытые через «Удалить» даты в пределах периода — их можно вернуть. */
  const restorableDates = useMemo(
    () =>
      [...config.hiddenDates]
        .filter(
          (item) => item >= addDateBounds.min && item <= addDateBounds.max
        )
        .sort(),
    [config.hiddenDates, addDateBounds]
  );

  return (
    <div className="space-y-5">
      <FocusTodayScroller />
      <JournalSelectionBar
        count={selection.length}
        onClear={() => setSelection([])}
        onDelete={() => {
          clearSelectedRows().catch((error) =>
            toast.error(humanizeFetchError(error, "Не удалось удалить строки"))
          );
        }}
        hint="Выбранные даты будут скрыты из чек-листа, их отметки удалены"
      />

      {/* V7: белой карточки-обёртки вокруг страницы нет ни у эталона, ни
          у остальных наших журналов (hygiene/cleaning) — документ живёт
          прямо на фоне страницы. */}
      <div className="space-y-6">
        <DocumentActionsBar
          className="mb-0"
          backHref={`/journals/${routeCode}`}
          documentId={documentId}
          heading={<h1 className={`${DOC_HEADING_CLASS} max-w-[980px]`}>{docTitle}</h1>}
          onSettings={isActive ? () => setSettingsOpen(true) : undefined}
          undo={{
            canUndo: undoStack.canUndo,
            canRedo: undoStack.canRedo,
            onUndo: () => void undoStack.undo(),
            onRedo: () => void undoStack.redo(),
            undoCount: undoStack.undoCount,
          }}
          menuItems={
            isActive
              ? [
                  {
                    key: "copy-yesterday",
                    label: "Скопировать вчерашнее",
                    icon: <Copy className="size-4" />,
                    title:
                      "Создать сегодняшние строки по вчерашним значениям — удобно, когда ничего не поменялось.",
                    onSelect: () => void copyYesterday.run(false),
                    disabled: copyYesterday.busy,
                  },
                ]
              : []
          }
        >
          {copyYesterday.dialog}
        </DocumentActionsBar>

        {!isActive ? (
          <JournalClosedBanner hint="Откройте журнал заново, чтобы редактировать отметки." documentId={documentId} />
        ) : (
          (() => {
            // Сегодня закрыто, когда у каждой процедуры дня проставлено
            // хотя бы одно время.
            const todayRow = rows.find((row) => row.dateKey === todayKey);
            const total = todayRow?.procedures.length ?? 0;
            const filled =
              todayRow?.procedures.filter((procedure) =>
                procedure.times.some(Boolean)
              ).length ?? 0;
            return (
              <div className="mb-4 print:hidden">
                <TodayStripForJournal
                  journalCode="cleaning_ventilation_checklist"
                  total={total}
                  filled={filled}
                  label="процедур"
                />
              </div>
            );
          })()
        )}

        {/* Полоса автозаполнения — ОДНА строка, как на эталоне
            (cleaning_ventilation_checklist-grid.png): тумблер слева,
            «Настроить» справа. Резюме («3 процедуры, время …») жило второй
            строкой и делало полосу вдвое выше эталонной — расписание
            времени и так видно в панели настройки. */}
        {/* Q3: полоса — общий токен-лента 48px. Была карточка r28 без
            вертикальных отступов (прилипала к заголовку). Кнопка
            «Настроить ⌄» остаётся в полосе справа, панель настроек —
            отдельным блоком под полосой. */}
        <div className={cn(DOC_AUTOFILL_STRIP_CLASS, panelOpen && "mb-0")}>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Switch
                id="cleaning-ventilation-autofill"
                checked={config.autoFillEnabled}
                disabled={!isActive}
                onCheckedChange={(checked) => {
                  persistConfig({ ...config, autoFillEnabled: checked === true }).catch((error) =>
                    toast.error(humanizeFetchError(error, "Не удалось сохранить настройки"))
                  );
                }}
                className="data-[state=checked]:bg-[#5566f6] data-[state=unchecked]:bg-[#d4d8ec]"
              />
              <label
                htmlFor="cleaning-ventilation-autofill"
                // Перенос вместо `truncate`: на 360/390 подпись обрезалась до
                // «Автоматически запол…» при свободном месте во второй строке.
                className={`block min-w-0 cursor-pointer break-words ${DOC_AUTOFILL_LABEL_CLASS}`}
              >
                Автоматически заполнять чек-лист
              </label>
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen((current) => !current)}
              className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[#5566f6]/[0.06] px-3 text-[13.5px] font-semibold text-[#5566f6] transition-colors duration-150 hover:bg-[#5566f6]/[0.11]"
              title={panelOpen ? "Свернуть настройки автозаполнения" : "Показать время и ответственных"}
            >
              {panelOpen ? "Свернуть" : "Настроить"}
              {panelOpen ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </button>
          </div>

          {panelOpen ? (
            <div className="-mx-4 mb-10 bg-[#f3f4fe] px-4 pb-6 print:hidden md:-mx-8 md:px-8">
            <div className="space-y-7">
              {activeProcedures.map((procedure) => (
                <div key={procedure.id} className="space-y-4">
                  {procedure.times.map((time, index) => (
                    <div
                      key={`${procedure.id}-${index}`}
                      className="flex flex-col gap-3 md:flex-row md:items-center"
                    >
                      <div className="w-full text-[18px] text-black md:w-[180px]">
                        {procedure.label}
                      </div>
                      <TimeSelect
                        value={time}
                        disabled={!isActive}
                        onChange={(value) => {
                          const nextProcedures = config.procedures.map((item) =>
                            item.id === procedure.id
                              ? {
                                  ...item,
                                  times: item.times.map((existing, timeIndex) =>
                                    timeIndex === index ? value : existing
                                  ),
                                }
                              : item
                          );
                          persistConfig({ ...config, procedures: nextProcedures }).catch((error) =>
                            toast.error(humanizeFetchError(error, "Не удалось сохранить настройки"))
                          );
                        }}
                      />
                    </div>
                  ))}

                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <div className="w-full text-[18px] text-black md:w-[180px]">ФИО отв. лица</div>
                    <Select
                      value={procedure.responsibleUserId}
                      disabled={!isActive}
                      onValueChange={(value) => {
                        const nextProcedures = config.procedures.map((item) =>
                          item.id === procedure.id ? { ...item, responsibleUserId: value } : item
                        );
                        persistConfig({ ...config, procedures: nextProcedures }).catch((error) =>
                          toast.error(humanizeFetchError(error, "Не удалось сохранить настройки"))
                        );
                      }}
                    >
                      <SelectTrigger className="h-12 w-full rounded-[18px] border-[#dcdfed] bg-white px-4 text-[16px] md:w-[320px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {users.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}

              <label className="flex items-center gap-3 text-[18px] text-black">
                <Checkbox
                  checked={config.skipWeekends}
                  disabled={!isActive}
                  onCheckedChange={(checked) => {
                    persistConfig({ ...config, skipWeekends: checked === true }).catch((error) =>
                      toast.error(humanizeFetchError(error, "Не удалось сохранить настройки"))
                    );
                  }}
                  className="size-6 rounded-[10px]"
                />
                Не заполнять в выходные дни
              </label>
            </div>
            </div>
          ) : null}

        {/* R1: бумажное полотно — во всю ширину контентной колонки:
            шапка ХАССП, блоки «Процедура/Периодичность/Ответственные»,
            «Добавить» и сама сетка чек-листа. */}
        <div className="mb-4 sm:hidden print:hidden">
          <MobileViewToggle mobileView={mobileView} onChange={switchMobileView} />
        </div>

        <div className={DOC_PAPER_CANVAS_CLASS}>
        {/* Рамку контейнера убрали: границы теперь несут сами ячейки
            бумажной шапки, иначе линия дублировалась. */}
        {/* В табличном виде на телефоне шапка той же ширины, что сетка (1140px). */}
        {/* В карточках на телефоне бумажная часть (шапка ХАССП +
            «Процедура/Периодичность/Ответственные») скрыта: она шире
            экрана и обрезалась справа. Печать и десктоп — как были. */}
        {/* Своя рамка прокрутки у шапки (общий класс): страница документа
            вбок не едет, и без рамки бланк шириной 1140px просто обрезался
            бы краем экрана. */}
        <div className={`${JOURNAL_TABLE_SCROLL_CLASS} print:overflow-visible`}>
        <div className={`overflow-hidden ${mobileView === "table" ? "max-sm:w-fit max-sm:min-w-full" : "max-sm:hidden print:block"}`}>
          <table className={`w-full border-collapse text-[13px] text-left ${mobileView === "table" ? "max-sm:min-w-[1140px]" : ""}`}>
            <tbody>
              <JournalPaperHeaderRows
                orgName={organizationName || ORG_NAME_FALLBACK}
                title={CLEANING_VENTILATION_CHECKLIST_TITLE.toUpperCase()}
                startedAt={dateFrom}
                finishedAt={isActive ? null : dateFrom}
                controlPeriodicity={controlPeriodicity}
                orgCellClass="w-[220px]"
                sideCellClass="w-[250px]"
              />
            </tbody>
          </table>

          <table className="w-full border-collapse text-[13px]">
            <tbody>
              <tr className="border-b border-[#333] print:border-black">
                {/* A21 аудита: `rowSpan={2}` снят с обеих левых ячеек.
                    Правый стек (Периодичность + Ответственные, каждый со
                    своей кнопкой «Добавить») почти вдвое выше описания
                    процедуры, поэтому спан растягивал левый блок на его
                    высоту — под текстом зияло ~200px пустоты, и бланк
                    читался как «Процедура не заполнена». Теперь строка
                    «Ответственные лица» занимает всю ширину (colSpan=3
                    у списка), высота каждой строки — по её содержимому.

                    Ширины на бумаге — в ПРОЦЕНТАХ (A8): жёсткие
                    180/210/260px не сжимались печатью, чек-лист уезжал
                    за лист и рвался на 12 страниц. */}
                <td
                  className={`${GRID_HEAD_CELL_CLASS} w-[180px] px-5 py-2 align-top text-[16px] font-semibold leading-tight print:w-[14%]`}
                >
                  Процедура
                </td>
                <td
                  className={`border-r border-[#333] print:border-black px-5 py-2 align-top text-[15px] leading-6 print:w-[46%] ${
                    descriptionLines.length === 0 ? CHECKLIST_EMPTY_CELL_CLASS : ""
                  }`}
                >
                  {descriptionLines.map((item) => (
                    <div key={item.label}>
                      <span className="font-semibold">{item.label}: </span>
                      {item.text}
                    </div>
                  ))}
                </td>
                <td
                  className={`${GRID_HEAD_CELL_CLASS} w-[210px] px-5 py-2 align-top text-[16px] font-semibold leading-tight print:w-[16%]`}
                >
                  Периодичность
                </td>
                <td className="w-[260px] p-0 align-top text-[15px] leading-6 print:w-[24%]">
                  <div className="space-y-1 px-5 py-2">
                    {getCleaningVentilationPeriodicityLines(config.ventilationEnabled).map(
                      (line) => (
                        <div key={line}>{line}</div>
                      )
                    )}
                    {(config.extraPeriodicityLines ?? []).map((line, index) => (
                      <div
                        key={`${line}-${index}`}
                        className="flex items-center justify-between gap-3"
                      >
                        <span>{line}</span>
                        {isActive ? (
                          <button
                            type="button"
                            aria-label={`Удалить периодичность «${line}»`}
                            className="shrink-0 text-[#ff3b30] transition-colors duration-150 hover:text-[#d92b21] print:hidden"
                            onClick={() => {
                              persistConfig({
                                ...config,
                                extraPeriodicityLines: (
                                  config.extraPeriodicityLines ?? []
                                ).filter((_, itemIndex) => itemIndex !== index),
                              }).catch((error) =>
                                toast.error(
                                  humanizeFetchError(error, "Не удалось обновить периодичность")
                                )
                              );
                            }}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {isActive ? (
                    <button
                      type="button"
                      className={CHECKLIST_ADD_CELL_CLASS}
                      onClick={() => setPeriodicityDialogOpen(true)}
                    >
                      <Plus className="size-5" strokeWidth={2.5} />
                      Добавить периодичность
                    </button>
                  ) : null}
                </td>
              </tr>
              <tr>
                <td
                  className={`${GRID_HEAD_CELL_CLASS} w-[180px] px-5 py-2 align-top text-[16px] font-semibold leading-tight print:w-[14%]`}
                >
                  Ответственные лица
                </td>
                {/* R5-3в: у ячейки не было НИ ОДНОЙ рамки, а строка
                    «Ответственные лица» — последняя в бланке, поэтому на
                    бумаге весь блок оставался с открытым низом: рамка
                    таблицы просто обрывалась после «Периодичности».
                    GRID_CELL_CLASS закрывает контур (в border-collapse
                    лишние линии сливаются с соседями). */}
                <td
                  colSpan={3}
                  className={`${GRID_CELL_CLASS} p-0 align-top text-[15px] leading-6`}
                >
                  <div className="space-y-2 px-5 py-2">
                  {config.responsibles.length > 0 ? (
                    config.responsibles.map((responsible) => {
                      const user = userMap[responsible.userId];
                      // Должность этого человека из карточки; сохранённая —
                      // только если его уже нет в организации.
                      const responsibleTitle = getRowEmployeeTitle(user, responsible.title);
                      return (
                        <div key={responsible.id} className="flex items-center justify-between gap-3">
                          <span>
                            {responsibleTitle} - {user?.name || "Не выбран"}
                          </span>
                          {isActive ? (
                            <button
                              type="button"
                              aria-label={`Удалить ответственного «${responsibleTitle}»`}
                              /* R5-3а: без print:hidden иконки-корзины
                                 уходили на бумагу — в официальном бланке
                                 у каждого ответственного печаталась
                                 красная корзина удаления. */
                              className="shrink-0 text-[#ff3b30] transition-colors duration-150 hover:text-[#d92b21] print:hidden"
                              onClick={() => {
                                persistConfig({
                                  ...config,
                                  responsibles: config.responsibles.filter(
                                    (item) => item.id !== responsible.id
                                  ),
                                }).catch((error) =>
                                  toast.error(
                                    humanizeFetchError(error, "Не удалось обновить список ответственных")
                                  )
                                );
                              }}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div>—</div>
                  )}
                  </div>
                  {isActive ? (
                    <button
                      type="button"
                      className={CHECKLIST_ADD_CELL_CLASS}
                      onClick={() => setResponsibleDialogOpen(true)}
                    >
                      <Plus className="size-5" strokeWidth={2.5} />
                      Добавить ответственного
                    </button>
                  ) : null}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        </div>


        {mobileView === "cards" ? (
          <RecordCardsView
            items={rows.map((row, index) => ({
              id: row.dateKey,
              title: `№${index + 1} · ${formatRuDate(row.dateKey)}`,
              subtitle: `${row.procedures.length} процедур`,
              leading: isActive ? (
                <Checkbox
                  checked={selection.includes(row.dateKey)}
                  onCheckedChange={(checked) =>
                    setSelection((current) =>
                      checked === true
                        ? [...new Set([...current, row.dateKey])]
                        : current.filter((item) => item !== row.dateKey)
                    )
                  }
                  className="size-5"
                />
              ) : null,
              fields: row.procedures.map((procedure) => {
                const responsibleName = userMap[procedure.responsibleUserId]?.name || "";
                const times = procedure.times.filter(Boolean).join(" · ") || "—";
                // Автозаполнение решает, ПОДСТАВЛЯТЬ ли время заранее, а не
                // можно ли человеку поправить уже записанное: при выключенном
                // автозаполнении время было видно, но не редактировалось.
                const editable = isActive;
                return {
                  label: procedure.label,
                  value: (
                    <div className="space-y-1">
                      <div>{times}</div>
                      {responsibleName ? (
                        <div className="text-[12px] text-[#6f7282]">{responsibleName}</div>
                      ) : null}
                    </div>
                  ),
                  onClick: editable
                    ? () =>
                        setEditingProcedure({
                          dateKey: row.dateKey,
                          procedureId: procedure.id,
                        })
                    : undefined,
                  hint: editable ? "нажмите, чтобы изменить время" : undefined,
                };
              }),
            }))}
            emptyLabel="Журнал пока пуст."
          />
        ) : null}

        {/* «Добавить» — слева непосредственно над таблицей (эталон).
            Раньше кнопка стояла справа и выше mobile-переключателя. */}
        <div className={DOC_ADD_ROW_CLASS}>
          {isActive ? (
            <Button
              type="button"
              onClick={() => setAddDateOpen(true)}
              className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white hover:bg-[#4a5bf0]"
            >
              <Plus className="size-5" strokeWidth={2.5} />
              Добавить
            </Button>
          ) : null}
        </div>

        {/* Липкая шапка: у чек-листа 90+ строк (3 процедуры × 31 день), и
            без sticky заголовки колонок уезжали на первом же экране. Скролл
            собственный (max-h + overflow-y-auto), потому что страница
            журналов лежит в transform-обёртке — position:sticky относительно
            окна там работает непредсказуемо, а внутри своего скролл-контейнера
            надёжно. При печати ограничение высоты и залипание снимаются.
            Ширины колонок фиксируем через colgroup: «ФИО ответственного
            лица» раньше сжималось до «Администрат…». */}
        <MobileViewTableWrapper
          mobileView={mobileView}
          // Своя рамка прокрутки сетки 1140px (общий класс). Вертикальный
          // скролл с липкой шапкой — от 640px, как и было: на телефоне
          // сетка идёт во всю высоту.
          className={`${JOURNAL_TABLE_SCROLL_CLASS} sm:max-h-[70vh] sm:overflow-y-auto rounded-[28px] border border-[#333] print:max-h-none print:overflow-visible print:border-black`}
        >
          <table className="min-w-[1140px] w-full table-fixed border-collapse text-[13px]">
            <colgroup>
              {/* Q2-3: колонка выделения строк не печатается. Прячем
                  ИМЕННО <col>, а не только ячейки: при table-fixed
                  оставшийся <col> сдвинул бы все ширины на одну. */}
              <col className="w-[58px] print:hidden" />
              <col className="w-[130px]" />
              <col className="w-[220px]" />
              {/* V4: 150px = два селекта по 64px + зазор + поля ячейки. */}
              <col className="w-[150px]" />
              <col className="w-[150px]" />
              <col className="w-[150px]" />
              <col className="w-[280px]" />
            </colgroup>
            <thead className="max-sm:static sticky top-0 z-20 print:static">
              <tr className="bg-[#f8f9fc] print:bg-white">
                <th className={`${CHECKLIST_STICKY_HEAD_CLASS} border-r px-4 py-4 text-center print:hidden`}>
                  <div className="flex justify-center">
                    <Checkbox
                      checked={rows.length > 0 && selection.length === rows.length}
                      onCheckedChange={(checked) =>
                        setSelection(Boolean(checked) ? rows.map((r) => r.dateKey) : [])
                      }
                      disabled={!isActive}
                      className="size-5 rounded-[8px]"
                    />
                  </div>
                </th>
                <th className={`${CHECKLIST_STICKY_HEAD_CLASS} border-r px-4 py-4 text-left`}>
                  Дата
                </th>
                <th className={`${CHECKLIST_STICKY_HEAD_CLASS} border-r px-4 py-4 text-left`}>
                  Процедура
                </th>
                <th className={`${CHECKLIST_STICKY_HEAD_CLASS} border-r px-4 py-4 text-center`}>
                  Время 1
                </th>
                <th className={`${CHECKLIST_STICKY_HEAD_CLASS} border-r px-4 py-4 text-center`}>
                  Время 2
                </th>
                <th className={`${CHECKLIST_STICKY_HEAD_CLASS} border-r px-4 py-4 text-center`}>
                  Время 3
                </th>
                <th className={`${CHECKLIST_STICKY_HEAD_CLASS} px-4 py-4 text-left`}>
                  ФИО ответственного лица
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) =>
                row.procedures.map((procedure, index) => {
                  const selected = selection.includes(row.dateKey);
                  const responsibleName = userMap[procedure.responsibleUserId]?.name || "";
                  return (
                    <tr
                      key={`${row.dateKey}-${procedure.id}`}
                      data-focus-today={
                        index === 0 && row.dateKey === todayKey ? "" : undefined
                      }
                      className="bg-white"
                    >
                      {index === 0 ? (
                        <td
                          rowSpan={row.procedures.length}
                          className="border-b border-r border-[#333] print:border-black px-4 py-4 align-top leading-tight print:hidden"
                        >
                          <div className="flex justify-center">
                            <Checkbox
                              checked={selected}
                              disabled={!isActive}
                              onCheckedChange={(checked) => {
                                setSelection((current) =>
                                  checked === true
                                    ? [...new Set([...current, row.dateKey])]
                                    : current.filter((item) => item !== row.dateKey)
                                );
                              }}
                              className="mt-1 size-5 rounded-[8px]"
                            />
                          </div>
                        </td>
                      ) : null}
                      {index === 0 ? (
                        <td
                          rowSpan={row.procedures.length}
                          className="border-b border-r border-[#333] print:border-black px-4 py-4 align-top text-[16px] text-black leading-tight"
                        >
                          {formatRuDate(row.dateKey)}
                        </td>
                      ) : null}
                      <td className="border-b border-r border-[#333] print:border-black px-4 py-4 text-[16px] text-black leading-tight">
                        {procedure.label}
                      </td>
                      {[0, 1, 2].map((timeIndex) => (
                        <td
                          key={`${row.dateKey}-${procedure.id}-${timeIndex}`}
                          className={`border-b border-r border-[#333] print:border-black px-2 py-1 leading-tight ${
                            // Незаполненный слот — розовая заливка: инспектор
                            // сразу видит недооформленный документ.
                            timeIndex < procedure.plannedCount &&
                            !procedure.times[timeIndex]
                              ? CHECKLIST_EMPTY_CELL_CLASS
                              : ""
                          }`}
                        >
                          {/* Q2-10: на бумаге печатаем ФАКТИЧЕСКОЕ время
                              и ничего, если его нет. Селект подставляет
                              `00:00` для незаданного слота — у процедур с
                              периодичностью 2 раза «Время 3» печаталось
                              третьим фиктивным замером. */}
                          <span className="hidden print:inline text-[13px] text-black">
                            {procedure.times[timeIndex] || ""}
                          </span>
                          <span className="print:hidden">
                            <TimeSelect
                              value={procedure.times[timeIndex] || ""}
                              disabled={!isActive}
                              onChange={(value) => {
                                updateProcedureTime(row.dateKey, procedure, timeIndex, value).catch(
                                  (error) =>
                                    toast.error(
                                      humanizeFetchError(error, "Не удалось сохранить время")
                                    )
                                );
                              }}
                            />
                          </span>
                        </td>
                      ))}
                      <td className="border-b border-[#333] print:border-black px-4 py-4 text-[16px] text-black leading-tight">
                        {responsibleName}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </MobileViewTableWrapper>
        </div>
      </div>

      <DocumentSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        users={users}
        initial={settingsState}
        onSubmit={async (value) => {
          await persistConfig(
            {
              ...config,
              ventilationEnabled: value.ventilationEnabled,
              mainResponsibleTitle: getRowEmployeeTitle(
                users.find((user) => user.id === value.mainResponsibleUserId),
                value.mainResponsibleTitle
              ),
              mainResponsibleUserId: value.mainResponsibleUserId,
              procedures: config.procedures.map((item) => ({
                ...item,
                responsibleUserId:
                  item.responsibleUserId === config.mainResponsibleUserId
                    ? value.mainResponsibleUserId
                    : item.responsibleUserId,
              })),
            },
            {
              title: value.title,
              dateFrom: value.dateFrom,
            }
          );
        }}
        useV2={useV2}
      />

      <AddChecklistDateDialog
        open={addDateOpen}
        onOpenChange={setAddDateOpen}
        min={addDateBounds.min}
        max={addDateBounds.max}
        suggested={suggestedDate}
        hiddenDates={restorableDates}
        onAdd={async (date) => {
          try {
            await addManualDate(date);
          } catch (error) {
            toast.error(
              humanizeFetchError(error, "Не удалось добавить дату")
            );
            throw error;
          }
        }}
      />

      <AddPeriodicityDialog
        open={periodicityDialogOpen}
        onOpenChange={setPeriodicityDialogOpen}
        onAdd={async (line) => {
          await persistConfig({
            ...config,
            extraPeriodicityLines: [...(config.extraPeriodicityLines ?? []), line],
          });
        }}
      />

      <AddResponsibleDialog
        open={responsibleDialogOpen}
        onOpenChange={setResponsibleDialogOpen}
        users={users}
        onAdd={async (responsible) => {
          await persistConfig({
            ...config,
            responsibles: [...config.responsibles, responsible],
          });
        }}
      />

      {/* Времена одной процедуры за день — вход из карточки. */}
      {(() => {
        const editingRow = editingProcedure
          ? rows.find((row) => row.dateKey === editingProcedure.dateKey)
          : undefined;
        const procedure = editingRow?.procedures.find(
          (item) => item.id === editingProcedure?.procedureId
        );
        // Слоты те же три, что и в таблице. Раньше поля строились от УЖЕ
        // заполненных времён, и для пустого дня лист правки открывался
        // без единого поля — с телефона день нельзя было заполнить.
        const slotCount = procedure
          ? Math.min(3, Math.max(procedure.times.length, procedure.plannedCount, 1))
          : 0;
        const fields: CardEditFieldDef[] = Array.from(
          { length: slotCount },
          (_, index) => ({
            type: "time" as const,
            key: `time${index}`,
            label: slotCount > 1 ? `Время ${index + 1}` : "Время",
          })
        );
        const values: CardEditValues = {};
        procedure?.times.forEach((time, index) => {
          values[`time${index}`] = time || "";
        });

        return (
          <CardEditSheet
            open={Boolean(procedure)}
            title={procedure?.label ?? "Процедура"}
            subtitle={
              editingRow ? formatRuDate(editingRow.dateKey) : undefined
            }
            fields={fields}
            values={values}
            onClose={() => setEditingProcedure(null)}
            onSubmit={(next) => {
              if (!editingProcedure || !procedure) return;
              editProcedure(editingProcedure.dateKey, procedure, next).catch(
                (error) =>
                  toast.error(
                    humanizeFetchError(error, "Не удалось сохранить время")
                  )
              );
            }}
          />
        );
      })()}
    </div>
  );
}
