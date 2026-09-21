"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, CalendarDays, Plus, X } from "lucide-react";
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
import { getDistinctRoleLabels, getUserRoleLabel, getUsersForRoleLabel } from "@/lib/user-roles";
import {
  createEmptyTrainingRow,
  createTrainingTopic,
  normalizeTrainingPlanConfig,
  type TrainingPlanConfig,
} from "@/lib/training-plan-document";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import {
  GRID_CELL_CLASS,
  GRID_HEAD_CELL_CLASS,
} from "@/components/journals/journal-grid";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  CardEditSheet,
  type CardEditFieldDef,
  type CardEditValues,
} from "@/components/journals/card-edit-sheet";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { localDayKey } from "@/lib/entry-defaults";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
type UserItem = { id: string; name: string; role: string };

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

type SettingsState = {
  title: string;
  documentDate: string;
  year: string;
  approveRole: string;
  approveEmployeeId: string;
  approveEmployee: string;
};

const MONTH_OPTIONS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

function roleOptionsFromUsers(users: UserItem[]) {
  return getDistinctRoleLabels(users);
}

function usersForRole(users: UserItem[], roleLabel: string) {
  return getUsersForRoleLabel(users, roleLabel);
}

function toIsoDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return localDayKey();
  return date.toISOString().slice(0, 10);
}

function toViewDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  if (!year || !month || !day) return dateKey;
  // Без дня локаль ru-RU даёт именительный падеж («январь»), а бланк
  // требует родительный («января»): форматируем дату целиком и отрезаем день.
  const monthName = new Date(`${year}-${month}-${day}T00:00:00`)
    .toLocaleDateString("ru-RU", { day: "numeric", month: "long" })
    .replace(/^\d+\s+/, "");
  return `« ${day} » ${monthName} ${year} г.`;
}

function AddPositionDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  users: UserItem[];
  onCreate: (name: string) => Promise<void>;
}) {
  const [position, setPosition] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const uniqueRoles = useMemo(() => {
    const labels = props.users.map((user) => getUserRoleLabel(user.role));
    return [...new Set(labels)];
  }, [props.users]);

  async function submit() {
    if (!position.trim()) {
      toast.error("Выберите должность");
      return;
    }

    setSubmitting(true);
    try {
      await props.onCreate(position.trim());
      setPosition("");
      props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[660px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              Добавление новой должности
            </DialogTitle>
            <button type="button" className="rounded-xl p-2" onClick={() => props.onOpenChange(false)}>
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-4 px-8 py-6">
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Должность</Label>
            <Select value={position || "__empty__"} onValueChange={(value) => setPosition(value === "__empty__" ? "" : value)}>
              <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                <SelectValue placeholder="- Выберите значение -" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty__">- Выберите значение -</SelectItem>
                <PositionSelectItems users={props.users} />
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
            >
              {submitting ? "Создание..." : "Создать"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddTopicDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [topicName, setTopicName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!topicName.trim()) {
      toast.error("Введите тему обучения");
      return;
    }

    setSubmitting(true);
    try {
      await props.onCreate(topicName.trim());
      setTopicName("");
      props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[660px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              Добавление новой темы
            </DialogTitle>
            <button type="button" className="rounded-xl p-2" onClick={() => props.onOpenChange(false)}>
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-4 px-8 py-6">
          <Input
            value={topicName}
            onChange={(event) => setTopicName(event.target.value)}
            placeholder="Тема обучения"
            className="h-9 rounded-xl border-[#5566f6] px-3.5 text-[13.5px]"
          />
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
            >
              {submitting ? "Создание..." : "Создать"}
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
  const roles = useMemo(() => roleOptionsFromUsers(props.users), [props.users]);

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
    resolveCandidates: (roleLabel) => usersForRole(props.users, roleLabel),
    autoPick: "first",
  });

  const handleSave = async () => {
    setSubmitting(true);
    try {
      await props.onSubmit(state);
      props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (props.useV2) {
    return (
      <JournalSettingsModal
        open={props.open}
        onOpenChange={(value) => {
          if (value) setState(props.initial);
          props.onOpenChange(value);
        }}
        title="Настройки документа"
        description="Параметры плана обучения и аттестации"
        size="md"
        isSaving={submitting}
        onSave={handleSave}
        onCancel={() => props.onOpenChange(false)}
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Название документа</Label>
            <Input
              value={state.title}
              onChange={(event) => setState({ ...state, title: event.target.value })}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Дата документа</Label>
              <div className="relative">
                <Input
                  type="date"
                  value={state.documentDate}
                  onChange={(event) => setState({ ...state, documentDate: toIsoDate(event.target.value) })}
                  className="h-9 rounded-xl border-[#dcdfed] px-3.5 pr-12 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
                />
                <CalendarDays className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-[#6f7282]" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Год</Label>
              <Select value={state.year} onValueChange={(value) => setState({ ...state, year: value })}>
                <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 8 }).map((_, index) => {
                    const year = String(new Date().getFullYear() - 2 + index);
                    return (
                      <SelectItem key={year} value={year}>{year}</SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Должность «Утверждаю»</Label>
            <Select
              value={state.approveRole}
              onValueChange={approveCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15">
                <SelectValue placeholder="— Выберите значение —" />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={props.users} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Сотрудник</Label>
            <Select
              value={state.approveEmployeeId || "__empty__"}
              onValueChange={approveCascade.handleEmployeeChange}
              open={approveCascade.employeeOpen}
              onOpenChange={approveCascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15">
                <SelectValue placeholder="— Выберите значение —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty__">— Выберите значение —</SelectItem>
                {approveCascade.candidates.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {buildStaffOptionLabel(user)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              Настройки документа
            </DialogTitle>
            <button type="button" className="rounded-xl p-2" onClick={() => props.onOpenChange(false)}>
              <X className="size-8" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-4 px-8 py-6">
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Название документа</Label>
            <Input
              value={state.title}
              onChange={(event) => setState({ ...state, title: event.target.value })}
              className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Дата документа</Label>
            <div className="relative">
              <Input
                type="date"
                value={state.documentDate}
                onChange={(event) => setState({ ...state, documentDate: toIsoDate(event.target.value) })}
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 pr-14 text-[13.5px]"
              />
              <CalendarDays className="pointer-events-none absolute right-4 top-1/2 size-6 -translate-y-1/2 text-[#6e7080]" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Год</Label>
            <Select value={state.year} onValueChange={(value) => setState({ ...state, year: value })}>
              <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 8 }).map((_, index) => {
                  const year = String(new Date().getFullYear() - 2 + index);
                  return (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Должность &quot;Утверждаю&quot;</Label>
            <Select
              value={state.approveRole}
              onValueChange={approveCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                <SelectValue placeholder="- Выберите значение -" />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={props.users} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Сотрудник</Label>
            <Select
              value={state.approveEmployeeId || "__empty__"}
              onValueChange={approveCascade.handleEmployeeChange}
              open={approveCascade.employeeOpen}
              onOpenChange={approveCascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                <SelectValue placeholder="- Выберите значение -" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty__">- Выберите значение -</SelectItem>
                {approveCascade.candidates.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {buildStaffOptionLabel(user)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
              className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TrainingPlanDocumentClient({
  documentId,
  title,
  organizationName,
  status,
  users,
  config,
  useV2 = false,
}: Props) {
  const router = useRouter();
  const [addPositionOpen, setAddPositionOpen] = useState(false);
  const [addTopicOpen, setAddTopicOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  // Какую клетку «должность × тема» правим из карточки.
  const [editingCell, setEditingCell] = useState<
    { rowId: string; topicId: string } | null
  >(null);
  const normalized = normalizeTrainingPlanConfig(config);
  const readOnly = status === "closed";

  const settingsState: SettingsState = {
    title,
    documentDate: normalized.documentDate,
    year: String(normalized.year),
    approveRole: normalized.approveRole,
    approveEmployeeId: normalized.approveEmployeeId || "",
    approveEmployee: normalized.approveEmployee,
  };

  async function patchConfig(nextConfig: TrainingPlanConfig, nextTitle = title) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: nextTitle,
        dateFrom: nextConfig.documentDate,
        dateTo: nextConfig.documentDate,
        config: nextConfig,
      }),
    });

    if (!response.ok) {
      toast.error("Не удалось сохранить документ");
      return;
    }

    router.refresh();
  }

  async function addPosition(name: string) {
    const topicIds = normalized.topics.map((topic) => topic.id);
    const row = createEmptyTrainingRow(name, topicIds);
    await patchConfig({ ...normalized, rows: [...normalized.rows, row] });
  }

  async function addTopic(name: string) {
    const topic = createTrainingTopic(name);
    const topics = [...normalized.topics, topic];
    const rows = normalized.rows.map((row) => ({
      ...row,
      cells: { ...row.cells, [topic.id]: { required: false, date: "" } },
    }));
    await patchConfig({ ...normalized, topics, rows });
  }

  async function toggleCell(rowId: string, topicId: string, checked: boolean) {
    const nextRows = normalized.rows.map((row) => {
      if (row.id !== rowId) return row;
      return {
        ...row,
        cells: {
          ...row.cells,
          [topicId]: {
            ...row.cells[topicId],
            required: checked,
            date: checked ? row.cells[topicId]?.date || `01.${String(normalized.year).slice(-2)}` : "",
          },
        },
      };
    });
    await patchConfig({ ...normalized, rows: nextRows });
  }

  async function setCellDate(rowId: string, topicId: string, date: string) {
    const nextRows = normalized.rows.map((row) => {
      if (row.id !== rowId) return row;
      return {
        ...row,
        cells: {
          ...row.cells,
          [topicId]: { ...row.cells[topicId], date },
        },
      };
    });
    await patchConfig({ ...normalized, rows: nextRows });
  }

  /** Поля листа: нужна ли тема и в каком месяце года её планируют. */
  function buildCellEditFields(): CardEditFieldDef[] {
    const yy = String(normalized.year).slice(-2);
    return [
      { type: "boolean", key: "required", label: "Тема нужна этой должности" },
      {
        type: "select",
        key: "month",
        label: "Месяц обучения",
        options: MONTH_OPTIONS.map((label, monthIndex) => ({
          value: `${String(monthIndex + 1).padStart(2, "0")}.${yy}`,
          label,
        })),
      },
    ];
  }

  function buildCellEditValues(rowId: string, topicId: string): CardEditValues {
    const row = normalized.rows.find((item) => item.id === rowId);
    const cell = row?.cells[topicId] || { required: false, date: "" };
    return { required: cell.required === true, month: cell.date || "" };
  }

  async function saveCellFromSheet(
    rowId: string,
    topicId: string,
    values: CardEditValues
  ) {
    const required = values.required === true;
    const month = String(values.month ?? "");
    const nextRows = normalized.rows.map((row) => {
      if (row.id !== rowId) return row;
      return {
        ...row,
        cells: {
          ...row.cells,
          [topicId]: {
            ...row.cells[topicId],
            required,
            // Сняли галочку — месяц тоже уходит: в бланке «дата без
            // требования» читается как ошибка.
            date: required
              ? month || `01.${String(normalized.year).slice(-2)}`
              : "",
          },
        },
      };
    });
    setEditingCell(null);
    await patchConfig({ ...normalized, rows: nextRows });
  }

  async function deleteSelectedRows() {
    if (selectedRowIds.length === 0) return;
    const count = selectedRowIds.length;
    if (!(await confirmAsync({ title: "Удалить выбранные строки?", description: `Будет удалено строк: ${count}. Восстановить нельзя.`, variant: "danger", confirmLabel: "Удалить" }))) return;
    const idsToRemove = [...selectedRowIds];
    try {
      const nextRows = normalized.rows.filter((row) => !idsToRemove.includes(row.id));
      setSelectedRowIds([]);
      await patchConfig({ ...normalized, rows: nextRows });
      toast.success(`Удалено строк: ${count}`);
    } catch (error) {
      toast.error(humanizeFetchError(error, "Не удалось удалить выбранные строки"));
    }
  }

  async function closeDocument() {
    const ok = await confirmAsync({
      title: `Закончить журнал «${title}»?`,
      description:
        "Журнал уйдёт из рабочего списка в раздел закрытых. Все записи сохранятся — отчёты и PDF по ним останутся.",
      bullets: [
        { label: "Добавлять и править записи после этого нельзя", tone: "warn" },
        { label: "Вернуть журнал в активные можно в любой момент", tone: "info" },
      ],
      confirmLabel: "Закончить журнал",
      variant: "warn",
    });
    if (!ok) return;

    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });

    if (!response.ok) {
      toast.error("Не удалось закрыть журнал");
      return;
    }

    router.refresh();
  }

  const allSelected = normalized.rows.length > 0 && selectedRowIds.length === normalized.rows.length;
  const { mobileView, switchMobileView } = useMobileView("training_plan");

  const cardItems: RecordCardItem[] = normalized.rows.map((row, index) => {
    const required = normalized.topics
      .map((topic) => {
        const cell = row.cells[topic.id] || { required: false, date: "" };
        if (!cell.required) return null;
        return cell.date ? `${topic.name} (${cell.date})` : topic.name;
      })
      .filter((x): x is string => x !== null);

    return {
      id: row.id,
      title: `№${index + 1} · ${row.positionName}`,
      subtitle: `Тем для обучения: ${required.length}`,
      leading: !readOnly ? (
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
      // Каждая тема — своё поле: тап по теме открывает лист «нужна ли она
      // этой должности и в каком месяце». Раньше карточка показывала одну
      // склеенную строку и не открывала ничего.
      fields: normalized.topics.map((topic) => {
        const cell = row.cells[topic.id] || { required: false, date: "" };
        return {
          label: topic.name,
          value: cell.required ? cell.date || "нужна" : "",
          hideIfEmpty: false,
          onClick: readOnly
            ? undefined
            : () => setEditingCell({ rowId: row.id, topicId: topic.id }),
          hint: readOnly ? undefined : "нажмите, чтобы изменить",
        };
      }),
    };
  });

  return (
    <div className="space-y-5">
      <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />

      {selectedRowIds.length > 0 && !readOnly && (
        <div className="sticky top-0 z-30 -mx-4 flex flex-wrap items-center gap-4 rounded-2xl border-b border-[#dcdfed] bg-white/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
          <button
            type="button"
            className="flex items-center gap-1 text-[16px] text-[#5566f6]"
            onClick={() => setSelectedRowIds([])}
          >
            <X className="size-4" /> Выбрано: {selectedRowIds.length}
          </button>
          <button type="button" className="flex items-center gap-1 text-[16px] text-[#ff3b30]" onClick={deleteSelectedRows}>
            Удалить
          </button>
        </div>
      )}

      <JournalDocumentShell
        title={title}
        documentId={documentId}
        backHref="/journals/training_plan"
        onSettings={!readOnly ? () => setSettingsOpen(true) : undefined}
        menuItems={
          !readOnly
            ? [
                {
                  key: "close-journal",
                  label: "Закончить журнал",
                  icon: <Archive className="size-4" />,
                  onSelect: () => {
                    closeDocument().catch(() => toast.error("Не удалось закрыть журнал"));
                  },
                },
              ]
            : []
        }
        mobileView={mobileView}
        onMobileView={switchMobileView}
        cards={<RecordCardsView items={cardItems} emptyLabel="Должностей не добавлено." />}
        paperHeader={
          <>
            <JournalDocumentHeader
              orgName={organizationName}
              title="ПЛАН ОБУЧЕНИЯ ПЕРСОНАЛА"
              startedAt={normalized.documentDate}
              finishedAt={null}
            />
            <div className="ml-auto flex w-full max-w-[420px] flex-col items-end gap-1 text-right text-[14px] leading-tight">
              <div className="font-semibold">УТВЕРЖДАЮ</div>
              <div>{normalized.approveRole}</div>
              <div>{normalized.approveEmployee}</div>
              <div className="mt-1 h-px w-[230px] bg-black" />
              <div>{toViewDateLabel(normalized.documentDate)}</div>
            </div>
          </>
        }
        sheetTitle={`ПЛАН ОБУЧЕНИЯ ПЕРСОНАЛА НА ${normalized.year} Г.`}
        toolbar={
          !readOnly ? (
            <div className="grid w-full gap-4 md:grid-cols-2">
              <Button
                className="h-9 w-full rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
                onClick={() => setAddPositionOpen(true)}
              >
                <Plus className="size-5" /> Добавить должность
              </Button>
              <Button
                className="h-9 w-full rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
                onClick={() => setAddTopicOpen(true)}
              >
                <Plus className="size-5" /> Добавить тему обучения
              </Button>
            </div>
          ) : undefined
        }
      >
        <table className="min-w-full border-collapse bg-white text-[13px]">
          <thead>
            <tr>
              <th rowSpan={2} className={`w-14 ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {!readOnly && (
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelectedRowIds(checked === true ? normalized.rows.map((row) => row.id) : [])
                    }
                  />
                )}
              </th>
              <th rowSpan={2} className={`w-[60px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                № п/п
              </th>
              <th rowSpan={2} className={`w-[200px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                Должностная единица, подлежащая обучению
              </th>
              <th colSpan={normalized.topics.length} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                Требуется обучение по теме:
              </th>
            </tr>
            <tr>
              {normalized.topics.map((topic) => (
                <th key={topic.id} className={`min-w-[140px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {topic.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {normalized.rows.map((row, index) => (
              <tr key={row.id}>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                  {!readOnly && (
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
                  )}
                </td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{index + 1}</td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.positionName}</td>
                {normalized.topics.map((topic) => {
                  const cell = row.cells[topic.id] || { required: false, date: "" };
                  return (
                    <td key={topic.id} className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                      <div className="flex flex-col items-center gap-1">
                        {readOnly ? (
                          cell.required ? (
                            <>
                              <Checkbox checked disabled />
                              {cell.date && <span className="text-[13px] text-[#5566f6]">{cell.date}</span>}
                            </>
                          ) : (
                            <Checkbox checked={false} disabled />
                          )
                        ) : (
                          <>
                            <Checkbox
                              checked={cell.required}
                              onCheckedChange={(checked) => void toggleCell(row.id, topic.id, checked === true)}
                            />
                            {cell.required && (
                              <select
                                className="w-[128px] border-b border-dashed border-[#5566f6] bg-transparent text-center text-[13px] text-[#5566f6] outline-none"
                                value={cell.date ? cell.date.split(".")[0] : ""}
                                onChange={(event) => {
                                  const month = event.target.value;
                                  const yy = String(normalized.year).slice(2);
                                  void setCellDate(row.id, topic.id, month ? `${month}.${yy}` : "");
                                }}
                              >
                                <option value=""></option>
                                {MONTH_OPTIONS.map((label, monthIndex) => {
                                  const month = String(monthIndex + 1).padStart(2, "0");
                                  return (
                                    <option key={month} value={month}>
                                      {label}
                                    </option>
                                  );
                                })}
                              </select>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>{!readOnly && <Checkbox disabled />}</td>
              <td colSpan={2 + normalized.topics.length} className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`} />
            </tr>
          </tbody>
        </table>
      </JournalDocumentShell>

      <AddPositionDialog
        open={addPositionOpen}
        onOpenChange={setAddPositionOpen}
        users={users}
        onCreate={addPosition}
      />
      <AddTopicDialog open={addTopicOpen} onOpenChange={setAddTopicOpen} onCreate={addTopic} />
      <DocumentSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        users={users}
        initial={settingsState}
        useV2={useV2}
        onSubmit={async (value) => {
          const nextYear = Number(value.year);
          // Даты ячеек хранятся как `MM.YY`: при смене года они оставались
          // от прошлого, и план на новый год печатался старыми датами.
          const oldSuffix = String(normalized.year).slice(-2);
          const newSuffix = String(nextYear).slice(-2);
          let rows = normalized.rows;
          if (nextYear !== normalized.year && oldSuffix !== newSuffix) {
            const stale = normalized.rows.reduce(
              (count, row) =>
                count +
                Object.values(row.cells).filter((cell) =>
                  cell.date.endsWith(`.${oldSuffix}`)
                ).length,
              0
            );
            if (stale > 0) {
              const confirmed = await confirmAsync({
                title: `Перенести даты на ${nextYear} год?`,
                description:
                  "Месяцы останутся прежними, поменяется только год в датах ячеек.",
                variant: "info",
                confirmLabel: "Перенести",
                bullets: [
                  { label: `Дат будет обновлено: ${stale}`, tone: "info" },
                  {
                    label: "Отказ оставит в плане даты прошлого года",
                    tone: "warn",
                  },
                ],
              });
              if (confirmed) {
                rows = normalized.rows.map((row) => ({
                  ...row,
                  cells: Object.fromEntries(
                    Object.entries(row.cells).map(([key, cell]) => [
                      key,
                      cell.date.endsWith(`.${oldSuffix}`)
                        ? { ...cell, date: `${cell.date.slice(0, 3)}${newSuffix}` }
                        : cell,
                    ])
                  ),
                }));
              }
            }
          }
          const nextConfig = normalizeTrainingPlanConfig({
            ...normalized,
            rows,
            year: nextYear,
            documentDate: value.documentDate,
            approveRole: value.approveRole,
            approveEmployeeId: value.approveEmployeeId || null,
            approveEmployee: value.approveEmployee,
          });
          await patchConfig(nextConfig, value.title.trim() || title);
        }}
      />

      {/* Правка клетки «должность × тема» из карточного режима. */}
      <CardEditSheet
        open={editingCell !== null}
        title={
          normalized.topics.find((topic) => topic.id === editingCell?.topicId)
            ?.name ?? "Тема обучения"
        }
        subtitle={
          normalized.rows.find((row) => row.id === editingCell?.rowId)
            ?.positionName
        }
        fields={editingCell ? buildCellEditFields() : []}
        values={
          editingCell
            ? buildCellEditValues(editingCell.rowId, editingCell.topicId)
            : {}
        }
        onClose={() => setEditingCell(null)}
        onSubmit={(values) => {
          if (!editingCell) return;
          void saveCellFromSheet(
            editingCell.rowId,
            editingCell.topicId,
            values
          );
        }}
      />
    </div>
  );
}
