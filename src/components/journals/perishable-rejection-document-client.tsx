"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, ChevronDown, List, ListPlus, Plus, Trash2, Users } from "lucide-react";
import { CommissionDialog } from "@/components/journals/commission-dialog";
import { ApplyToSelectedDialog, type ApplyToSelectedField } from "@/components/journals/apply-to-selected-dialog";
import { SelectionApplyButton, SelectionEditButton, SelectionRepeatButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { SuggestInput } from "@/components/journals/suggest-input";
import { useNameSuggestions } from "@/components/journals/use-name-suggestions";
import { toast } from "sonner";
import { DocumentActionsBar } from "@/components/journals/document-actions-bar";
import {
  DOC_ADD_ROW_CLASS,
  DOC_BODY_STACK_CLASS,
  DOC_SECONDARY_BUTTON_CLASS,
  DOC_TITLE_ROW_NO_STRIP_CLASS,
  DOC_CAPS_TITLE_CLASS,
  DOC_HEADING_CLASS,
  DOC_PAPER_CANVAS_CLASS,
  DOC_PAPER_HEADER_CLASS,
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_CONTENT_WIDE_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
} from "@/components/journals/journal-responsive";
import { JournalCellInput } from "@/components/journals/journal-cell-input";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { getUserDisplayTitle } from "@/lib/user-roles";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import {
  addHoursToLocalDateTime,
  createPerishableRejectionRow,
  formatPerishableDateTime,
  formatPerishableExpiry,
  formatPerishableResponsible,
  normalizePerishableRejectionConfig,
  PERISHABLE_EXPIRY_PRESET_HOURS,
  STORAGE_CONDITION_LABELS,
  ORGANOLEPTIC_LABELS,
  PERISHABLE_ORGANOLEPTIC_VALUES,
  type PerishableRejectionConfig,
  type PerishableRejectionRow,
} from "@/lib/perishable-rejection-document";
import { useLiveEvents } from "@/lib/use-live-events";
import { formatRowSignatures, normalizeRowSignatures } from "@/lib/brakerage-commission";
import { useDocumentCloseAction } from "@/components/journals/document-close-button";
import {
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { JournalClosedBanner } from "@/components/journals/journal-closed-banner";
import { confirmAsync } from "@/components/ui/confirm-async";
import { promptAsync } from "@/components/ui/prompt-async";
import { useMobileView } from "@/lib/use-mobile-view";
import { formatCardDateTime } from "@/lib/journal-card-date";
import {
  MobileViewToggle,
  MobileViewTableWrapper,
} from "@/components/journals/mobile-view-toggle";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";
import {
  GRID_CELL_CLASS,
  GRID_HEAD_CELL_CLASS,
  GRID_VIEWPORT_CLASS,
} from "@/components/journals/journal-grid";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { JournalPaperHeaderRows } from "@/components/journals/journal-document-header";
import {
  JournalColumnsSettings,
  useColumnHeaderMenu,
} from "@/components/journals/journal-columns-settings";
import { useJournalHeaderEdit } from "@/components/journals/journal-header-edit";
import {
  legacyFlagsFromColumns,
  resolveColumns,
  type JournalColumnsConfig,
  type ResolvedJournalColumn,
} from "@/lib/journal-columns";
import {
  JournalCustomCell,
  customCellValue,
  withCustomCell,
} from "@/components/journals/journal-custom-cell";
import { OrgDirectoryDialog } from "@/components/journals/org-directory-dialog";
import { mergeIntoList, type OrgDirectoryKind } from "@/lib/org-directory";

import { useTodayKey } from "@/lib/use-today-key";
import { TodayStripForJournal } from "@/components/journals/today-strip-for-journal";
import { localDayKey } from "@/lib/entry-defaults";
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
  dateFrom: string;
  status: string;
  initialConfig: PerishableRejectionConfig;
  // Должность из карточки (как в UserLike) — в «ФИО, должность».
  users: {
    id: string;
    name: string;
    role: string;
    positionTitle?: string | null;
    jobPosition?: { name: string; categoryKey: string } | null;
  }[];
  /**
   * Ответственный документа (бракеровщик). Его имя подставляется в новую
   * строку; не назначен — поле пустое, человек выбирает сам.
   */
  responsibleUserId?: string | null;
};


/**
 * ЭКРАН = WeSetup (мягкие серые рамки `#ececf4`, шапка `#f8f9fc`),
 * ПЕЧАТЬ (Ctrl+P) = «бумага» для инспектора РПН/СЭС (чёрные рамки,
 * белая шапка). Поэтому каждый токен несёт пару screen + `print:`.
 */
/** Скруглённый viewport вокруг таблицы; в печати — прозрачный wrapper. */

/** Общий вид триггера shadcn-селекта внутри форм журнала. */
const SELECT_TRIGGER_CLASS =
  "h-9 w-full rounded-xl border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15";
/**
 * `<SelectItem value="">` в Radix запрещён — пустая строка зарезервирована
 * под «ничего не выбрано». Поэтому пункт «— выберите —» несёт сентинел,
 * который на входе/выходе мапится в пустую строку.
 */
const NONE_VALUE = "__none";
const fromNone = (value: string) => (value === NONE_VALUE ? "" : value);
const toNone = (value: string) => (value ? value : NONE_VALUE);

/** Сколько строк максимум разрешаем добавить одной пачкой. */
const BULK_ROWS_MAX = 50;

/**
 * Доля служебной колонки с чекбоксом в общей ширине бланка (P8).
 *
 * Именно ПРОЦЕНТ, а не фиксированные 36px: при `table-fixed` фиксированная
 * колонка складывалась со 100% процентных, и таблица становилась шире
 * бумажного полотна — правая колонка «Примечание» разрезалась краем.
 */
const CHECKBOX_COL_PERCENT = 2.6;

/**
 * Заголовок колонки бланка бракеража (P8).
 *
 * Раньше стоял `break-words` (`overflow-wrap: break-word`) — он разрешает
 * рвать слово В ЛЮБОМ месте, если оно не влезает, и на узких колонках
 * давал «Кол- во» и оторванную скобку в «(ФИО, должность )». Перенос
 * теперь ТОЛЬКО по словам; место освободили сами колонки (см. веса выше)
 * и шрифт 11.5px, как в бракераже готовой продукции.
 */
const HEAD_CELL_CLASS = `${GRID_HEAD_CELL_CLASS} px-1.5 py-1.5 text-[11.5px] font-semibold leading-[1.25] [overflow-wrap:normal] [word-break:normal] hyphens-none`;

/** Пауза до автосохранения после последнего нажатия клавиши. */
const AUTOSAVE_DELAY_MS = 900;

function nowDate() {
  return localDayKey();
}

function nowHour() {
  return String(new Date().getHours()).padStart(2, "0");
}

function nowMinute() {
  return String(new Date().getMinutes()).padStart(2, "0");
}

function padTwo(n: number) {
  return String(n).padStart(2, "0");
}

function parseTimeToHM(time: string): { h: string; m: string } {
  if (!time) return { h: nowHour(), m: nowMinute() };
  const [h = "00", m = "00"] = time.split(":");
  return { h, m };
}

function mergeHM(h: string, m: string) {
  return `${h}:${m}`;
}

/**
 * Ячейка «только показать, править в окне строки».
 *
 * Нужна там, где в одной колонке бланка живут ДВА поля строки
 * («Изготовитель / поставщик», «Фасовка / Кол-во», «Условия хранения,
 * срок») или значение — код, а не текст (органолептика). Правка на месте
 * писала всю склейку в одно поле: данные портились и удлинялись с каждым
 * заходом, а органолептика молча становилась «Соответствует» при любом
 * написании, кроме «не соответ».
 */
function JournalCellOpensRow({
  value,
  onOpen,
  disabled,
}: {
  value: string;
  onOpen: () => void;
  disabled?: boolean;
}) {
  const text = value.trim();
  if (disabled) {
    return (
      <div className="min-h-7 px-1.5 py-[5px] text-[12.5px] leading-[1.35] text-[#0b1024]">
        {text}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Нажмите, чтобы открыть окно записи"
      className="block min-h-7 w-full rounded-md px-1.5 py-[5px] text-left text-[12.5px] leading-[1.35] text-[#0b1024] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
    >
      {text || <span className="text-[#9b9fb3]">—</span>}
    </button>
  );
}

export function PerishableRejectionDocumentClient({
  documentId,
  title,
  organizationName,
  controlPeriodicity = "",
  dateFrom,
  status,
  initialConfig,
  users,
  responsibleUserId = null,
}: Props) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  // Раньше новая строка получала «первого сотрудника по алфавиту».
  // «ФИО, должность» ответственного — должность из его карточки.
  const defaultResponsibleUser = responsibleUserId
    ? users.find((user) => user.id === responsibleUserId)
    : undefined;
  const defaultResponsibleName = defaultResponsibleUser
    ? formatPerishableResponsible(defaultResponsibleUser)
    : "";
  const defaultResponsiblePosition = defaultResponsibleUser
    ? getUserDisplayTitle(defaultResponsibleUser)
    : "";
  const [config, setConfig] = useState(() =>
    normalizePerishableRejectionConfig(initialConfig)
  );
  // Колонки документа: скрытые не показываются в таблице, карточках,
  // диалоге строки и печати; данные скрытой колонки остаются в строках.
  const columnsView = useMemo(() => resolveColumns("perishable_rejection", config), [config]);
  const visibleColumnsView = useMemo(
    () => columnsView.filter((column) => !column.hidden),
    [columnsView]
  );
  const isColumnVisible = (key: string) =>
    columnsView.find((column) => column.key === key)?.hidden !== true;
  /** Имена сотрудников — для своей колонки типа «Сотрудник». */
  const employeeNames = useMemo(() => users.map((user) => user.name), [users]);
  /** Свои колонки организации — их ячейки печатаются в конце строки. */
  const customColumns = useMemo(
    () =>
      visibleColumnsView.flatMap((column) =>
        column.custom ? [{ column, custom: column.custom }] : []
      ),
    [visibleColumnsView]
  );
  /** Подпись колонки: своя из набора документа или стандартная `fallback`. */
  const columnLabel = (key: string, fallback: string) => {
    const column = columnsView.find((item) => item.key === key);
    return column && column.label !== column.defaultLabel ? column.label : fallback;
  };
  const withColumns = (base: PerishableRejectionConfig, next: JournalColumnsConfig): PerishableRejectionConfig => ({
    ...base,
    columns: next,
    showNote: legacyFlagsFromColumns("perishable_rejection", next).showNote !== false,
  });
  const readOnly = status === "closed";
  /** Окно «Сторонняя бракеражная комиссия». */
  const [commissionOpen, setCommissionOpen] = useState(false);
  // «Настройки журнала» — название документа и дата начала. Раньше их
  // можно было изменить только со страницы списка; теперь доступны из «⋯».
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTitle, setSettingsTitle] = useState(title);
  const [settingsDateFrom, setSettingsDateFrom] = useState(dateFrom);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const closeAction = useDocumentCloseAction({ documentId, title: settingsTitle });

  async function saveDocumentSettings() {
    setSettingsSaving(true);
    try {
      const response = await fetch(`/api/journal-documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: settingsTitle.trim() || title,
          dateFrom: settingsDateFrom,
        }),
      });
      if (!response.ok) throw new Error();
      setSettingsOpen(false);
      router.refresh();
    } catch {
      toast.error("Не удалось сохранить настройки");
    } finally {
      setSettingsSaving(false);
    }
  }
  const { mobileView, switchMobileView } = useMobileView("perishable_rejection");
  // Объявлено до cardItems: карточки читают selectedRows при рендере,
  // а `const` в TDZ падал «Cannot access before initialization» на любом
  // документе с хотя бы одной строкой.
  const [selectedRows, setSelectedRows] = useState<string[]>([]);

  const cardItems: RecordCardItem[] = config.rows.map((row, index) => ({
    id: row.id,
    title: `№${index + 1} · ${row.productName || "—"}`,
    // Общий формат карточек «дд.мм.гггг чч:мм» (в бланке формат свой).
    subtitle: formatCardDateTime(row.arrivalDate, row.arrivalTime) || undefined,
    onClick: readOnly ? undefined : () => openEditRow(row),
    leading: !readOnly ? (
      <Checkbox
        checked={selectedRows.includes(row.id)}
        onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
        className="size-5"
      />
    ) : null,
    fields: [
      isColumnVisible("productionDate")
        ? { label: columnLabel("productionDate", "Дата выработки"), value: row.productionDate, hideIfEmpty: true }
        : null,
      // В одной колонке бланка живут два поля; карточка показывала только
      // первое — поставщик и фасовка с телефона были не видны вообще.
      isColumnVisible("manufacturer")
        ? {
            label: columnLabel("manufacturer", "Изготовитель/поставщик"),
            value: [row.manufacturer, row.supplier].filter(Boolean).join(" / "),
            hideIfEmpty: true,
          }
        : null,
      isColumnVisible("packaging")
        ? {
            label: columnLabel("packaging", "Фасовка/количество"),
            value: [row.packaging, row.quantity].filter(Boolean).join(" / "),
            hideIfEmpty: true,
          }
        : null,
      isColumnVisible("document")
        ? { label: columnLabel("document", "Документ безопасности"), value: row.documentNumber, hideIfEmpty: true }
        : null,
      isColumnVisible("organoleptic")
        ? {
            label: columnLabel("organoleptic", "Органолептика"),
            value: ORGANOLEPTIC_LABELS[row.organolepticResult] || row.organolepticResult,
            hideIfEmpty: true,
          }
        : null,
      isColumnVisible("storage")
        ? {
            label: columnLabel("storage", "Условия хранения"),
            value: STORAGE_CONDITION_LABELS[row.storageCondition] || row.storageCondition,
            hideIfEmpty: true,
          }
        : null,
      // Срок реализации в карточке раньше не показывался вообще — с
      // телефона его нельзя было даже прочитать, не открывая запись.
      isColumnVisible("storage")
        ? {
            label: "Срок реализации",
            value: formatPerishableExpiry(row),
            hideIfEmpty: true,
          }
        : null,
      isColumnVisible("sale")
        ? {
            label: columnLabel("sale", "Реализовано"),
            value: `${row.actualSaleDate || ""} ${row.actualSaleTime || ""}`.trim(),
            hideIfEmpty: true,
          }
        : null,
      isColumnVisible("responsible")
        ? { label: columnLabel("responsible", "Ответственный"), value: row.responsiblePerson, hideIfEmpty: true }
        : null,
      isColumnVisible("signatures")
        ? {
            label: columnLabel("signatures", "Подпись бракеражной комиссии"),
            value: formatRowSignatures(normalizeRowSignatures(row.signatures)) || "Ждёт подписи комиссии",
            hideIfEmpty: false,
          }
        : null,
      isColumnVisible("note") ? { label: columnLabel("note", "Примечание"), value: row.note, hideIfEmpty: true } : null,
      // Свои колонки организации — и в карточке на телефоне, иначе с
      // телефона их вообще не видно.
      ...customColumns.map(({ column }) => ({
        label: column.label,
        value: customCellValue(row, column.key),
        hideIfEmpty: true,
      })),
    ].filter((field): field is { label: string; value: string; hideIfEmpty: boolean } => field !== null),
  }));
  const [addModalOpen, setAddModalOpen] = useState(false);
  /** «Применить ко всем выделенным» — одно окно на несколько строк. */
  const [applyOpen, setApplyOpen] = useState(false);
  // Правка существующей строки идёт через ту же модалку, что и добавление:
  // журнал rolling (до 30 записей за смену), и на телефоне карточка была
  // единственным доступным входом — но не открывала ничего.
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [activeListSection, setActiveListSection] = useState<
    "products" | "manufacturers" | "suppliers"
  >("products");
  const [newListName, setNewListName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [activeListId, setActiveListId] = useState<string>("");
  // «Из справочника организации» — общий список продуктов/поставщиков
  // организации. Раньше каждый журнал вёл свой список и свою загрузку из
  // файла, и загруженное в настройках сюда не доезжало.
  const [directoryKind, setDirectoryKind] = useState<OrgDirectoryKind | null>(null);

  const [draftRow, setDraftRow] = useState<PerishableRejectionRow>(() =>
    createPerishableRejectionRow({
      arrivalDate: nowDate(),
      arrivalTime: mergeHM(nowHour(), nowMinute()),
      organolepticResult: "compliant",
      storageCondition: "2_6",
      responsiblePerson: defaultResponsibleName,
    })
  );
  // Без «Управляющий» по умолчанию: ответственный документа и его должность.
  const [draftPosition, setDraftPosition] = useState(defaultResponsiblePosition);
  const [draftUserId, setDraftUserId] = useState(defaultResponsibleUser?.id ?? "");
  const draftCascade = usePositionEmployeeCascade({
    users,
    positionTitle: draftPosition,
    userId: draftUserId,
    onChange: (next) => {
      setDraftPosition(next.positionTitle);
      setDraftUserId(next.userId);
    },
    autoPick: "none",
  });

  // Наименования всей организации (последние сверху) + списки документа.
  const productSuggestions = useNameSuggestions("product");
  const productOptions = useMemo(() => {
    const fromLists = config.productLists.flatMap((list) => list.items);
    return productSuggestions.options(fromLists);
  }, [config.productLists, productSuggestions]);

  // Dedupe manufacturer/supplier catalogs at render time — legacy
  // documents may contain duplicate entries (same name typed twice
  // by different staff), and React would warn about duplicate keys
  // in the <option key={name}> selects below.
  const manufacturerOptions = useMemo(
    () => Array.from(new Set(config.manufacturers.filter(Boolean))),
    [config.manufacturers]
  );
  const supplierOptions = useMemo(
    () => Array.from(new Set(config.suppliers.filter(Boolean))),
    [config.suppliers]
  );

  /* ── Автосохранение (паттерн finished_product) ──────────────────────
   * Кнопки «Сохранить» нет: правки уезжают на сервер сами. Последнее
   * состояние конфига держим в ref, PATCH шлём через AUTOSAVE_DELAY_MS
   * после последнего нажатия клавиши. Blur ячейки и структурные операции
   * (добавить/удалить строку, правка справочников) сбрасывают очередь
   * немедленно, размонтирование — тоже. `router.refresh()` внутри
   * автосейва не зовём: он перерисовывает серверный компонент и сбивает
   * фокус в поле.
   */
  const configRef = useRef(config);
  configRef.current = config;
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Строки, которые видела эта страница: сервер по ним не даёт сохранению с
   * сайта стереть позиции, добавленные по QR, и подписи комиссии
   * (см. brakerage-row-merge.ts).
   */
  const knownRowIdsRef = useRef<Set<string>>(new Set(config.rows.map((row) => row.id)));
  const inFlightRef = useRef(0);
  const adoptServerRows = useCallback((rawConfig: unknown) => {
    if (dirtyRef.current || saveTimerRef.current || inFlightRef.current > 0) return;
    const fresh = normalizePerishableRejectionConfig(rawConfig);
    for (const row of fresh.rows) knownRowIdsRef.current.add(row.id);
    setConfig((prev) => {
      const same =
        prev.rows.length === fresh.rows.length &&
        prev.rows.every((row, index) => JSON.stringify(row) === JSON.stringify(fresh.rows[index]));
      return same ? prev : { ...prev, rows: fresh.rows };
    });
  }, []);

  const flushConfigSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    setIsSaving(true);
    for (const row of configRef.current.rows) knownRowIdsRef.current.add(row.id);
    inFlightRef.current += 1;
    void fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: configRef.current, knownRowIds: [...knownRowIdsRef.current] }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const body = (await response.json().catch(() => null)) as { document?: { config?: unknown } } | null;
        inFlightRef.current -= 1;
        if (body?.document) adoptServerRows(body.document.config);
      })
      .catch(() => {
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
        toast.error("Не удалось сохранить журнал — изменения остались только на экране");
      })
      .finally(() => setIsSaving(false));
  }, [documentId, adoptServerRows]);

  /**
   * Применить изменение конфига и поставить запись в очередь.
   * `immediate` шлём через `setTimeout(0)`, чтобы React успел закоммитить
   * состояние и `configRef.current` уже содержал новое значение.
   */
  const applyConfig = useCallback(
    (
      updater: (prev: PerishableRejectionConfig) => PerishableRejectionConfig,
      immediate = false
    ) => {
      setConfig(updater);
      dirtyRef.current = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(
        flushConfigSave,
        immediate ? 0 : AUTOSAVE_DELAY_MS
      );
    },
    [flushConfigSave]
  );

  // Уход со страницы не должен съедать последний недописанный ввод.
  useEffect(() => () => flushConfigSave(), [flushConfigSave]);

  // Позиции с телефонов (QR) и подписи комиссии появляются здесь сами.
  useLiveEvents((event) => {
    if ((event as { type?: string }).type !== "journal" || readOnly) return;
    const data = (event as { data?: { documentIds?: unknown } }).data;
    const ids = Array.isArray(data?.documentIds) ? (data?.documentIds as unknown[]) : [];
    if (!ids.includes(documentId)) return;
    void fetch(`/api/journal-documents/${documentId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { document?: { config?: unknown } } | null) => {
        if (body?.document) adoptServerRows(body.document.config);
      })
      .catch(() => undefined);
  });

  /** Ячейка колонки: одно место для всех колонок бланка и своих. */
  function renderCell(row: PerishableRejectionRow, column: ResolvedJournalColumn) {
    if (column.custom) {
      return (
        <JournalCustomCell
          column={column.custom}
          value={customCellValue(row, column.key)}
          onChange={(value) => updateRow(row.id, { custom: withCustomCell(row, column.key, value) })}
          onBlur={flushConfigSave}
          disabled={readOnly}
          mustFill={column.mustFill}
          employees={employeeNames}
        />
      );
    }
    const opens = (value: string) => (
      <JournalCellOpensRow value={value} onOpen={() => openEditRow(row)} disabled={readOnly} />
    );
    const text = (field: "productName" | "productionDate" | "documentNumber" | "responsiblePerson" | "note") => (
      <JournalCellInput
        value={row[field]}
        onChange={(e) => updateRow(row.id, { [field]: e.target.value } as Partial<PerishableRejectionRow>)}
        onBlur={flushConfigSave}
        disabled={readOnly}
      />
    );
    switch (column.key) {
      case "arrival":
        // Дата и время — только через окно строки: свободный ввод делился
        // по пробелу и молча портил оба поля.
        return opens(formatPerishableDateTime(row.arrivalDate, row.arrivalTime));
      case "product":
        return text("productName");
      case "productionDate":
        return text("productionDate");
      case "manufacturer":
        return opens([row.manufacturer, row.supplier].filter(Boolean).join(" / "));
      case "packaging":
        return opens([row.packaging, row.quantity].filter(Boolean).join(" / "));
      case "document":
        return text("documentNumber");
      case "organoleptic":
        return opens(ORGANOLEPTIC_LABELS[row.organolepticResult] || row.organolepticResult);
      case "storage":
        return opens(
          [STORAGE_CONDITION_LABELS[row.storageCondition] || row.storageCondition, formatPerishableExpiry(row)]
            .filter(Boolean)
            .join(", ")
        );
      case "sale":
        return opens(formatPerishableDateTime(row.actualSaleDate, row.actualSaleTime));
      case "responsible":
        return text("responsiblePerson");
      case "note":
        return text("note");
      case "signatures": {
        const signatures = normalizeRowSignatures(row.signatures);
        return signatures.length > 0 ? (
          <div className="px-1 py-1 text-center text-[12px] leading-snug">{formatRowSignatures(signatures)}</div>
        ) : (
          <div className="px-1 py-1 text-center print:hidden">
            <span className="inline-flex rounded-full bg-[#fff8eb] px-2 py-0.5 text-[11px] font-medium text-[#7a4a00]">
              Ждёт подписи комиссии
            </span>
          </div>
        );
      }
      default:
        return null;
    }
  }

  const headerEdit = useJournalHeaderEdit();
  const canManageColumns = headerEdit?.canEditDocument === true;
  // ПКМ / долгое нажатие по заголовку колонки: переименовать, скрыть,
  // применить ко всем документам. Набор документа сохраняется сразу.
  const headerMenu = useColumnHeaderMenu({
    code: "perishable_rejection",
    config: config as unknown as Record<string, unknown>,
    enabled: !readOnly,
    canApplyToAll: canManageColumns,
    onChange: (next) => applyConfig((prev) => withColumns(prev, next), true),
  });

  /**
   * «Закончить журнал». Штамп даты закрытия кладём в конфиг ДО PATCH со
   * статусом: закрытый документ править уже нельзя, а в шапке бланка
   * раньше печаталась дата начала.
   */
  async function closeJournal() {
    applyConfig((prev) => ({ ...prev, finishedAt: localDayKey() }), true);
    await closeAction.closeDocument();
  }

  function updateRow(id: string, patch: Partial<PerishableRejectionRow>) {
    applyConfig((prev) => ({
      ...prev,
      rows: prev.rows.map((row) =>
        row.id === id ? { ...row, ...patch } : row
      ),
    }));
  }

  function toggleRow(id: string, checked: boolean) {
    if (readOnly) return;
    setSelectedRows((prev) =>
      checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)
    );
  }

  /** Поля, которые имеет смысл менять у нескольких строк сразу. */
  const applyFields: ApplyToSelectedField[] = [
    { key: "arrivalDate", label: "Дата поступления", type: "date" },
    { key: "arrivalTime", label: "Время поступления", type: "time" },
    { key: "manufacturer", label: "Производитель", type: "text", suggestions: manufacturerOptions },
    { key: "supplier", label: "Поставщик", type: "text", suggestions: supplierOptions },
    { key: "organolepticResult", label: "Органолептическая оценка", type: "select", options: PERISHABLE_ORGANOLEPTIC_VALUES.map((value) => ({ value, label: ORGANOLEPTIC_LABELS[value] })) },
    { key: "storageCondition", label: "Условия хранения", type: "select", options: (Object.entries(STORAGE_CONDITION_LABELS) as [string, string][]).map(([value, label]) => ({ value, label })) },
    { key: "actualSaleDate", label: "Дата фактической реализации", type: "date" },
    { key: "actualSaleTime", label: "Время фактической реализации", type: "time" },
    { key: "responsiblePerson", label: "Ответственный", type: "text" },
  ];

  async function applyToSelectedRows(patch: Record<string, string>) {
    if (readOnly || selectedRows.length === 0) return;
    applyConfig(
      (prev) => ({
        ...prev,
        rows: prev.rows.map((row) => (selectedRows.includes(row.id) ? createPerishableRejectionRow({ ...row, ...patch }) : row)),
      }),
      true
    );
    toast.success(`Изменено строк: ${selectedRows.length}`);
  }

  /** Копия выделенных строк с датой и временем поступления «сейчас». */
  function repeatSelectedRows() {
    if (readOnly || selectedRows.length === 0) return;
    const copies = config.rows
      .filter((row) => selectedRows.includes(row.id))
      .map((row) =>
        createPerishableRejectionRow({
          ...row,
          id: undefined,
          arrivalDate: nowDate(),
          arrivalTime: mergeHM(nowHour(), nowMinute()),
          actualSaleDate: "",
          actualSaleTime: "",
          sourceRowKey: undefined,
        })
      );
    applyConfig((prev) => ({ ...prev, rows: [...prev.rows, ...copies] }), true);
    setSelectedRows(copies.map((row) => row.id));
    toast.success(copies.length > 1 ? `Добавлено копий: ${copies.length}` : `Повторено: ${copies[0]?.productName || "строка"}`);
  }

  async function removeSelectedRows() {
    if (readOnly) return;
    if (selectedRows.length === 0) return;
    const names = config.rows
      .filter((row) => selectedRows.includes(row.id))
      .map((row) => row.productName)
      .filter(Boolean);
    const confirmed = await confirmAsync({
      title: "Удалить выбранные записи?",
      description: "Записи бракеража скоропортящейся продукции исчезнут из журнала.",
      variant: "danger",
      confirmLabel: "Удалить",
      bullets: [
        { label: `Записей будет удалено: ${selectedRows.length}`, tone: "warn" },
        names.length > 0
          ? {
              label: `Изделия: ${names.slice(0, 4).join(", ")}${names.length > 4 ? " и др." : ""}`,
              tone: "info" as const,
            }
          : { label: "У выбранных записей не заполнено наименование", tone: "info" as const },
        {
          label: `Останется записей: ${config.rows.length - selectedRows.length}`,
          tone: "default",
        },
      ],
    });
    if (!confirmed) return;
    applyConfig((prev) => ({
      ...prev,
      rows: prev.rows.filter((row) => !selectedRows.includes(row.id)),
    }));
    setSelectedRows([]);
  }

  function addSingleRow(productName = "") {
    if (readOnly) return;
    applyConfig((prev) => ({
      ...prev,
      rows: [
        ...prev.rows,
        createPerishableRejectionRow({
          productName,
          arrivalDate: nowDate(),
          arrivalTime: mergeHM(nowHour(), nowMinute()),
          organolepticResult: "compliant",
          storageCondition: "2_6",
          responsiblePerson: defaultResponsibleName,
        }),
      ],
    }));
  }

  function addRowsFromList() {
    if (readOnly) return;
    const list = config.productLists.find((l) => l.id === activeListId);
    if (!list) return;
    list.items.forEach((item) => addSingleRow(item));
  }

  /** «Добавить несколько изделий» — пачка пустых строк. */
  async function addSeveralRows() {
    if (readOnly) return;
    const raw = await promptAsync({
      title: "Добавить несколько изделий",
      description:
        "В таблицу добавятся пустые строки с текущей датой и временем поступления — останется вписать наименования.",
      label: "Сколько строк добавить",
      type: "number",
      defaultValue: "3",
      placeholder: "3",
      confirmLabel: "Добавить",
      validate: (value) => {
        const count = Number(value);
        if (!value.trim()) return "Введите число";
        if (!Number.isInteger(count) || count <= 0) return "Нужно целое число больше нуля";
        if (count > BULK_ROWS_MAX)
          return `За один раз можно добавить не больше ${BULK_ROWS_MAX} строк`;
        return null;
      },
    });
    if (raw === null) return;
    const count = Number(raw);
    if (!Number.isInteger(count) || count <= 0 || count > BULK_ROWS_MAX) return;
    for (let i = 0; i < count; i += 1) addSingleRow();
  }

  /** «Добавить списком» — многострочная вставка наименований. */
  function addRowsFromText() {
    if (readOnly) return;
    const items = bulkText
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    if (items.length === 0) return;
    items.forEach((item) => addSingleRow(item));
    setBulkText("");
    setBulkOpen(false);
    toast.success(`Добавлено строк: ${items.length}`);
  }

  function resetDraftRow() {
    setDraftRow(
      createPerishableRejectionRow({
        arrivalDate: nowDate(),
        arrivalTime: mergeHM(nowHour(), nowMinute()),
        organolepticResult: "compliant",
        storageCondition: "2_6",
        responsiblePerson: defaultResponsibleName,
      })
    );
    setDraftPosition(defaultResponsiblePosition);
    setDraftUserId(defaultResponsibleUser?.id ?? "");
  }

  function openAddRow() {
    setEditingRowId(null);
    resetDraftRow();
    setAddModalOpen(true);
  }

  /** Правка строки — модалка добавления, засеянная её значениями. */
  function openEditRow(row: PerishableRejectionRow) {
    if (readOnly) return;
    setEditingRowId(row.id);
    setDraftRow({ ...row });
    // Ответственный в строке хранится склеенной строкой «Имя, должность»:
    // разбираем обратно, чтобы селекты модалки встали на свои значения.
    const [namePart, positionPart] = String(row.responsiblePerson || "")
      .split(",")
      .map((part) => part.trim());
    const matchedUser = users.find((user) => user.name === namePart);
    setDraftUserId(matchedUser?.id ?? "");
    // Должность найденного человека — из карточки; иначе то, что записано.
    setDraftPosition(matchedUser ? getUserDisplayTitle(matchedUser) : positionPart || "");
    setAddModalOpen(true);
  }

  /** Правка выделенных строк по очереди — тем же окном. */
  const seq = useSequentialEdit({
    open: (id) => {
      const row = config.rows.find((item) => item.id === id);
      if (!row || readOnly) return false;
      openEditRow(row);
      return true;
    },
    close: () => {
      setAddModalOpen(false);
      setEditingRowId(null);
    },
  });

  function closeRowModal() {
    // Закрытие без сохранения прерывает очередь («Изменено k из N»).
    seq.cancelled();
  }

  async function saveDraftRow() {
    if (readOnly) return;
    const user = users.find((u) => u.id === draftUserId);
    // Сотрудника в списке может не быть (уволен, ФИО вписано руками) —
    // тогда сохраняем то, что уже стояло в строке, иначе ФИО стиралось
    // и оставалась одна должность.
    // Должность — выбранного человека, не метка фильтра; одна должность
    // без ФИО в колонку «ФИО, должность» не пишется.
    const responsible = user
      ? formatPerishableResponsible(user)
      : draftRow.responsiblePerson.trim();
    const nextRow = { ...draftRow, responsiblePerson: responsible };
    const rowId = editingRowId;
    applyConfig(
      (prev) => ({
        ...prev,
        rows: rowId
          ? prev.rows.map((row) => (row.id === rowId ? nextRow : row))
          : [...prev.rows, nextRow],
      }),
      true
    );
    void productSuggestions.remember([nextRow.productName]);
    resetDraftRow();
    if (rowId) {
      // Очередь правок откроет следующую строку или закроет окно.
      seq.saved();
      return;
    }
    setEditingRowId(null);
    setAddModalOpen(false);
  }

  /* ---------- List modal helpers ---------- */

  function addProductList() {
    if (readOnly) return;
    if (!newListName.trim()) return;
    const id = `list-${Date.now()}`;
    applyConfig((prev) => ({
      ...prev,
      productLists: [
        ...prev.productLists,
        { id, name: newListName.trim(), items: [] },
      ],
    }));
    setNewListName("");
  }

  function addItemToProductList(item: string) {
    if (readOnly) return;
    if (!activeListId) return;
    applyConfig((prev) => ({
      ...prev,
      productLists: prev.productLists.map((list) =>
        list.id === activeListId && !list.items.includes(item)
          ? { ...list, items: [...list.items, item] }
          : list
      ),
    }));
  }

  function addProductItem() {
    if (readOnly) return;
    if (!newItemName.trim()) return;
    const list = config.productLists[0];
    if (!list) return;
    applyConfig((prev) => ({
      ...prev,
      productLists: prev.productLists.map((l) =>
        l.id === list.id && !l.items.includes(newItemName.trim())
          ? { ...l, items: [...l.items, newItemName.trim()] }
          : l
      ),
    }));
    setNewItemName("");
  }

  function addManufacturerItem() {
    if (readOnly) return;
    if (!newItemName.trim()) return;
    applyConfig((prev) => ({
      ...prev,
      manufacturers: [...prev.manufacturers, newItemName.trim()],
    }));
    setNewItemName("");
  }

  function addSupplierItem() {
    if (readOnly) return;
    if (!newItemName.trim()) return;
    applyConfig((prev) => ({
      ...prev,
      suppliers: [...prev.suppliers, newItemName.trim()],
    }));
    setNewItemName("");
  }

  async function importItemsFromText(
    section: "products" | "manufacturers" | "suppliers",
  ) {
    if (readOnly) return;
    const sectionLabel =
      section === "products"
        ? "изделий"
        : section === "manufacturers"
          ? "изготовителей"
          : "поставщиков";
    const text = await promptAsync({
      title: `Импорт ${sectionLabel}`,
      description:
        "Вставьте элементы через запятую или точку с запятой — они добавятся в справочник документа. Дубликаты будут отброшены.",
      label: "Список элементов",
      placeholder: "Молоко 3,2%; Творог 9%; Сметана 20%",
      confirmLabel: "Импортировать",
      validate: (value) => (value.trim() ? null : "Вставьте хотя бы один элемент"),
    });
    if (text === null) return;
    const items = text
      .split(/[\n;]/)
      .map((x) => x.trim())
      .filter(Boolean);
    addItemsToSection(section, items);
  }

  /**
   * Добавление готовых наименований в раздел списков. Общая точка для
   * вставки текстом и для выбора из справочника организации — чтобы оба
   * пути клали значения в одно и то же место.
   */
  function addItemsToSection(
    section: "products" | "manufacturers" | "suppliers",
    items: string[]
  ) {
    if (readOnly || items.length === 0) return;
    if (section === "products") {
      const list = config.productLists[0];
      if (!list) return;
      applyConfig((prev) => ({
        ...prev,
        productLists: prev.productLists.map((l) =>
          l.id === list.id ? { ...l, items: mergeIntoList(l.items, items) } : l
        ),
      }));
    } else if (section === "manufacturers") {
      applyConfig((prev) => ({
        ...prev,
        manufacturers: mergeIntoList(prev.manufacturers, items),
      }));
    } else {
      applyConfig((prev) => ({ ...prev, suppliers: mergeIntoList(prev.suppliers, items) }));
    }
  }

  /** «+N ч» — конечный срок реализации от даты-времени поступления. */
  function applyExpiryPreset(hours: number) {
    const next = addHoursToLocalDateTime(
      draftRow.arrivalDate,
      draftRow.arrivalTime,
      hours
    );
    if (!next) {
      toast.error("Укажите дату поступления — от неё считается срок");
      return;
    }
    setDraftRow((prev) => ({
      ...prev,
      expiryDate: next.date,
      expiryTime: next.time,
    }));
  }

  const arrivalHM = parseTimeToHM(draftRow.arrivalTime);
  const saleHM = parseTimeToHM(draftRow.actualSaleTime);

  // «Сегодня» — после mount (useTodayKey): new Date() в рендере
  // расходился между сервером (UTC) и браузером и врал подсветкой.
  const todayKey = useTodayKey();
  const todayFocusRowId = config.rows.find((row) => row.arrivalDate === todayKey)?.id;

  /**
   * Ширины колонок бланка бракеража (P8).
   *
   * Веса, а не готовые проценты: опциональное «Примечание» просто
   * добавляется в массив, и сетка пересчитывается сама — как в
   * `finished-product-document-client.tsx`. Сумма ВСЕГДА равна 100%
   * вместе с колонкой чекбокса, поэтому `table-fixed` не раздувает
   * таблицу шире бумажного полотна (1150px).
   *
   * Порядок весов = порядок `<th>` ниже:
   * дата поступления · наименование · дата выработки · изготовитель ·
   * фасовка · номер документа · органолептика · условия хранения ·
   * дата реализации · ответственное лицо · (примечание).
   */
  const columnWeights = visibleColumnsView.map((column) => column.weight);
  const columnWeightsTotal = columnWeights.reduce((sum, weight) => sum + weight, 0);
  const columnWidths = columnWeights.map(
    (weight) =>
      `${((weight / columnWeightsTotal) * (100 - CHECKBOX_COL_PERCENT)).toFixed(3)}%`
  );

  return (
    <div className="text-black">
      <FocusTodayScroller
        onCreate={!readOnly ? () => openAddRow() : undefined}
      />
      {/* Q3: `space-y-6` на корне снят — вертикальный ритм задают токены
          DOC_* (иначе зазор H1 → шапка «плавал» между 24 и 28px). */}
      <DocumentActionsBar
        className={DOC_TITLE_ROW_NO_STRIP_CLASS}
        backHref="/journals/perishable_rejection"
        documentId={documentId}
        heading={<h1 className={DOC_HEADING_CLASS}>{settingsTitle}</h1>}
        onSettings={!readOnly ? () => setSettingsOpen(true) : undefined}
        menuItems={
          !readOnly
            ? [
                {
                  key: "close-journal",
                  label: "Закончить журнал",
                  icon: <Archive className="size-4" />,
                  onSelect: () => void closeJournal(),
                  disabled: closeAction.isClosing,
                },
              ]
            : []
        }
      />
      {readOnly ? (
        <div className="mb-6">
          <JournalClosedBanner hint="Верните журнал в активные, чтобы снова вносить записи бракеража скоропортящейся продукции." documentId={documentId} />
        </div>
      ) : (
        <div className="mb-4 print:hidden">
          <TodayStripForJournal
            journalCode="perishable_rejection"
            todayCount={
              config.rows.filter((row) => row.arrivalDate === todayKey).length
            }
            label="запись бракеража за сегодня"
          />
        </div>
      )}

      {/* Обёртка — как у finished_product: без карточной рамки и без
          `overflow-hidden`. Именно `overflow-hidden` на карточке резал
          таблицу по правому краю: горизонтальный скролл живёт ВНУТРИ
          GRID_VIEWPORT_CLASS, а внешний клип его перекрывал. */}
      {/* R1: бумажное полотно — во всю ширину контентной колонки. */}
        <div className="mb-4 sm:hidden print:hidden">
          <MobileViewToggle mobileView={mobileView} onChange={switchMobileView} />
        </div>

      <div className={`${DOC_BODY_STACK_CLASS} ${DOC_PAPER_CANVAS_CLASS}`}>
        {/* HACCP header table */}
        {/* В карточках на телефоне бумажная шапка скрыта (уезжала за
            правый край); на печати и на десктопе — как было. */}
        {/* Свой `overflow-x-auto`: на 360px шапка была шире экрана на
            96px, и «Начат…/СТР. 1 ИЗ 1» обрезались без прокрутки. */}
        <div
          className={`overflow-x-auto print:overflow-visible ${
            mobileView === "cards" ? "max-sm:hidden print:block" : ""
          }`}
        >
        <table
          className={`${DOC_PAPER_HEADER_CLASS} w-full border-collapse text-[13px]`}
        >
          <tbody>
            <JournalPaperHeaderRows
              orgName={organizationName}
              title="ЖУРНАЛ БРАКЕРАЖА СКОРОПОРТЯЩЕЙСЯ ПИЩЕВОЙ ПРОДУКЦИИ"
              startedAt={dateFrom}
              finishedAt={readOnly ? config.finishedAt || dateFrom : null}
              controlPeriodicity={controlPeriodicity}
              orgCellClass="w-[18%]"
              sideCellClass="w-[20%]"
            />
          </tbody>
        </table>
        </div>

        <h2 className={`${DOC_CAPS_TITLE_CLASS} text-center text-[13px] font-bold uppercase leading-tight sm:text-[14px]`}>
          ЖУРНАЛ БРАКЕРАЖА СКОРОПОРТЯЩЕЙСЯ ПИЩЕВОЙ ПРОДУКЦИИ
        </h2>

        {/* Action buttons */}
        <div className={DOC_ADD_ROW_CLASS}>
          {!readOnly && (
            <ResponsiveMenu
              title="Добавить"
              align="start"
              items={[
                {
                  key: "add-product",
                  label: "Добавить изделие",
                  icon: <Plus className="size-4 text-[#6f7282]" />,
                  onSelect: () => openAddRow(),
                },
                {
                  key: "add-several",
                  label: "Добавить несколько изделий",
                  icon: <Plus className="size-4 text-[#6f7282]" />,
                  onSelect: () => void addSeveralRows(),
                },
                {
                  key: "add-from-list",
                  label: "Добавить из списка",
                  icon: <List className="size-4 text-[#6f7282]" />,
                  onSelect: addRowsFromList,
                },
                {
                  key: "add-bulk-list",
                  label: "Добавить списком",
                  icon: <ListPlus className="size-4 text-[#6f7282]" />,
                  onSelect: () => {
                    setBulkText("");
                    setBulkOpen(true);
                  },
                },
              ]}
              trigger={
                <Button
                  type="button"
                  className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors hover:bg-[#4a5bf0]"
                >
                  <Plus className="size-5" strokeWidth={2.5} />
                  Добавить
                  <ChevronDown className="size-4" />
                </Button>
              }
            />
          )}
          {/* P1: прямая кнопка добавления рядом со сплитом — ровно как
              «+ Добавить изделие» в finished_product. Раньше единственный
              способ завести строку прятался внутрь дропдауна: два клика
              вместо одного на самом частом действии журнала. */}
          {!readOnly && (
            <Button
              type="button"
              className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors hover:bg-[#4a5bf0]"
              onClick={() => openAddRow()}
            >
              <Plus className="size-5" strokeWidth={2.5} />
              Добавить запись
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className={DOC_SECONDARY_BUTTON_CLASS}
            onClick={() => setListModalOpen(true)}
            disabled={readOnly}
          >
            Редактировать списки
          </Button>
          <Button type="button" variant="outline" className={DOC_SECONDARY_BUTTON_CLASS} onClick={() => setCommissionOpen(true)}>
            <Users className="size-4" />
            Комиссия{config.commissionMembers.length > 0 ? ` · ${config.commissionMembers.length}` : ""}
          </Button>
          {/* Кнопки «Сохранить» нет: правки уезжают сами (см. applyConfig). */}
          {isSaving ? (
            <span className="text-[13px] text-[#6f7282]">Сохранение…</span>
          ) : null}
        </div>
        {config.commissionMembers.length > 0 ? (
          <p className="text-[13px] leading-snug text-[#3c4053] print:hidden" data-testid="brakerage-responsibles">
            {defaultResponsibleUser ? `Ответственные: ${defaultResponsibleUser.name} (исполнитель) · ` : ""}
            Комиссия: {config.commissionMembers.map((member) => member.employeeName).join(", ")}
          </p>
        ) : null}

        {!readOnly ? (
          <JournalSelectionBar
            count={selectedRows.length}
            onClear={() => setSelectedRows([])}
            onDelete={() => void removeSelectedRows()}
            hint="Строки бракеража будут удалены без возможности отмены"
          >
            <SelectionEditButton count={selectedRows.length} disabled={readOnly} onClick={() => seq.start(selectedRows)} />
            <SelectionApplyButton count={selectedRows.length} disabled={readOnly} onClick={() => setApplyOpen(true)} />
            <SelectionRepeatButton count={selectedRows.length} disabled={readOnly} onClick={() => repeatSelectedRows()} />
          </JournalSelectionBar>
        ) : null}
        <ApplyToSelectedDialog open={applyOpen} onOpenChange={setApplyOpen} count={selectedRows.length} fields={applyFields} onApply={applyToSelectedRows} />

        {/* View toggle */}

        {/* Карточки — только на телефоне. Раньше обёртки `sm:hidden` не
            было, и на десктопе «Записей пока нет.» висело над таблицей. */}
        {mobileView === "cards" ? (
          <div className="sm:hidden print:hidden">
            <RecordCardsView items={cardItems} emptyLabel="Записей пока нет." />
          </div>
        ) : null}

        {/* Main data table */}
        <MobileViewTableWrapper mobileView={mobileView} className={GRID_VIEWPORT_CLASS}>
          {/* Паттерн N4 (finished_product): `table-fixed` + colgroup в
              процентах. Раньше стоял `min-w-[2200px]` без фиксированной
              раскладки — колонки расползались, «Примечание» уезжало из
              контейнера. Скролл живёт ВНУТРИ viewport-обёртки.

              P3: `min-w-[1600px]` был шире полотна (~1150-1250px), поэтому
              ПОСЛЕДНЯЯ колонка всегда упиралась в правый край контейнера и
              её правая рамка обрезалась.

              P8 (финальная сверка): даже с `min-w-[1180px]` таблица не
              влезала в полотно 1150 по ДВУМ причинам сразу — сам минимум
              был больше полотна И проценты колонок в сумме давали 100%
              ПЛЮС фиксированные 36px чекбокса, то есть `table-fixed`
              раздувал таблицу ещё на ширину чекбокса. «Примечание»
              физически разрезалось правым краем.

              Теперь ВСЕ колонки, включая чекбокс, заданы процентами от
              одной суммы 100%, а ширины считаются из весов — включение
              опционального «Примечания» пересчитывает сетку, а не ломает
              её. Минимум опущен до 1040px: на десктопе таблица ровно по
              полотну (правая рамка видна), на узких экранах остаётся
              скролл внутри viewport'а. */}
          <table className="w-full min-w-[1040px] table-fixed border-collapse text-[12.5px]">
            <colgroup>
              {/* Q2-3: служебная колонка выделения не печатается. */}
              <col className="print:hidden" style={{ width: `${CHECKBOX_COL_PERCENT}%` }} />
              {columnWidths.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {/* Select-all — как в остальных журналах: одна галочка
                    отмечает все строки листа, снятие очищает выделение. */}
                <th className={`${GRID_HEAD_CELL_CLASS} px-1 py-1.5 text-center leading-tight print:hidden`}>
                  <Checkbox
                    checked={config.rows.length > 0 && selectedRows.length === config.rows.length}
                    onCheckedChange={(checked) =>
                      !readOnly &&
                      setSelectedRows(checked === true ? config.rows.map((row) => row.id) : [])
                    }
                    disabled={readOnly || config.rows.length === 0}
                    aria-label="Выбрать все строки"
                  />
                </th>
                {visibleColumnsView.map((column) => (
                  <th
                    key={column.key}
                    className={HEAD_CELL_CLASS}
                    {...headerMenu.headerProps(column.key)}
                  >
                    {column.label}
                    {column.mustFill ? (
                      <span className="text-[#d43a2f]" title="Обязательно заполнять">
                        {" *"}
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Пустое состояние = ПУСТАЯ СТРОКА бланка (чекбокс + пустые
                  ячейки), как на эталоне. Текстовой заглушки внутри таблицы
                  нет — бланк должен выглядеть бланком, а подсказка «Нажмите
                  Добавить» живёт на кнопке над таблицей. */}
              {config.rows.length === 0 ? (
                <tr>
                  <td className={`${GRID_CELL_CLASS} px-1 py-1 align-top leading-tight print:hidden`}>
                    <Checkbox checked={false} disabled />
                  </td>
                  {Array.from({ length: visibleColumnsView.length }, (_, index) => (
                    <td
                      key={index}
                      className={`${GRID_CELL_CLASS} p-1 align-top leading-tight`}
                    >
                      <div className="h-7" />
                    </td>
                  ))}
                </tr>
              ) : null}
              {config.rows.map((row) => (
                <tr key={row.id} data-focus-today={row.id === todayFocusRowId ? "" : undefined}>
                  <td className={`${GRID_CELL_CLASS} px-1 py-1 align-top leading-tight print:hidden`}>
                    <Checkbox
                      checked={selectedRows.includes(row.id)}
                      onCheckedChange={(checked) =>
                        toggleRow(row.id, checked === true)
                      }
                      disabled={readOnly}
                    />
                  </td>
                  {/* Ячейки идут тем же циклом, что и шапка: скрытая колонка
                      исчезает, порядок колонок — как в настройках. */}
                  {visibleColumnsView.map((column) => (
                    <td key={column.key} className={`${GRID_CELL_CLASS} p-1 align-top leading-tight`}>
                      {renderCell(row, column)}
                    </td>
                  ))}
                </tr>
              ))}
              {/* Последняя строка — кликабельная «пустая»: то же окно,
                  что и «Добавить запись» над таблицей. Строка пустого
                  состояния выше (rows.length === 0) — это не «хвостовая
                  заготовка», а замена таблицы бланком без строк, поэтому
                  её не трогаем.
                  leading=1 (чекбокс), labelSpan=2 — подпись растянута на
                  «Дата, время поступления» + «Наименование»: вместе они
                  опознают запись (когда и что поступило). Остальные
                  колонки (дата выработки, изготовитель, фасовка, документ,
                  органолептика, условия хранения, дата реализации,
                  ответственный и опциональное примечание) — данные,
                  пустые в новой строке: trailing = config.showNote ? 9 : 8.
                  Сумма 1+2+(9 или 8) = 12 или 11 — тот же colSpan, что был
                  раньше. */}
              {!readOnly ? (
                <JournalAddRow
                  leading={1}
                  labelSpan={Math.min(2, Math.max(1, visibleColumnsView.length))}
                  trailing={Math.max(0, visibleColumnsView.length - 2)}
                  label="Добавить запись"
                  onClick={() => openAddRow()}
                />
              ) : null}
            </tbody>
          </table>
        </MobileViewTableWrapper>
        {headerMenu.element}
      </div>

      {/* Add Row Dialog — design-system shape: padded header, body
       * sections, bottom-stuck footer with secondary + primary buttons. */}
      <Dialog
        open={readOnly ? false : addModalOpen}
        onOpenChange={(next) => (next ? setAddModalOpen(true) : closeRowModal())}
      >
        <DialogContent className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
          <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              {editingRowId ? `Изменение записи${seq.progress ? ` ${seq.progress}` : ""}` : "Добавление новой строки"}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
            {/* Дата и время поступления */}
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">
                Дата и время поступления
              </Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
                <Input
                  type="date"
                  className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  value={draftRow.arrivalDate}
                  onChange={(e) =>
                    setDraftRow((prev) => ({
                      ...prev,
                      arrivalDate: e.target.value,
                    }))
                  }
                />
                <Select
                  value={arrivalHM.h}
                  onValueChange={(value) =>
                    setDraftRow((prev) => ({
                      ...prev,
                      arrivalTime: mergeHM(value, arrivalHM.m),
                    }))
                  }
                >
                  <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                    <SelectValue placeholder="Час" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={padTwo(i)}>
                        {padTwo(i)} ч
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={arrivalHM.m}
                  onValueChange={(value) =>
                    setDraftRow((prev) => ({
                      ...prev,
                      arrivalTime: mergeHM(arrivalHM.h, value),
                    }))
                  }
                >
                  <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                    <SelectValue placeholder="Мин" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 60 }, (_, i) => (
                      <SelectItem key={i} value={padTwo(i)}>
                        {padTwo(i)} мин
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Наименование изделия */}
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">
                Наименование изделия
              </Label>
              {/* Одно поле вместо «список + или введите новое»: варианты
                  открываются по стрелке, своё пишется прямо в поле. */}
              <SuggestInput
                ariaLabel="Наименование изделия"
                value={draftRow.productName}
                options={productOptions}
                placeholder="Выберите из списка или введите новое"
                onChange={(next) =>
                  setDraftRow((prev) => ({ ...prev, productName: next }))
                }
              />
            </div>

            {/* Дата выработки */}
            <div className={`space-y-2${isColumnVisible("productionDate") ? "" : " hidden"}`}>
              <Label className="text-[13px] font-medium text-[#3c4053]">
                {columnLabel("productionDate", "Дата выработки")}
              </Label>
              <Input
                type="date"
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                value={draftRow.productionDate}
                onChange={(e) =>
                  setDraftRow((prev) => ({
                    ...prev,
                    productionDate: e.target.value,
                  }))
                }
              />
            </div>

            {/* Изготовитель */}
            <div className={`space-y-2${isColumnVisible("manufacturer") ? "" : " hidden"}`}>
              <Label className="text-[13px] font-medium text-[#3c4053]">
                {columnLabel("manufacturer", "Изготовитель")}
              </Label>
              <Select
                value={toNone(
                  config.manufacturers.includes(draftRow.manufacturer)
                    ? draftRow.manufacturer
                    : ""
                )}
                onValueChange={(value) =>
                  setDraftRow((prev) => ({
                    ...prev,
                    manufacturer: fromNone(value),
                  }))
                }
              >
                <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder="— выберите из списка —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— выберите из списка —</SelectItem>
                  {manufacturerOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                placeholder="Или введите нового изготовителя"
                value={
                  config.manufacturers.includes(draftRow.manufacturer)
                    ? ""
                    : draftRow.manufacturer
                }
                onChange={(e) =>
                  setDraftRow((prev) => ({
                    ...prev,
                    manufacturer: e.target.value,
                  }))
                }
              />
            </div>

            {/* Поставщик */}
            <div className={`space-y-2${isColumnVisible("manufacturer") ? "" : " hidden"}`}>
              <Label className="text-[13px] font-medium text-[#3c4053]">
                Поставщик
              </Label>
              <Select
                value={toNone(
                  config.suppliers.includes(draftRow.supplier)
                    ? draftRow.supplier
                    : ""
                )}
                onValueChange={(value) =>
                  setDraftRow((prev) => ({
                    ...prev,
                    supplier: fromNone(value),
                  }))
                }
              >
                <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder="— выберите из списка —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— выберите из списка —</SelectItem>
                  {supplierOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                placeholder="Или введите нового поставщика"
                value={
                  config.suppliers.includes(draftRow.supplier)
                    ? ""
                    : draftRow.supplier
                }
                onChange={(e) =>
                  setDraftRow((prev) => ({
                    ...prev,
                    supplier: e.target.value,
                  }))
                }
              />
            </div>

            {/* Фасовка + Кол-во side-by-side */}
            <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2${isColumnVisible("packaging") ? "" : " hidden"}`}>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">
                  Фасовка
                </Label>
                <Input
                  className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  value={draftRow.packaging}
                  onChange={(e) =>
                    setDraftRow((prev) => ({
                      ...prev,
                      packaging: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">
                  Количество
                </Label>
                <Input
                  className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  value={draftRow.quantity}
                  onChange={(e) =>
                    setDraftRow((prev) => ({
                      ...prev,
                      quantity: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            {/* Номер документа */}
            <div className={`space-y-2${isColumnVisible("document") ? "" : " hidden"}`}>
              <Label className="text-[13px] font-medium text-[#3c4053]">
                {columnLabel("document", "Номер документа")}
              </Label>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                value={draftRow.documentNumber}
                onChange={(e) =>
                  setDraftRow((prev) => ({
                    ...prev,
                    documentNumber: e.target.value,
                  }))
                }
              />
            </div>

            {/* Органолептическая оценка — pill-style segmented control */}
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">
                Органолептическая оценка
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["compliant", "Соответствует", "#136b2a", "rgba(19,107,42,0.18)"],
                    ["non_compliant", "Не соответствует", "#d2453d", "rgba(210,69,61,0.18)"],
                    ["good_quality", "Доброкачественная", "#136b2a", "rgba(19,107,42,0.18)"],
                    ["poor_quality", "Недоброкачественная", "#d2453d", "rgba(210,69,61,0.18)"],
                  ] as const
                ).map(([value, label, fg, bg]) => {
                  const active = draftRow.organolepticResult === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        setDraftRow((prev) => ({
                          ...prev,
                          organolepticResult: value,
                        }))
                      }
                      role="radio"
                      aria-checked={active}
                      // Выбранный — заливка + галочка + кольцо, невыбранный —
                      // белый: раньше оба были цветными и «нажатый» не читался.
                      className={`flex h-10 items-center justify-center gap-1.5 rounded-xl border px-3.5 text-[14px] font-medium transition-all duration-150 ${
                        active
                          ? "border-transparent text-white shadow-[0_8px_20px_-10px_rgba(11,16,36,0.35)]"
                          : "border-[#dcdfed] bg-white text-[#6f7282] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024]"
                      }`}
                      style={active ? { backgroundColor: fg, boxShadow: `0 0 0 4px ${bg}` } : undefined}
                    >
                      {active ? <Check className="size-4" strokeWidth={3} /> : null}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Условия хранения — radio cards */}
            <div className={`space-y-2${isColumnVisible("storage") ? "" : " hidden"}`}>
              <Label className="text-[13px] font-medium text-[#3c4053]">
                {columnLabel("storage", "Условия хранения")}
              </Label>
              <div className="flex flex-col gap-2">
                {(
                  Object.entries(STORAGE_CONDITION_LABELS) as [string, string][]
                ).map(([key, label]) => {
                  const active = draftRow.storageCondition === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setDraftRow((prev) => ({
                          ...prev,
                          storageCondition: key as PerishableRejectionRow["storageCondition"],
                        }))
                      }
                      className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-[14px] transition-colors ${
                        active
                          ? "border-[#5566f6] bg-[#f5f6ff] text-[#0b1024]"
                          : "border-[#dcdfed] bg-white text-[#3c4053] hover:bg-[#fafbff]"
                      }`}
                    >
                      <span className="font-medium">{label}</span>
                      <span
                        className={`flex size-5 items-center justify-center rounded-full border-2 ${
                          active ? "border-[#5566f6]" : "border-[#c7ccea]"
                        }`}
                      >
                        {active ? (
                          <span className="size-2 rounded-full bg-[#5566f6]" />
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Конечный срок реализации */}
            <div className={`space-y-2${isColumnVisible("storage") ? "" : " hidden"}`}>
              <Label className="text-[13px] font-medium text-[#3c4053]">
                Конечный срок реализации (число, месяц, час)
              </Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr]">
                <Input
                  type="date"
                  className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  value={draftRow.expiryDate}
                  onChange={(e) =>
                    setDraftRow((prev) => ({
                      ...prev,
                      expiryDate: e.target.value,
                    }))
                  }
                />
                <Input
                  type="time"
                  aria-label="Час конечного срока реализации"
                  className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  value={draftRow.expiryTime}
                  onChange={(e) =>
                    setDraftRow((prev) => ({
                      ...prev,
                      expiryTime: e.target.value,
                    }))
                  }
                />
              </div>
              {/* Скоропорт живёт 12/24/36/72 часа от поступления — считать
                  их в уме у плиты незачем. */}
              <div className="flex flex-wrap gap-2">
                {PERISHABLE_EXPIRY_PRESET_HOURS.map((hours) => (
                  <button
                    key={hours}
                    type="button"
                    onClick={() => applyExpiryPreset(hours)}
                    disabled={!draftRow.arrivalDate}
                    className="h-9 rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] font-medium text-[#3c4053] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    +{hours} ч
                  </button>
                ))}
              </div>
              <p className="text-[12px] leading-[1.5] text-[#9b9fb3]">
                Кнопки отсчитывают срок от даты и времени поступления
                {draftRow.arrivalDate
                  ? ` (${draftRow.arrivalDate}${draftRow.arrivalTime ? ` ${draftRow.arrivalTime}` : ""})`
                  : ": сначала укажите дату поступления"}
                .
              </p>
            </div>

            {/* Дата и время фактической реализации */}
            <div className={`space-y-2${isColumnVisible("sale") ? "" : " hidden"}`}>
              <Label className="text-[13px] font-medium text-[#3c4053]">
                {columnLabel("sale", "Дата и время фактической реализации")}
              </Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
                <Input
                  type="date"
                  className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  value={draftRow.actualSaleDate}
                  onChange={(e) =>
                    setDraftRow((prev) => ({
                      ...prev,
                      actualSaleDate: e.target.value,
                    }))
                  }
                />
                <Select
                  value={saleHM.h}
                  onValueChange={(value) =>
                    setDraftRow((prev) => ({
                      ...prev,
                      actualSaleTime: mergeHM(value, saleHM.m),
                    }))
                  }
                >
                  <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                    <SelectValue placeholder="Час" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={padTwo(i)}>
                        {padTwo(i)} ч
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={saleHM.m}
                  onValueChange={(value) =>
                    setDraftRow((prev) => ({
                      ...prev,
                      actualSaleTime: mergeHM(saleHM.h, value),
                    }))
                  }
                >
                  <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                    <SelectValue placeholder="Мин" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 60 }, (_, i) => (
                      <SelectItem key={i} value={padTwo(i)}>
                        {padTwo(i)} мин
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Должность + Сотрудник side-by-side */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">
                  Должность ответственного
                </Label>
                <Select
                  value={draftPosition}
                  onValueChange={draftCascade.handlePositionChange}
                >
                  <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                    <SelectValue placeholder="— выберите должность —" />
                  </SelectTrigger>
                  <SelectContent>
                    <PositionSelectItems users={users} />
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">
                  Сотрудник
                </Label>
                <Select
                  value={toNone(draftUserId)}
                  onValueChange={(value) => setDraftUserId(fromNone(value))}
                  open={draftCascade.employeeOpen}
                  onOpenChange={draftCascade.setEmployeeOpen}
                >
                  <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                    <SelectValue placeholder="— выберите —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>— выберите —</SelectItem>
                    {draftCascade.candidates.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Примечание */}
            <div className={`space-y-2${isColumnVisible("note") ? "" : " hidden"}`}>
              <Label className="text-[13px] font-medium text-[#3c4053]">
                {columnLabel("note", "Примечание")}
              </Label>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                value={draftRow.note}
                onChange={(e) =>
                  setDraftRow((prev) => ({ ...prev, note: e.target.value }))
                }
              />
            </div>

            {/* Свои колонки организации — и в окне строки: на телефоне
                карточка открывает именно это окно. */}
            {customColumns.map(({ column, custom }) => (
              <div key={column.key} className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">
                  {column.label}
                  {column.mustFill ? <span className="ml-1 text-[#a13a32]">*</span> : null}
                </Label>
                <JournalCustomCell
                  column={custom}
                  value={customCellValue(draftRow, column.key)}
                  onChange={(value) =>
                    setDraftRow((prev) => ({ ...prev, custom: withCustomCell(prev, column.key, value) }))
                  }
                  mustFill={column.mustFill}
                  employees={employeeNames}
                  className="h-9 rounded-xl border border-[#dcdfed] px-3.5 text-[13.5px]"
                />
              </div>
            ))}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff] sm:w-auto"
              onClick={closeRowModal}
            >
              Отмена
            </Button>
            <Button
              type="button"
              className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
              onClick={() => {
                void saveDraftRow();
              }}
              disabled={isSaving}
            >
              {isSaving
                ? "Сохранение…"
                : editingRowId
                  ? "Сохранить"
                  : "Добавить запись"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* «Добавить списком» — многострочная вставка вместо window.prompt. */}
      <CommissionDialog
        code="perishable_rejection"
        open={commissionOpen}
        onClose={() => setCommissionOpen(false)}
        onSaved={(members) => {
          setConfig((prev) => ({ ...prev, commissionMembers: members }));
          router.refresh();
        }}
      />
      <Dialog open={readOnly ? false : bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              Добавить изделия списком
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 px-6 py-5">
            <p className="text-[13px] leading-[1.55] text-[#6f7282]">
              Вставьте наименования изделий — каждое с новой строки. Для каждой строки
              создастся запись с текущей датой и временем поступления.
            </p>
            <Textarea
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
              placeholder={"Молоко 3,2%\nТворог 9%\nСметана 20%"}
              className="min-h-[180px] rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <div className="text-[12px] text-[#9b9fb3]">
              Будет добавлено строк:{" "}
              {bulkText.split("\n").map((item) => item.trim()).filter(Boolean).length}
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none transition-colors hover:bg-[#fafbff] sm:w-auto"
              onClick={() => setBulkOpen(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] sm:w-auto"
              onClick={addRowsFromText}
              disabled={
                bulkText.split("\n").map((item) => item.trim()).filter(Boolean).length === 0
              }
            >
              Добавить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Lists Dialog */}
      <Dialog open={readOnly ? false : listModalOpen} onOpenChange={setListModalOpen}>
        <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              Редактировать списки
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 px-6 py-5">
            {/* Section tabs */}
            <div className="flex gap-2 border-b pb-2">
              {(
                [
                  ["products", "Изделия"],
                  ["manufacturers", "Изготовители"],
                  ["suppliers", "Поставщики"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`rounded-t-md px-4 py-2 text-sm font-medium ${
                    activeListSection === key
                      ? "bg-[#5566f6] text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                  onClick={() => {
                    setActiveListSection(key);
                    setNewItemName("");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Products section */}
            {activeListSection === "products" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Списки изделий</Label>
                  {config.productLists.map((list) => (
                    <div
                      key={list.id}
                      className="flex items-center gap-2 rounded-lg border p-2"
                    >
                      <Checkbox
                        checked={activeListId === list.id}
                        onCheckedChange={(v) =>
                          setActiveListId(v === true ? list.id : "")
                        }
                      />
                      <Input
                        value={list.name}
                        onChange={(e) =>
                          applyConfig((prev) => ({
                            ...prev,
                            productLists: prev.productLists.map((x) =>
                              x.id === list.id
                                ? { ...x, name: e.target.value }
                                : x
                            ),
                          }))
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          applyConfig((prev) => ({
                            ...prev,
                            productLists: prev.productLists.filter(
                              (x) => x.id !== list.id
                            ),
                          }))
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      placeholder="Введите название нового списка"
                    />
                    <Button onClick={addProductList}>
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Изделия</Label>
                  {(() => {
                    const activeList = config.productLists.find(
                      (l) => l.id === activeListId
                    );
                    if (activeList) {
                      return Array.from(new Set(activeList.items)).map(
                        (item) => (
                          <div
                            key={item}
                            className="flex items-center gap-2 rounded-lg border p-2"
                          >
                            <div className="flex-1">{item}</div>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() =>
                                applyConfig((prev) => ({
                                  ...prev,
                                  productLists: prev.productLists.map((list) =>
                                    list.id === activeListId
                                      ? {
                                          ...list,
                                          items: list.items.filter(
                                            (x) => x !== item
                                          ),
                                        }
                                      : list
                                  ),
                                }))
                              }
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        )
                      );
                    }
                    return Array.from(new Set(productOptions)).map((item) => (
                      <div
                        key={item}
                        className="flex items-center gap-2 rounded-lg border p-2"
                      >
                        <div className="flex-1">{item}</div>
                        {activeListId && (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => addItemToProductList(item)}
                          >
                            <Plus className="size-4" />
                          </Button>
                        )}
                      </div>
                    ));
                  })()}
                  <div className="flex gap-2">
                    <Input
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      placeholder="Введите название нового изделия"
                    />
                    <Button onClick={addProductItem}>
                      <Plus className="size-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <button
                      type="button"
                      className="text-[#5566f6] underline"
                      onClick={() => void importItemsFromText("products")}
                    >
                      Добавить из файла
                    </button>
                    <button
                      type="button"
                      className="text-[#3848c7] underline"
                      onClick={() => setDirectoryKind("product")}
                    >
                      Из справочника организации
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Manufacturers section */}
            {activeListSection === "manufacturers" && (
              <div className="space-y-2">
                <Label>Изготовители</Label>
                {Array.from(new Set(config.manufacturers)).map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-2 rounded-lg border p-2"
                  >
                    <div className="flex-1">{item}</div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        applyConfig((prev) => ({
                          ...prev,
                          manufacturers: prev.manufacturers.filter(
                            (x) => x !== item
                          ),
                        }))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder="Введите название изготовителя"
                  />
                  <Button onClick={addManufacturerItem}>
                    <Plus className="size-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <button
                    type="button"
                    className="text-[#5566f6] underline"
                    onClick={() => void importItemsFromText("manufacturers")}
                  >
                    Добавить из файла
                  </button>
                  <button
                    type="button"
                    className="text-[#3848c7] underline"
                    onClick={() => setDirectoryKind("manufacturer")}
                  >
                    Из справочника организации
                  </button>
                </div>
              </div>
            )}

            {/* Suppliers section */}
            {activeListSection === "suppliers" && (
              <div className="space-y-2">
                <Label>Поставщики</Label>
                {Array.from(new Set(config.suppliers)).map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-2 rounded-lg border p-2"
                  >
                    <div className="flex-1">{item}</div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        applyConfig((prev) => ({
                          ...prev,
                          suppliers: prev.suppliers.filter((x) => x !== item),
                        }))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder="Введите название поставщика"
                  />
                  <Button onClick={addSupplierItem}>
                    <Plus className="size-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <button
                    type="button"
                    className="text-[#5566f6] underline"
                    onClick={() => void importItemsFromText("suppliers")}
                  >
                    Добавить из файла
                  </button>
                  <button
                    type="button"
                    className="text-[#3848c7] underline"
                    onClick={() => setDirectoryKind("supplier")}
                  >
                    Из справочника организации
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={() => {
                  setListModalOpen(false);
                  flushConfigSave();
                }}
              >
                Закрыть
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Общий справочник организации — один диалог на все три раздела. */}
      <OrgDirectoryDialog
        open={directoryKind !== null}
        onClose={() => setDirectoryKind(null)}
        kind={directoryKind ?? "product"}
        existing={
          directoryKind === "manufacturer"
            ? config.manufacturers
            : directoryKind === "supplier"
              ? config.suppliers
              : config.productLists[0]?.items ?? []
        }
        onAdd={(items) =>
          addItemsToSection(
            directoryKind === "manufacturer"
              ? "manufacturers"
              : directoryKind === "supplier"
                ? "suppliers"
                : "products",
            items
          )
        }
      />

      {/* Настройки журнала — название документа и дата начала. */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              Настройки документа
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Название документа</Label>
              <Input
                value={settingsTitle}
                onChange={(event) => setSettingsTitle(event.target.value)}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Дата начала</Label>
              <Input
                type="date"
                value={settingsDateFrom}
                onChange={(event) => setSettingsDateFrom(event.target.value)}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              />
            </div>
            <JournalColumnsSettings
              code="perishable_rejection"
              config={config as unknown as Record<string, unknown>}
              canApplyToAll={canManageColumns}
              onChange={(next) => applyConfig((prev) => withColumns(prev, next), true)}
              onApplyToAll={(next) => {
                setSettingsOpen(false);
                headerMenu.openApplyToAll(next);
              }}
            />
            <div className="flex justify-end">
              <Button
                type="button"
                disabled={settingsSaving}
                onClick={() => void saveDocumentSettings()}
                className="h-10 rounded-xl bg-[#5566f6] px-6 text-[13.5px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
              >
                {settingsSaving ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
