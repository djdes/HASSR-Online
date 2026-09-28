"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ChevronDown, ChevronLeft, ChevronRight, MousePointerSquareDashed, Pencil, Plus, RefreshCw, Save, Sparkles, Trash2, UserPlus } from "lucide-react";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  RoomEditorDialog,
  type RoomEditorInitial,
} from "@/components/cleaning/room-editor-dialog";
import { toast } from "sonner";
import {
  TableContextMenu,
  type TableContextMenuItem,
} from "@/components/journals/table-context-menu";
import {
  applyRoomResponsiblesToConfig,
  countRoomsPerUser,
  type RoomResponsibles,
} from "@/lib/cleaning-room-responsibles";
import {
  ScopeListEditor,
  WeekdayMaskPicker,
} from "@/components/cleaning/scope-and-schedule-editors";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  applyCleaningAutoFillToConfig,
  applyRoomScheduleToMatrix,
  type RoomScheduleFromDb,
  CLEANING_DOCUMENT_TITLE,
  CLEANING_MARK_OPTIONS,
  CLEANING_PAGE_TITLE,
  createCleaningResponsibleRow,
  createCleaningRoomRow,
  deleteCleaningResponsibleRow,
  deleteCleaningRoomRow,
  listDeletedCleaningRoomsWithMarks,
  CLEANING_NOT_PERFORMED_DISPLAY,
  displayLegendLine,
  displayMatrixValue,
  fillPastDaysNotPerformed,
  getCleaningGridMonthLabel,
  getCleaningPeriodLabel,
  isAutoSignatureValue,
  CLEANING_ROW_LABELS,
  buildCleaningSignatureResolver,
  cleaningSignatureRef,
  listCleaningCodeEntries,
  listControlCodeEntries,
  listCleaningRoomCompletions,
  markAutoSignature,
  normalizeCleaningDocumentConfig,
  resolveDocumentController,
  resolveRoomCleaners,
  resolveRoomControllers,
  setCleaningMatrixValue,
  toggleCleaningMatrixValue,
  type CleaningDocumentConfig,
  type CleaningMatrixValue,
  type CleaningResponsible,
  type CleaningResponsibleKind,
  type CleaningRoomItem,
} from "@/lib/cleaning-document";
import { buildDateKeys, isWeekend, toDateKey } from "@/lib/hygiene-document";
import { useJournalUndo } from "@/lib/journal-undo";
import { getCalendarDayKind } from "@/lib/production-calendar-data";
import {
  WEEKDAY_LABELS_RU,
  WEEKDAY_MASK_ALL,
  WEEKDAY_MASK_NONE,
  WEEKDAY_MASK_WEEKENDS,
  WEEKDAY_MASK_WORKDAYS,
  describeMask,
  isMaskedWeekday,
  normalizeMask,
  toggleWeekdayBit,
} from "@/lib/weekday-mask";
import { getDistinctRoleLabels } from "@/lib/user-roles";
import { DocumentActionsBar } from "@/components/journals/document-actions-bar";
import {
  DOC_AUTOFILL_STRIP_CLASS,
  DOC_BODY_STACK_CLASS,
  DOC_CAPS_TITLE_CLASS,
  DOC_EXTRA_BLOCK_CLASS,
  DOC_HEADING_CLASS,
  DOC_LEGEND_CLASS,
  DOC_PAPER_CANVAS_CLASS,
  DOC_PAPER_HEADER_CLASS,
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_CONTENT_WIDE_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
  DOC_AUTOFILL_LABEL_CLASS,
} from "@/components/journals/journal-responsive";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { useDocumentCloseAction } from "@/components/journals/document-close-button";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import {
  JournalDocumentHeader,
  JournalDocumentTitle,
  JournalLegendBlock,
} from "@/components/journals/journal-document-header";
import { MobileViewAxisToggle } from "@/components/journals/mobile-view-axis-toggle";
import { DayFirstCards } from "@/components/journals/day-first-cards";
import { documentViewClasses, useMobileView } from "@/lib/use-mobile-view";
import {
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { JournalClosedBanner } from "@/components/journals/journal-closed-banner";
import { useCanManageJournalDocument } from "@/components/journals/journal-header-edit";
import {
  GRID_CELL_CLASS,
  GRID_DAY_OFF_BG_CLASS,
  GRID_DAY_SHORT_BG_CLASS,
  GRID_HEAD_CELL_CLASS,
  GRID_HEAD_CELL_PLAIN_CLASS,
  CELL_FOCUS_CLASS,
  GRID_VIEWPORT_CLASS,
} from "@/components/journals/journal-grid";

import { useTodayKey } from "@/lib/use-today-key";
import { TodayStripForJournal } from "@/components/journals/today-strip-for-journal";
import { localDayKey } from "@/lib/entry-defaults";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
type UserItem = {
  id: string;
  name: string;
  role: string;
  // 2026-09-04: для группировки в мультивыборе карточки помещения.
  // Форма jobPosition — как в UserLike (user-roles.ts), чтобы тот же
  // список подходил и PositionSelect / usePositionEmployeeCascade.
  isRoot?: boolean;
  positionTitle?: string | null;
  jobPosition?: { name: string; categoryKey: string } | null;
};
type EntryItem = { id: string; employeeId: string; date: string; data: unknown };
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
  dateFrom: string;
  dateTo: string;
  responsibleTitle: string | null;
  responsibleUserId: string | null;
  autoFill: boolean;
  users: UserItem[];
  config: CleaningDocumentConfig;
  initialEntries: EntryItem[];
  /**
   * True when the org has connected TasksFlow. Reserved for the upcoming
   * auto-poll on mount + manual «Sync from TasksFlow» button. Optional
   * so existing callers (no integration) keep compiling without
   * touching every render site.
   */
  hasTasksFlowIntegration?: boolean;
  /**
   * Зарегистрированные в /settings/buildings корпуса и помещения.
   * Используется для нового rooms-режима (race-задачи). Старые
   * caller'ы могут не передавать — режим pairs работает как раньше.
   */
  buildings?: Array<{
    id: string;
    name: string;
    rooms: Array<{
      id: string;
      name: string;
      kind: string;
      // Cleaning unification: эти поля теперь живут на Room (DB).
      // Если page.tsx не передал — fallback на дефолты внутри клиента.
      detergent?: string;
      currentScope?: string[];
      generalScope?: string[];
      currentDays?: number;
      generalDays?: number;
      currentScheduleType?: "weekly" | "monthly";
      generalScheduleType?: "weekly" | "monthly";
      currentMonthDays?: string[];
      generalMonthDays?: string[];
      requirePhoto?: boolean;
      // 2026-09-04: кто убирает / кто проверяет помещение (Room DB).
      cleanerUserIds?: string[];
      verifierUserIds?: string[];
    }>;
  }>;
  /**
   * Если true — рендерим Settings dialog в Design v2 стиле через
   * `<JournalSettingsModal>`. Сама механика и data-flow остаются
   * прежними; меняется только обёртка модалки. Включается через
   * `Organization.experimentalUiV2`. Default true с 2026-05 — V2.
   * См. docs/PIPELINE-VISION.md раздел P3.
   */
  useV2?: boolean;
};
type SettingsState = { title: string; cleaningRole: string; cleaningUserId: string; controlRole: string; controlUserId: string };
// RoomFormState — legacy type, заменён на RoomEditorInitial из
// @/components/cleaning/room-editor-dialog. См. cleaning-unification spec.
type ResponsibleFormState = { id: string | null; kind: CleaningResponsibleKind; title: string; userId: string };
type RowDescriptor =
  | { id: string; kind: "room"; room: CleaningRoomItem }
  | { id: string; kind: "cleaning"; responsible: CleaningResponsible }
  | { id: string; kind: "control"; responsible: CleaningResponsible };

// Cleaning unification 2026-05-08: ScopeListEditor + WeekdayMaskPicker
// extract'нуты в shared module @/components/cleaning/scope-and-schedule-editors
// чтобы /settings/buildings UI использовал тот же редактор. См. spec
// docs/superpowers/specs/2026-05-08-cleaning-unification.md (stages 2-3).

const userNameById = (users: UserItem[], userId: string) => users.find((user) => user.id === userId)?.name || "";
const buildSettingsState = (config: CleaningDocumentConfig): SettingsState => ({
  title: config.documentTitle || config.title || CLEANING_DOCUMENT_TITLE,
  cleaningRole: config.cleaningResponsibles[0]?.title || "",
  cleaningUserId: config.cleaningResponsibles[0]?.userId || "",
  controlRole: config.controlResponsibles[0]?.title || "",
  controlUserId: config.controlResponsibles[0]?.userId || "",
});
// buildRoomState — legacy helper, заменён на openRoomEditorFromRow в
// компоненте, который использует RoomEditorDialog/RoomEditorInitial.
const buildResponsibleState = (kind: CleaningResponsibleKind, responsible?: CleaningResponsible): ResponsibleFormState => ({
  id: responsible?.id || null,
  kind,
  title: responsible?.title || "",
  userId: responsible?.userId || "",
});

/**
 * Screen ↔ print duality tokens.
 *
 * НА ЭКРАНЕ журнал должен выглядеть частью дизайн-системы WeSetup:
 * мягкие границы `#ececf4`, серо-голубая шапка таблицы, hover строк.
 * ПРИ ПЕЧАТИ (Ctrl+P) инспектор РПН/СЭС ожидает «бумагу»: чёрные
 * рамки, без скруглений и заливок. Поэтому каждый токен несёт пару
 * screen-класс + `print:`-override.
 */
/** Скруглённый viewport вокруг таблицы; в печати — прозрачный wrapper. */
/** Focus-ring для интерактивных ячеек грида (A11y, п. B11). */

/** Человекочитаемые названия отметок — для aria-label ячеек. */
const CLEANING_VALUE_LABELS: Record<string, string> = {
  T: "Текущая уборка",
  G: "Генеральная уборка",
  "/": "Уборка не проводилась",
};

/**
 * Пометка выбывшего в легенде: его подписи в журнале остались, а новые
 * на него уже не ставятся — менеджеру видно, почему он ещё в списке.
 */
const RETIRED_LEGEND_SUFFIX = " · в архиве";

/** «2026-08-10» → «10 августа» для aria-label. */
function formatDayAriaLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/**
 * Легенда журнала хранится в config строками вида «Т — Текущая».
 * Разбираем их на `{ symbol, description }` для <JournalLegendBlock>.
 * Латинские T/G в легаси-конфигах приводим к кириллице по явной карте
 * (раньше это делалось regex-заменами прямо в JSX).
 */
const LEGEND_SYMBOL_ALIASES: Record<string, string> = { T: "Т", G: "Г" };

function parseLegendItem(raw: string): { symbol: string; description: string } {
  const trimmed = raw.trim();
  for (const separator of ["—", " - ", " – "]) {
    const index = trimmed.indexOf(separator);
    if (index > 0) {
      const symbol = trimmed.slice(0, index).trim();
      return {
        symbol: LEGEND_SYMBOL_ALIASES[symbol] ?? symbol,
        description: trimmed.slice(index + separator.length).trim(),
      };
    }
  }
  return { symbol: "", description: trimmed };
}

/**
 * Расшифровка цветов дней. Раньше цвет выходного/сокращённого дня
 * объяснялся только `title`-атрибутом ячейки — то есть никак для
 * тех, кто не наводит мышь. Показываем видимые chip'ы рядом с легендой.
 */
