"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarRange, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { buildStaffOptionLabel } from "@/lib/journal-staff-binding";
import { getUsersForRoleLabel } from "@/lib/user-roles";
import {
  SANITATION_MONTHS,
  applyRoomDirectoryToSanitationConfig,
  createEmptySanitationRow,
  getSanitationApproveLabel,
  listSanitationRoomsNotInDocument,
  normalizeSanitationDayConfig,
  sanitationScheduleFromKey,
  suggestDirectoryRoomForSanitationRow,
  summarizeCleanings,
  type SanitationDayConfig,
  type SanitationRoomRow,
} from "@/lib/sanitation-day-document";
import {
  describeGeneralSchedule,
  roomGeneralSchedule,
  type RoomGeneralSchedule,
} from "@/lib/general-cleaning-schedule";
import {
  applyGeneralCleaningOp,
  diffCleaningPlans,
  type GeneralCleaningOp,
} from "@/lib/general-cleaning-ops";
import { nextOpenCleaning } from "@/lib/tasksflow-adapters/sanitation-day-tasks";
import {
  RoomEditorDialog,
  type RoomEditorInitial,
  type RoomEditorSavedSnapshot,
} from "@/components/cleaning/room-editor-dialog";
import { RoomDirectoryPickerDialog } from "@/components/cleaning/room-directory-picker-dialog";
import { directoryRoomToEditorInitial } from "@/components/cleaning/room-editor-initial";
import type { DirectoryBuilding, DirectoryRoom } from "@/lib/room-directory";
import { DocumentActionsBar } from "@/components/journals/document-actions-bar";
import {
  DOC_ADD_ROW_CLASS,
  DOC_BODY_STACK_CLASS,
  DOC_TITLE_ROW_NO_STRIP_CLASS,
  DOC_CAPS_TITLE_CLASS,
  DOC_HEADING_CLASS,
  DOC_PAPER_CANVAS_CLASS,
  DOC_PAPER_HEADER_CLASS,
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
} from "@/components/journals/journal-responsive";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { JournalClosedBanner } from "@/components/journals/journal-closed-banner";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  MobileViewToggle,
  MobileViewTableWrapper,
} from "@/components/journals/mobile-view-toggle";
import {
  RecordCardsView,
} from "@/components/journals/record-cards-view";
import { DateField } from "@/components/journals/journal-dialog-field";
import { GeneralCleaningMonthCell } from "@/components/journals/general-cleaning/month-cell";
import {
  GeneralCleaningMonthEditor,
  GeneralCleaningMonthPanel,
  describeMonthLoad,
  type GeneralCleaningAnchor,
} from "@/components/journals/general-cleaning/month-editor";
import { GeneralCleaningYearSheet } from "@/components/journals/general-cleaning/year-sheet";
import { GeneralCleaningFillDialog } from "@/components/journals/general-cleaning/fill-dialog";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import {
  GRID_CELL_CLASS,
  GRID_HEAD_CELL_CLASS,
  GRID_SERVICE_LABEL_CLASS,
  GRID_VIEWPORT_CLASS,
} from "@/components/journals/journal-grid";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { JournalPaperHeaderRows } from "@/components/journals/journal-document-header";
import { localDayKey } from "@/lib/entry-defaults";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
import { resolveApprover, resolveResponsible } from "@/lib/approver-display";
import { useLiveRefetch } from "@/lib/use-live-refetch";
import { useTodayKey } from "@/lib/use-today-key";
import { MONTH_NAMES_RU, formatDayMonth, formatDayMonthWeekday } from "@/lib/wheel-date";

/**
 * Screen ↔ print duality tokens (тот же приём, что в
 * `cleaning-document-client.tsx` / `hygiene-document-client.tsx`).
 */

type UserItem = {
  id: string;
  name: string;
  role: string;
};

type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  /**
   * «Периодичность контроля» — вторая строка бумажной шапки документа
   * (`config.controlPeriodicity`, дефолт — из реестра шаблонов).
   * Пустая строка ⇒ строка в шапке не рендерится.
   */
  controlPeriodicity?: string;
  status: string;
  users: UserItem[];
  /**
   * 2026-09-04: единый справочник помещений (/settings/buildings).
   * Строки с `roomId` берут название из него; карточка помещения
   * открывается прямо из журнала.
   */
  buildings?: DirectoryBuilding[];
  config: unknown;
  /** Design v2 toggle. */
  useV2?: boolean;
  /**
   * Интеграция с TasksFlow включена: подсказываем, что в день уборки
   * исполнитель получит задачу.
   */
  tasksflowEnabled?: boolean;
};

type SettingsState = {
  title: string;
  documentDate: string;
  year: string;
  approveRole: string;
  approveEmployeeId: string;
  approveEmployee: string;
  responsibleRole: string;
  responsibleEmployeeId: string;
  responsibleEmployee: string;
};

type RoomDialogState = {
  id: string | null;
  name: string;
};

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

function toViewDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  if (!year || !month || !day) return dateKey;
  // `toLocaleDateString({ month: "long" })` без дня даёт именительный
  // падеж («январь»), а бланк требует родительный («января»). Просим
  // локаль отформатировать дату целиком с днём — тогда падеж верный —
  // и забираем из результата только название месяца.
  const monthName = new Date(`${year}-${month}-${day}T00:00:00`)
    .toLocaleDateString("ru-RU", { day: "numeric", month: "long" })
    .replace(/^\d+\s+/, "");
  return `« ${day} » ${monthName} ${year} г.`;
}

function datesPreview(dates: string[]): string {
  const shown = dates.slice(0, 5).map(formatDayMonth).join(", ");
  return dates.length > 5 ? `${shown} и ещё ${dates.length - 5}` : shown;
}

function RoomDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  submitText: string;
  initial: RoomDialogState;
  /** Помещения справочника, с которыми можно связать legacy-строку. */
  linkOptions?: Array<{ id: string; name: string }>;
  onSubmit: (value: RoomDialogState, linkRoomId?: string | null) => Promise<void>;
}) {
  const [state, setState] = useState<RoomDialogState>(props.initial);
  const [linkRoomId, setLinkRoomId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Окно открывают снаружи (setRoomDialogOpen), и onOpenChange(true) при этом
  // не срабатывает: без ресинка окно показывало прошлую строку, а «Сохранить»
  // с пустым id создавал дубль вместо правки.
  useEffect(() => {
    if (!props.open) return;
    setState(props.initial);
    setLinkRoomId("");
  }, [props.open, props.initial]);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(value) => {
        if (value) {
          setState(props.initial);
          setLinkRoomId("");
        }
        props.onOpenChange(value);
      }}
    >
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <div className="flex items-center justify-between">
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              {props.title}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5">
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              Название помещения
            </Label>
            <Input
              value={state.name}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="Введите название помещения"
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
            />
          </div>

          {props.initial.id && (props.linkOptions?.length ?? 0) > 0 ? (
            <div className="space-y-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
              <Label className="text-[13px] font-medium text-[#3c4053]">
                Связать с помещением из справочника
              </Label>
              <select
                value={linkRoomId}
                onChange={(event) => setLinkRoomId(event.target.value)}
                className="h-10 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              >
                <option value="">— не связывать —</option>
                {props.linkOptions?.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
              <p className="text-[11.5px] leading-[1.5] text-[#6f7282]">
                После связи название, ответственные и график генуборки берутся из карточки помещения («Настройки → Помещения»); даты плана сохраняются.
              </p>
            </div>
          ) : null}

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              disabled={submitting}
              onClick={async () => {
                if (!state.name.trim()) {
                  toast.error("Введите название помещения");
                  return;
                }
                setSubmitting(true);
                try {
                  await props.onSubmit({ ...state, name: state.name.trim() }, linkRoomId || null);
                  // Окно закрывает родитель: очередь правок может открыть
                  // следующее помещение.
                } finally {
                  setSubmitting(false);
                }
              }}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4a5bf0]"
            >
              {submitting ? "Сохранение..." : props.submitText}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DocumentSettingsDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  users: UserItem[];
  initial: SettingsState;
  onSubmit: (value: SettingsState) => Promise<void>;
  useV2?: boolean;
}) {
  const [state, setState] = useState<SettingsState>(props.initial);
  const [submitting, setSubmitting] = useState(false);
  // Тот же ресинк, что и в RoomDialog: окно открывается снаружи.
  useEffect(() => {
    if (!props.open) return;
    setState(props.initial);
  }, [props.open, props.initial]);
  const resolveRoleCandidates = (roleLabel: string) =>
    usersForRole(props.users, roleLabel);

  const approveCascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: state.approveRole,
    userId: state.approveEmployeeId,
    onChange: (next) =>
      setState((current) => {
        const user = props.users.find((item) => item.id === next.userId);
        return {
          ...current,
          approveRole: next.positionTitle,
          approveEmployeeId: next.userId,
          approveEmployee: user
            ? user.name
            : next.positionTitle !== current.approveRole
              ? current.approveEmployee
              : "",
        };
      }),
    resolveCandidates: resolveRoleCandidates,
    autoPick: "first",
  });

  const responsibleCascade = usePositionEmployeeCascade({
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
    resolveCandidates: resolveRoleCandidates,
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

  // «Дата документа» — барабан «день | месяц | год»: дата в шапке бланка
  // редко бывает сегодняшней, листать календарь по месяцам неудобно.
  const documentDateField = (
    <DateField
      picker="wheel"
      label="Дата документа"
      value={state.documentDate}
      onChange={(value) =>
        setState((current) => ({
          ...current,
          documentDate: toIsoDate(value),
        }))
      }
    />
  );

  if (props.useV2) {
    return (
      <JournalSettingsModal
        open={props.open}
        onOpenChange={(value) => {
          if (value) setState(props.initial);
          props.onOpenChange(value);
        }}
        title="Настройки документа"
        description="Название документа, дата, год и две роли: утверждающий и ответственный."
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
            placeholder="Название документа"
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {documentDateField}
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Год
            </Label>
            <Select
              value={state.year}
              onValueChange={(value) =>
                setState((current) => ({ ...current, year: value }))
              }
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 8 }).map((_, idx) => {
                  const year = String(new Date().getFullYear() - 2 + idx);
                  return (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>
        {state.year !== props.initial.year ? (
          <p className="rounded-2xl bg-[#fff8eb] px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-[#8a5a14]">
            Даты плана и отметки перенесутся на {state.year} год — те же числа и месяцы. Перед
            сохранением мы спросим ещё раз.
          </p>
        ) : null}
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {/* G6: у эталона кавычки прямые, не «ёлочки». */}
            Должность &quot;Утверждаю&quot;
          </Label>
          <Select
            value={state.approveRole}
            onValueChange={approveCascade.handlePositionChange}
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
            Сотрудник (утверждает)
          </Label>
          <Select
            value={state.approveEmployeeId || "__empty__"}
            onValueChange={approveCascade.handleEmployeeChange}
            open={approveCascade.employeeOpen}
            onOpenChange={approveCascade.setEmployeeOpen}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue placeholder="— Выберите —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__empty__">— не выбран —</SelectItem>
              {approveCascade.candidates.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {buildStaffOptionLabel(user)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Должность ответственного
          </Label>
          <Select
            value={state.responsibleRole}
            onValueChange={responsibleCascade.handlePositionChange}
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
            Сотрудник (ответственный)
          </Label>
          <Select
            value={state.responsibleEmployeeId || "__empty__"}
            onValueChange={responsibleCascade.handleEmployeeChange}
            open={responsibleCascade.employeeOpen}
            onOpenChange={responsibleCascade.setEmployeeOpen}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue placeholder="— Выберите —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__empty__">— не выбран —</SelectItem>
              {responsibleCascade.candidates.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {buildStaffOptionLabel(user)}
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
      onOpenChange={(value) => {
        if (value) setState(props.initial);
        props.onOpenChange(value);
      }}
    >
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <div className="flex items-center justify-between">
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              Настройки документа
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5">
          <Input
            value={state.title}
            onChange={(event) =>
              setState((current) => ({ ...current, title: event.target.value }))
            }
            placeholder="Название документа"
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
          />

          {documentDateField}

          <Select
            value={state.year}
            onValueChange={(value) =>
              setState((current) => ({ ...current, year: value }))
            }
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 8 }).map((_, idx) => {
                const year = String(new Date().getFullYear() - 2 + idx);
                return (
                  <SelectItem key={year} value={year}>
                    {year}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <Select
            value={state.approveRole}
            onValueChange={approveCascade.handlePositionChange}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
              <SelectValue placeholder='Должность "Утверждаю"' />
            </SelectTrigger>
            <SelectContent>
              <PositionSelectItems users={props.users} />
            </SelectContent>
          </Select>

          <Select
            value={state.approveEmployeeId || "__empty__"}
            onValueChange={approveCascade.handleEmployeeChange}
            open={approveCascade.employeeOpen}
            onOpenChange={approveCascade.setEmployeeOpen}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
              <SelectValue placeholder="Сотрудник" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__empty__">Выберите сотрудника</SelectItem>
              {approveCascade.candidates.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {buildStaffOptionLabel(user)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={state.responsibleRole}
            onValueChange={responsibleCascade.handlePositionChange}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
              <SelectValue placeholder="Должность ответственного" />
            </SelectTrigger>
            <SelectContent>
              <PositionSelectItems users={props.users} />
            </SelectContent>
          </Select>

          <Select
            value={state.responsibleEmployeeId || "__empty__"}
            onValueChange={responsibleCascade.handleEmployeeChange}
            open={responsibleCascade.employeeOpen}
            onOpenChange={responsibleCascade.setEmployeeOpen}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
              <SelectValue placeholder="Сотрудник" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__empty__">Выберите сотрудника</SelectItem>
              {responsibleCascade.candidates.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {buildStaffOptionLabel(user)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true);
                try {
                  await props.onSubmit(state);
                  props.onOpenChange(false);
                } finally {
                  setSubmitting(false);
                }
              }}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4a5bf0]"
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SanitationDayDocumentClient({
  documentId,
  title,
  organizationName,
  controlPeriodicity = "",
  status,
  users,
  buildings = [],
  config,
  useV2 = false,
  tasksflowEnabled = false,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const todayKey = useTodayKey();
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [roomDialogState, setRoomDialogState] = useState<RoomDialogState>({
    id: null,
    name: "",
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  // Редактор месяца (поповер у ячейки / лист снизу) и годовой лист строки
  // для карточек на телефоне.
  const [editor, setEditor] = useState<{ rowId: string; monthIndex: number } | null>(null);
  const anchorRef = useRef<GeneralCleaningAnchor>({
    getBoundingClientRect: () => new DOMRect(),
  });
  const [yearSheetRowId, setYearSheetRowId] = useState<string | null>(null);
  const [fillOpen, setFillOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [roomEditor, setRoomEditor] = useState<RoomEditorInitial | null>(null);
  // Справочник помещений: название строк с roomId — из Room.
  const directoryRooms = useMemo(
    () => buildings.flatMap((b) => b.rooms),
    [buildings],
  );
  // График генуборки каждого помещения справочника (null — не задан).
  const scheduleByRoomId = useMemo(
    () =>
      new Map<string, RoomGeneralSchedule | null>(
        directoryRooms.map((room) => [room.id, roomGeneralSchedule(room)]),
      ),
    [directoryRooms],
  );
  // Ответ операции показываем сразу, не дожидаясь router.refresh():
  // `source` — проп, от которого он получен; новый проп с сервера его
  // вытесняет сам.
  const [override, setOverride] = useState<{ source: unknown; config: SanitationDayConfig } | null>(null);
  const baseConfig =
    override && override.source === config ? override.config : normalizeSanitationDayConfig(config);
  const normalized = applyRoomDirectoryToSanitationConfig(baseConfig, directoryRooms);
  // Последнее локальное состояние конфига + очередь сохранений: быстрый
  // ввод по ячейкам месяцев раньше строил каждый PATCH от серверного пропа.
  const configRef = useRef(normalized);
  const configPropRef = useRef<unknown>(config);
  useEffect(() => {
    // Пришли свежие серверные данные — начинаем от них.
    configRef.current = normalized;
    configPropRef.current = config;
    // Намеренно только по пропу `config`: `normalized` пересоздаётся
    // на каждый рендер и затирал бы локальное состояние.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  // Отметка, пришедшая из TasksFlow или по QR, появляется без перезагрузки.
  useLiveRefetch(() => router.refresh(), { codes: ["general_cleaning"] });
  // Шапка «УТВЕРЖДАЮ» и строка «Ответственный»: должность и ФИО одного
  // человека — из его карточки, сохранённые строки только для уволенных.
  const approver = resolveApprover(normalized, users);
  const responsible = resolveResponsible(normalized, users);
  const userNameById = useMemo(
    () => new Map(users.map((u) => [u.id, u.name])),
    [users],
  );
  const readOnly = status === "closed";
  const { mobileView, switchMobileView } = useMobileView("general_cleaning");

  const allSelected =
    normalized.rows.length > 0 &&
    selectedRowIds.length === normalized.rows.length;
  const journalHref = pathname
    ? pathname.split("/documents/")[0]
    : "/journals/general_cleaning";

  // useMemo обязателен: объект уходит в диалог как `initial`, а тот
  // ресинкается по его ссылке — новый объект на каждый рендер стирал бы
  // ввод пользователя.
  const settingsState: SettingsState = useMemo(
    () => ({
      title,
      documentDate: normalized.documentDate,
      year: String(normalized.year),
      approveRole: normalized.approveRole,
      approveEmployeeId: normalized.approveEmployeeId || "",
      approveEmployee: normalized.approveEmployee,
      responsibleRole: normalized.responsibleRole,
      responsibleEmployeeId: normalized.responsibleEmployeeId || "",
      responsibleEmployee: normalized.responsibleEmployee,
    }),
    [
      title,
      normalized.documentDate,
      normalized.year,
      normalized.approveRole,
      normalized.approveEmployeeId,
      normalized.approveEmployee,
      normalized.responsibleRole,
      normalized.responsibleEmployeeId,
      normalized.responsibleEmployee,
    ],
  );

  async function patchConfig(
    nextConfig: SanitationDayConfig,
    nextTitle = title,
  ) {
    // Следующая правка строится от этого состояния, а не от серверного
    // пропа: быстрые правки успевали перезаписать друг друга.
    const previousConfig = configRef.current;
    configRef.current = nextConfig;
    // Сохранения — строго по очереди, двойной клик не создаёт дубль.
    const run = saveChainRef.current.catch(() => {}).then(async () => {
      const response = await fetch(`/api/journal-documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: nextTitle,
          dateFrom: nextConfig.documentDate,
          dateTo: nextConfig.documentDate,
          responsibleTitle: nextConfig.responsibleRole,
          config: nextConfig,
        }),
      });

      if (!response.ok) {
        configRef.current = previousConfig;
        const body = await response.json().catch(() => null);
        toast.error(
          (body && typeof body.error === "string" && body.error) ||
            "Не удалось сохранить документ",
        );
        return;
      }

      setSelectedRowIds([]);
      setOverride({ source: configPropRef.current, config: nextConfig });
      router.refresh();
    });
    saveChainRef.current = run;
    await run;
  }

  /**
   * Одна правка уборок (`POST …/general-cleaning`): сервер применяет её к
   * свежему конфигу под блокировкой документа — отметки из задач и
   * соседние вкладки не затираются. true — сохранилось.
   */
  async function postOp(op: GeneralCleaningOp): Promise<boolean> {
    const run = saveChainRef.current.catch(() => {}).then(async () => {
      try {
        const response = await fetch(`/api/journal-documents/${documentId}/general-cleaning`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          toast.error(
            (body && typeof body.error === "string" && body.error) ||
              "Не удалось сохранить график",
          );
          return false;
        }
        const next = normalizeSanitationDayConfig(body?.config);
        configRef.current = applyRoomDirectoryToSanitationConfig(next, directoryRooms);
        setOverride({ source: configPropRef.current, config: next });
        router.refresh();
        return true;
      } catch (error) {
        toast.error(humanizeFetchError(error, "Не удалось сохранить график"));
        return false;
      }
    });
    saveChainRef.current = run;
    return run;
  }

  /** Кто убирает / проверяет помещение строки — из справочника. */
  function roomPeople(row: SanitationRoomRow): { cleaners: string[]; verifiers: string[] } {
    const dbRoom = row.roomId ? directoryRooms.find((r) => r.id === row.roomId) : undefined;
    if (!dbRoom) return { cleaners: [], verifiers: [] };
    const nameOf = (id: string) => userNameById.get(id) ?? "—";
    return {
      cleaners: dbRoom.cleanerUserIds.map(nameOf),
      verifiers: dbRoom.verifierUserIds.map(nameOf),
    };
  }

  function rowSchedule(row: SanitationRoomRow): RoomGeneralSchedule | null {
    return row.roomId ? scheduleByRoomId.get(row.roomId) ?? null : null;
  }

  function rowLinked(row: SanitationRoomRow): boolean {
    return Boolean(row.roomId && scheduleByRoomId.has(row.roomId));
  }

  function openMonthEditor(rowId: string, monthIndex: number, event: MouseEvent<HTMLButtonElement>) {
    anchorRef.current = event.currentTarget;
    setEditor({ rowId, monthIndex });
  }

  /** Правка выделенных помещений по очереди — карточкой или legacy-диалогом. */
  const seq = useSequentialEdit({
    open: (id) => {
      const row = configRef.current.rows.find((item) => item.id === id);
      if (!row || readOnly) return false;
      openRowEditor(row);
      return true;
    },
    close: () => {
      setRoomDialogOpen(false);
      setRoomEditor(null);
    },
  });
  // Карточка помещения зовёт onOpenChange(false) и сразу onSaved —
  // «отмену» решаем после тика, когда известно, было ли сохранение.
  const roomEditorSavedRef = useRef(false);

  /** Клик по помещению: со связью — карточка помещения, без — legacy-диалог. */
  function openRowEditor(row: SanitationRoomRow) {
    const dbRoom = row.roomId ? directoryRooms.find((r) => r.id === row.roomId) : undefined;
    if (dbRoom) {
      setRoomEditor(directoryRoomToEditorInitial(dbRoom));
      return;
    }
    setRoomDialogState({ id: row.id, name: row.roomName });
    setRoomDialogOpen(true);
  }

  /**
   * Помещение из справочника → строка графика (id стабильный
   * `row-room-<Room.id>`). План сразу заполнен по графику помещения — с
   * сегодняшнего дня до конца года документа.
   */
  async function addRoomFromDirectory(room: DirectoryRoom) {
    const current = configRef.current;
    if (current.rows.some((r) => r.roomId === room.id)) {
      toast.error("Это помещение уже есть в графике");
      return;
    }
    const nextRow = createEmptySanitationRow(
      room.name,
      room.id,
      roomGeneralSchedule(room),
      sanitationScheduleFromKey(current.year, todayKey),
    );
    await patchConfig({
      ...current,
      rows: [...current.rows, nextRow],
    });
  }

  /** «Связать» legacy-строку с помещением: id строки не меняем (линки TF живы). */
  async function linkRow(rowId: string, room: { id: string; name: string }) {
    const current = configRef.current;
    await patchConfig({
      ...current,
      rows: current.rows.map((r) =>
        r.id === rowId ? { ...r, roomId: room.id, roomName: room.name } : r,
      ),
    });
  }

  async function saveRoomDialog(value: RoomDialogState, linkRoomId?: string | null) {
    if (value.id && linkRoomId) {
      const room = directoryRooms.find((r) => r.id === linkRoomId);
      if (room) {
        await linkRow(value.id, room);
        return;
      }
    }
    const current = configRef.current;
    if (!value.id) {
      await patchConfig({
        ...current,
        rows: [...current.rows, createEmptySanitationRow(value.name)],
      });
      return;
    }

    await patchConfig({
      ...current,
      rows: current.rows.map((row) =>
        row.id === value.id ? { ...row, roomName: value.name } : row,
      ),
    });
  }

  async function deleteSelectedRows() {
    const count = selectedRowIds.length;
    const confirmed = await confirmAsync({
      title: count > 1 ? `Удалить ${count} строк?` : "Удалить строку?",
      description: "Строки помещений, их план и отметки о выполнении будут удалены безвозвратно.",
      variant: "danger",
      confirmLabel: "Удалить",
    });
    if (!confirmed) return;

    const rowIdSet = new Set(selectedRowIds);
    const current = configRef.current;
    await patchConfig({
      ...current,
      rows: current.rows.filter((row) => !rowIdSet.has(row.id)),
    });
  }

  /**
   * В карточке помещения поменяли график генуборки — предлагаем привести
   * к нему будущие даты этой строки (прошлое и отметки не меняются).
   */
  async function offerScheduleRefresh(snapshot: RoomEditorSavedSnapshot, inSequence: boolean) {
    if (!snapshot.scheduleChanged || readOnly) return;
    const row = configRef.current.rows.find((item) => item.roomId === snapshot.id);
    if (!row) return;
    const schedule = roomGeneralSchedule(snapshot);
    if (!schedule) {
      toast.info(`У «${row.roomName}» больше нет графика генуборки — даты в плане остались как были`);
      return;
    }
    if (inSequence) {
      toast.info("График помещения изменился — обновите даты кнопкой «Заполнить план по графику»");
      return;
    }
    const op: GeneralCleaningOp = {
      type: "fillFromSchedule",
      rowIds: [row.id],
      mode: "replace-future",
      fromDate: todayKey,
    };
    const schedules = new Map(scheduleByRoomId);
    schedules.set(snapshot.id, schedule);
    let change: { added: string[]; removed: string[] } | undefined;
    try {
      const result = applyGeneralCleaningOp(configRef.current, op, {
        todayKey,
        userId: null,
        schedules,
      });
      change = diffCleaningPlans(configRef.current, result.config).get(row.id);
    } catch {
      return;
    }
    if (!change) return;
    const ok = await confirmAsync({
      title: `Обновить план «${row.roomName}» по новому графику?`,
      description: `Новый график: ${describeGeneralSchedule(schedule)}.`,
      bullets: [
        ...(change.added.length > 0
          ? [{ label: `Добавятся: ${datesPreview(change.added)}`, tone: "info" as const }]
          : []),
        ...(change.removed.length > 0
          ? [{ label: `Уйдут из плана: ${datesPreview(change.removed)}`, tone: "warn" as const }]
          : []),
        { label: "Прошедшие даты и отметки о выполнении не изменятся", tone: "default" as const },
      ],
      confirmLabel: "Обновить план",
      cancelLabel: "Оставить как есть",
    });
    if (ok) await postOp(op);
  }

  async function saveSettings(value: SettingsState) {
    const nextYear = Number(value.year);
    const hasDates = configRef.current.rows.some(
      (row) => row.cleanings.length > 0 || Object.keys(row.legacyNotes ?? {}).length > 0,
    );
    if (Number.isFinite(nextYear) && nextYear !== configRef.current.year && hasDates) {
      // Окно настроек закрываем до вопроса: подтверждение поверх
      // модального окна Radix закрыло бы его само.
      setSettingsOpen(false);
      const counts = configRef.current.rows.reduce(
        (acc, row) => {
          acc.planned += row.cleanings.filter((c) => c.planned).length;
          acc.done += row.cleanings.filter((c) => c.done).length;
          return acc;
        },
        { planned: 0, done: 0 },
      );
      const ok = await confirmAsync({
        title: `Перенести график на ${nextYear} год?`,
        description: "Все даты останутся теми же числами и месяцами, но в новом году.",
        bullets: [
          { label: `Дат в плане: ${counts.planned}`, tone: "info" },
          { label: `Отметок о выполнении: ${counts.done} — тоже переедут`, tone: counts.done > 0 ? "warn" : "info" },
          { label: "Для графика на следующий год удобнее «Сделать копию» в списке документов", tone: "default" },
        ],
        confirmLabel: `Перенести на ${nextYear}`,
        variant: "warn",
      });
      if (!ok) {
        toast.info("Год не изменён — настройки не сохранены");
        return;
      }
      if (!(await postOp({ type: "shiftYear", year: nextYear }))) return;
    }
    const next = normalizeSanitationDayConfig({
      ...configRef.current,
      year: nextYear,
      documentDate: value.documentDate,
      approveRole: value.approveRole,
      approveEmployeeId: value.approveEmployeeId || null,
      approveEmployee: value.approveEmployee,
      responsibleRole: value.responsibleRole,
      responsibleEmployeeId: value.responsibleEmployeeId || null,
      responsibleEmployee: value.responsibleEmployee,
    });
    await patchConfig(next, value.title.trim() || title);
  }

  const editorRow = editor ? normalized.rows.find((row) => row.id === editor.rowId) ?? null : null;
  const yearSheetRow = yearSheetRowId
    ? normalized.rows.find((row) => row.id === yearSheetRowId) ?? null
    : null;

  return (
    <div className="space-y-5">
      <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />
      <DocumentActionsBar
        className={DOC_TITLE_ROW_NO_STRIP_CLASS}
        backHref={journalHref}
        documentId={documentId}
        heading={<h1 className={DOC_HEADING_CLASS}>{title}</h1>}
        onSettings={!readOnly ? () => setSettingsOpen(true) : undefined}
      />

      {readOnly ? (
        <JournalClosedBanner hint="Откройте журнал заново, чтобы редактировать план и факт уборок." documentId={documentId} />
      ) : null}

      {/* R1: бумажное полотно — во всю ширину контентной колонки. */}
      {/* P8: карточки-обёртки вокруг бланка больше НЕТ (как у чек-листа
          вентиляции в P5). `rounded-[18px] border p-8 overflow-hidden`
          съедал 2×32px паддинга и клипал содержимое: полотно сжималось
          до ~1083px вместо 1150, и правая рамка служебной строки уходила
          под клип. Бланк лежит прямо на фоне страницы. */}
        <div className="mb-4 sm:hidden print:hidden">
          <MobileViewToggle mobileView={mobileView} onChange={switchMobileView} />
        </div>

      <section className={`${DOC_BODY_STACK_CLASS} ${DOC_PAPER_CANVAS_CLASS}`}>
        {/* В карточках на телефоне бумажная шапка скрыта: 560px не
            влезают в 390px и лист обрезался справа. */}
        <div
          className={`-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 lg:overflow-visible sm:px-0 ${
            mobileView === "cards" ? "max-sm:hidden print:block" : ""
          }`}
        >
        <table className="w-full min-w-[560px] border-collapse text-[13px] sm:min-w-0">
          <tbody>
            <JournalPaperHeaderRows
              orgName={organizationName}
              title="ГРАФИК И УЧЕТ ГЕНЕРАЛЬНЫХ УБОРОК"
              startedAt={normalized.documentDate}
              finishedAt={readOnly ? normalized.documentDate : null}
              controlPeriodicity={controlPeriodicity}
              orgCellClass="w-[18%]"
              sideCellClass="w-[22%]"
            />
          </tbody>
        </table>
        </div>

        <div className={`${DOC_PAPER_HEADER_CLASS} flex justify-end`}>
          <div className="w-full max-w-[320px] pr-2 text-right text-[13px] leading-snug">
            <div className="font-semibold">УТВЕРЖДАЮ</div>
            <div>{approver.title}</div>
            {/* G2: линия подписи и ФИО стоят В ОДНУ строку
                («_________ Борисов Борис Борисович»), как на эталоне
                (general_cleaning-2-doc.png). Раньше подчёркнутым был сам
                текст ФИО, а места под подпись не оставалось вовсе. */}
            <div className="flex items-end justify-end gap-2 pt-1">
              <span aria-hidden className="h-[1em] w-[150px] border-b border-black" />
              <span>{approver.name}</span>
            </div>
            <div className="pt-1">
              {toViewDateLabel(normalized.documentDate)}
            </div>
          </div>
        </div>

        <h2 className={`${DOC_CAPS_TITLE_CLASS} text-center text-[15px] font-bold`}>
          График и учет генеральных уборок на предприятии в {normalized.year} г.
        </h2>

        {!readOnly ? (
          <>
          <div className={`${DOC_ADD_ROW_CLASS} justify-between`}>
            <Button
              type="button"
              onClick={() => {
                setPickerOpen(true);
              }}
              className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white hover:bg-[#4a5bf0]"
            >
              <Plus className="size-5" strokeWidth={2.5} />
              Добавить помещение
            </Button>

            {normalized.rows.length > 0 ? (
              <button
                type="button"
                onClick={() => setFillOpen(true)}
                title="Проставить даты плана по дням генеральной уборки из карточек помещений"
                className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 print:hidden"
              >
                <CalendarRange className="size-4 text-[#5566f6]" />
                Заполнить план по графику помещений
              </button>
            ) : null}
          </div>

          <JournalSelectionBar
            count={selectedRowIds.length}
            onClear={() => setSelectedRowIds([])}
            onDelete={() => {
              deleteSelectedRows().catch((error) =>
                toast.error(humanizeFetchError(error, "Не удалось удалить строки"))
              );
            }}
            hint="Помещения будут удалены вместе с планом генеральных уборок"
          >
            <SelectionEditButton count={selectedRowIds.length} disabled={readOnly} onClick={() => seq.start(selectedRowIds)} />
          </JournalSelectionBar>
          </>
        ) : null}

        {/* Карточки — ВНЕ скроллера таблицы: глобальное правило
            `div.overflow-x-auto:has(table)` гасит у него боковые поля
            (таблица на телефоне идёт в край), и карточки уезжали за
            края экрана вместе с ней. */}
        {mobileView === "cards" ? (
            <RecordCardsView
              items={normalized.rows.map((row, index) => {
                const summary = summarizeCleanings(row.cleanings, todayKey);
                const next = nextOpenCleaning(row, todayKey);
                const planText =
                  summary.planned + summary.unplanned === 0
                    ? ""
                    : [
                        `${summary.planned} в плане`,
                        `выполнено ${summary.done}`,
                        ...(summary.overdue > 0 ? [`просрочено ${summary.overdue}`] : []),
                      ].join(" · ");
                const openYear = readOnly ? undefined : () => setYearSheetRowId(row.id);
                return {
                  id: row.id,
                  title: `№${index + 1} · ${row.roomName || "—"}`,
                  // «изменить» на карточке — год строки по месяцам в листе снизу.
                  onClick: openYear,
                  leading: !readOnly ? (
                    <Checkbox
                      checked={selectedRowIds.includes(row.id)}
                      onCheckedChange={(checked) =>
                        setSelectedRowIds((current) =>
                          checked
                            ? [...new Set([...current, row.id])]
                            : current.filter((id) => id !== row.id),
                        )
                      }
                      className="size-5"
                    />
                  ) : null,
                  fields: [
                    { label: "Уборки", value: planText || "дат пока нет", header: true },
                    {
                      label: "Ближайшая",
                      value: next?.planned ? formatDayMonthWeekday(next.planned) : "",
                      header: true,
                    },
                    { label: "Убирает", value: roomPeople(row).cleaners.join(", "), hideIfEmpty: true },
                    { label: "Проверяет", value: roomPeople(row).verifiers.join(", "), hideIfEmpty: true },
                    {
                      label: "План и факт на год",
                      value: planText,
                      hideIfEmpty: false,
                      onClick: openYear,
                      hint: readOnly ? undefined : "нажмите, чтобы открыть месяцы",
                    },
                  ],
                };
              })}
              emptyLabel="Помещений пока не внесено."
            />
          ) : null}

          <MobileViewTableWrapper mobileView={mobileView} className={GRID_VIEWPORT_CLASS}>
          <table className={`min-w-full border-collapse ${GRID_CELL_CLASS} bg-white text-[13px] leading-tight`}>
            <thead>
              <tr>
                <th
                  rowSpan={2}
                  className={`${GRID_HEAD_CELL_CLASS} w-[54px] px-2 py-1.5 leading-tight print:hidden`}
                >
                  {!readOnly ? (
                    <div className="flex items-center justify-center">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={(checked) =>
                          setSelectedRowIds(
                            checked ? normalized.rows.map((row) => row.id) : [],
                          )
                        }
                      />
                    </div>
                  ) : null}
                </th>
                <th
                  rowSpan={2}
                  className={`${GRID_HEAD_CELL_CLASS} w-[240px] px-3 py-1.5 leading-tight`}
                >
                  Помещение
                </th>
                <th
                  rowSpan={2}
                  className={`${GRID_HEAD_CELL_CLASS} w-[90px] px-2 py-1.5 leading-tight`}
                >
                  Вид
                </th>
                <th colSpan={12} className={`${GRID_HEAD_CELL_CLASS} px-3 py-1.5 leading-tight`}>
                  График
                </th>
              </tr>
              <tr>
                {SANITATION_MONTHS.map((month) => (
                  <th
                    key={month.key}
                    className={`${GRID_HEAD_CELL_CLASS} w-[60px] px-1 py-1.5 leading-tight`}
                  >
                    {month.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {normalized.rows.map((row) => (
                <Fragment key={row.id}>
                  <tr>
                    <td
                      rowSpan={2}
                      className={`${GRID_CELL_CLASS} px-2 py-1 align-middle leading-tight print:hidden`}
                    >
                      {!readOnly ? (
                        <div className="flex items-center justify-center">
                          <Checkbox
                            checked={selectedRowIds.includes(row.id)}
                            onCheckedChange={(checked) =>
                              setSelectedRowIds((current) =>
                                checked
                                  ? [...new Set([...current, row.id])]
                                  : current.filter((id) => id !== row.id),
                              )
                            }
                          />
                        </div>
                      ) : null}
                    </td>
                    <td
                      rowSpan={2}
                      className={`${GRID_CELL_CLASS} px-3 py-1 text-center align-middle ${readOnly ? "" : "cursor-pointer hover:bg-[#f5f6ff]"} leading-tight`}
                      onClick={() => {
                        if (readOnly) return;
                        openRowEditor(row);
                      }}
                    >
                      <div>{row.roomName}</div>
                      {/* Кто убирает / проверяет — из карточки помещения. */}
                      {roomPeople(row).cleaners.length > 0 ? (
                        <div className="text-[11px] font-normal text-[#3848c7] print:hidden">
                          Убирает: {roomPeople(row).cleaners.join(", ")}
                        </div>
                      ) : null}
                      {roomPeople(row).verifiers.length > 0 ? (
                        <div className="text-[11px] font-normal text-[#3848c7] print:hidden">
                          Проверяет: {roomPeople(row).verifiers.join(", ")}
                        </div>
                      ) : null}
                      {rowSchedule(row) ? (
                        <div className="text-[11px] font-normal text-[#6f7282] print:hidden">
                          График: {describeGeneralSchedule(rowSchedule(row) as RoomGeneralSchedule)}
                        </div>
                      ) : null}
                      {!readOnly && !row.roomId && suggestDirectoryRoomForSanitationRow(row, directoryRooms) ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            const match = suggestDirectoryRoomForSanitationRow(row, directoryRooms);
                            if (match) void linkRow(row.id, match);
                          }}
                          title="В справочнике есть помещение с таким же названием — связать, чтобы название, ответственные и график брались из карточки помещения"
                          className="mt-0.5 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#eef1ff] print:hidden"
                        >
                          Связать
                        </button>
                      ) : null}
                    </td>
                    <td className={`${GRID_CELL_CLASS} px-3 py-1 text-center leading-tight`}>
                      План
                    </td>
                    {SANITATION_MONTHS.map((month, monthIndex) => (
                      <td
                        key={`${row.id}-plan-${month.key}`}
                        className={`${GRID_CELL_CLASS} px-1 py-1 text-center leading-tight`}
                      >
                        <GeneralCleaningMonthCell
                          row={row}
                          year={normalized.year}
                          monthIndex={monthIndex}
                          kind="plan"
                          todayKey={todayKey}
                          readOnly={readOnly}
                          onOpen={(event) => openMonthEditor(row.id, monthIndex, event)}
                        />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className={`${GRID_CELL_CLASS} px-3 py-1 text-center leading-tight`}>
                      Факт
                    </td>
                    {SANITATION_MONTHS.map((month, monthIndex) => (
                      <td
                        key={`${row.id}-fact-${month.key}`}
                        className={`${GRID_CELL_CLASS} px-1 py-1 text-center leading-tight`}
                      >
                        <GeneralCleaningMonthCell
                          row={row}
                          year={normalized.year}
                          monthIndex={monthIndex}
                          kind="fact"
                          todayKey={todayKey}
                          readOnly={readOnly}
                          onOpen={(event) => openMonthEditor(row.id, monthIndex, event)}
                        />
                      </td>
                    ))}
                  </tr>
                </Fragment>
              ))}
              {!readOnly ? (
                <JournalAddRow
                  // Галочка — leading, «Помещение» — под подпись (совпадает
                  // с текстом), «Вид» (План/Факт) + все месяцы графика
                  // остаются пустыми ячейками.
                  leading={1}
                  labelSpan={1}
                  trailing={1 + SANITATION_MONTHS.length}
                  label="Добавить помещение"
                  onClick={() => setPickerOpen(true)}
                />
              ) : null}
              <tr>
                {/* A5 аудита: раньше здесь стоял один `colSpan={3}`,
                    перекрывавший ещё и колонку чекбоксов. Колонка
                    чекбоксов `print:hidden` — на бумаге строка
                    «Ответственный» оказывалась на КОЛОНКУ ШИРЕ шапки, и
                    справа от таблицы печаталась пустая безымянная
                    полоса. Служебная ячейка теперь отдельная и тоже
                    `print:hidden`, а подпись занимает ровно
                    «Помещение» + «Вид». */}
                {/* R5-14: служебная строка «Ответственный: …» держит тот
                    же вертикальный ритм, что и строки данных.
                    У ячейки-заглушки не было НИ padding'а, ни
                    выравнивания, а у подписи стоял `py-1` против `py-2`
                    у данных — строка выходила ниже соседних, и подпись
                    прижималась к нижней рамке. */}
                <td className={`${GRID_CELL_CLASS} px-3 py-2 print:hidden`} />
                <td
                  colSpan={2}
                  className={`${GRID_CELL_CLASS} px-3 py-2 text-center align-middle leading-tight`}
                >
                  <span className={GRID_SERVICE_LABEL_CLASS}>
                    Ответственный:{" "}
                    {getSanitationApproveLabel(
                      responsible.title,
                      responsible.name,
                      ", ",
                    )}
                  </span>
                </td>
                {/* G1: на эталоне (general_cleaning-2-doc.png) служебная
                    строка «Ответственный: …» продолжается ДВЕНАДЦАТЬЮ
                    пустыми ячейками месяцев — сетка не рвётся, колонки
                    остаются на месте. Мы вместо них рисовали пояснение
                    «Отметки по месяцам указаны в таблице выше», которое
                    съедало 12 колонок в один colSpan. Ячейки намеренно
                    некликабельны: это подвал строки, а не данные. */}
                {SANITATION_MONTHS.map((month) => (
                  <td
                    key={`responsible-${month.key}`}
                    className={`${GRID_CELL_CLASS} px-3 py-2 leading-tight`}
                  />
                ))}
              </tr>
            </tbody>
          </table>
          </MobileViewTableWrapper>
      </section>

      {editor && editorRow ? (
        <GeneralCleaningMonthEditor
          open
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          anchorRef={anchorRef}
          title={`${MONTH_NAMES_RU[editor.monthIndex]} ${normalized.year} · ${editorRow.roomName || "Помещение"}`}
          subtitle={describeMonthLoad(editorRow, normalized.year, editor.monthIndex, todayKey).text}
        >
          <GeneralCleaningMonthPanel
            key={`${editorRow.id}-${editor.monthIndex}`}
            row={editorRow}
            year={normalized.year}
            monthIndex={editor.monthIndex}
            todayKey={todayKey}
            schedule={rowSchedule(editorRow)}
            linked={rowLinked(editorRow)}
            tasksflowEnabled={tasksflowEnabled}
            canFillFromSchedule
            onOp={postOp}
          />
        </GeneralCleaningMonthEditor>
      ) : null}

      {yearSheetRow ? (
        <GeneralCleaningYearSheet
          key={yearSheetRow.id}
          open
          onClose={() => setYearSheetRowId(null)}
          row={yearSheetRow}
          year={normalized.year}
          todayKey={todayKey}
          schedule={rowSchedule(yearSheetRow)}
          linked={rowLinked(yearSheetRow)}
          tasksflowEnabled={tasksflowEnabled}
          canFillFromSchedule
          onOp={postOp}
        />
      ) : null}

      {fillOpen ? (
        <GeneralCleaningFillDialog
          onClose={() => setFillOpen(false)}
          config={normalized}
          schedules={scheduleByRoomId}
          todayKey={todayKey}
          onConfirm={postOp}
        />
      ) : null}

      <RoomDialog
        key={`room-dialog-${roomDialogState.id || "new"}`}
        open={roomDialogOpen}
        onOpenChange={(open) => {
          if (open) setRoomDialogOpen(true);
          else seq.cancelled();
        }}
        initial={roomDialogState}
        title={
          roomDialogState.id
            ? `Редактирование строки${seq.progress ? ` ${seq.progress}` : ""}`
            : "Добавление новой строки"
        }
        submitText={roomDialogState.id ? "Сохранить" : "Создать"}
        linkOptions={listSanitationRoomsNotInDocument(normalized, directoryRooms)}
        onSubmit={async (value, linkRoomId) => {
          await saveRoomDialog(value, linkRoomId);
          // Очередь правок откроет следующее помещение или закроет окно.
          seq.saved();
        }}
      />

      {/* Единый справочник помещений: добавить из /settings/buildings или
          создать новое — и сразу открыть его карточку. */}
      <RoomDirectoryPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        buildings={buildings}
        excludeRoomIds={normalized.rows.map((r) => r.roomId).filter((id): id is string => Boolean(id))}
        hint="Помещения общие для всех журналов. Состав генеральной уборки, дни по графику, уборщики и проверяющие — в карточке помещения."
        onPick={addRoomFromDirectory}
        onCreated={async (room) => {
          await addRoomFromDirectory(room);
          setRoomEditor(directoryRoomToEditorInitial(room));
        }}
      />

      <RoomEditorDialog
        open={roomEditor !== null}
        onOpenChange={(open) => {
          if (open) return;
          setTimeout(() => {
            if (roomEditorSavedRef.current) {
              roomEditorSavedRef.current = false;
              return;
            }
            seq.cancelled();
          }, 0);
        }}
        initial={roomEditor}
        focus="cleaning"
        users={users}
        onSaved={(snapshot) => {
          router.refresh();
          roomEditorSavedRef.current = true;
          const inSequence = seq.progress !== null;
          seq.saved();
          void offerScheduleRefresh(snapshot, inSequence);
        }}
      />

      <DocumentSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        users={users}
        initial={settingsState}
        onSubmit={saveSettings}
        useV2={useV2}
      />
    </div>
  );
}