function CleaningDayColorLegend() {
  // Образцы — те же серые заливки, что у колонок дней (journal-grid.ts).
  const items = [
    { color: `border-[#a8a8a8] ${GRID_DAY_OFF_BG_CLASS}`, label: "Выходной или праздник" },
    { color: `border-[#c8c8c8] ${GRID_DAY_SHORT_BG_CLASS}`, label: "Сокращённый день" },
    { color: "border-[#ececf4] bg-white", label: "Рабочий день" },
  ];
  return (
    // A18: заливки дней теперь ПЕЧАТАЮТСЯ (см. journal-grid.ts), значит
    // и легенда к ним имеет смысл на бумаге — проверяющий понимает,
    // почему серый столбец пуст. Квадраты помечены
    // `data-print-keep-bg`, иначе тотальный светлый сброс печати
    // выбелил бы их в три пустых рамки; рамка на бумаге — чёрная, как у
    // образцов легенды в PDF.
    <div className="mx-auto flex w-full max-w-[820px] flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-[#3c4053]">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-2">
          <span data-print-keep-bg="" className={`inline-block size-4 rounded-md border ${item.color} print:border-black`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function CleaningDocumentClient(props: Props) {
  const router = useRouter();
  // «Сегодня» — после mount (useTodayKey): new Date() в рендере
  // расходился между сервером (UTC) и браузером и врал подсветкой.
  const todayKey = useTodayKey();
  const normalized = useMemo(() => normalizeCleaningDocumentConfig(props.config, { users: props.users }), [props.config, props.users]);
  const [config, setConfig] = useState(normalized);
  // Последнее локальное состояние конфига. Быстрый ввод (несколько кликов
  // до перерисовки) раньше строил каждый PATCH от протухшего `config` и
  // терял предыдущие правки.
  const configRef = useRef(config);
  configRef.current = config;
  // Очередь сохранений: PATCH'и идут строго по одному.
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const [saving, setSaving] = useState(false);
  /** Право управлять журналами — то же, что проверяет PATCH документа. */
  const canManageDocument = useCanManageJournalDocument();
  const [selection, setSelection] = useState<string[]>([]);
  // Multi-select cells (rowId::dateKey) для bulk-edit. Когда `cellSelectMode`
  // ON: клик по ячейке добавляет/убирает её из selection, mousedown+drag
  // выделяет диапазон (как в Excel).
  const [cellSelectMode, setCellSelectMode] = useState(false);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  // Меню выбора отметки для клетки карточного режима. Раньше тап
  // перебирал Т → Г → «/» → пусто вслепую: промахнулся — поехал дальше
  // по кругу, и на телефоне список вариантов взять было негде.
  const [cellMenu, setCellMenu] = useState<
    { x: number; y: number; rowId: string; dateKey: string } | null
  >(null);
  // История отмены: только правки ячеек, сделанные этим человеком в
  // этой вкладке. Настройки журнала и состав помещений в неё не идут —
  // это не «ой, не туда нажал».
  const undoStack = useJournalUndo({ enabled: props.status === "active" });
  // Drag-state хранится в refs (а не useState), чтобы read из mouseenter
  // handler'а был синхронным. setState async и handler читал бы stale
  // значение между ячейками, drag «терял» промежуточные.
  //
  // Excel-style rectangle drag-select:
  //   • mousedown на ячейке A → anchor = A, base = текущая selectedCells,
  //     mode = "remove" если A уже в base, иначе "add"
  //   • mousemove на ячейку B → applyRect(A, B): selectedCells = base ± cells_in_rect(A,B)
  //   • mouseup → очищает anchor; selectedCells уже финальный
  type CellPos = { rowId: string; dateKey: string };
  const dragAnchorRef = useRef<CellPos | null>(null);
  const dragBaseRef = useRef<Set<string>>(new Set());
  const dragModeRef = useRef<"add" | "remove" | null>(null);
  // Refs с актуальным порядком rows / dayKeys — нужны applyRectToSelection,
  // который вызывается из mouseenter handler'ов и должен читать самую
  // свежую раскладку (rows может пересчитаться при патче config).
  // Сами `rows` и `dayKeys` объявлены ниже как useMemo; sync через useEffect.
  const rowIdToIndexRef = useRef<Map<string, number>>(new Map());
  const dateKeyToIndexRef = useRef<Map<string, number>>(new Map());
  const rowsOrderRef = useRef<RowDescriptor[]>([]);
  const dateOrderRef = useRef<string[]>([]);
  // Дополнительный counter — для re-render UI «выделено N» в realtime
  // (selectedCells changes уже триггерят re-render, dragAnchorRef нет).
  const [, setDragTick] = useState(0);
  const cellKey = (rowId: string, dateKey: string) => `${rowId}::${dateKey}`;
  function clearCellSelection() {
    setSelectedCells(new Set());
  }
  // Mouse-up listener — снимает drag-state. Глобальный (на window),
  // чтобы работало даже если кнопка отпущена за пределами grid'а
  // (после того как пользователь утащил курсор за viewport).
  useEffect(() => {
    function handleUp() {
      dragAnchorRef.current = null;
      dragBaseRef.current = new Set();
      dragModeRef.current = null;
      setDragTick((n) => n + 1);
    }
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchend", handleUp);
    return () => {
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchend", handleUp);
    };
  }, []);
  // Drag-helpers. ref-based для синхронного read'а в mouseenter.
  // Применяет «прямоугольник от anchor до end» к selectedCells.
  // base — снимок selection в момент mousedown; mode — добавляем или убираем.
  function applyRectToSelection(anchor: CellPos, end: CellPos) {
    const aRow = rowIdToIndexRef.current.get(anchor.rowId);
    const eRow = rowIdToIndexRef.current.get(end.rowId);
    const aDate = dateKeyToIndexRef.current.get(anchor.dateKey);
    const eDate = dateKeyToIndexRef.current.get(end.dateKey);
    if (aRow == null || eRow == null || aDate == null || eDate == null) return;
    const r0 = Math.min(aRow, eRow);
    const r1 = Math.max(aRow, eRow);
    const d0 = Math.min(aDate, eDate);
    const d1 = Math.max(aDate, eDate);
    const base = dragBaseRef.current;
    const mode = dragModeRef.current ?? "add";
    const next = new Set(base);
    const rowsArr = rowsOrderRef.current;
    const dateArr = dateOrderRef.current;
    for (let i = r0; i <= r1; i += 1) {
      for (let j = d0; j <= d1; j += 1) {
        const row = rowsArr[i];
        const day = dateArr[j];
        if (!row || !day) continue;
        const k = cellKey(row.id, day);
        if (mode === "add") next.add(k);
        else next.delete(k);
      }
    }
    setSelectedCells(next);
  }
  function startDragOnCell(rowId: string, dateKey: string) {
    if (!cellSelectMode) return;
    const anchor: CellPos = { rowId, dateKey };
    const k = cellKey(rowId, dateKey);
    dragAnchorRef.current = anchor;
    dragBaseRef.current = new Set(selectedCells);
    dragModeRef.current = selectedCells.has(k) ? "remove" : "add";
    applyRectToSelection(anchor, anchor);
    setDragTick((n) => n + 1);
  }
  function continueDragOnCell(rowId: string, dateKey: string) {
    if (!cellSelectMode) return;
    const anchor = dragAnchorRef.current;
    if (!anchor || !dragModeRef.current) return;
    applyRectToSelection(anchor, { rowId, dateKey });
  }
  // Cleaning unification 2026-05-08+: один и тот же RoomEditorDialog
  // что используется в /settings/buildings. Сохраняет в Room (DB)
  // через PATCH /api/settings/rooms/[id]. router.refresh() подтягивает
  // обновлённый props.buildings и rows-builder перерисовывает.
  const [roomEditor, setRoomEditor] = useState<RoomEditorInitial | null>(null);

  // Полная конфигурация race-режима теперь живёт в диалоге, а не на странице.
  // По дефолту в журнале — только тонкая полоска с переключателем.
  const [raceConfigOpen, setRaceConfigOpen] = useState(false);

  function openRoomEditorFromRow(roomId: string) {
    const dbRoom = dbRoomById.get(roomId);
    if (!dbRoom) {
      // Строка есть в документе (config.rooms), но помещения нет в Room БД —
      // редактор шагов уборки пишет именно в Room, поэтому объясняем, что
      // делать, вместо глухого «не найдено».
      toast.error(
        "Это помещение есть только в документе. Заведите его в «Настройки → Помещения», чтобы редактировать состав уборки.",
      );
      return;
    }
    setRoomEditor({
      id: roomId,
      name: dbRoom.name,
      kind: dbRoom.kind ?? "other",
      detergent: dbRoom.detergent ?? "",
      // Передаём scope как-есть (string[] | ScopeStep[]) —
      // RoomEditorDialog.parseScopeSteps нормализует.
      currentScope: Array.isArray(dbRoom.currentScope)
        ? (dbRoom.currentScope as Array<string | { label: string; requirePhoto?: boolean }>)
        : [],
      generalScope: Array.isArray(dbRoom.generalScope)
        ? (dbRoom.generalScope as Array<string | { label: string; requirePhoto?: boolean }>)
        : [],
      currentDays:
        typeof dbRoom.currentDays === "number" ? dbRoom.currentDays : 127,
      generalDays:
        typeof dbRoom.generalDays === "number" ? dbRoom.generalDays : 0,
      currentScheduleType: dbRoom.currentScheduleType ?? "weekly",
      generalScheduleType: dbRoom.generalScheduleType ?? "weekly",
      currentMonthDays: Array.isArray(dbRoom.currentMonthDays)
        ? dbRoom.currentMonthDays
        : [],
      generalMonthDays: Array.isArray(dbRoom.generalMonthDays)
        ? dbRoom.generalMonthDays
        : [],
      requirePhoto: dbRoom.requirePhoto === true,
      cleanerUserIds: dbRoom.cleanerUserIds ?? [],
      verifierUserIds: dbRoom.verifierUserIds ?? [],
    });
  }
  const [responsibleDialog, setResponsibleDialog] = useState<ResponsibleFormState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsState, setSettingsState] = useState(buildSettingsState(normalized));
  // Каскады «Должность → Сотрудник»: общая логика (автоподбор, автооткрытие
  // списка сотрудников) в usePositionEmployeeCascade.
  const responsibleCascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: responsibleDialog?.title ?? "",
    userId: responsibleDialog?.userId ?? "",
    onChange: (next) =>
      setResponsibleDialog((current) =>
        current ? { ...current, title: next.positionTitle, userId: next.userId } : current
      ),
    autoPick: "first",
  });
  const cleaningCascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: settingsState.cleaningRole,
    userId: settingsState.cleaningUserId,
    onChange: (next) =>
      setSettingsState((current) => ({
        ...current,
        cleaningRole: next.positionTitle,
        cleaningUserId: next.userId,
      })),
    autoPick: "first",
  });
  const controlCascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: settingsState.controlRole,
    userId: settingsState.controlUserId,
    onChange: (next) =>
      setSettingsState((current) => ({
        ...current,
        controlRole: next.positionTitle,
        controlUserId: next.userId,
      })),
    autoPick: "first",
  });
  // «Сохранить как шаблон по умолчанию» — confirm dialog для записи
  // текущего config'а в Organization.defaultCleaningDocumentConfig.
  const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false);
  const [saveAsTemplateBusy, setSaveAsTemplateBusy] = useState(false);
  const closeAction = useDocumentCloseAction({
    documentId: props.documentId,
    title: normalized.documentTitle || CLEANING_PAGE_TITLE,
  });

  // «Заполнить по плану» — применяет weekday-маски всех помещений к
  // матрице. По умолчанию fill-empty (только пустые), но если зажат
  // shift / есть отметки → confirm-dialog с overwrite.
  async function applySchedulePlan(mode: "fill-empty" | "overwrite") {
    const next = applyRoomScheduleToMatrix(config, dayKeys, mode, dbScheduleMap);
    await patchDocument(next);
    const planned = next.rooms.reduce((acc, room) => {
      const row = next.matrix[room.id] ?? {};
      return acc + Object.keys(row).length;
    }, 0);
    toast.success(
      mode === "overwrite"
        ? `План применён заново: ${planned} ячеек`
        : `План применён к пустым ячейкам: ${planned} запланировано всего`,
    );
  }

  /**
   * Auto-apply schedule после сохранения помещения. Каллер передаёт
   * snapshot patch'а (свежие currentDays/generalDays/... ещё ДО того,
   * как router.refresh() прокинет это через props). Мы создаём
   * локальный override-map поверх dbScheduleMap и пересчитываем matrix
   * для затронутого помещения. patchDocument отрабатывает →
   * syncTodayMatrixChanges (auto-trigger в API endpoint) обновляет
   * сегодняшние TF-задачи. Past дата не трогается — менеджер не
   * хочет чтобы редактирование расписания меняло уже отмеченные дни.
   */
  async function autoApplyScheduleForRoom(snapshot: {
    id: string;
    currentDays: number;
    generalDays: number;
    currentScheduleType: "weekly" | "monthly";
    generalScheduleType: "weekly" | "monthly";
    currentMonthDays: string[];
    generalMonthDays: string[];
  }) {
    const overrideMap = new Map(dbScheduleMap ?? new Map());
    overrideMap.set(snapshot.id, {
      id: snapshot.id,
      currentDays: snapshot.currentDays,
      generalDays: snapshot.generalDays,
      currentScheduleType: snapshot.currentScheduleType,
      generalScheduleType: snapshot.generalScheduleType,
      currentMonthDays: snapshot.currentMonthDays,
      generalMonthDays: snapshot.generalMonthDays,
    });
    // Только будущее (СТРОГО завтра+) — сегодня не трогаем, иначе
    // existing completed TF-tasks могут потеряться (matrix меняется
    // → syncTodayMatrixChanges удаляет TF tasks → completion-history
    // отвязывается от TF). Plus исключаем дни, у которых уже есть
    // completion — на них уборщик уже отметился, перезапись плана
    // на этих днях ломает compliance-trail.
    const today = localDayKey();
    const completedDayKeysForRoom = new Set<string>();
    for (const e of props.initialEntries) {
      for (const c of listCleaningRoomCompletions(e.data)) {
        if (c.roomId === snapshot.id && c.dateKey) {
          completedDayKeysForRoom.add(c.dateKey);
        }
      }
    }
    const futureDayKeys = dayKeys.filter(
      (k) => k > today && !completedDayKeysForRoom.has(k),
    );
    if (futureDayKeys.length === 0) {
      // Ничего не пересчитываем (today + completion-дни исключены).
      // Однако параллельно — обновим requiresPhoto на сегодняшних TF-tasks
      // (без destructive matrix-сброса).
      await fetch("/api/integrations/tasksflow/sync-room-photo-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: props.documentId,
          roomId: snapshot.id,
        }),
      }).catch(() => {});
      return;
    }
    const next = applyRoomScheduleToMatrix(
      config,
      futureDayKeys,
      "overwrite",
      overrideMap,
      // Только изменённое помещение: overwrite по всем стирал будущие
      // отметки, проставленные вручную в остальных строках.
      { roomIds: [snapshot.id] },
    );
    await patchDocument(next);
    // После patch: подтолкнём requiresPhoto-апдейт на существующих TF-tasks
    // этого помещения. patchDocument уже вызвал syncTodayMatrixChanges,
    // но он только title/description обновляет, не requiresPhoto.
    await fetch("/api/integrations/tasksflow/sync-room-photo-policy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: props.documentId,
        roomId: snapshot.id,
      }),
    }).catch(() => {});
    toast.success(
      "Расписание помещения применено — будущие задачи обновлены",
    );
  }

  // Pipeline-mode setters — патчат config и persist'ят сразу.
  // perRoom = у каждой комнаты свой scope (текущее поведение)
  // global  = один общий список для всех комнат
  // legacy  = без подзадач, чек-лист отключён
  async function setCleaningSubtaskMode(mode: "perRoom" | "global" | "legacy") {
    const next = normalizeCleaningDocumentConfig(
      { ...config, cleaningSubtaskMode: mode },
      { users: props.users },
    );
    await patchDocument(next);
  }
  async function setGlobalSubtasks(value: { current?: string[]; general?: string[] }) {
    const prev = config.globalSubtasks ?? { current: [], general: [] };
    const merged = {
      current: value.current ?? prev.current,
      general: value.general ?? prev.general,
    };
    const next = normalizeCleaningDocumentConfig(
      { ...config, globalSubtasks: merged },
      { users: props.users },
    );
    await patchDocument(next);
  }
  async function handleSaveAsTemplate() {
    setSaveAsTemplateBusy(true);
    try {
      const response = await fetch("/api/journals/cleaning/default-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        toast.error(data?.error || "Не удалось сохранить шаблон");
        return;
      }
      toast.success("Шаблон сохранён — новые журналы уборки будут создаваться с этими настройками");
      setSaveAsTemplateOpen(false);
    } catch (err) {
      console.error("[cleaning] save-as-template failed", err);
      toast.error("Сетевая ошибка");
    } finally {
      setSaveAsTemplateBusy(false);
    }
  }
  // Mobile-only preference — Cards default. See hygiene-document-client.tsx
  // for the full rationale; the 920-px grid behind horizontal scroll is
  // unusable on a 320-px phone, so we collapse it into a per-row accordion
  // with tap-to-cycle day buttons. Desktop / print always use the table.
  const {
    mobileView,
    switchMobileView,
    mobileAxis,
    switchMobileAxis,
    viewResolved,
  } = useMobileView("cleaning");
  const viewClasses = documentViewClasses(mobileView, viewResolved);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  // Миграция со старого ключа "cleaning-mobile-view" (до перехода на
  // общий useMobileView). Читаем один раз: если нового ключа ещё нет,
  // а старый лежит — переносим выбор пользователя и чистим легаси.
  // Эффект объявлен ПОСЛЕ useMobileView, поэтому его собственный
  // restore-эффект уже отработал и мы не перетираем свежее значение.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("journal-mobile-view:cleaning")) return;
      const legacy = window.localStorage.getItem("cleaning-mobile-view");
      if (legacy === "table" || legacy === "cards") switchMobileView(legacy);
      window.localStorage.removeItem("cleaning-mobile-view");
    } catch {
      /* localStorage blocked — остаёмся на дефолте 'cards' */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const roleOptions = useMemo(() => getDistinctRoleLabels(props.users), [props.users]);
  const dayKeys = useMemo(() => buildDateKeys(props.dateFrom, props.dateTo), [props.dateFrom, props.dateTo]);

  /**
   * Дни, за которые на телефоне можно подписаться: период документа без
   * будущего — подпись «вперёд» ставить нечем, уборки ещё не было.
   */
  const signatureDayKeys = useMemo(() => {
    const untilToday = dayKeys.filter((key) => key <= todayKey);
    return untilToday.length > 0 ? untilToday : dayKeys;
  }, [dayKeys, todayKey]);
  const [signatureDay, setSignatureDay] = useState<string | null>(null);
  // Выбранный день переживает смену периода: невалидный откатывается на
  // последний доступный (обычно сегодня).
  const signatureDayKey =
    signatureDay && signatureDayKeys.includes(signatureDay)
      ? signatureDay
      : (signatureDayKeys[signatureDayKeys.length - 1] ?? "");

  /**
   * Минимальная ширина сетки уборки (P8).
   *
   * Раньше стояло жёсткое `sm:min-w-[1200px]` при бумажном полотне 1150px:
   * документ на 15 дней всегда выезжал за правый край — последний день и
   * правая рамка обрезались, хотя по факту таблица помещалась.
   *
   * Считаем от состава: чекбокс 48 + «Наименование помещения» 230 +
   * «Моющие и дезинфицирующие средства» 200 + 34px на каждый день. Месяц
   * из 15 дней = 988px (влезает в полотно, правая рамка на месте), полный
   * месяц из 31 дня = 1532px — и вот тогда включается горизонтальный
   * скролл внутри viewport'а с видимой полосой.
   */
  const gridMinWidth = 48 + 230 + 200 + dayKeys.length * 34;

  const isRoomsMode = config.cleaningMode === "rooms";

  // Для rooms-mode: подгружаем имя комнаты из buildings и инициалы юзеров.
  const buildingsRoomMap = useMemo(() => {
    const m = new Map<string, string>();
    (props.buildings ?? []).forEach((b) =>
      b.rooms.forEach((r) => m.set(r.id, r.name))
    );
    return m;
  }, [props.buildings]);

  // Cleaning unification: подгружаем полные Room-объекты (scope/days/
  // detergent + scheduleType/monthDays/requirePhoto) для rooms-mode.
  // Source of truth с 2026-05-08 — Room в БД, не config.rooms[].
  const dbRoomById = useMemo(() => {
    const m = new Map<
      string,
      {
        id: string;
        name: string;
        kind: string;
        detergent?: string;
        currentScope?: string[];
        generalScope?: string[];
        currentDays?: number;
        generalDays?: number;
        currentScheduleType?: "weekly" | "monthly";
        generalScheduleType?: "weekly" | "monthly";
        currentMonthDays?: string[];
        generalMonthDays?: string[];
        requirePhoto?: boolean;
        cleanerUserIds?: string[];
        verifierUserIds?: string[];
      }
    >();
    (props.buildings ?? []).forEach((b) =>
      b.rooms.forEach((r) => m.set(r.id, r)),
    );
    return m;
  }, [props.buildings]);

  // Назначения помещений (Room.cleanerUserIds / verifierUserIds) для
  // эффективного конфига и подсказок нагрузки в карточке помещения.
  const dbRoomResponsibles = useMemo(
    () =>
      Array.from(dbRoomById.values()).map((r) => ({
        id: r.id,
        cleanerUserIds: r.cleanerUserIds ?? [],
        verifierUserIds: r.verifierUserIds ?? [],
      })),
    [dbRoomById],
  );

  /**
   * ЭФФЕКТИВНЫЙ конфиг — raw `config` + назначения помещений из Room.
   * Только для отображения и резолверов (кто убирает / кто проверяет,
   * коды С1..СN). В сохранение (patchDocument) уходит только raw
   * `config` — назначения живут в Room, а не в документе.
   */
  const effectiveConfig = useMemo(
    () =>
      applyRoomResponsiblesToConfig(
        config,
        dbRoomResponsibles,
        new Set(props.users.map((u) => u.id)),
      ),
    [config, dbRoomResponsibles, props.users],
  );

  // Map с полным расписанием для applyRoomScheduleToMatrix.
  const dbScheduleMap = useMemo(() => {
    const m = new Map<string, RoomScheduleFromDb>();
    dbRoomById.forEach((r, id) => {
      m.set(id, {
        id,
        currentDays: r.currentDays,
        generalDays: r.generalDays,
        currentScheduleType: r.currentScheduleType,
        generalScheduleType: r.generalScheduleType,
        currentMonthDays: r.currentMonthDays,
        generalMonthDays: r.generalMonthDays,
      });
    });
    return m;
  }, [dbRoomById]);
  const userInitialsById = useMemo(() => {
    const m = new Map<string, string>();
    props.users.forEach((u) => {
      const parts = u.name.trim().split(/\s+/);
      const ini = parts
        .map((p) => p[0]?.toUpperCase() ?? "")
        .slice(0, 3)
        .join("");
      m.set(u.id, ini);
    });
    return m;
  }, [props.users]);

  // Уборщики — С1, С2, ..., СN. Без дедупа с контролёрами: один человек
  // МОЖЕТ быть и в «Ответственный за уборку», и в «Ответственный за
  // контроль» одновременно (раньше дедупили — пользователь жаловался,
  // что «Ярослав в контроле, но не в уборке» — теперь разрешено).
  const cleaningCodeEntries = useMemo(() => {
    // Единый источник с PDF/адаптером (listCleaningCodeEntries).
    const names = new Map(props.users.map((u) => [u.id, u.name]));
    return listCleaningCodeEntries(effectiveConfig, names);
  }, [effectiveConfig, props.users]);
  const cleaningResponsibleList = useMemo<CleaningResponsible[]>(
    () =>
      cleaningCodeEntries.map((r) => ({
        id: r.id,
        kind: "cleaning" as const,
        code: r.code,
        title: r.title,
        userId: r.userId,
        userName: r.userName,
      })),
    [cleaningCodeEntries],
  );

  // Контролёры — С1, С2, ... СM (independent numbering от cleaning-list).
  // Каждая строка («Ответственный за уборку» и «Ответственный за контроль»)
  // имеет собственное С-нумерование от С1 — они логически независимые
  // списки, объединённая нумерация запутывала менеджера.
  const controlCodeEntries = useMemo(() => {
    const names = new Map(props.users.map((u) => [u.id, u.name]));
    return listControlCodeEntries(config, names);
  }, [config, props.users]);
  const controlResponsibleList = useMemo<CleaningResponsible[]>(
    () =>
      controlCodeEntries.map((r) => ({
        id: r.id,
        kind: "control" as const,
        code: r.code,
        title: r.title,
        userId: r.userId,
        userName: r.userName,
      })),
    [controlCodeEntries],
  );

  // Коды, которые предлагает клик по ячейке подписи: выбывшие в цикл не
  // попадают — на них можно только смотреть в уже стоящих подписях.
  const activeCleaningCodes = useMemo(
    () => cleaningCodeEntries.filter((r) => !r.retired).map((r) => r.code),
    [cleaningCodeEntries],
  );
  const activeControlCodes = useMemo(
    () => controlCodeEntries.filter((r) => !r.retired).map((r) => r.code),
    [controlCodeEntries],
  );

  // Единый резолвер подписей: и чтение, и запись ячеек строк подписей идут
  // только через него (в matrix лежит `uid:<userId>`, код «СN» — отображение).
  const cleaningSignatures = useMemo(
    () => buildCleaningSignatureResolver(cleaningResponsibleList),
    [cleaningResponsibleList],
  );
  const controlSignatures = useMemo(
    () => buildCleaningSignatureResolver(controlResponsibleList),
    [controlResponsibleList],
  );

  const rows = useMemo<RowDescriptor[]>(() => {
    // Cleaning unification 2026-05-08+: помещения ВСЕГДА из Buildings
    // (Room DB), независимо от режима. Если selectedRoomIds задан — берём
    // их; если пусто — все Room орги.
    //
    // 2026-05-08 (поздний вечер): rows возвращает ТОЛЬКО помещения. Строки
    // «Ответственный за уборку» и «Ответственный за контроль» рендерятся
    // как 2 отдельных <tr>/<div> ПОСЛЕ rows.map(...) в JSX, по образцу
    // haccp-online.ru: одна группированная строка с multi-line списком
    // «С1 - Имя / С2 - Имя» в первой колонке вместо N отдельных строк.
    //
    // 2026-08-12: источником списка строк были ТОЛЬКО Room из БД
    // (`props.buildings`). Если у орги помещения живут в документе
    // (`config.rooms` — их же видит нижняя сводная таблица «Наименование
    // помещения | Текущая уборка | Генеральная уборка»), а Buildings пуст,
    // основная сетка рендерила ноль строк помещений: оставались только две
    // строки ответственных. Теперь список — ОБЪЕДИНЕНИЕ обоих источников:
    // порядок задаёт документ, недостающие помещения добираются из БД,
    // а содержимое строки берётся из Room БД (source of truth), с откатом
    // на данные документа для помещений, которых в Buildings нет.
    const allBuildingRoomIds = Array.from(dbRoomById.keys());
    const selectedIds = config.selectedRoomIds ?? [];
    const dbRoomIds =
      selectedIds.length > 0
        ? selectedIds.filter((id) => dbRoomById.has(id))
        : allBuildingRoomIds;
    const configRoomById = new Map(config.rooms.map((room) => [room.id, room]));
    // Помещение удалили из справочника, а отметки уборки в журнале
    // остались: строку показываем с пометкой «помещение удалено»
    // (стирать данные ХАССП нельзя), пустую — нет.
    const deletedWithMarks = listDeletedCleaningRoomsWithMarks(
      config,
      dbRoomById.keys()
    ).filter((item) => !configRoomById.has(item.id));
    const deletedNameById = new Map(
      deletedWithMarks.map((item) => [item.id, item.name])
    );
    const roomIds = [
      ...config.rooms.map((room) => room.id),
      ...dbRoomIds.filter((id) => !configRoomById.has(id)),
      ...deletedWithMarks.map((item) => item.id),
    ];
    return roomIds.map((roomId) => {
      const dbRoom = dbRoomById.get(roomId);
      const cfgRoom = configRoomById.get(roomId);
      const room: CleaningRoomItem = {
        id: roomId,
        areaId: cfgRoom?.areaId ?? null,
        name:
          dbRoom?.name ??
          deletedNameById.get(roomId) ??
          cfgRoom?.name ??
          "Помещение",
        detergent: dbRoom?.detergent ?? cfgRoom?.detergent ?? "",
        currentScope: Array.isArray(dbRoom?.currentScope)
          ? (dbRoom.currentScope as string[])
          : (cfgRoom?.currentScope ?? []),
        generalScope: Array.isArray(dbRoom?.generalScope)
          ? (dbRoom.generalScope as string[])
          : (cfgRoom?.generalScope ?? []),
        currentDays:
          typeof dbRoom?.currentDays === "number"
            ? dbRoom.currentDays
            : (cfgRoom?.currentDays ?? 127),
        generalDays:
          typeof dbRoom?.generalDays === "number"
            ? dbRoom.generalDays
            : (cfgRoom?.generalDays ?? 0),
      };
      return { id: roomId, kind: "room" as const, room };
    });
    // `config` целиком: список строк зависит ещё и от matrix (строки
    // удалённых помещений с отметками).
  }, [config, dbRoomById]);

  /**
   * C4 аудита: справочник «Наименование помещения / Текущая уборка /
   * Генеральная уборка» под бланком строится из ТЕХ ЖЕ строк, что и
   * матрица. Раньше он рендерил `config.rooms` — то есть blueprint'ы с
   * пустыми scope, а шаги, введённые менеджером в /settings/buildings,
   * в бланк не попадали вовсе.
   */
  const referenceRooms = useMemo(
    () => rows.filter((row) => row.kind === "room").map((row) => row.room),
    [rows],
  );

  /**
   * Все id, которые вообще можно выделить в сетке: помещения + уборщики +
   * контролёры. Ровно этот набор умеет удалять `deleteSelectedRows`.
   *
   * До этой правки select-all шапки клал в selection ТОЛЬКО помещения и
   * попутно сбрасывал уже выбранных уборщиков, а `allSelected` считался по
   * `rows.length` — поэтому галочка шапки могла показать «выбрано всё»,
   * когда отмечены были одни уборщики. Теперь и выбор, и индикатор идут от
   * одного множества.
   */
  const selectableRowIds = useMemo<string[]>(
    () => [
      ...rows.map((row) => row.id),
      ...cleaningResponsibleList.map((resp) => resp.id),
      ...controlResponsibleList.map((resp) => resp.id),
    ],
    [rows, cleaningResponsibleList, controlResponsibleList],
  );

  const allRowsSelected =
    selectableRowIds.length > 0 &&
    selectableRowIds.every((id) => selection.includes(id));

  // Псевдо-rowId для manual signature ответственного. matrix хранит их
  // как обычные строки — patchDocument сам их сохраняет/читает.
  const CLEANING_SIGNATURE_ROW_ID = "__cleaning_signature__";
  const CONTROL_SIGNATURE_ROW_ID = "__control_signature__";

  // Подпись «Ответственный за уборку» в день D.
  //   1. Если есть manual override (matrix[CLEANING_SIGNATURE_ROW_ID][D]) —
  //      возвращаем его. НО если код устарел (С2 из 2-уборщикового
  //      прошлого, а сейчас только С1) — игнорируем.
  //   2. Иначе computed: коды С1/С2 из completion-entries напрямую
  //      (раньше через cellValue, но cellValue для room-rows больше не
  //      возвращает С-коды — только Т/Г/«/», см. cellValue выше).
  function cleaningCodeForDay(dateKey: string): string {
    // Резолвер снимает маркер «auto:», понимает «uid:<id>» и легаси «СN»
    // и возвращает "" на явную очистку, null — когда подписи нет.
    const manual = cleaningSignatures.readManual(
      config.matrix[CLEANING_SIGNATURE_ROW_ID]?.[dateKey],
    );
    if (manual !== null) return manual;
    const codes = new Set<string>();
    for (const e of props.initialEntries) {
      for (const c of listCleaningRoomCompletions(e.data)) {
        if (c.dateKey !== dateKey) continue;
        const code = cleanerCodeById.get(c.cleanerUserId);
        if (code) codes.add(code);
      }
    }
    return Array.from(codes).sort().join(",");
  }

  // Подпись «Ответственный за контроль» в день D.
  //   1. Manual override matrix[CONTROL_SIGNATURE_ROW_ID][D] выигрывает.
  //   2. Иначе: коды контролёров (К1/К2) в дни где была хоть одна реальная
  //      completion в комнатах. Без completions — пусто (нечего проверять).
  function controlCodeForDay(dateKey: string): string {
    const manual = controlSignatures.readManual(
      config.matrix[CONTROL_SIGNATURE_ROW_ID]?.[dateKey],
    );
    if (manual !== null) return manual;
    if (controlResponsibleList.length === 0) return "";
    // Computed: если хоть одна completion в этот день — считаем что
    // контролёр(ы) проверили. Без completions — нечего проверять, пусто.
    const hasAnyCompletion = hasCompletionOnDay(dateKey);
    if (!hasAnyCompletion) return "";
    return controlResponsibleList.map((c) => c.code).join(",");
  }

  // Циклим manual signature по клику. Порядок:
  //   computed/empty → С1 → С2 → ... → СN → «—» (sentinel: visual empty,
  //   но override computed) → computed/empty (delete from storage)
  //
  // Sentinel «—» нужен по той же причине что и в room-cells: если
  // computed-fallback (cleaningCodeForDay из completions) показывает код,
  // менеджер не может «очистить» клетку — она всегда возвращалась к
  // computed. Sentinel явно подавляет fallback.
  /**
   * Запись подписи в matrix: единственное место, где решается что уходит
   * в сторадж. `next` — код «СN», sentinel «—» (видимо пусто, подавляет
   * computed) или "" (удалить override). Отсюда пишут и клетка таблицы,
   * и блок «Подписи за день» на телефоне — правила одни на оба.
   */
  async function writeSignature(rowId: string, dateKey: string, next: string) {
    if (props.status !== "active" || saving) return;
    const previousConfig = config;
    // Что было видно в клетке до снятия — по нему решаем, есть ли что
    // возвращать, и это же показываем в тосте.
    const previousVisible =
      rowId === CLEANING_SIGNATURE_ROW_ID
        ? cleaningCodeForDay(dateKey)
        : controlCodeForDay(dateKey);
    const nextRowMap = { ...(config.matrix[rowId] ?? {}) };
    if (next === "—") {
      nextRowMap[dateKey] = "—";
    } else if (next === "") {
      delete nextRowMap[dateKey];
    } else {
      // В matrix уходит стабильная ссылка на сотрудника, а не код «СN»:
      // код зависит от состава, а подпись должна остаться его подписью.
      const resolver =
        rowId === CLEANING_SIGNATURE_ROW_ID ? cleaningSignatures : controlSignatures;
      const userId = resolver.userIdOf(next);
      nextRowMap[dateKey] = userId ? cleaningSignatureRef(userId) : next;
    }
    // Пишем БЕЗ auto-маркера: подпись, которую менеджер поставил
    // кликом, считается ручной и автоснятием больше не трогается.
    await patchCellsWithUndo({
      ...config,
      matrix: { ...config.matrix, [rowId]: nextRowMap },
    });
    // Снятие подписи обратимо, поэтому не спрашиваем заранее, а даём
    // кнопку «Вернуть» — это и подтверждение, что действие прошло.
    if (next === "—" && previousVisible) {
      toast.success(`Подпись снята: ${previousVisible}`, {
        action: {
          label: "Вернуть",
          onClick: () => {
            void patchCellsWithUndo(previousConfig);
          },
        },
      });
    }
  }

  async function cycleSignature(
    rowId: string,
    dateKey: string,
    codes: string[],
  ) {
    if (props.status !== "active" || saving) return;
    if (codes.length === 0) return;
    // Source-of-truth: видимое значение (matrix override ИЛИ computed).
    // Раньше читали только matrix → клик на computed-derived "С1" вёл к
    // matrix=С1 (визуально без изменений). Теперь cycle стартует от того
    // что менеджер видит.
    const visualCode =
      rowId === CLEANING_SIGNATURE_ROW_ID
        ? cleaningCodeForDay(dateKey)
        : controlCodeForDay(dateKey);
    const matrixVal = config.matrix[rowId]?.[dateKey];
    // Sentinel в matrix → текущее визуальное "" (empty), next = codes[0].
    // visualCode может быть "С1" или "С1,С2" (multi). Простое правило:
    // если visualCode === codes[i] (single match) — берём codes[i+1].
    // Иначе если visualCode пустое или multi/unknown → start с codes[0].
    // sentinel → start с codes[0].
    let next: string;
    if (matrixVal === "—") {
      next = codes[0];
    } else if (!visualCode) {
      next = codes[0];
    } else {
      const idx = codes.indexOf(visualCode);
      if (idx < 0) {
        // visualCode не один из codes (multi-code, stale, или unknown)
        next = codes[0];
      } else if (idx === codes.length - 1) {
        // Последний код → sentinel (visual empty, override computed)
        next = "—";
      } else {
        next = codes[idx + 1];
      }
    }
    await writeSignature(rowId, dateKey, next);
  }

  /**
   * Сохранение состава помещений журнала (race-config). Новым строкам
   * достраиваем прошлое: сперва план по маскам Т/Г, затем «/» на все
   * оставшиеся прошедшие дни — как на эталоне, чтобы добавленное в
   * середине периода помещение не оставляло пустой хвост.
   *
   * Уже существующие строки не трогаем — их прошлое остаётся как есть.
   */
  async function saveRoomsSelection(patch: {
    cleaningMode: "pairs" | "rooms";
    selectedRoomIds: string[];
    selectedCleanerUserIds: string[];
  }) {
    const previousIds = new Set(config.selectedRoomIds ?? []);
    const addedIds = patch.selectedRoomIds.filter((id) => !previousIds.has(id));
    let nextConfig: CleaningDocumentConfig = {
      ...config,
      cleaningMode: patch.cleaningMode,
      selectedRoomIds: patch.selectedRoomIds,
      selectedCleanerUserIds: patch.selectedCleanerUserIds,
      // 2026-09-04: закрепления живут в Room (cleanerUserIds), в документе
      // остаётся только legacy config.cleanerByRoomId — не трогаем.
    };
    if (addedIds.length > 0) {
      const todayKey = toDateKey(new Date());
      const pastKeys = dayKeys.filter((key) => key < todayKey);
      if (pastKeys.length > 0) {
        const planned = applyRoomScheduleToMatrix(
          {
            ...nextConfig,
            cleaningMode: "rooms",
            selectedRoomIds: addedIds,
            rooms: nextConfig.rooms.filter((room) => addedIds.includes(room.id)),
          },
          pastKeys,
          "fill-empty",
          dbScheduleMap,
        );
        nextConfig = {
          ...nextConfig,
          matrix: planned.matrix,
          marks: planned.matrix,
        };
      }
      nextConfig = fillPastDaysNotPerformed(nextConfig, dayKeys, {
        todayKey,
        roomIds: addedIds,
      });
    }
    await patchDocument(nextConfig);
  }

  /** Есть ли в этот день хоть одна TF-completion (kind="cleaning_room"). */
  function hasCompletionOnDay(dateKey: string): boolean {
    return props.initialEntries.some((e) =>
      listCleaningRoomCompletions(e.data).some((c) => c.dateKey === dateKey),
    );
  }

  /**
   * Автоподпись ответственных при РУЧНОМ заполнении матрицы.
   *
   * Как на эталоне: как только в дне появилась хоть одна отметка Т/Г,
   * в строках «Ответственный за уборку» и «Ответственный за контроль»
   * появляется код С1 соответствующего ответственного. Когда все
   * отметки дня сняты («/», пусто, sentinel) — автоподпись снимается.
   *
   * Приоритеты:
   *   • TF-completion важнее: если в день есть completion — ничего не
   *     трогаем, подпись считается по completions (cleaningCodeForDay).
   *   • Ручная подпись (значение без auto-маркера, включая sentinel «—»)
   *     не перетирается и не снимается — это осознанный выбор менеджера.
   *   • Идемпотентно: повторный вызов на тех же данных не меняет config.
   */
  function applyAutoSignatures(
    cfg: CleaningDocumentConfig,
    dateKeys: string[],
  ): CleaningDocumentConfig {
    // Стабильная ссылка вместо кода «СN» — см. cycleSignature.
    const cleaningCode = cleaningSignatureRef(
      cleaningCodeEntries.find((r) => !r.retired)?.userId,
    );
    const controlCode = cleaningSignatureRef(
      controlCodeEntries.find((r) => !r.retired)?.userId,
    );
    const roomIds = rows.map((r) => r.id);
    if (roomIds.length === 0) return cfg;

    const cleaningRow = { ...(cfg.matrix[CLEANING_SIGNATURE_ROW_ID] ?? {}) };
    const controlRow = { ...(cfg.matrix[CONTROL_SIGNATURE_ROW_ID] ?? {}) };
    let changed = false;

    function applyOne(
      row: Record<string, CleaningMatrixValue>,
      dateKey: string,
      performed: boolean,
      code: string,
    ): boolean {
      const current = row[dateKey];
      if (performed) {
        if (!code) return false;
        const want = markAutoSignature(code);
        if (current === undefined) {
          row[dateKey] = want;
          return true;
        }
        if (isAutoSignatureValue(current) && current !== want) {
          row[dateKey] = want;
          return true;
        }
        return false;
      }
      if (current !== undefined && isAutoSignatureValue(current)) {
        delete row[dateKey];
        return true;
      }
      return false;
    }

    for (const dateKey of dateKeys) {
      if (hasCompletionOnDay(dateKey)) continue;
      const performed = roomIds.some((id) => {
        const value = cfg.matrix[id]?.[dateKey];
        return value === "T" || value === "G";
      });
      if (applyOne(cleaningRow, dateKey, performed, cleaningCode)) changed = true;
      if (applyOne(controlRow, dateKey, performed, controlCode)) changed = true;
    }
    if (!changed) return cfg;

    const nextMatrix = { ...cfg.matrix };
    if (Object.keys(cleaningRow).length > 0) nextMatrix[CLEANING_SIGNATURE_ROW_ID] = cleaningRow;
    else delete nextMatrix[CLEANING_SIGNATURE_ROW_ID];
    if (Object.keys(controlRow).length > 0) nextMatrix[CONTROL_SIGNATURE_ROW_ID] = controlRow;
    else delete nextMatrix[CONTROL_SIGNATURE_ROW_ID];
    return { ...cfg, matrix: nextMatrix, marks: nextMatrix };
  }

  // Синкаем refs для rect-drag-select. Без этого applyRectToSelection
  // может прочитать stale rows при быстром переключении.
  useEffect(() => {
    rowsOrderRef.current = rows;
    const m = new Map<string, number>();
    rows.forEach((r, i) => m.set(r.id, i));
    rowIdToIndexRef.current = m;
  }, [rows]);
  useEffect(() => {
    dateOrderRef.current = dayKeys;
    const m = new Map<string, number>();
    dayKeys.forEach((d, i) => m.set(d, i));
    dateKeyToIndexRef.current = m;
  }, [dayKeys]);

  /** Выделить ВСЕ ячейки (rows × dates). Используется для bulk-«Применить». */
  function selectAllCells() {
    const next = new Set<string>();
    for (const row of rows) {
      for (const day of dayKeys) {
        next.add(cellKey(row.id, day));
      }
    }
    setSelectedCells(next);
    setCellSelectMode(true);
  }

  // Map userId → код уборщика (С1/С2/...). Используется в room-cells
  // (cellValue.completion-fallback) и должен быть согласован с
  // cleaningResponsibleList — иначе ghost-уборщик (например, бывший
  // или контролёр) генерирует код С2 в клетке, хотя в списке
  // уборщиков его нет.
  //
  // Раньше cleanerCodeById брал данные напрямую из selectedCleanerUserIds,
  // включая отфильтрованных. Теперь источник = cleaningResponsibleList
  // (уже отдедуплицирован: контролёры исключены).
  const cleanerCodeById = useMemo(() => {
    const m = new Map<string, string>();
    cleaningResponsibleList.forEach((r) => {
      if (r.userId) m.set(r.userId, r.code);
    });
    return m;
  }, [cleaningResponsibleList]);

  // Все, кто когда-либо был уборщиком этого документа (закреплённые коды).
  // Их закрытая TF-задача — факт: после ухода из состава отметка не должна
  // пропадать из бланка. Чужие (контролёр, случайный юзер) сюда не попадают.
  const knownCleanerIds = useMemo(
    () => new Set(Object.keys(effectiveConfig.cleanerCodeByUserId ?? {})),
    [effectiveConfig.cleanerCodeByUserId],
  );

  /**
   * Подпись «кто убирает зону» под названием комнаты (rooms-mode).
   * Тот же резолвер, что у адаптера и PDF — на экране видно ровно то,
   * что уйдёт в TasksFlow. Закреплённая зона помечается отдельно.
   */
  function roomAssignmentLabel(roomId: string): { text: string; pinned: boolean } | null {
    if (!isRoomsMode) return null;
    const ids = resolveRoomCleaners(effectiveConfig, roomId);
    if (ids.length === 0) return null;
    const pinned = (effectiveConfig.cleanerByRoomId?.[roomId]?.length ?? 0) > 0;
    const names = ids.map((uid) => {
      const name = props.users.find((u) => u.id === uid)?.name ?? "—";
      const code = cleanerCodeById.get(uid);
      return code ? `${name} (${code})` : name;
    });
    const suffix = ids.length > 1 ? " — кто первый" : "";
    return { text: `Уборка: ${names.join(", ")}${suffix}`, pinned };
  }

  /**
   * Подпись «кто проверяет помещение» — только когда у помещения свои
   * проверяющие (Room.verifierUserIds). Контролёр журнала и так стоит в
   * строке «Контролёр» внизу — не дублируем его под каждой комнатой.
   */
  function roomVerifierLabel(roomId: string): string | null {
    if (!isRoomsMode) return null;
    const zone = effectiveConfig.verifierByRoomId?.[roomId];
    if (!zone || zone.length === 0) return null;
    const names = resolveRoomControllers(effectiveConfig, roomId).map(
      (uid) => props.users.find((u) => u.id === uid)?.name ?? "—",
    );
    return `Проверяет: ${names.join(", ")}`;
  }

  /** Нагрузка по ДРУГИМ помещениям — подсказка в карточке помещения. */
  const roomsPerCleanerForEditor = useMemo(
    () =>
      countRoomsPerUser(
        dbRoomResponsibles.filter((r) => r.id !== roomEditor?.id),
        "cleaner",
      ),
    [dbRoomResponsibles, roomEditor?.id],
  );
  const roomsPerVerifierForEditor = useMemo(
    () =>
      countRoomsPerUser(
        dbRoomResponsibles.filter((r) => r.id !== roomEditor?.id),
        "verifier",
      ),
    [dbRoomResponsibles, roomEditor?.id],
  );

  /**
   * Значение ячейки.
   *
   * Приоритет (2026-05-09 фикс «по середине не убирается»):
   *   1. Manual matrix override (T/G/«/») — побеждает всегда. Так клик
   *      менеджера сразу виден: cycled empty→T→G→«/»→empty без сюрпризов.
   *      Раньше completion-код блокировал визуальные правки и менеджер
   *      думал что клик не работает.
   *   2. Completion из JournalDocumentEntry (kind="cleaning_room") — код
   *      уборщика С1/С2/... Виден когда matrix пустой и уборщик закрыл
   *      TF-задачу. Менеджер не теряет compliance-данные: чтобы вернуться
   *      к completion-display, надо до-цикл матрицы до empty.
   *   3. Иначе пусто.
   *
   * Responsible-rows (cleaning/control) рендерятся отдельно ниже rows.map
   * с собственными cleaningCodeForDay/controlCodeForDay; здесь возвращаем
   * пусто для безопасности (никогда не вызывается с non-room в новой
   * структуре, но guard на случай регрессии).
   */
  function cellValue(row: RowDescriptor, dateKey: string): string {
    if (row.kind !== "room") return "";
    // 1. Manual matrix override — Т/Г/«/» или sentinel «—» (явная пустота).
    //    Любые С-коды (легаси из 2-уборщикового setup'а) — игнор.
    const matrixVal = config.matrix[row.id]?.[dateKey];
    if (matrixVal === "—") {
      // Sentinel: менеджер явно очистил клетку, completion-fallback
      // подавляется. Возвращаем сам sentinel — JSX через
      // displayMatrixValue превратит его в "" (визуальная пустота),
      // а updateCell использует sentinel для корректного цикла.
      return matrixVal;
    }
    if (matrixVal && (matrixVal === "T" || matrixVal === "G" || matrixVal === "/")) {
      return matrixVal;
    }
    // 2. Completion из DB — cleaner закрыл TF-задачу. Возвращаем тип
    //    уборки на этот день: Г если день в generalDays bitmask room'а,
    //    иначе Т.
    for (const e of props.initialEntries) {
      for (const c of listCleaningRoomCompletions(e.data)) {
        if (c.roomId !== row.id || c.dateKey !== dateKey) continue;
        const cleanerId = c.cleanerUserId;
        if (!cleanerCodeById.has(cleanerId) && !knownCleanerIds.has(cleanerId)) {
          // Чужой (например, контролёр) — не показываем фантомное «выполнено».
          return "";
        }
        // Cleaner валидный. Определяем тип уборки по день-недели bitmask.
        const dow = (() => {
          const d = new Date(`${dateKey}T00:00:00.000Z`);
          if (Number.isNaN(d.getTime())) return -1;
          const js = d.getUTCDay(); // 0=Вс..6=Сб
          return js === 0 ? 6 : js - 1; // приводим к Пн=0..Вс=6
        })();
        const generalDays =
          typeof row.room.generalDays === "number" ? row.room.generalDays : 0;
        if (dow >= 0 && (generalDays & (1 << dow)) !== 0) return "G";
        return "T";
      }
    }
    return "";
  }

  useEffect(() => { setConfig(normalized); setSettingsState(buildSettingsState(normalized)); }, [normalized]);

  // TasksFlow round-trip:
  //   1. On mount, if the org has the integration, ask the server to
  //      pull task statuses from TasksFlow. If anything is newly
  //      completed, the server has already written the cell — we just
  //      router.refresh() to re-render.
  //   2. The action button calls the same endpoint with explicit toast
  //      so the user can force a refresh after closing a task in the
  //      cleaner's app without leaving the page.
  // Guarded by `hasTasksFlowIntegration` so orgs without integration
  // pay zero cost.
  const [tasksFlowSyncing, setTasksFlowSyncing] = useState(false);
  const [cleanupCompletedRunning, setCleanupCompletedRunning] = useState(false);

  async function cleanupCompletedTasks() {
    if (!props.hasTasksFlowIntegration || cleanupCompletedRunning) return;
    const ok = await confirmAsync({
      title: "Удалить выполненные TF-задачи?",
      description:
        "Из TasksFlow будут удалены ВСЕ задачи которые помечены как выполненные у этой компании. Журналы (matrix, audit-log, фото) — остаются. Это нужно когда лента TF разрослась и хочется чистоты.",
      variant: "warn",
      confirmLabel: "Очистить",
      bullets: [
        { label: "Удаляются ТОЛЬКО completed-задачи (active не трогаем)" },
        { label: "Только нашей компании в TF (companyId-фильтр)" },
        { label: "Compliance-данные остаются: matrix-ячейки, JournalDocumentEntry, AuditLog" },
      ],
    });
    if (!ok) return;
    setCleanupCompletedRunning(true);
    try {
      const r = await fetch(
        "/api/integrations/tasksflow/cleanup-completed",
        { method: "POST" },
      );
      const data = (await r.json().catch(() => ({}))) as {
        deletedTfTasks?: number;
        alreadyGone?: number;
        message?: string;
        error?: string;
      };
      if (!r.ok) {
        toast.error(data.error ?? "Не удалось очистить выполненные");
        return;
      }
      toast.success(data.message ?? "Готово");
      router.refresh();
    } catch (err) {
      toast.error(humanizeFetchError(err, "Сеть упала"));
    } finally {
      setCleanupCompletedRunning(false);
    }
  }

  async function syncFromTasksFlow(opts?: { silent?: boolean }) {
    if (!props.hasTasksFlowIntegration || tasksFlowSyncing) return;
    setTasksFlowSyncing(true);
    try {
      const response = await fetch(
        "/api/integrations/tasksflow/sync-tasks",
        { method: "POST" }
      );
      if (!response.ok) {
        if (!opts?.silent) {
          toast.error("Не удалось обновить статусы из TasksFlow");
        }
        return;
      }
      const data = (await response.json()) as {
        checked: number;
        newlyCompleted: number;
        reopened: number;
        errors: number;
      };
      if (data.newlyCompleted > 0 || data.reopened > 0) {
        router.refresh();
      }
      if (!opts?.silent) {
        if (data.errors > 0) {
          toast.error("TasksFlow временно недоступен. Журнал продолжает работать.");
        } else if (data.newlyCompleted > 0) {
          toast.success(
            `Из TasksFlow подтянуто выполненных: ${data.newlyCompleted}`
          );
        } else if (data.checked === 0) {
          toast.info("Связанных задач в TasksFlow пока нет");
        } else {
          toast.info("Все задачи уже актуальны");
        }
      }
    } catch (error) {
      if (!opts?.silent) {
        toast.error(
          humanizeFetchError(error, "Ошибка обновления")
        );
      }
    } finally {
      setTasksFlowSyncing(false);
    }
  }
  useEffect(() => {
    if (!props.hasTasksFlowIntegration) return;
    void syncFromTasksFlow({ silent: true });
    // Intentionally fires once per mount; do not re-run on every props
    // change or we'd hammer TasksFlow on every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function patchDocument(nextConfig: CleaningDocumentConfig, overrides?: Record<string, unknown>) {
    setSaving(true);
    try {
      const payload = normalizeCleaningDocumentConfig(nextConfig, { users: props.users });
      const response = await fetch(`/api/journal-documents/${props.documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: payload.documentTitle || payload.title,
          config: payload,
          responsibleTitle: payload.controlResponsibles[0]?.title || props.responsibleTitle || null,
          responsibleUserId: payload.controlResponsibles[0]?.userId || props.responsibleUserId || null,
          autoFill: payload.autoFill.enabled,
          ...overrides,
        }),
      });
      if (!response.ok) {
        // Раньше бросали «save failed», а вызовы глушили .catch(() => {}) —
        // любая ошибка сохранения пропадала бесследно.
        const body = await response.json().catch(() => null);
        const message =
          (body && typeof body.error === "string" && body.error) ||
          "Не удалось сохранить изменения";
        throw new Error(message);
      }
      setConfig(payload);
      setSettingsState(buildSettingsState(payload));
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  /**
   * Оптимистичная правка ячеек: локальное состояние применяем сразу,
   * при ошибке сервера откатываем и показываем текст ошибки.
   */
  async function patchCellsOptimistic(nextConfig: CleaningDocumentConfig) {
    const previousConfig = configRef.current;
    configRef.current = nextConfig;
    setConfig(nextConfig);
    // Сериализация: следующий PATCH стартует только после предыдущего.
    const run = saveChainRef.current.catch(() => {}).then(async () => {
      try {
        await patchDocument(nextConfig);
      } catch (error) {
        configRef.current = previousConfig;
        setConfig(previousConfig);
        setSettingsState(buildSettingsState(previousConfig));
        toast.error(
          humanizeFetchError(error, "Не удалось сохранить изменения"),
        );
        throw error;
      }
    });
    saveChainRef.current = run;
    await run;
  }

  /**
   * Правка ячеек с записью в историю отмены.
   *
   * Откат — это повторный PATCH прежнего config'а тем же роутом, а не
   * правка состояния на клиенте: серверные проверки (закрытый документ,
   * права) обязаны срабатывать и на откате.
   */
  async function patchCellsWithUndo(nextConfig: CleaningDocumentConfig) {
    const previousConfig = config;
    await patchCellsOptimistic(nextConfig);
    undoStack.push({
      undo: () => patchDocument(previousConfig),
      redo: () => patchDocument(nextConfig),
    });
  }

  async function updateSettings(patch: Partial<SettingsState>) {
    const nextState = { ...settingsState, ...patch };
    setSettingsState(nextState);
    // Upsert ответственных:
    //   • если массив непустой — обновляем index 0 (как раньше)
    //   • если массив пустой и пользователь выбрал role+userId — создаём
    //     новую запись через createCleaningResponsibleRow (это и был
    //     баг P0.2: пустой .map() возвращал пустой массив, и сохранение
    //     терялось — settings-modal/banner-select показывали выбор, но
    //     после router.refresh() значение слетало)
    //   • если массив пустой и role+userId тоже пустые — оставляем как есть
    function upsertResponsible(
      kind: "cleaning" | "control",
      items: CleaningResponsible[],
      role: string,
      userId: string
    ): CleaningResponsible[] {
      const userName = userNameById(props.users, userId);
      if (items.length > 0) {
        return items.map((item, index) =>
          index === 0
            ? { ...item, title: role, userId, userName }
            : item
        );
      }
      // empty array
      if (!role && !userId) return items;
      return [
        createCleaningResponsibleRow({
          kind,
          title: role,
          userId,
          userName,
        }),
      ];
    }
    const nextConfig = normalizeCleaningDocumentConfig({
      ...config,
      title: nextState.title.trim() || CLEANING_DOCUMENT_TITLE,
      documentTitle: nextState.title.trim() || CLEANING_DOCUMENT_TITLE,
      cleaningResponsibles: upsertResponsible(
        "cleaning",
        config.cleaningResponsibles,
        nextState.cleaningRole,
        nextState.cleaningUserId
      ),
      controlResponsibles: upsertResponsible(
        "control",
        config.controlResponsibles,
        nextState.controlRole,
        nextState.controlUserId
      ),
    }, { users: props.users });
    await patchDocument(nextConfig);
  }

  async function toggleAutoFill(checked: boolean) {
    const baseConfig = normalizeCleaningDocumentConfig({
      ...config,
      settings: { ...config.settings, autoFillEnabled: checked },
      autoFill: { ...config.autoFill, enabled: checked },
    }, { users: props.users });
    const nextConfig = checked ? applyCleaningAutoFillToConfig({ config: baseConfig, dateFrom: props.dateFrom, dateTo: props.dateTo }) : baseConfig;
    await patchDocument(nextConfig, { autoFill: checked });
  }

  async function toggleSkipWeekends(checked: boolean) {
    const nextConfig = normalizeCleaningDocumentConfig({
      ...config,
      settings: { ...config.settings, skipWeekends: checked },
      autoFill: { ...config.autoFill, skipWeekends: checked },
      skipWeekends: checked,
    }, { users: props.users });
    await patchDocument(nextConfig);
  }

  /** Прямая запись отметки — выбор из списка, без перебора. */
  async function applyCellValue(
    rowId: string,
    dateKey: string,
    value: CleaningMatrixValue
  ) {
    if (props.status !== "active") return;
    // От последнего локального состояния, а не от протухшего `config`.
    const nextConfig = setCleaningMatrixValue({
      config: configRef.current,
      rowId,
      dateKey,
      value,
    });
    await patchCellsWithUndo(applyAutoSignatures(nextConfig, [dateKey]));
  }

  /** Пункты меню клетки: Т / Г / «/» / пусто с отметкой текущего. */
  function buildCellMenuItems(menu: {
    rowId: string;
    dateKey: string;
  }): TableContextMenuItem[] {
    const row = rows.find((item) => item.id === menu.rowId);
    const current = row ? cellValue(row, menu.dateKey) : "";
    return CLEANING_MARK_OPTIONS.map((option) => ({
      key: option.value || "empty",
      code: option.code || undefined,
      label: option.label,
      active: (current || "") === option.value,
      onSelect: () => {
        applyCellValue(menu.rowId, menu.dateKey, option.value).catch(() => {});
      },
    }));
  }

  async function updateCell(row: RowDescriptor, dateKey: string) {
    if (props.status !== "active") return;
    // В режиме выделения клик игнорируется — drag-handlers (mousedown +
    // mouseenter) добавляют/убирают ячейки в selection.
    if (cellSelectMode) return;
    // Responsible-rows (С1/С2) — не редактируемые ячейки. Клик не делает
    // ничего. Информация в первой колонке («С1 — Иван Иванов»), коды
    // вписываются в room-cells автоматически когда уборщик закроет
    // соответствующую TF-задачу.
    if (row.kind !== "room") return;
    // Cycle source-of-truth: видимое значение (matrix override ИЛИ
    // completion-derived). Раньше читали только matrix → клик на клетке
    // с completion "T" не двигал цикл (matrix=undefined → toggle("")="T",
    // matrix=T, визуально без изменений). Теперь cycle стартует от того
    // что менеджер реально видит.
    //
    // sentinel "—" возвращается cellValue как-есть (display конвертит в "");
    // toggleCleaningMatrixValue("—") = "T" (delete sentinel, начать заново).
    const visualValue = cellValue(row, dateKey);
    const nextValue = toggleCleaningMatrixValue(visualValue);
    const nextConfig = setCleaningMatrixValue({
      config: configRef.current,
      rowId: row.id,
      dateKey,
      value: nextValue,
    });
    // Ручное Т/Г → автоподпись ответственных за этот день; полная
    // очистка дня → автоподпись снимается.
    await patchCellsWithUndo(applyAutoSignatures(nextConfig, [dateKey]));
  }

  /**
   * Bulk-set значения для ВСЕХ выходных и праздников периода (для всех
   * room-rows). Не требует выделения. Использует production calendar.
   */
  async function bulkSetHolidaysAndWeekends(value: CleaningMatrixValue) {
    if (props.status !== "active") return;
    // Источник списка room id'ов: pairs-mode → config.rooms,
    // rooms-mode → selectedRoomIds + buildings name lookup.
    const roomIds = isRoomsMode
      ? (config.selectedRoomIds ?? [])
      : config.rooms.map((r) => r.id);
    if (roomIds.length === 0) return;
    // bulk-clear → sentinel «—» (см. bulkSetSelectedCells выше).
    const storedValue = value === "" ? "—" : value;
    const offDays = dayKeys.filter((dk) => {
      const k = getCalendarDayKind(dk).kind;
      return k === "weekend" || k === "holiday";
    });
    if (offDays.length === 0) {
      toast.info("В периоде нет выходных или праздников");
      return;
    }
    let nextConfig = config;
    let cellsUpdated = 0;
    for (const roomId of roomIds) {
      for (const dateKey of offDays) {
        nextConfig = setCleaningMatrixValue({
          config: nextConfig,
          rowId: roomId,
          dateKey,
          value: storedValue,
        });
        cellsUpdated += 1;
      }
    }
    try {
      await patchCellsWithUndo(applyAutoSignatures(nextConfig, offDays));
      const action = value === "/" ? "помечены «Не проводилась»" : value === "" ? "очищены" : "обновлены";
      toast.success(
        `Выходных и праздников: ${offDays.length} дн. × ${roomIds.length} помещ. = ${cellsUpdated} ячеек ${action}`,
      );
    } catch (err) {
      toast.error(
        humanizeFetchError(err, "Не удалось обновить ячейки"),
      );
    }
  }

  /**
   * Bulk-set значения для всех selectedCells (rowId::dateKey). Один
   * patchDocument вместо N — быстрее и атомарно. После успеха выделение
   * сбрасывается.
   */
  async function bulkSetSelectedCells(value: CleaningMatrixValue) {
    if (props.status !== "active") return;
    if (selectedCells.size === 0) return;
    // Допустимые room-id для bulk: pairs-mode → config.rooms,
    // rooms-mode → selectedRoomIds.
    const allowedRoomIds = new Set(
      isRoomsMode
        ? (config.selectedRoomIds ?? [])
        : config.rooms.map((r) => r.id),
    );
    // При bulk-clear (value="") пишем sentinel «—» вместо delete, чтобы
    // подавить completion-fallback. Иначе клетки с completion-задачами
    // остались бы визуально с «Т»/«Г» — менеджер жаловался: «при
    // очистке некоторые дни не очищаются».
    const storedValue = value === "" ? "—" : value;
    let nextConfig = configRef.current;
    const touchedDateKeys = new Set<string>();
    // Считаем РЕАЛЬНО изменённые ячейки: раньше в тосте показывался
    // размер выделения, даже если значение уже было таким же.
    let changedCells = 0;
    for (const k of selectedCells) {
      const [rowId, dateKey] = k.split("::");
      if (!rowId || !dateKey) continue;
      // responsible-rows используют свой code как значение, не T/G/«/».
      // Bulk-edit предназначен для room-rows; для responsible пропустим.
      if (!allowedRoomIds.has(rowId)) continue;
      const before = nextConfig.matrix?.[rowId]?.[dateKey] ?? "";
      if (before === storedValue) continue;
      changedCells += 1;
      touchedDateKeys.add(dateKey);
      nextConfig = setCleaningMatrixValue({
        config: nextConfig,
        rowId,
        dateKey,
        value: storedValue,
      });
    }
    if (changedCells === 0) {
      toast.info("Выбранные ячейки уже с этим значением");
      setSelectedCells(new Set());
      return;
    }
    try {
      await patchCellsWithUndo(
        applyAutoSignatures(nextConfig, Array.from(touchedDateKeys)),
      );
      const labelMap: Record<CleaningMatrixValue, string> = {
        "": "очищены",
        T: "помечены «Текущая»",
        G: "помечены «Генеральная»",
        "/": "помечены «Не проводилась»",
      };
      toast.success(
        `Ячеек обновлено: ${changedCells} (${labelMap[value] ?? "обновлены"})`,
      );
      clearCellSelection();
    } catch (err) {
      toast.error(
        humanizeFetchError(err, "Не удалось обновить ячейки"),
      );
    }
  }

  async function deleteSelectedRows() {
    const count = selection.length;
    if (count === 0) return;
    const ok = await confirmAsync({
      title: "Удалить выбранные строки?",
      description:
        "Строки исчезнут из журнала вместе с их отметками в матрице. Уже сохранённые записи о выполненной уборке (compliance-история) остаются.",
      variant: "danger",
      confirmLabel: "Удалить",
      bullets: [
        // A15 аудита: выделять можно НЕ ТОЛЬКО помещения — служебные
        // строки «Ответственный за уборку/контроль» тоже удаляются
        // (ветки `deleteCleaningResponsibleRow` / `selected-cleaner-`
        // ниже), поэтому чекбоксы у них оставлены. Подпись обобщена:
        // «помещений: N» врала, когда в выделении были ответственные.
        { label: `Будет удалено строк: ${count}`, tone: "warn" },
        { label: "Отметки Т / Г / «/» в этих строках будут стёрты", tone: "warn" },
        { label: "Помещения остаются в /settings/buildings — удаляется только строка журнала" },
      ],
    });
    if (!ok) return;
    try {
      let nextConfig = config;
      for (const rowId of selection) {
        if (nextConfig.rooms.some((item) => item.id === rowId)) nextConfig = deleteCleaningRoomRow(nextConfig, rowId);
        else if (nextConfig.cleaningResponsibles.some((item) => item.id === rowId)) nextConfig = deleteCleaningResponsibleRow(nextConfig, "cleaning", rowId);
        else if (nextConfig.controlResponsibles.some((item) => item.id === rowId)) nextConfig = deleteCleaningResponsibleRow(nextConfig, "control", rowId);
        else if (rowId.startsWith("selected-cleaner-")) {
          // rooms-mode: строка уборщика собирается из selectedCleanerUserIds,
          // а не из cleaningResponsibles — без этой ветки удаление выделенной
          // строки молча ничего не делало.
          const userId = rowId.slice("selected-cleaner-".length);
          nextConfig = {
            ...nextConfig,
            selectedCleanerUserIds: (nextConfig.selectedCleanerUserIds ?? []).filter(
              (id) => id !== userId,
            ),
          };
        }
      }
      setSelection([]);
      await patchDocument(nextConfig);
      toast.success(`Удалено строк: ${count}`);
    } catch (error) {
      toast.error(humanizeFetchError(error, "Не удалось удалить выбранные строки"));
    }
  }


  async function submitResponsible() {
    if (!responsibleDialog) return;
    const responsible = createCleaningResponsibleRow({ kind: responsibleDialog.kind, title: responsibleDialog.title, userId: responsibleDialog.userId, userName: userNameById(props.users, responsibleDialog.userId) });
    const key = responsibleDialog.kind === "cleaning" ? "cleaningResponsibles" : "controlResponsibles";
    const currentItems = config[key];
    const updatedItems = responsibleDialog.id
      ? currentItems.map((item) =>
          item.id === responsibleDialog.id
            ? { ...responsible, id: responsibleDialog.id }
            : item,
        )
      : [...currentItems, responsible];
    const draft: CleaningDocumentConfig = { ...config, [key]: updatedItems };
    // В rooms-mode (race-режим) источник cleaning row — selectedCleanerUserIds,
    // а не cleaningResponsibles array. Без синка добавление через диалог
    // «Добавить отв. за уборку» не отображалось — bug сообщён юзером.
    // Контролёры всегда из controlResponsibles, поэтому для kind="control"
    // дополнительный sync не нужен.
    if (
      responsibleDialog.kind === "cleaning" &&
      (config.cleaningMode ?? "pairs") === "rooms" &&
      responsibleDialog.userId
    ) {
      const currentSelected = config.selectedCleanerUserIds ?? [];
      if (!currentSelected.includes(responsibleDialog.userId)) {
        draft.selectedCleanerUserIds = [
          ...currentSelected,
          responsibleDialog.userId,
        ];
      }
    }
    const nextConfig = normalizeCleaningDocumentConfig(draft, {
      users: props.users,
    });
    setResponsibleDialog(null);
    await patchDocument(nextConfig);
  }

  const cleaningAddToolbar = (
    <>
        {/* ОБЫЧНЫЙ инлайновый тулбар между КАПС-заголовком и таблицей
            (эталон cleaning-04-grid.png). Раньше здесь стояло
            `sticky top-14 z-20`: полоса «прилипала» к своему скролл-предку
            и на странице её не было видно вообще. */}
        <div className="mb-3 space-y-2 print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <ResponsiveMenu
                  title="Добавить"
                  align="start"
                  contentClassName="max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-3 shadow-xl sm:w-[340px]"
                  items={[
                    {
                      key: "rooms",
                      label: "Помещения в /settings/buildings",
                      icon: <Plus className="size-4 text-[#5566f6]" />,
                      onSelect: () => router.push("/settings/buildings"),
                    },
                    {
                      key: "responsible-cleaning",
                      label: "Ответственный за уборку",
                      icon: <UserPlus className="size-4 text-[#5566f6]" />,
                      onSelect: () =>
                        setResponsibleDialog(buildResponsibleState("cleaning")),
                    },
                    {
                      key: "responsible-control",
                      label: "Ответственный за контроль",
                      icon: <UserPlus className="size-4 text-[#5566f6]" />,
                      onSelect: () =>
                        setResponsibleDialog(buildResponsibleState("control")),
                    },
                    ...(props.status === "active"
                      ? [
                          {
                            key: "bulk-fill",
                            label: "Массовое заполнение",
                            icon: <Sparkles className="size-4 text-[#5566f6]" />,
                            items: [
                              {
                                key: "fill-plan",
                                label: "Заполнить по плану",
                                title:
                                  "Поставить T (текущая) и G (генеральная) во все пустые ячейки согласно плану помещений",
                                onSelect: () => applySchedulePlan("fill-empty"),
                              },
                              {
                                key: "mark-holidays",
                                label: "Отметить выходные «/»",
                                title:
                                  "Поставить «/» (не проводилась) на все выходные и праздники периода",
                                onSelect: () =>
                                  bulkSetHolidaysAndWeekends("/" as CleaningMatrixValue),
                              },
                              {
                                key: "clear-holidays",
                                label: "Очистить выходные",
                                title: "Очистить ячейки выходных и праздников периода",
                                onSelect: () =>
                                  bulkSetHolidaysAndWeekends("" as CleaningMatrixValue),
                              },
                            ],
                          },
                          {
                            key: "bulk-select",
                            label: cellSelectMode
                              ? "Массовое выделение: ВКЛ"
                              : "Массовое выделение",
                            icon: (
                              <MousePointerSquareDashed className="size-4 text-[#5566f6]" />
                            ),
                            items: [
                              {
                                key: "toggle-select",
                                label: cellSelectMode
                                  ? "Выключить выделение мышкой"
                                  : "Выделить мышкой",
                                title:
                                  "ВКЛ: тяните мышью / пальцем от одного угла к другому, выделится прямоугольник ячеек",
                                onSelect: () => {
                                  if (cellSelectMode) {
                                    setCellSelectMode(false);
                                    clearCellSelection();
                                  } else {
                                    setCellSelectMode(true);
                                  }
                                },
                              },
                              {
                                key: "select-all",
                                label: "Выделить всё",
                                title: "Выделить все ячейки матрицы",
                                onSelect: selectAllCells,
                              },
                            ],
                          },
                        ]
                      : []),
                  ]}
                  trigger={<Button className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white hover:bg-[#4a5bf0]"><Plus className="size-5" strokeWidth={2.5} />Добавить<ChevronDown className="size-4" /></Button>}
                />
              </div>
            </div>
            <JournalSelectionBar
              count={selection.length}
              onClear={() => setSelection([])}
              onDelete={() => {
                void deleteSelectedRows();
              }}
              hint="Строки уборки будут удалены без возможности отмены"
            />
            {/* Полосы «Заполнение ▾ / Выделение ▾» под заголовком больше
                НЕТ (P8): оба меню живут внутри «Добавить ▾». Здесь остаётся
                только КОНТЕКСТНАЯ строка действий — она появляется, когда
                режим выделения включён, и без неё выделенные ячейки нечем
                было бы заполнить. */}
            {props.status === "active" && cellSelectMode ? (
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="text-[12px] text-[#6f7282]">
                      Выделено: <span className="font-semibold tabular-nums text-[#0b1024]">{selectedCells.size}</span>
                    </span>
                    <button
                      type="button"
                      disabled={selectedCells.size === 0}
                      onClick={() => bulkSetSelectedCells("T" as CleaningMatrixValue)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 py-1.5 font-medium text-[#0b1024] transition-colors hover:bg-[#f5f6ff] disabled:opacity-40"
                    >
                      Т · Текущая
                    </button>
                    <button
                      type="button"
                      disabled={selectedCells.size === 0}
                      onClick={() => bulkSetSelectedCells("G" as CleaningMatrixValue)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 py-1.5 font-medium text-[#0b1024] transition-colors hover:bg-[#f5f6ff] disabled:opacity-40"
                    >
                      Г · Генеральная
                    </button>
                    <button
                      type="button"
                      disabled={selectedCells.size === 0}
                      onClick={() => bulkSetSelectedCells("/" as CleaningMatrixValue)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#ffd7d3] bg-[#fff4f2] px-3 py-1.5 font-medium text-[#a13a32] transition-colors hover:bg-[#fff2f1] disabled:opacity-40"
                    >
                      / · Не проводилась
                    </button>
                    <button
                      type="button"
                      disabled={selectedCells.size === 0}
                      onClick={() => bulkSetSelectedCells("" as CleaningMatrixValue)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 py-1.5 font-medium text-[#6f7282] transition-colors hover:bg-[#fafbff] disabled:opacity-40"
                    >
                      Очистить
                    </button>
                    <button
                      type="button"
                      disabled={selectedCells.size === 0}
                      onClick={clearCellSelection}
                      className="inline-flex items-center gap-1.5 rounded-xl px-2 py-1 text-[12px] text-[#6f7282] hover:text-[#0b1024] disabled:opacity-40"
                    >
                      Сбросить
                    </button>
              </div>
            ) : null}
          </div>
    </>
  );

  const cleaningRaceStrip = (
    <>
        {props.buildings && props.buildings.length > 0 ? (
          <div className="print:hidden">
          <CleaningRaceModeStrip
            enabled={(config.cleaningMode ?? "pairs") === "rooms"}
            raceMode={config.roomsRaceMode === true}
            roomCount={(config.selectedRoomIds ?? []).length}
            cleanerCount={(effectiveConfig.selectedCleanerUserIds ?? []).length}
            pinnedCount={Object.keys(effectiveConfig.cleanerByRoomId ?? {}).length}
            disabled={props.status !== "active" || saving}
            onToggle={async (enabled) => {
              await patchDocument({
                ...config,
                cleaningMode: enabled ? "rooms" : "pairs",
                // Когда включаем — сразу ставим roomsRaceMode=true. Без этого
                // адаптер падает в round-robin (cleaners[i % M] — половина
                // одному, половина другому) и пользователь думает что race
                // не работает. По умолчанию владелец хочет именно race.
                roomsRaceMode: enabled ? true : false,
                selectedRoomIds: config.selectedRoomIds ?? [],
                selectedCleanerUserIds: config.selectedCleanerUserIds ?? [],
              });
            }}
            onSwitchRace={async (race) => {
              await patchDocument({
                ...config,
                roomsRaceMode: race,
              });
            }}
            onConfigure={() => setRaceConfigOpen(true)}
          />
          </div>
        ) : (
          // C1 аудита: помещения уборки берутся из /settings/buildings.
          // Если их ещё нет — документ показывает стартовый набор-заглушку,
          // и менеджеру надо явно сказать, где завести настоящие.
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-8 text-center print:hidden">
            <div className="text-[15px] font-medium text-[#0b1024]">
              Помещения ещё не заведены
            </div>
            <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] text-[#6f7282]">
              Пока в журнале стартовый набор строк. Заведите реальные помещения —
              и матрица, шаги уборки и задачи уборщикам соберутся из них сами.
            </p>
            <Link
              href="/settings/buildings"
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Завести помещения
            </Link>
          </div>
        )}
    </>
  );

  /**
   * «Подписи за день» — телефонный эквивалент клика по клетке строки
   * подписи в таблице: в карточках такой клетки нет, и подписаться с
   * телефона было нечем. Пишет тем же `writeSignature`, поэтому правила
   * записи, блокировка на время сохранения и undo — общие с таблицей.
   */
  const cleaningDaySignatures = signatureDayKey ? (
    <section className="rounded-2xl border border-[#ececf4] bg-white p-3 print:hidden">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-[#0b1024]">Подписи за день</div>
          <div className="text-[12px] text-[#6f7282]">
            Кто подписал уборку и контроль
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {([-1, 1] as const).map((step) => {
            const index = signatureDayKeys.indexOf(signatureDayKey) + step;
            const target = signatureDayKeys[index];
            return (
              <button
                key={step}
                type="button"
                disabled={!target}
                aria-label={step < 0 ? "Предыдущий день" : "Следующий день"}
                onClick={() => target && setSignatureDay(target)}
                className="flex size-8 items-center justify-center rounded-xl border border-[#ececf4] text-[#3c4053] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#5566f6] disabled:opacity-40 disabled:hover:border-[#ececf4] disabled:hover:bg-transparent disabled:hover:text-[#3c4053]"
              >
                {step < 0 ? (
                  <ChevronLeft className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-1 text-[13px] font-medium text-[#3848c7]">
        {formatDayAriaLabel(signatureDayKey)}
        {signatureDayKey === todayKey ? " · сегодня" : ""}
      </div>
      {[
        {
          rowId: CLEANING_SIGNATURE_ROW_ID,
          label: CLEANING_ROW_LABELS.cleaning,
          codes: cleaningCodeForDay(signatureDayKey),
          list: cleaningResponsibleList,
          activeCodes: activeCleaningCodes,
        },
        {
          rowId: CONTROL_SIGNATURE_ROW_ID,
          label: CLEANING_ROW_LABELS.control,
          codes: controlCodeForDay(signatureDayKey),
          list: controlResponsibleList,
          activeCodes: activeControlCodes,
        },
      ].map((row) => {
        const signed = row.codes
          .split(",")
          .map((code) => code.trim())
          .filter(Boolean);
        const names = signed
          .map((code) => {
            const resp = row.list.find((item) => item.code === code);
            return resp?.userName ? `${code} — ${resp.userName}` : code;
          })
          .join(", ");
        // Выбывшие подписывать больше нельзя — тот же список, что у клетки.
        const options = row.list.filter((resp) => row.activeCodes.includes(resp.code));
        const locked = props.status !== "active" || saving || options.length === 0;
        return (
          <div
            key={row.rowId}
            className="mt-2 flex items-center gap-2 rounded-xl border border-[#ececf4] bg-[#fafbff] p-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-[#6f7282]">{row.label}</div>
              <div className="truncate text-[13px] font-medium text-[#0b1024]">
                {names || "Не подписано"}
              </div>
            </div>
            <ResponsiveMenu
              title={row.label}
              items={[
                ...options.map((resp) => ({
                  key: resp.id,
                  label: `${resp.code} — ${resp.userName || "не назначен"}`,
                  onSelect: () => {
                    void writeSignature(row.rowId, signatureDayKey, resp.code);
                  },
                })),
                {
                  key: "clear",
                  label: "Снять подпись",
                  tone: "danger" as const,
                  onSelect: () => {
                    void writeSignature(row.rowId, signatureDayKey, "—");
                  },
                },
              ]}
              trigger={
                <button
                  type="button"
                  disabled={locked}
                  className="shrink-0 rounded-xl border border-[#5566f6]/30 bg-[#f5f6ff] px-3 py-2 text-[13px] font-medium text-[#5566f6] transition-colors hover:bg-[#eef1ff] disabled:opacity-40"
                >
                  {signed.length > 0 ? "Изменить" : "Подписать"}
                </button>
              }
            />
          </div>
        );
      })}
    </section>
  ) : null;

  return (
    <>
      <div className="space-y-5">
        <FocusTodayScroller />
        <div className="print:hidden">
          <DocumentActionsBar
            backHref="/journals/cleaning"
            documentId={props.documentId}
            undo={{
              canUndo: undoStack.canUndo,
              canRedo: undoStack.canRedo,
              onUndo: () => void undoStack.undo(),
              onRedo: () => void undoStack.redo(),
              undoCount: undoStack.undoCount,
            }}
            heading={
              <div>
                <h1 className={DOC_HEADING_CLASS}>
                  {config.documentTitle || CLEANING_PAGE_TITLE}
                </h1>
                <p className="mt-2 text-[15px] text-[#6f7282]">
                  {getCleaningPeriodLabel(props.dateFrom, props.dateTo)}
                  {saving ? " · Сохранение..." : ""}
                </p>
              </div>
            }
            onSettings={() => setSettingsOpen(true)}
            menuItems={[
              ...(props.hasTasksFlowIntegration
                ? [
                    {
                      key: "tf-sync",
                      label: tasksFlowSyncing ? "Обновляю…" : "Обновить из TasksFlow",
                      icon: (
                        <RefreshCw
                          className={`size-4 ${tasksFlowSyncing ? "animate-spin" : ""}`}
                        />
                      ),
                      title: "Подтянуть отметки выполнения из TasksFlow",
                      onSelect: () => void syncFromTasksFlow(),
                      disabled: tasksFlowSyncing,
                    },
                    {
                      key: "tf-cleanup",
                      label: cleanupCompletedRunning ? "Чищу…" : "Очистить TF архив",
                      icon: <Trash2 className="size-4" />,
                      title:
                        "Удалить выполненные задачи из TasksFlow (compliance-история сохранится в журнале)",
                      onSelect: () => void cleanupCompletedTasks(),
                      disabled: cleanupCompletedRunning,
                      tone: "danger" as const,
                    },
                  ]
                : []),
              {
                key: "save-as-template",
                label: "Сохранить как шаблон",
                icon: <Save className="size-4" />,
                title:
                  "Сохранить помещения, ответственных и шаги уборки как шаблон по умолчанию для новых журналов уборки",
                onSelect: () => setSaveAsTemplateOpen(true),
              },
              ...(props.status === "active"
                ? [
                    {
                      key: "close-journal",
                      label: "Закончить журнал",
                      icon: <Archive className="size-4" />,
                      onSelect: () => void closeAction.closeDocument(),
                      disabled: closeAction.isClosing,
                    },
                  ]
                : []),
            ]}
          />
        </div>

        {props.status !== "active" ? (
          <JournalClosedBanner hint="Откройте журнал заново, чтобы редактировать отметки, помещения и ответственных." documentId={props.documentId} />
        ) : (
          (() => {
            // Считаем только строки-помещения: строки ответственных
            // (С1/С2) подписываются автоматически по закрытым задачам.
            const roomRows = rows.filter((row) => row.kind === "room");
            const filled = roomRows.filter((row) =>
              Boolean(cellValue(row, todayKey))
            ).length;
            return (
              <div className="mb-4 print:hidden">
                <TodayStripForJournal
                  journalCode="cleaning"
                  total={roomRows.length}
                  filled={filled}
                  label="помещений"
                />
              </div>
            );
          })()
        )}

        {/* Полоса автозаполнения — как на эталоне (cleaning-04-grid.png,
            cleaning-12-autofill-on.png): в полосе ТОЛЬКО тумблер. Селекты
            «Ответственный за уборку/контроль» и чекбокс «Не заполнять в
            выходные» переехали в «Настройки документа» (cleaning-11) —
            их меняют раз в месяц, а место в полосе они занимали всегда. */}
        {/* Q3: рамка и свой фон #f5f6ff сняты — только общий токен-лента. */}
        {/* Настройка документа — право руководителя (сервер отвечал 403). */}
        {canManageDocument ? (
          <section className={DOC_AUTOFILL_STRIP_CLASS}>
            <Switch
              checked={config.autoFill.enabled}
              onCheckedChange={toggleAutoFill}
              disabled={props.status !== "active" || saving}
              className="data-[state=unchecked]:bg-[#d4d8ec]"
            />
            <span className={DOC_AUTOFILL_LABEL_CLASS}>
              Автоматически заполнять журнал
            </span>
          </section>
        ) : null}

        {/* Тулбар «Добавить»/«Заполнение»/«Выделение» и race-strip уборки
            переехали ПОД бумажную шапку и КАПС-заголовок, вплотную над
            таблицу — как на эталоне (cleaning-07-grid-with-room.png).
            В mobile-cards ветке те же узлы рендерятся выше карточек. */}
        {mobileView === "cards" ? (
          <div className={viewClasses.cards}>
            {cleaningAddToolbar}
            {cleaningRaceStrip}
          </div>
        ) : null}


        {/* Один ряд вместо двух: таблица показывает весь период и
            ось игнорирует, так что состояний три, а не четыре. */}
        <MobileViewAxisToggle
          view={mobileView}
          axis={mobileAxis}
          axisAvailable={dayKeys.includes(todayKey)}
          entityLabel="По помещениям"
          onChange={(next) => {
            if (next.view === "table") {
              switchMobileView("table");
              return;
            }
            switchMobileView("cards");
            switchMobileAxis(next.axis);
          }}
        />

        {/* Ось «Сегодня»: помещения за один день. Уборщица закрывает свою
            смену одним экраном, не раскрывая каждое помещение. */}
        {mobileView === "cards" &&
        mobileAxis === "today" &&
        dayKeys.includes(todayKey) ? (
          <div className={`mb-4 ${viewClasses.cards}`}>
            <DayFirstCards
              items={rows
                .filter((row) => row.kind === "room")
                .map((row) => {
                  const before = cellValue(row, todayKey) || "";
                  return {
                  id: row.id,
                  title: row.kind === "room" ? row.room.name : row.id,
                  subtitle:
                    row.kind === "room" ? row.room.detergent || undefined : undefined,
                  // Карточки показывали стораджевые «T»/«G»/«/», а таблица и
                  // легенда — «Т»/«Г»/«/-/». Один и тот же день выглядел
                  // по-разному на телефоне и на компьютере.
                  value: displayMatrixValue(before) || undefined,
                  disabledReason:
                    props.status === "active" ? undefined : "журнал закрыт",
                  // Карточка помещения (расписание, уборщик, QR) — с телефона
                  // она была доступна только из таблицы.
                  onEdit:
                    props.status === "active"
                      ? () => openRoomEditorFromRow(row.id)
                      : undefined,
                  editLabel: "Открыть карточку помещения",
                  onPress: (event: React.MouseEvent) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setCellMenu({
                      x: event.clientX,
                      y: event.clientY,
                      rowId: row.id,
                      dateKey: todayKey,
                    });
                  },
                  // Смахнуть вправо — «Т», текущая уборка: она бывает
                  // ежедневно, генеральная по графику. Возврат ставит
                  // ровно прежнее значение, а не пустоту: в клетке могло
                  // стоять «Г» или «/».
                  quickMark: {
                    label: "Т",
                    onApply: () => {
                      void applyCellValue(
                        row.id,
                        todayKey,
                        "T" as CleaningMatrixValue,
                      );
                    },
                    onUndo: () => {
                      void applyCellValue(
                        row.id,
                        todayKey,
                        before as CleaningMatrixValue,
                      );
                    },
                  },
                  };
                })}
              emptyLabel="Добавьте помещение через меню «Добавить»."
            />
            <div className="mt-3">{cleaningDaySignatures}</div>
          </div>
        ) : null}

        {/* Cards view — hidden in print, on screen the toggle decides.
            Each row (room or responsible) is an accordion with per-day
            tap-to-cycle cells. */}
        {mobileView === "cards" &&
        (mobileAxis === "entity" || !dayKeys.includes(todayKey)) ? (
          <div className={`space-y-2 ${viewClasses.cards}`}>
            {rows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-5 text-center text-[13px] text-[#6f7282]">
                Добавьте помещение или ответственного через меню «Добавить».
              </div>
            ) : null}
            {rows.map((row) => {
              const expanded = expandedRowId === row.id;
              const title = row.kind === "room" ? row.room.name : row.kind === "cleaning" ? CLEANING_ROW_LABELS.cleaning : CLEANING_ROW_LABELS.control;
              const subtitle = row.kind === "room" ? row.room.detergent : `${row.responsible.code} · ${row.responsible.userName || "не назначен"}`;
              const filledCount = dayKeys.reduce((acc, dk) => acc + (cellValue(row, dk) ? 1 : 0), 0);
              const isSelected = selection.includes(row.id);
              return (
                <div key={row.id} className="rounded-2xl border border-[#ececf4] bg-white">
                  <div className="flex items-center gap-3 px-3 py-3">
                    <span onClick={(event) => event.stopPropagation()} className="shrink-0">
                      <Checkbox checked={isSelected} onCheckedChange={(checked) => setSelection((current) => Boolean(checked) ? [...current, row.id].filter((value, index, list) => list.indexOf(value) === index) : current.filter((id) => id !== row.id))} disabled={props.status !== "active"} className="size-5" />
                    </span>
                    <button type="button" onClick={() => setExpandedRowId(expanded ? null : row.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-3 break-words text-[14px] font-medium leading-snug text-[#0b1024]">{title}</div>
                        {subtitle ? <div className="line-clamp-2 break-words text-[12px] text-[#6f7282]">{subtitle}</div> : null}
                        {row.kind === "room" && roomAssignmentLabel(row.id) ? (
                          <div
                            className={`truncate text-[11px] ${
                              roomAssignmentLabel(row.id)?.pinned ? "text-[#3848c7]" : "text-[#9b9fb3]"
                            }`}
                          >
                            {roomAssignmentLabel(row.id)?.text}
                          </div>
                        ) : null}
                        {row.kind === "room" && roomVerifierLabel(row.id) ? (
                          <div className="truncate text-[11px] text-[#3848c7]">
                            {roomVerifierLabel(row.id)}
                          </div>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-semibold text-[#5566f6]">{filledCount}/{dayKeys.length}</span>
                      <ChevronDown className={`size-4 shrink-0 text-[#6f7282] transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </button>
                    {/* Карточка помещения (расписание, уборщик, QR) с телефона:
                        раньше это действие было только в таблице. */}
                    {props.status === "active" ? (
                      <button
                        type="button"
                        aria-label={row.kind === "room" ? "Открыть карточку помещения" : "Изменить ответственного"}
                        title={row.kind === "room" ? "Расписание, уборщик, QR" : "Изменить ответственного"}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (row.kind === "room") {
                            openRoomEditorFromRow(row.id);
                          } else {
                            setResponsibleDialog(
                              buildResponsibleState(row.kind, row.responsible),
                            );
                          }
                        }}
                        className="shrink-0 rounded-lg p-2 text-[#7a7f93] transition-colors hover:bg-[#f5f6ff] hover:text-[#5566f6]"
                      >
                        <Pencil className="size-4" />
                      </button>
                    ) : null}
                  </div>
                  {expanded ? (
                    <div className="border-t border-[#ececf4] p-3">
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1.5">
                        {dayKeys.map((dateKey) => {
                          const cellVal = cellValue(row, dateKey);
                          const dayKind = getCalendarDayKind(dateKey);
                          const isOff = dayKind.kind === "holiday" || dayKind.kind === "weekend";
                          const isShort = dayKind.kind === "short";
                          const isSelected = selectedCells.has(cellKey(row.id, dateKey));
                          // Mobile-card cell — приоритет: selected > filled > off-day color > short > workday.
                          const cellCls = isSelected
                            ? "ring-2 ring-[#5566f6] border-[#5566f6] bg-[#eef1ff] text-[#5566f6]"
                            : cellVal
                              ? "border-[#5566f6] bg-[#f5f6ff] text-[#5566f6]"
                              : isOff
                                ? `border-[#a8a8a8] ${GRID_DAY_OFF_BG_CLASS} text-[#3c4053]`
                                : isShort
                                  ? `border-[#c8c8c8] ${GRID_DAY_SHORT_BG_CLASS} text-[#3c4053]`
                                  : "border-[#ececf4] bg-white text-[#3c4053] hover:bg-[#f5f6ff]";
                          return (
                            <button
                              key={dateKey}
                              type="button"
                              title={dayKind.name ?? undefined}
                              onClick={(event) => {
                                if (props.status !== "active") return;
                                // В режиме выделения клик отдан drag-логике.
                                if (cellSelectMode) return;
                                if (row.kind !== "room") return;
                                event.preventDefault();
                                event.stopPropagation();
                                setCellMenu({
                                  x: event.clientX,
                                  y: event.clientY,
                                  rowId: row.id,
                                  dateKey,
                                });
                              }}
                              onTouchStart={() => {
                                if (cellSelectMode) startDragOnCell(row.id, dateKey);
                              }}
                              onTouchMove={(e) => {
                                if (!cellSelectMode || !dragModeRef.current) return;
                                const touch = e.touches[0];
                                if (!touch) return;
                                const target = document.elementFromPoint(touch.clientX, touch.clientY);
                                const cellEl = target?.closest?.("[data-cell-key]");
                                const k = cellEl?.getAttribute("data-cell-key");
                                if (!k) return;
                                const [r, d] = k.split("::");
                                if (r && d) continueDragOnCell(r, d);
                              }}
                              data-cell-key={cellKey(row.id, dateKey)}
                              disabled={props.status !== "active"}
                              className={`flex h-9 flex-col items-center justify-center rounded-lg border text-[11px] font-medium transition-colors disabled:opacity-60 select-none ${cellCls}`}
                            >
                              <span className="text-[12px] font-semibold tabular-nums">{Number(dateKey.slice(-2))}</span>
                              <span className="text-[11px] leading-none">{displayMatrixValue(cellVal) || "—"}</span>
                            </button>
                          );
                        })}
                      </div>
                      {props.status === "active" ? (
                        <div className="mt-3 text-[11px] text-[#6f7282]">
                          {row.kind === "room" ? "Нажмите на день, чтобы выбрать Т / Г / «/»." : "Тап по дню переключает отметку ответственного."}
                        </div>
                      ) : null}
                      {row.kind === "room" ? (
                        <div className="mt-3 space-y-1 rounded-xl border border-[#ececf4] bg-[#fafbff] p-3 text-[12px] leading-5 text-[#3c4053]">
                          <div className="font-semibold text-[#0b1024]">Текущая:</div>
                          <div>{row.room.currentScope.join(", ") || "—"}</div>
                          <div className="mt-2 font-semibold text-[#0b1024]">Генеральная:</div>
                          <div>{row.room.generalScope.join(", ") || "—"}</div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {cleaningDaySignatures}
            {/* Mobile: 2 группированные карточки ответственных, симметрично
                desktop-таблице. Серый фон визуально отделяет от помещений. */}
            {cleaningResponsibleList.length > 0 ? (
              <div className="rounded-2xl border border-[#ececf4] bg-[#f6f6f6] p-3">
                <button
                  type="button"
                  disabled={props.status !== "active"}
                  onClick={() =>
                    setResponsibleDialog(
                      buildResponsibleState(
                        "cleaning",
                        cleaningResponsibleList[0],
                      ),
                    )
                  }
                  className="text-left text-[14px] font-medium text-[#0b1024] disabled:cursor-default"
                >
                  {CLEANING_ROW_LABELS.cleaning}
                </button>
                <div className="mt-1 text-[12px] leading-[1.55] text-[#3c4053]">
                  {cleaningCodeEntries.map((resp) => (
                    <div key={resp.id}>
                      <span className="font-semibold text-[#3848c7]">
                        {resp.code}
                      </span>{" "}
                      — {resp.userName || "не назначен"}
                      {resp.retired ? RETIRED_LEGEND_SUFFIX : ""}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {controlResponsibleList.length > 0 ? (
              <div className="rounded-2xl border border-[#ececf4] bg-[#f6f6f6] p-3">
                <button
                  type="button"
                  disabled={props.status !== "active"}
                  onClick={() =>
                    setResponsibleDialog(
                      buildResponsibleState(
                        "control",
                        controlResponsibleList[0],
                      ),
                    )
                  }
                  className="text-left text-[14px] font-medium text-[#0b1024] disabled:cursor-default"
                >
                  {CLEANING_ROW_LABELS.control}
                </button>
                <div className="mt-1 text-[12px] leading-[1.55] text-[#3c4053]">
                  {controlCodeEntries.map((resp) => (
                    <div key={resp.id}>
                      <span className="font-semibold text-[#7a5cff]">
                        {resp.code}
                      </span>{" "}
                      — {resp.userName || "не назначен"}
                      {resp.retired ? RETIRED_LEGEND_SUFFIX : ""}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={viewClasses.table}>
        {/* R1: бумажное полотно — во всю ширину контентной колонки.
            Сетка уборки шире (min-w 1200) и продолжает скроллиться внутри
            своего GRID_VIEWPORT_CLASS, который лежит ВНУТРИ полотна. */}
        <div className={`${DOC_BODY_STACK_CLASS} ${DOC_PAPER_CANVAS_CLASS}`}>
          {/* Официальный ХАССП-блок — общий компонент вместо самодельной
              таблицы с чёрными рамками (на экране — карточка дизайн-системы,
              в печати сам компонент возвращает бумажный вид). */}
          {/* Шапка лежит в ТОМ ЖЕ viewport'е и с той же min-width, что и
              сетка ниже, поэтому её ширина совпадает с шириной таблицы
              (раньше шапка была ~57% ширины сетки и центрировалась сама). */}
          <div className={`${DOC_PAPER_HEADER_CLASS} ${GRID_VIEWPORT_CLASS}`}>
            <div
              style={{ minWidth: `${gridMinWidth}px`, "--jgrid-days": dayKeys.length } as CSSProperties}
              data-journal-blank-column
              data-journal-grid-sheet
              data-jgrid-labels="2"
            >
            <JournalDocumentHeader
              orgName={props.organizationName}
              title={config.documentTitle || CLEANING_DOCUMENT_TITLE}
              startedAt={props.dateFrom}
              finishedAt={props.status === "closed" ? props.dateTo : null}
              controlPeriodicity={props.controlPeriodicity}
            />
            </div>
          </div>
          <JournalDocumentTitle className={DOC_CAPS_TITLE_CLASS}>
            {config.documentTitle || CLEANING_PAGE_TITLE}
          </JournalDocumentTitle>
          {/* Тулбар рендерим ВСЕГДА: внешний контейнер в cards-режиме
              спрятан классом (`viewClasses.table`), а копия для карточек
              рендерится выше в своей обёртке. До восстановления выбора
              обе обёртки брейкпоинтные, после — по состоянию, так что на
              экране всегда ровно один экземпляр. */}
          {cleaningAddToolbar}
          {cleaningRaceStrip}
          <div className={GRID_VIEWPORT_CLASS}><div
              style={{ minWidth: `${gridMinWidth}px`, "--jgrid-days": dayKeys.length } as CSSProperties}
              data-journal-blank-column
              data-journal-grid-sheet
              data-jgrid-labels="2"
            >
          <table className="w-full border-collapse text-[13px] print:text-[11px]" data-journal-grid><colgroup><col data-grid-col-check /><col data-grid-col-label /><col data-grid-col-label2 />{dayKeys.map((dateKey) => <col key={`col:${dateKey}`} data-grid-col-day />)}</colgroup><thead><tr><th rowSpan={2} data-grid-check className={`w-12 px-2 py-1.5 align-middle ${GRID_HEAD_CELL_PLAIN_CLASS} print:hidden leading-tight`}><Checkbox checked={allRowsSelected} onCheckedChange={(checked) => setSelection(Boolean(checked) ? [...selectableRowIds] : [])} className="size-4" disabled={props.status !== "active"} aria-label="Выбрать все строки" /></th><th rowSpan={2} data-grid-label className={`w-[230px] px-2 py-1.5 align-middle font-semibold text-[#3c4053] ${GRID_HEAD_CELL_CLASS} leading-tight`}>Наименование помещения</th><th rowSpan={2} data-grid-label2 className={`w-[200px] px-2 py-1.5 align-middle font-semibold text-[#3c4053] ${GRID_HEAD_CELL_CLASS} leading-tight`}>Моющие и дезинфицирующие средства</th><th className={`px-2 py-1.5 font-semibold text-[#3c4053] ${GRID_HEAD_CELL_CLASS} leading-tight`} colSpan={dayKeys.length}>Месяц {getCleaningGridMonthLabel(props.dateFrom, props.dateTo)}</th></tr><tr>{dayKeys.map((dateKey) => <th key={dateKey} data-grid-day data-focus-today={dateKey === todayKey ? "" : undefined} className={`px-2 py-1.5 text-[13px] font-semibold tabular-nums text-[#3c4053] ${GRID_HEAD_CELL_PLAIN_CLASS} leading-tight ${dateKey === todayKey ? "bg-[#eef1ff] text-[#3848c7] print:bg-transparent print:text-inherit" : ""}`}>{Number(dateKey.slice(-2))}</th>)}</tr></thead><tbody>
            {rows.map((row) => {
              const title = row.kind === "room" ? row.room.name : row.kind === "cleaning" ? CLEANING_ROW_LABELS.cleaning : CLEANING_ROW_LABELS.control;
              const secondColumn = row.kind === "room" ? row.room.detergent : `${row.responsible.code} - ${row.responsible.userName || "не назначен"}`;
              return <tr key={row.id} className="transition-colors hover:bg-[#fafbff] print:hover:bg-transparent">
                <td data-grid-check className={`px-2 py-1 text-center ${GRID_CELL_CLASS} print:hidden leading-tight`}><Checkbox checked={selection.includes(row.id)} onCheckedChange={(checked) => setSelection((current) => Boolean(checked) ? [...current, row.id].filter((value, index, list) => list.indexOf(value) === index) : current.filter((id) => id !== row.id))} className="size-4" disabled={props.status !== "active"} /></td>
                <td data-grid-label className={`px-2 py-1 align-middle ${GRID_CELL_CLASS} leading-tight`}>
                  <div className="flex items-center justify-between gap-3">
                    {/* S10: содержимое бумажных ячеек у эталона по центру.
                        `flex-1 text-center` центрирует название помещения,
                        оставляя карандаш прижатым к правому краю ячейки. */}
                    <div className="min-w-0 flex-1 text-center">
                      <button
                        type="button"
                        className="w-full transition-colors hover:text-[#5566f6]"
                        disabled={props.status !== "active"}
                        onClick={() => {
                          if (row.kind === "room") {
                            openRoomEditorFromRow(row.id);
                          } else {
                            setResponsibleDialog(
                              buildResponsibleState(row.kind, row.responsible),
                            );
                          }
                        }}
                      >
                        {title}
                      </button>
                      {row.kind === "room" && roomAssignmentLabel(row.id) ? (
                        <button
                          type="button"
                          title="Кто убирает и проверяет — изменить в карточке помещения"
                          disabled={props.status !== "active"}
                          onClick={() => openRoomEditorFromRow(row.id)}
                          className={`mt-0.5 block w-full truncate text-[11px] font-normal transition-colors print:hidden ${
                            roomAssignmentLabel(row.id)?.pinned
                              ? "text-[#3848c7] hover:text-[#5566f6]"
                              : "text-[#9b9fb3] hover:text-[#5566f6]"
                          }`}
                        >
                          {roomAssignmentLabel(row.id)?.text}
                        </button>
                      ) : null}
                      {row.kind === "room" && roomVerifierLabel(row.id) ? (
                        <button
                          type="button"
                          title="Кто убирает и проверяет — изменить в карточке помещения"
                          disabled={props.status !== "active"}
                          onClick={() => openRoomEditorFromRow(row.id)}
                          className="block w-full truncate text-[11px] font-normal text-[#3848c7] transition-colors hover:text-[#5566f6] print:hidden"
                        >
                          {roomVerifierLabel(row.id)}
                        </button>
                      ) : null}
                    </div>
                    {props.status === "active" ? (
                      <button
                        type="button"
                        aria-label="Редактировать"
                        className="rounded-lg p-1 text-[#7a7f93] transition-colors hover:bg-[#f5f6ff] hover:text-[#5566f6] print:hidden"
                        onClick={() => {
                          if (row.kind === "room") {
                            openRoomEditorFromRow(row.id);
                          } else {
                            setResponsibleDialog(
                              buildResponsibleState(row.kind, row.responsible),
                            );
                          }
                        }}
                      >
                        <Pencil className="size-4" />
                      </button>
                    ) : null}
                  </div>
                </td>
                {/* S10: «Моющие и дезинфицирующие средства» у эталона по
                    центру; подпись ответственного («С1 - ФИО») он же
                    оставляет по левому краю — так и держим. */}
                <td data-grid-label2 className={`px-2 py-1 text-[#3c4053] ${GRID_CELL_CLASS} leading-tight ${row.kind === "room" ? "text-center" : ""}`}>{secondColumn}</td>
                {dayKeys.map((dateKey) => {
                  const isSelected = selectedCells.has(cellKey(row.id, dateKey));
                  const dayKind = getCalendarDayKind(dateKey);
                  // Окраска по производственному календарю — общие токены
                  // `GRID_DAY_*_BG_CLASS` (одна палитра с гигиеной/здоровьем
                  // и PDF; только серые — ч/б принтеры):
                  //   • holiday/weekend → серый
                  //   • short          → светло-серый
                  //   • workday        → прозрачный (чтобы hover строки был виден)
                  // Selected outline overlays поверх любого фона.
                  const dayBg =
                    dayKind.kind === "holiday" || dayKind.kind === "weekend"
                      ? GRID_DAY_OFF_BG_CLASS
                      : dayKind.kind === "short"
                        ? GRID_DAY_SHORT_BG_CLASS
                        : "";
                  const interactive = props.status === "active";
                  const rawValue = cellValue(row, dateKey);
                  const displayValue = displayMatrixValue(rawValue);
                  const valueLabel = CLEANING_VALUE_LABELS[rawValue] ?? "не заполнено";
                  return (
                    <td
                      key={dateKey}
                      data-grid-day
                      data-cell-key={cellKey(row.id, dateKey)}
                      data-print-keep-bg={dayBg ? "" : undefined}
                      title={dayKind.name ?? undefined}
                      role={interactive ? "button" : undefined}
                      tabIndex={interactive ? 0 : undefined}
                      aria-label={`${title}, ${formatDayAriaLabel(dateKey)}: ${valueLabel}`}
                      className={`h-8 px-2 py-1 text-center text-[13px] leading-tight select-none ${GRID_CELL_CLASS} ${interactive ? `cursor-pointer hover:bg-[#f5f6ff] ${CELL_FOCUS_CLASS}` : ""} ${dayBg} ${isSelected ? "outline outline-2 outline-offset-[-2px] outline-[#5566f6] !bg-[#eef1ff]" : ""}`}
                      onClick={() => {
                        // Если только что был drag — onClick после mouseup
                        // тоже срабатывает. Защищаемся: если в режиме
                        // selection и drag завершился, click игнорируем.
                        if (cellSelectMode) return;
                        updateCell(row, dateKey);
                      }}
                      onKeyDown={(event) => {
                        if (!interactive) return;
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        if (cellSelectMode) return;
                        void updateCell(row, dateKey);
                      }}
                      onMouseDown={(e) => {
                        if (!cellSelectMode) return;
                        e.preventDefault();
                        startDragOnCell(row.id, dateKey);
                      }}
                      onMouseEnter={() => continueDragOnCell(row.id, dateKey)}
                      onTouchStart={() => {
                        if (!cellSelectMode) return;
                        startDragOnCell(row.id, dateKey);
                      }}
                    >
                      {displayValue}
                    </td>
                  );
                })}
              </tr>;
            })}
            {/* Группированные строки ответственных по образцу haccp-online.
                Одна строка для всех уборщиков (С1-Имя1 / С2-Имя2 в первой
                колонке), одна для контролёров. Серый фон выделяет их от
                помещений. В ячейках per-day — кто работал/проверял в этот
                день (выводим коды С1/С2/К1 из реальных completions). */}
            {cleaningResponsibleList.length > 0 ? (
              <tr key="cleaning-group" className="bg-[#f8f9fc] print:bg-white">
                {/* Чекбокс есть у каждой выделяемой строки — помещения,
                    «Ответственный за уборку», «Ответственный за контроль».
                    Здесь одна галочка отмечает сразу всех уборщиков строки:
                    дальше — обычная JournalSelectionBar. */}
                <td data-grid-check className={`px-2 py-1 text-center ${GRID_CELL_CLASS} print:hidden leading-tight`}>
                  <Checkbox
                    checked={
                      cleaningResponsibleList.length > 0 &&
                      cleaningResponsibleList.every((resp) =>
                        selection.includes(resp.id),
                      )
                    }
                    disabled={props.status !== "active"}
                    onCheckedChange={(checked) => {
                      const ids = cleaningResponsibleList.map((resp) => resp.id);
                      setSelection((current) =>
                        Boolean(checked)
                          ? [...new Set([...current, ...ids])]
                          : current.filter((id) => !ids.includes(id)),
                      );
                    }}
                    className="size-4"
                  />
                </td>
                <td data-grid-label className={`px-2 py-1 align-middle ${GRID_CELL_CLASS} leading-tight`}>
                  <button
                    type="button"
                    disabled={props.status !== "active"}
                    onClick={() =>
                      setResponsibleDialog(
                        buildResponsibleState(
                          "cleaning",
                          cleaningResponsibleList[0],
                        ),
                      )
                    }
                    className="text-left transition-colors hover:text-[#5566f6] disabled:cursor-default"
                  >
                    {CLEANING_ROW_LABELS.cleaning}
                  </button>
                </td>
                <td className={`px-2 py-1 text-[13px] leading-[1.5] text-[#3c4053] ${GRID_CELL_CLASS}`}>
                  {cleaningCodeEntries.map((resp) => (
                    <div key={resp.id}>
                      {resp.code} - {resp.userName || "не назначен"}
                      {resp.retired ? RETIRED_LEGEND_SUFFIX : ""}
                    </div>
                  ))}
                </td>
                {dayKeys.map((dateKey) => {
                  const dayKind = getCalendarDayKind(dateKey);
                  const dayBg =
                    dayKind.kind === "holiday" || dayKind.kind === "weekend"
                      ? GRID_DAY_OFF_BG_CLASS
                      : dayKind.kind === "short"
                        ? GRID_DAY_SHORT_BG_CLASS
                        : "";
                  const code = cleaningCodeForDay(dateKey);
                  const interactive = props.status === "active";
                  const cleaningCodes = activeCleaningCodes;
                  return (
                    <td
                      key={dateKey}
                      data-print-keep-bg={dayBg ? "" : undefined}
                      title={
                        interactive
                          ? `${dayKind.name ? dayKind.name + " · " : ""}Тап циклит: пусто → ${cleaningCodes.join(" → ")} → пусто`
                          : (dayKind.name ?? undefined)
                      }
                      role={interactive ? "button" : undefined}
                      tabIndex={interactive ? 0 : undefined}
                      aria-label={`${CLEANING_ROW_LABELS.cleaning}, ${formatDayAriaLabel(dateKey)}: ${code || "не отмечено"}`}
                      onClick={
                        interactive
                          ? () =>
                              cycleSignature(
                                CLEANING_SIGNATURE_ROW_ID,
                                dateKey,
                                cleaningCodes,
                              )
                          : undefined
                      }
                      onKeyDown={(event) => {
                        if (!interactive) return;
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        void cycleSignature(
                          CLEANING_SIGNATURE_ROW_ID,
                          dateKey,
                          cleaningCodes,
                        );
                      }}
                      className={`h-8 px-2 py-1 text-center text-[13px] leading-tight select-none ${GRID_CELL_CLASS} ${dayBg} ${interactive ? `cursor-pointer hover:bg-[#eef1ff] ${CELL_FOCUS_CLASS}` : ""}`}
                    >
                      {code}
                    </td>
                  );
                })}
              </tr>
            ) : null}
            {controlResponsibleList.length > 0 ? (
              <tr key="control-group" className="bg-[#f8f9fc] print:bg-white">
                {/* Симметрично строке «Ответственный за уборку»: одна
                    галочка отмечает всех контролёров строки. Удаление их
                    `deleteSelectedRows` умеет — без чекбокса эта ветка была
                    недостижима из UI. */}
                <td data-grid-check className={`px-2 py-1 text-center ${GRID_CELL_CLASS} print:hidden leading-tight`}>
                  <Checkbox
                    checked={
                      controlResponsibleList.length > 0 &&
                      controlResponsibleList.every((resp) =>
                        selection.includes(resp.id),
                      )
                    }
                    disabled={props.status !== "active"}
                    onCheckedChange={(checked) => {
                      const ids = controlResponsibleList.map((resp) => resp.id);
                      setSelection((current) =>
                        Boolean(checked)
                          ? [...new Set([...current, ...ids])]
                          : current.filter((id) => !ids.includes(id)),
                      );
                    }}
                    className="size-4"
                  />
                </td>
                <td data-grid-label className={`px-2 py-1 align-middle ${GRID_CELL_CLASS} leading-tight`}>
                  <button
                    type="button"
                    disabled={props.status !== "active"}
                    onClick={() =>
                      setResponsibleDialog(
                        buildResponsibleState(
                          "control",
                          controlResponsibleList[0],
                        ),
                      )
                    }
                    className="text-left transition-colors hover:text-[#5566f6] disabled:cursor-default"
                  >
                    {CLEANING_ROW_LABELS.control}
                  </button>
                </td>
                <td className={`px-2 py-1 text-[13px] leading-[1.5] text-[#3c4053] ${GRID_CELL_CLASS}`}>
                  {controlCodeEntries.map((resp) => (
                    <div key={resp.id}>
                      {resp.code} - {resp.userName || "не назначен"}
                      {resp.retired ? RETIRED_LEGEND_SUFFIX : ""}
                    </div>
                  ))}
                </td>
                {dayKeys.map((dateKey) => {
                  const dayKind = getCalendarDayKind(dateKey);
                  const dayBg =
                    dayKind.kind === "holiday" || dayKind.kind === "weekend"
                      ? GRID_DAY_OFF_BG_CLASS
                      : dayKind.kind === "short"
                        ? GRID_DAY_SHORT_BG_CLASS
                        : "";
                  const code = controlCodeForDay(dateKey);
                  const interactive = props.status === "active";
                  const controlCodes = activeControlCodes;
                  return (
                    <td
                      key={dateKey}
                      data-print-keep-bg={dayBg ? "" : undefined}
                      title={
                        interactive
                          ? `${dayKind.name ? dayKind.name + " · " : ""}Тап циклит: пусто → ${controlCodes.join(" → ")} → пусто`
                          : (dayKind.name ?? undefined)
                      }
                      role={interactive ? "button" : undefined}
                      tabIndex={interactive ? 0 : undefined}
                      aria-label={`${CLEANING_ROW_LABELS.control}, ${formatDayAriaLabel(dateKey)}: ${code || "не отмечено"}`}
                      onClick={
                        interactive
                          ? () =>
                              cycleSignature(
                                CONTROL_SIGNATURE_ROW_ID,
                                dateKey,
                                controlCodes,
                              )
                          : undefined
                      }
                      onKeyDown={(event) => {
                        if (!interactive) return;
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        void cycleSignature(
                          CONTROL_SIGNATURE_ROW_ID,
                          dateKey,
                          controlCodes,
                        );
                      }}
                      className={`p-2 text-center text-[13px] select-none ${GRID_CELL_CLASS} ${dayBg} ${interactive ? `cursor-pointer hover:bg-[#eef1ff] ${CELL_FOCUS_CLASS}` : ""}`}
                    >
                      {code}
                    </td>
                  );
                })}
              </tr>
            ) : null}
          </tbody></table>
          </div></div>

          {/* Условные обозначения — общий <JournalLegendBlock> вместо
              самодельного блока с regex-заменами латиницы на кириллицу. */}
          <JournalLegendBlock
            className={DOC_LEGEND_CLASS}
            variant="plain"
            items={Array.from(new Set(config.legend))
              .map(displayLegendLine)
              .map(parseLegendItem)}
          />
          <div className="mt-3">
            <CleaningDayColorLegend />
          </div>

          <div className={`${DOC_EXTRA_BLOCK_CLASS} ${GRID_VIEWPORT_CLASS}`}><div className="min-w-[640px] sm:min-w-0">
          <table className="w-full border-collapse text-[13px] print:text-[11px]"><thead><tr><th className={`px-2 py-1.5 text-center font-semibold text-[#3c4053] ${GRID_HEAD_CELL_CLASS} leading-tight`}>Наименование помещения</th><th className={`px-2 py-1.5 text-center font-semibold text-[#3c4053] ${GRID_HEAD_CELL_CLASS} leading-tight`}>Текущая уборка</th><th className={`px-2 py-1.5 text-center font-semibold text-[#3c4053] ${GRID_HEAD_CELL_CLASS} leading-tight`}>Генеральная уборка</th></tr></thead><tbody>{referenceRooms.map((room) => <tr key={room.id} className="transition-colors hover:bg-[#fafbff] print:hover:bg-transparent"><td className={`px-2 py-1 ${GRID_CELL_CLASS} leading-tight`}>{room.name}</td><td className={`px-2 py-1 text-[#3c4053] ${GRID_CELL_CLASS} leading-tight`}>{room.currentScope.join(", ")}</td><td className={`px-2 py-1 text-[#3c4053] ${GRID_CELL_CLASS} leading-tight`}>{room.generalScope.join(", ")}</td></tr>)}</tbody></table>
          </div></div>
        </div>
        </div>
      </div>

      <RoomEditorDialog
        open={roomEditor !== null}
        onOpenChange={(open) => {
          if (!open) setRoomEditor(null);
        }}
        initial={roomEditor}
        users={props.users}
        roomsPerCleaner={roomsPerCleanerForEditor}
        roomsPerVerifier={roomsPerVerifierForEditor}
        onSaved={async (snapshot) => {
          // Сначала auto-apply (использует snapshot для override и
          // patchDocument'ом отправляет matrix → API endpoint
          // syncTodayMatrixChanges → TF tasks обновляются).
          // Потом router.refresh() для re-build dbScheduleMap из БД.
          try {
            // Правка только названия/состава — план не пересчитываем.
            if (snapshot.scheduleChanged) {
              await autoApplyScheduleForRoom({
              id: snapshot.id,
              currentDays: snapshot.currentDays,
              generalDays: snapshot.generalDays,
              currentScheduleType: snapshot.currentScheduleType,
              generalScheduleType: snapshot.generalScheduleType,
              currentMonthDays: snapshot.currentMonthDays,
              generalMonthDays: snapshot.generalMonthDays,
              });
            }
          } catch (err) {
            console.error("[room-editor] auto-apply failed", err);
          }
          router.refresh();
        }}
      />

      {/* Полная конфигурация race-режима — в диалоге. На странице видна
          только тонкая полоска с переключателем + сводкой. */}
      {props.buildings && props.buildings.length > 0 ? (
        <Dialog open={raceConfigOpen} onOpenChange={setRaceConfigOpen}>
          <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
            <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
              <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
                Настроить race-режим
              </DialogTitle>
            </DialogHeader>
            <div className="overflow-y-auto px-2 py-2 sm:px-4 sm:py-4">
              <RoomsModeCard
                buildings={props.buildings}
                users={props.users}
                dbRooms={dbRoomResponsibles}
                disabled={props.status !== "active" || saving}
                cleaningMode={config.cleaningMode ?? "pairs"}
                selectedRoomIds={config.selectedRoomIds ?? []}
                selectedCleanerUserIds={config.selectedCleanerUserIds ?? []}
                cleanerByRoomId={config.cleanerByRoomId ?? {}}
                verifierByRoomId={config.verifierByRoomId ?? {}}
                controlUserId={resolveDocumentController(config)}
                roomsRaceMode={config.roomsRaceMode === true}
                onSave={async (patch) => {
                  await saveRoomsSelection(patch);
                  setRaceConfigOpen(false);
                }}
                onEditRoom={(roomId) => {
                  // Не стекаем два диалога: закрываем race-настройки и
                  // открываем карточку помещения.
                  setRaceConfigOpen(false);
                  openRoomEditorFromRow(roomId);
                }}
              />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      <Dialog open={!!responsibleDialog} onOpenChange={(open) => !open && setResponsibleDialog(null)}>
        <DialogContent className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
          <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              Добавление ответственного лица
            </DialogTitle>
          </DialogHeader>
          {responsibleDialog ? (
            <>
              <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-[13px] font-medium text-[#3c4053]">Должность ответственного</Label>
                    <Select
                      value={responsibleDialog.title}
                      onValueChange={responsibleCascade.handlePositionChange}
                    >
                      <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[14px]">
                        <SelectValue placeholder="— выберите —" />
                      </SelectTrigger>
                      <SelectContent>
                        <PositionSelectItems users={props.users} />
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px] font-medium text-[#3c4053]">Сотрудник</Label>
                    <Select
                      value={responsibleDialog.userId}
                      onValueChange={responsibleCascade.handleEmployeeChange}
                      open={responsibleCascade.employeeOpen}
                      onOpenChange={responsibleCascade.setEmployeeOpen}
                    >
                      <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[14px]">
                        <SelectValue placeholder="— выберите —" />
                      </SelectTrigger>
                      <SelectContent>
                        {responsibleCascade.candidates.map((user) => (
                          <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff] sm:w-auto"
                  onClick={() => setResponsibleDialog(null)}
                >
                  Отмена
                </Button>
                <Button
                  type="button"
                  className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
                  onClick={submitResponsible}
                >
                  {responsibleDialog.id ? "Сохранить" : "Добавить"}
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

        <JournalSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title="Настройки документа"
          description="Название документа и ответственные. Изменения применяются ко всему периоду документа."
          size="md"
          isSaving={saving}
          onSave={async () => {
            await updateSettings({});
            setSettingsOpen(false);
          }}
          onCancel={() => setSettingsOpen(false)}
        >
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Название документа
            </Label>
            <Input
              value={settingsState.title}
              onChange={(event) =>
                setSettingsState((current) => ({ ...current, title: event.target.value }))
              }
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Должность ответственного за уборку
            </Label>
            <Select
              value={settingsState.cleaningRole}
              onValueChange={cleaningCascade.handlePositionChange}
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
              value={settingsState.cleaningUserId}
              onValueChange={cleaningCascade.handleEmployeeChange}
              open={cleaningCascade.employeeOpen}
              onOpenChange={cleaningCascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
                <SelectValue placeholder="— Выберите —" />
              </SelectTrigger>
              <SelectContent>
                {cleaningCascade.candidates.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Должность ответственного за контроль
            </Label>
            <Select
              value={settingsState.controlRole}
              onValueChange={controlCascade.handlePositionChange}
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
              value={settingsState.controlUserId}
              onValueChange={controlCascade.handleEmployeeChange}
              open={controlCascade.employeeOpen}
              onOpenChange={controlCascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
                <SelectValue placeholder="— Выберите —" />
              </SelectTrigger>
              <SelectContent>
                {controlCascade.candidates.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Переехало из полосы автозаполнения (эталон держит в полосе
              только тумблер). Сохраняется сразу — как и раньше. */}
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3.5 transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
            <Checkbox
              checked={config.autoFill.skipWeekends}
              onCheckedChange={(checked) => toggleSkipWeekends(Boolean(checked))}
              disabled={props.status !== "active" || saving}
              className="mt-0.5 size-5 rounded-md"
            />
            <span className="flex-1">
              <span className="block text-[13.5px] font-semibold text-[#0b1024]">
                Не заполнять в выходные дни
              </span>
              <span className="mt-0.5 block text-[12px] leading-[1.5] text-[#6f7282]">
                Автозаполнение пропустит выходные и праздники производственного
                календаря — в этих днях останется «{CLEANING_NOT_PERFORMED_DISPLAY}».
              </span>
            </span>
          </label>

          {/* Pipeline mode — определяет, как сотрудник видит подзадачи в TasksFlow.
              Раньше всегда был perRoom (у каждой комнаты свой scope). Теперь
              менеджер может выбрать один общий список или отключить вовсе. */}
          <div className="space-y-3 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-4">
            <div>
              <Label className="text-[13px] font-semibold text-[#0b1024]">
                Подзадачи в TasksFlow (pipeline)
              </Label>
              <p className="mt-1 text-[12px] leading-[1.55] text-[#6f7282]">
                Как сотрудник видит чек-лист в задаче на уборку:
              </p>
            </div>
            <div className="grid gap-2">
              {([
                {
                  value: "perRoom" as const,
                  title: "По помещениям (рекомендуется)",
                  desc: "У каждой комнаты свой список шагов. Удобно когда уборка в кухне отличается от уборки в баре.",
                },
                {
                  value: "global" as const,
                  title: "Общий список",
                  desc: "Один список шагов, одинаковый для всех помещений. Удобно когда протокол простой и единый.",
                },
                {
                  value: "legacy" as const,
                  title: "Без чек-листа (legacy)",
                  desc: "Сотрудник просто отмечает «сделано», без разбивки на шаги. Подзадач в TasksFlow не будет.",
                },
              ]).map((opt) => {
                const isActive = (config.cleaningSubtaskMode ?? "perRoom") === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setCleaningSubtaskMode(opt.value)}
                    disabled={saving}
                    className={`text-left rounded-2xl border px-4 py-3 transition-colors disabled:opacity-60 ${
                      isActive
                        ? "border-[#5566f6] bg-white shadow-[0_0_0_4px_rgba(85,102,246,0.12)]"
                        : "border-[#ececf4] bg-white hover:border-[#5566f6]/40"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                          isActive ? "border-[#5566f6] bg-[#5566f6]" : "border-[#dcdfed] bg-white"
                        }`}
                      >
                        {isActive ? <div className="size-1.5 rounded-full bg-white" /> : null}
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-[#0b1024]">{opt.title}</div>
                        <p className="mt-0.5 text-[12px] leading-[1.5] text-[#6f7282]">{opt.desc}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {(config.cleaningSubtaskMode ?? "perRoom") === "global" ? (
              <div className="space-y-3 rounded-2xl border border-[#dcdfed] bg-white p-3">
                <div>
                  <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                    Общий список — текущая уборка
                  </Label>
                  <p className="mt-1 text-[12px] leading-[1.5] text-[#6f7282]">
                    Эти шаги увидит каждый сотрудник при уборке любого помещения (текущая).
                  </p>
                </div>
                <ScopeListEditor
                  value={config.globalSubtasks?.current ?? []}
                  onChange={(next) => { void setGlobalSubtasks({ current: next }); }}
                  placeholder="Например: Протереть рабочие поверхности"
                  addLabel="Добавить шаг текущей"
                  emptyHint="Шагов пока нет — добавьте первый шаг ниже."
                />
                <div className="border-t border-[#ececf4] pt-3">
                  <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                    Общий список — генеральная уборка
                  </Label>
                </div>
                <ScopeListEditor
                  value={config.globalSubtasks?.general ?? []}
                  onChange={(next) => { void setGlobalSubtasks({ general: next }); }}
                  placeholder="Например: Демонтировать съёмные части и промыть в горячей воде"
                  addLabel="Добавить шаг генеральной"
                  emptyHint="Шагов пока нет — добавьте первый шаг ниже."
                />
              </div>
            ) : null}
          </div>
        </JournalSettingsModal>
      <Dialog open={saveAsTemplateOpen} onOpenChange={setSaveAsTemplateOpen}>
        <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              Сохранить как шаблон по умолчанию
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 px-6 py-5">
            <p className="text-[14px] leading-[1.55] text-[#3c4053]">
              Текущие настройки журнала будут сохранены как шаблон для всей организации.
              Все <strong>новые</strong> журналы уборки будут автоматически создаваться с этими помещениями, ответственными, шагами и днями уборки.
            </p>
            <ul className="space-y-1.5 rounded-2xl bg-[#fafbff] px-4 py-3 text-[13px] text-[#3c4053]">
              <li>• Помещений: <strong>{config.rooms.length}</strong></li>
              <li>• Ответственных за уборку: <strong>{config.cleaningResponsibles.length}</strong></li>
              <li>• Ответственных за контроль: <strong>{config.controlResponsibles.length}</strong></li>
              <li>• Шагов текущей уборки (всего): <strong>{config.rooms.reduce((acc, r) => acc + r.currentScope.length, 0)}</strong></li>
              <li>• Шагов генеральной уборки (всего): <strong>{config.rooms.reduce((acc, r) => acc + r.generalScope.length, 0)}</strong></li>
            </ul>
            <p className="text-[12px] leading-[1.5] text-[#6f7282]">
              Текущий журнал и матрица отметок не изменятся. Шаблон не затронет уже созданные журналы.
            </p>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff] sm:w-auto"
              onClick={() => setSaveAsTemplateOpen(false)}
              disabled={saveAsTemplateBusy}
            >
              Отмена
            </Button>
            <Button
              type="button"
              className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
              onClick={handleSaveAsTemplate}
              disabled={saveAsTemplateBusy}
            >
              {saveAsTemplateBusy ? "Сохранение..." : "Сохранить шаблон"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Выбор отметки клетки. На телефоне приходит листом снизу. */}
      {cellMenu ? (
        <TableContextMenu
          x={cellMenu.x}
          y={cellMenu.y}
          onClose={() => setCellMenu(null)}
          ariaLabel="Отметка об уборке"
          items={buildCellMenuItems(cellMenu)}
        />
      ) : null}
    </>
  );
}

/**
 * Карточка настройки rooms-режима для journal-уборки.
 * Появляется только если у org заведены здания/помещения в /settings/buildings.
 *
 * При cleaningMode="rooms" daily fan-out создаст одну race-задачу на
 * каждое выбранное помещение (на каждого выбранного уборщика). Кто
 * первый закроет — забрал. В конце дня контролёр получит сводную
 * задачу о том что нужно проверить.
 *
 * Сейчас (Этап 2a/b) сохраняем только конфиг. Race-логика подключится
 * в Этапе 2c вместе с расширением cleaning adapter.
 */

/**
 * Компактная полоска вместо большой `RoomsModeCard` на странице журнала.
 * Один переключатель + сводка («4 помещения · 2 уборщика») + кнопка
 * «Настроить» открывает диалог с полным редактором. Сделано по запросу
 * владельца: «сократи как можно больше этого, чтобы просто можно было
 * включить и всё».
 */
function CleaningRaceModeStrip(props: {
  enabled: boolean;
  raceMode: boolean;
  roomCount: number;
  cleanerCount: number;
  pinnedCount: number;
  disabled: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onSwitchRace: (race: boolean) => Promise<void>;
  onConfigure: () => void;
}) {
  // Пустой список помещений ИЛИ уборщиков = нулевая раздача задач в TF.
  const incompleteRaceSetup =
    props.enabled && (props.roomCount === 0 || props.cleanerCount === 0);
  return (
    <section
      className={`rounded-2xl border bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] ${
        incompleteRaceSetup ? "border-[#a13a32]/30 bg-[#fff4f2]" : "border-[#ececf4]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-[14px] font-medium text-[#0b1024]">
          <input
            type="checkbox"
            checked={props.enabled}
            disabled={props.disabled}
            onChange={(e) => {
              void props.onToggle(e.target.checked);
            }}
            className="size-4 cursor-pointer accent-[#5566f6]"
          />
          Раздавать задачи по помещениям
        </label>
        {props.enabled ? (
          // C5 аудита: раньше строка молча показывала «Помещений: 0 ·
          // Уборщиков: 0» — и это не «значит все»: адаптер при пустом
          // списке НЕ создаёт ни одной задачи (buildRoomsModeRows
          // возвращает []). Показываем это как предупреждение с прямым
          // указанием, что делать.
          <span
            className={`text-[13px] ${
              incompleteRaceSetup ? "text-[#a13a32]" : "text-[#6f7282]"
            }`}
          >
            Помещений:{" "}
            <span
              className={`font-semibold tabular-nums ${
                props.roomCount === 0 ? "text-[#a13a32]" : "text-[#0b1024]"
              }`}
            >
              {props.roomCount}
            </span>
            {" · "}
            Уборщиков:{" "}
            <span
              className={`font-semibold tabular-nums ${
                props.cleanerCount === 0 ? "text-[#a13a32]" : "text-[#0b1024]"
              }`}
            >
              {props.cleanerCount}
            </span>
            {props.pinnedCount > 0 ? (
              <>
                {" · "}
                Закреплено зон:{" "}
                <span className="font-semibold tabular-nums text-[#3848c7]">
                  {props.pinnedCount}
                </span>
              </>
            ) : null}
            {incompleteRaceSetup ? (
              <span className="ml-1.5">
                — задачи не раздаются, нажмите «Настроить»
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-[13px] text-[#9b9fb3]">Выключено — обычный режим «1 пара уборщик-контролёр в день»</span>
        )}
        <button
          type="button"
          onClick={props.onConfigure}
          disabled={props.disabled}
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Настроить
        </button>
      </div>
      {props.enabled && props.cleanerCount > 1 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[#ececf4] pt-2.5 text-[13px]">
          <span className="text-[#6f7282]">Распределение между уборщиками:</span>
          <div className="inline-flex rounded-xl border border-[#dcdfed] bg-[#fafbff] p-0.5">
            <button
              type="button"
              disabled={props.disabled}
              onClick={() => {
                if (!props.raceMode) void props.onSwitchRace(true);
              }}
              className={`inline-flex h-7 items-center rounded-lg px-3 text-[12.5px] font-medium transition-colors ${
                props.raceMode
                  ? "bg-white text-[#0b1024] shadow-[0_0_0_1px_#dcdfed]"
                  : "text-[#6f7282] hover:text-[#0b1024]"
              }`}
              title="На каждое помещение задача отправляется ВСЕМ уборщикам. Кто первый — тот и закрепил за собой."
            >
              Гонка (кто первый)
            </button>
            <button
              type="button"
              disabled={props.disabled}
              onClick={() => {
                if (props.raceMode) void props.onSwitchRace(false);
              }}
              className={`inline-flex h-7 items-center rounded-lg px-3 text-[12.5px] font-medium transition-colors ${
                !props.raceMode
                  ? "bg-white text-[#0b1024] shadow-[0_0_0_1px_#dcdfed]"
                  : "text-[#6f7282] hover:text-[#0b1024]"
              }`}
              title="Помещения делятся между уборщиками поровну. Уборщик 1 делает комнаты 0,2,4..., уборщик 2 — 1,3,5..."
            >
              Поделить поровну
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

type RoomsModeCardProps = {
  buildings: Array<{
    id: string;
    name: string;
    rooms: Array<{ id: string; name: string; kind: string }>;
  }>;
  users: UserItem[];
  /** Назначения помещений из Room (кто убирает / кто проверяет). */
  dbRooms: RoomResponsibles[];
  disabled: boolean;
  cleaningMode: "pairs" | "rooms";
  selectedRoomIds: string[];
  selectedCleanerUserIds: string[];
  /** Legacy-закрепления документа (до 2026-09-04) — только для превью. */
  cleanerByRoomId: Record<string, string[]>;
  verifierByRoomId: Record<string, string[]>;
  controlUserId: string | null;
  roomsRaceMode: boolean;
  onSave: (patch: {
    cleaningMode: "pairs" | "rooms";
    selectedRoomIds: string[];
    selectedCleanerUserIds: string[];
  }) => Promise<void>;
  /** Открыть карточку помещения — единственное место закрепления. */
  onEditRoom: (roomId: string) => void;
};

function RoomsModeCard(props: RoomsModeCardProps) {
  const [mode, setMode] = useState<"pairs" | "rooms">(props.cleaningMode);
  const [rooms, setRooms] = useState<string[]>(props.selectedRoomIds);
  const [cleaners, setCleaners] = useState<string[]>(
    props.selectedCleanerUserIds
  );
  const [busy, setBusy] = useState(false);

  // Живой прогноз: сколько зон у каждого уборщика при текущих настройках
  // (назначения помещений + пул), тем же резолвером, что и раздача задач.
  const previewConfig = applyRoomResponsiblesToConfig(
    {
      selectedRoomIds: rooms,
      selectedCleanerUserIds: cleaners,
      roomsRaceMode: props.roomsRaceMode,
      cleanerByRoomId: props.cleanerByRoomId,
      verifierByRoomId: props.verifierByRoomId,
      controlUserId: props.controlUserId,
      controlResponsibles: [],
    },
    props.dbRooms,
    new Set(props.users.map((u) => u.id)),
  );
  const previewCleaners = previewConfig.selectedCleanerUserIds ?? [];
  const zonesPerCleaner = new Map<string, number>();
  for (const roomId of rooms) {
    for (const uid of resolveRoomCleaners(previewConfig, roomId)) {
      zonesPerCleaner.set(uid, (zonesPerCleaner.get(uid) ?? 0) + 1);
    }
  }
  const userName = (uid: string) =>
    props.users.find((u) => u.id === uid)?.name ?? "—";
  const selectedRoomNames = new Map<string, string>();
  for (const b of props.buildings) {
    for (const r of b.rooms) selectedRoomNames.set(r.id, r.name);
  }

  function toggleRoom(id: string) {
    setRooms((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
  function toggleCleaner(id: string) {
    setCleaners((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function save() {
    setBusy(true);
    try {
      await props.onSave({
        cleaningMode: mode,
        selectedRoomIds: rooms,
        selectedCleanerUserIds: cleaners,
      });
    } finally {
      setBusy(false);
    }
  }

  // Кандидаты на role «cleaner»: позиция «Уборщик» + cook-роль.
  const cleanerCandidates = props.users.filter((u) =>
    /уборщик|cleaner/i.test(`${u.name} ${u.role}`)
  );
  const allStaffCandidates = props.users; // fallback — если фильтр пустой
  const cleanersList =
    cleanerCandidates.length > 0 ? cleanerCandidates : allStaffCandidates;

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#3848c7]">
            Режим уборки
          </div>
          <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
            Race-задачи на помещения
          </h3>
          <p className="mt-1 max-w-[640px] text-[13px] leading-[1.55] text-[#6f7282]">
            Если включить — каждое выбранное помещение в каждый рабочий
            день станет отдельной задачей. Любой из выбранных уборщиков
            может её закрыть; кто первый — тот и закрепил за собой
            (остальные у него исчезают). Контролёр получит одну сводную
            задачу в конце дня.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-[#0b1024]">
          <input
            type="checkbox"
            checked={mode === "rooms"}
            disabled={props.disabled}
            onChange={(e) => setMode(e.target.checked ? "rooms" : "pairs")}
            className="size-4 cursor-pointer accent-[#5566f6]"
          />
          Включить
        </label>
      </div>

      {mode === "rooms" ? (
        <div className="space-y-5">
          {/* Помещения */}
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Помещения, по которым раздавать задачи
            </div>
            {props.buildings.map((b) => (
              <div key={b.id} className="mb-3">
                <div className="mb-1.5 text-[13px] font-medium text-[#3c4053]">
                  {b.name}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {b.rooms.length === 0 ? (
                    <span className="text-[12px] text-[#9b9fb3]">
                      Нет помещений в этом здании. Заведите в{" "}
                      <a href="/settings/buildings" className="text-[#5566f6] underline">
                        /settings/buildings
                      </a>
                      .
                    </span>
                  ) : (
                    b.rooms.map((r) => {
                      const active = rooms.includes(r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          disabled={props.disabled}
                          onClick={() => toggleRoom(r.id)}
                          className={`inline-flex h-9 items-center gap-1.5 rounded-2xl border px-3 text-[13px] font-medium transition-colors ${
                            active
                              ? "border-[#5566f6] bg-[#f5f6ff] text-[#3848c7]"
                              : "border-[#dcdfed] bg-white text-[#6f7282] hover:border-[#5566f6]/50 hover:bg-[#f5f6ff]"
                          }`}
                        >
                          {r.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Уборщики */}
          <div>
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Пул уборщиков — для помещений без назначенных
            </div>
            <p className="mb-2 max-w-[640px] text-[12.5px] leading-[1.5] text-[#6f7282]">
              Помещение с назначенными уборщиками (карточка помещения) раздаётся
              им. Остальные помещения — этому пулу:{" "}
              {props.roomsRaceMode ? "всем, кто первый." : "поровну между уборщиками."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {cleanersList.map((u) => {
                const active = cleaners.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    disabled={props.disabled}
                    onClick={() => toggleCleaner(u.id)}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-2xl border px-3 text-[13px] font-medium transition-colors ${
                      active
                        ? "border-[#5566f6] bg-[#f5f6ff] text-[#3848c7]"
                        : "border-[#dcdfed] bg-white text-[#6f7282] hover:border-[#5566f6]/50 hover:bg-[#f5f6ff]"
                    }`}
                  >
                    {u.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Кто убирает / кто проверяет каждое помещение — read-only сводка.
              Закрепление живёт в карточке помещения (Room), а не в документе. */}
          {rooms.length > 0 ? (
            <div>
              <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                Кто убирает и проверяет
              </div>
              <p className="mb-3 max-w-[640px] text-[12.5px] leading-[1.5] text-[#6f7282]">
                Назначения хранятся в карточке помещения — они общие для всех
                документов. Нажмите «Изменить», чтобы поменять уборщиков или
                проверяющих.
              </p>
              <div className="overflow-hidden rounded-2xl border border-[#ececf4]">
                {rooms.map((roomId, idx) => {
                  const dbRoom = props.dbRooms.find((r) => r.id === roomId);
                  const assigned = (dbRoom?.cleanerUserIds ?? []).length > 0;
                  const effective = resolveRoomCleaners(previewConfig, roomId);
                  const cleanerNames = effective.map(userName).join(", ");
                  const zoneVerifiers = previewConfig.verifierByRoomId?.[roomId] ?? [];
                  const verifierNames = zoneVerifiers.map(userName).join(", ");
                  return (
                    <div
                      key={roomId}
                      className={`flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4 ${
                        idx > 0 ? "border-t border-[#ececf4]" : ""
                      } ${assigned ? "bg-[#fafbff]" : "bg-white"}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-[#0b1024]">
                          {selectedRoomNames.get(roomId) ?? "Помещение"}
                        </div>
                        <div
                          className={`truncate text-[11.5px] ${
                            assigned ? "text-[#3848c7]" : "text-[#9b9fb3]"
                          }`}
                        >
                          {assigned
                            ? `Убирает: ${cleanerNames}${effective.length > 1 ? " — кто первый" : ""}`
                            : `Из пула — ${cleanerNames || "никто (пул пуст)"}`}
                        </div>
                        <div
                          className={`truncate text-[11.5px] ${
                            zoneVerifiers.length > 0 ? "text-[#3848c7]" : "text-[#9b9fb3]"
                          }`}
                        >
                          {zoneVerifiers.length > 0
                            ? `Проверяет: ${verifierNames}`
                            : "Проверяет контролёр журнала"}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={props.disabled || !dbRoom}
                        onClick={() => props.onEditRoom(roomId)}
                        title={
                          dbRoom
                            ? "Открыть карточку помещения"
                            : "Помещение есть только в документе — заведите его в «Настройки → Помещения»"
                        }
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Pencil className="size-3.5 text-[#5566f6]" />
                        Изменить
                      </button>
                    </div>
                  );
                })}
              </div>
              {/* Live-prediction: нагрузка по зонам при текущих настройках. */}
              {previewCleaners.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[#6f7282]">
                  <span>Зон на уборщика:</span>
                  {previewCleaners.map((uid) => {
                    const n = zonesPerCleaner.get(uid) ?? 0;
                    return (
                      <span
                        key={uid}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                          n === 0
                            ? "bg-[#fff4f2] text-[#a13a32]"
                            : "bg-[#f5f6ff] text-[#3848c7]"
                        }`}
                      >
                        {userName(uid)}
                        <span className="font-semibold tabular-nums">{n}</span>
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Контролёр журнала настраивается в одном месте — не дублируем. */}
          <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 text-[13px] leading-[1.55] text-[#3c4053]">
            <span className="font-medium text-[#0b1024]">Контролёр журнала</span>{" "}
            — на странице{" "}
            <a
              href="/settings/journal-responsibles"
              className="font-medium text-[#5566f6] hover:text-[#4a5bf0]"
            >
              /settings/journal-responsibles
            </a>
            . Свои проверяющие у помещения — в его карточке («Изменить» выше).
          </div>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[13px] text-[#6f7282]">
          Выключено — журнал работает в классическом режиме «1 задача на
          пару уборщик-контролёр в день».
        </p>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={props.disabled || busy}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_26px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:bg-[#c8cbe0]"
        >
          {busy ? "Сохраняем…" : "Сохранить настройки"}
        </button>
      </div>
    </section>
  );
}
