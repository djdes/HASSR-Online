"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import {
  perishableColumn,
  perishableCell,
  perishableCloseBlocker,
  perishableCommissionStatus,
  perishableDateTime,
  perishableHasCommission,
  perishableTitle,
  perishableSignatureLines,
  perishableTodaySignatures,
  type PerishableTranslator,
} from "./perishable-rejection-presentation";
import { useRouter } from "next/navigation";
import { Archive, Check, ChevronDown, List, ListPlus, Plus, Trash2, Users } from "lucide-react";
import { RecognizeFromPhoto } from "@/components/ai/recognize-from-photo";
import { ApplyToSelectedDialog, type ApplyToSelectedField } from "@/components/journals/apply-to-selected-dialog";
import {
  SelectionApplyButton,
  SelectionEditButton,
  SelectionRepeatButton,
  SelectionSignButton,
} from "@/components/journals/selection-edit-button";
import { CommissionDialog } from "@/components/journals/commission-dialog";
import { commissionRoleLabel, isCommissionMember, shortPersonName, todaySignatureSummary } from "@/lib/brakerage-commission";
import { readLocalizedApiError } from "@/lib/localized-api-error";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
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
  JOURNAL_TABLE_SCROLL_CLASS,
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
  formatPerishableResponsible,
  normalizePerishableRejectionConfig,
  PERISHABLE_EXPIRY_PRESET_HOURS,
  PERISHABLE_ORGANOLEPTIC_VALUES,
  type PerishableRejectionConfig,
  type PerishableRejectionRow,
} from "@/lib/perishable-rejection-document";
import { useLiveEvents } from "@/lib/use-live-events";
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
import type { VisionFieldKey, VisionRawItem } from "@/lib/ai-vision/shared";

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
  /**
   * Кто открыл документ. Член бракеражной комиссии документа подписывает
   * выделенные записи («Подписать»), остальные видят статус подписей.
   */
  currentUserId?: string | null;
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
 * Заголовок графы бланка бракеража.
 *
 * Форма приложения № 5 СанПиН — 13 граф с дословными длинными подписями
 * («продовольственного», «ветеринарно-санитарной»). Переносим по словам,
 * длинное слово — по слогам (`hyphens-auto`, страница `lang="ru"`);
 * `overflow-wrap: break-word` — только последний запас, чтобы слово не
 * вылезало за рамку, если браузер не умеет переносить по-русски. Шрифт 11px
 * (было 11.5px на 11 графах).
 */
const HEAD_CELL_CLASS = `${GRID_HEAD_CELL_CLASS} px-1.5 py-1.5 text-[11px] font-semibold leading-[1.25] hyphens-auto [overflow-wrap:break-word] [word-break:normal]`;

/** Короткие подписи граф в карточке на телефоне (если своей подписи нет). */
function cardLabels(t: PerishableTranslator): Record<string, string> { return {
  packaging: t("fields.packaging"),
  productionDate: t("fields.productionDate"),
  manufacturer: t("fields.manufacturer"),
  supplier: t("fields.supplier"),
  quantity: t("cards.quantity"),
  document: t("cards.document"),
  organoleptic: t("cards.organoleptic"),
  storage: t("cards.storage"),
  sale: t("cards.sale"),
  responsible: t("cards.responsible"),
  note: t("fields.note"),
}; }

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
 * Нужна там, где в графе живут ДВА поля строки («Условия хранения,
 * конечный срок реализации», дата и час), значение — код, а не текст
 * (органолептика), или показ отличается от записанного: у старых строк
 * графа «Изготовитель» / «Фасовка» показывается без склеенного хвоста
 * «␠/␠поставщик» (`perishableCellText`). Правка на месте писала всю
 * склейку в одно поле: данные портились и удлинялись с каждым заходом, а
 * органолептика молча становилась «Соответствует» при любом написании,
 * кроме «не соответ».
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
  const t = useTranslations("perishableRejection");
  const text = value.trim();
  // `break-words`: в узких графах формы (13 граф) длинное слово
  // («птицефабрика»», «пластиковый») переносится, а не вылезает за рамку.
  if (disabled) {
    return (
      <div className="min-h-7 break-words px-1.5 py-[5px] text-[12.5px] leading-[1.35] text-[#0b1024]">
        {text}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title={t("actions.openRow")}
      className="block min-h-7 w-full break-words rounded-md px-1.5 py-[5px] text-left text-[12.5px] leading-[1.35] text-[#0b1024] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
    >
      {text || <span className="text-[#9b9fb3]">—</span>}
    </button>
  );
}

/**
 * Пилюля статуса подписи комиссии под записью (и в карточке на телефоне):
 * янтарная «Ждёт подписи комиссии» или зелёная «Подписано: …». Только экран —
 * в печати подписи идут блоком под таблицей.
 */
function CommissionStatusChip({ status, compact = false }: { status: { signed: boolean; text: string }; compact?: boolean }) {
  return (
    <span
      data-testid="perishable-commission-status"
      data-signed={status.signed ? "1" : "0"}
      className={`${compact ? "" : "mt-1 "}inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium leading-[1.35] break-words print:hidden ${
        status.signed ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#fff8eb] text-[#9a5b00]"
      }`}
    >
      {status.text}
    </span>
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
  currentUserId = null,
}: Props) {
  const router = useRouter();
  const t = useTranslations("perishableRejection");
  const commissionT = useTranslations("journalControls.commissionDialog");
  const locale = useLocale() as Locale;
  const currentTranslations = useRef(t);
  useEffect(() => { currentTranslations.current = t; }, [t]);
  const CARD_LABELS = cardLabels(t);
  const storageOptions = (["2_6", "minus18", "minus2_2"] as const).map(value => ({ value, label: t(`storage.${value}`) }));
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
  const columnsView = useMemo(() => resolveColumns("perishable_rejection", config).map(column => perishableColumn(column, config, t)), [config, t]);
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
    return column && Object.hasOwn(config.columns?.labels ?? {}, key) ? column.label : fallback;
  };
  const withColumns = (base: PerishableRejectionConfig, next: JournalColumnsConfig): PerishableRejectionConfig => ({
    ...base,
    columns: next,
    showNote: legacyFlagsFromColumns("perishable_rejection", next).showNote !== false,
  });
  const readOnly = status === "closed";
  /** Окно «Комиссия» (состав организации, копия в активные документы). */
  const [commissionOpen, setCommissionOpen] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  // Комиссия действует только с меткой сервера — нормализатор конфига
  // отдаёт старую копию состава без метки пустой.
  const withCommission = perishableHasCommission(config);
  const canSign = !readOnly && isCommissionMember(config, currentUserId);
  const commissionRoleLabels = { chair: commissionT("chair"), member: commissionT("member") };
  // «Настройки журнала» — название документа и дата начала. Раньше их
  // можно было изменить только со страницы списка; теперь доступны из «⋯».
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTitle, setSettingsTitle] = useState(title);
  const [settingsDateFrom, setSettingsDateFrom] = useState(dateFrom);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const closeAction = useDocumentCloseAction({
    documentId,
    title: settingsTitle,
    // Записи без подписи комиссии — журнал не закончить (сервер тоже откажет).
    blocker: () => perishableCloseBlocker(config, t),
  });

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
      toast.error(currentTranslations.current("errors.settings"));
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
    subtitle: perishableDateTime(row.arrivalDate, row.arrivalTime, locale) || undefined,
    onClick: readOnly ? undefined : () => openEditRow(row),
    leading: !readOnly ? (
      <Checkbox
        aria-label={t("actions.selectRow", { number: index + 1 })}
        checked={selectedRows.includes(row.id)}
        onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
        className="size-5"
      />
    ) : null,
    // Графы — в порядке таблицы (форма приложения № 5 или свой набор),
    // текст — тот же, что в таблице и печати (`perishableCellText`).
    // Дата поступления и наименование — уже в заголовке карточки. Свои
    // колонки организации — тоже здесь, иначе с телефона их не видно.
    fields: visibleColumnsView
      .filter((column) => column.key !== "arrival" && column.key !== "product")
      .map((column) => ({
        label: column.custom ? column.label : columnLabel(column.key, CARD_LABELS[column.key] ?? column.label),
        value: column.custom ? customCellValue(row, column.key) : perishableCell(row, column.key, locale, t),
        hideIfEmpty: true,
      })),
    // Статус подписи комиссии — на телефоне тоже видно, что запись ждёт.
    badge: withCommission ? <CommissionStatusChip status={perishableCommissionStatus(row, t)} compact /> : undefined,
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
        toast.error(currentTranslations.current("errors.save"));
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

  /**
   * «Подписать» в полосе выделения: член комиссии подписывает выделенные
   * записи своей подписью (метод «вход в кабинет») с их текущей оценкой.
   * Сначала дописываем свои несохранённые правки — подписывается то, что
   * на сервере.
   */
  async function signSelectedRows() {
    if (!canSign || selectedRows.length === 0) return;
    setIsSigning(true);
    try {
      flushConfigSave();
      for (let i = 0; i < 50 && inFlightRef.current > 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const response = await fetch(`/api/journal-documents/${documentId}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: selectedRows.map((rowId) => ({ rowId })) }),
      });
      const errorResponse = response.clone();
      const body = (await response.json().catch(() => null)) as { signed?: number; config?: unknown } | null;
      if (!response.ok) throw new Error(await readLocalizedApiError(errorResponse, locale, t("commission.signFailed")));
      if (body?.config) {
        const fresh = normalizePerishableRejectionConfig(body.config);
        for (const row of fresh.rows) knownRowIdsRef.current.add(row.id);
        setConfig((prev) => ({ ...prev, rows: fresh.rows }));
      }
      setSelectedRows([]);
      toast.success(t("commission.signedRows", { count: body?.signed ?? selectedRows.length }));
    } catch (error) {
      toast.error(humanizeFetchError(error, t("commission.signFailed"), t("commission.network")));
    } finally {
      setIsSigning(false);
    }
  }

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
    const text = (field: "productName" | "documentNumber" | "responsiblePerson" | "note") => (
      <JournalCellInput
        value={row[field]}
        onChange={(e) => updateRow(row.id, { [field]: e.target.value } as Partial<PerishableRejectionRow>)}
        onBlur={flushConfigSave}
        disabled={readOnly}
      />
    );
    switch (column.key) {
      case "product":
        return text("productName");
      case "document":
        return text("documentNumber");
      case "responsible":
        return text("responsiblePerson");
      case "note":
        return text("note");
      // Даты — только через окно строки (там поле даты): свободный ввод
      // делился по пробелу и молча портил поля, а «2026-09-22» в узкой графе
      // рвался по дефису; показ — «22.09.2026», как в печати. Изготовитель /
      // поставщик и фасовка / количество — отдельные графы формы; правятся в
      // окне строки, где у них списки организации (мастер-кабинет, справочник).
      case "arrival":
      case "productionDate":
      case "packaging":
      case "manufacturer":
      case "supplier":
      case "quantity":
      case "organoleptic":
      case "storage":
      case "sale":
        return opens(perishableCell(row, column.key, locale, t));
      default:
        return null;
    }
  }

  const headerEdit = useJournalHeaderEdit();
  const canManageColumns = headerEdit?.canEditDocument === true;
  // ПКМ / долгое нажатие по заголовку колонки: переименовать, скрыть,
  // применить ко всем документам. Набор документа сохраняется сразу.
  const headerMenu = useColumnHeaderMenu({
    presentColumn: column => perishableColumn(column, config, t),
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
    // Записи ждут подписи комиссии — окно объяснит, почему закончить нельзя;
    // дату закрытия в шапку тогда не ставим.
    if (!perishableCloseBlocker(config, t)) {
      applyConfig((prev) => ({ ...prev, finishedAt: localDayKey() }), true);
    }
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
    { key: "arrivalDate", label: t("fields.arrivalDate"), type: "date" },
    { key: "arrivalTime", label: t("fields.arrivalTime"), type: "time" },
    { key: "manufacturer", label: t("fields.manufacturer"), type: "text", suggestions: manufacturerOptions },
    { key: "supplier", label: t("fields.supplier"), type: "text", suggestions: supplierOptions },
    { key: "organolepticResult", label: t("fields.organoleptic"), type: "select", options: PERISHABLE_ORGANOLEPTIC_VALUES.map((value) => ({ value, label: t(`organoleptic.${value}`) })) },
    { key: "storageCondition", label: t("fields.storage"), type: "select", options: storageOptions },
    { key: "actualSaleDate", label: t("fields.saleDate"), type: "date" },
    { key: "actualSaleTime", label: t("fields.saleTime"), type: "time" },
    { key: "responsiblePerson", label: t("fields.responsible"), type: "text" },
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
    toast.success(t("bulk.changed", { count: selectedRows.length }));
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
    toast.success(copies.length > 1 ? t("bulk.copied", { count: copies.length }) : t("bulk.repeated", { name: copies[0]?.productName || t("bulk.row") }));
  }

  async function removeSelectedRows() {
    if (readOnly) return;
    if (selectedRows.length === 0) return;
    const names = config.rows
      .filter((row) => selectedRows.includes(row.id))
      .map((row) => row.productName)
      .filter(Boolean);
    const confirmed = await confirmAsync({
      locale,
      title: t("bulk.deleteTitle"),
      description: t("bulk.deleteDescription"),
      variant: "danger",
      confirmLabel: t("actions.delete"),
      bullets: [
        { label: t("bulk.deleteCount", { count: selectedRows.length }), tone: "warn" },
        names.length > 0
          ? {
              label: t(names.length > 4 ? "bulk.productsMore" : "bulk.products", { names: names.slice(0, 4).join(", ") }),
              tone: "info" as const,
            }
          : { label: t("bulk.unnamed"), tone: "info" as const },
        {
          label: t("bulk.remaining", { count: config.rows.length - selectedRows.length }),
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
      locale,
      title: t("actions.addSeveral"),
      description:
        t("bulk.description"),
      label: t("bulk.count"),
      type: "number",
      defaultValue: "3",
      placeholder: "3",
      confirmLabel: t("actions.add"),
      validate: (value) => {
        const count = Number(value);
        if (!value.trim()) return currentTranslations.current("bulk.enterNumber");
        if (!Number.isInteger(count) || count <= 0) return currentTranslations.current("bulk.positiveInteger");
        if (count > BULK_ROWS_MAX)
          return currentTranslations.current("bulk.limit", { count: BULK_ROWS_MAX });
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
    toast.success(currentTranslations.current("bulk.added", { count: items.length }));
  }

  /** Поля сырья с фото — только те, чьи графы видны в журнале. */
  const photoRawFields: Array<VisionFieldKey & keyof VisionRawItem> = [
    "name",
    ...(isColumnVisible("manufacturer") ? (["manufacturer"] as const) : []),
    ...(isColumnVisible("supplier") ? (["supplier"] as const) : []),
    ...(isColumnVisible("quantity") ? (["quantity"] as const) : []),
    ...(isColumnVisible("productionDate") ? (["productionDate"] as const) : []),
    ...(isColumnVisible("storage") ? (["expiryDate"] as const) : []),
  ];

  /**
   * «С фото» в «Добавить списком»: распознанное сырьё сразу строками журнала —
   * с изготовителем, поставщиком, количеством и сроками; поступление — сейчас.
   */
  function addRowsFromPhoto(items: VisionRawItem[]) {
    if (readOnly || items.length === 0) return { added: 0 };
    const arrivalDate = nowDate();
    const arrivalTime = mergeHM(nowHour(), nowMinute());
    const rows = items.map((item) =>
      createPerishableRejectionRow({
        productName: item.name,
        manufacturer: item.manufacturer,
        supplier: item.supplier,
        quantity: item.quantity,
        productionDate: item.productionDate,
        expiryDate: item.expiryDate,
        arrivalDate,
        arrivalTime,
        organolepticResult: "compliant",
        storageCondition: "2_6",
        responsiblePerson: defaultResponsibleName,
      })
    );
    applyConfig((prev) => ({ ...prev, rows: [...prev.rows, ...rows] }), true);
    void productSuggestions.remember(items.map((item) => item.name));
    setBulkText("");
    setBulkOpen(false);
    return { added: rows.length };
  }

  /** «С фото» в «Редактировать списки»: изделия, изготовители и поставщики — в списки документа. */
  function addListsFromPhoto(items: VisionRawItem[]) {
    if (readOnly || items.length === 0) return { added: 0 };
    const list = config.productLists[0];
    const names = items.map((item) => item.name);
    const before = list ? list.items.length : 0;
    const merged = list ? mergeIntoList(list.items, names) : [];
    addItemsToSection("products", names);
    addItemsToSection("manufacturers", items.map((item) => item.manufacturer).filter(Boolean));
    addItemsToSection("suppliers", items.map((item) => item.supplier).filter(Boolean));
    const added = merged.length - before;
    return { added, skipped: names.length - added };
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
    const text = await promptAsync({
      locale,
      title: t(`import.${section}`),
      description:
        t("import.description"),
      label: t("import.label"),
      placeholder: t("import.placeholder"),
      confirmLabel: t("import.confirm"),
      validate: (value) => (value.trim() ? null : currentTranslations.current("import.required")),
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
      toast.error(t("errors.arrival"));
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
   * Ширины граф бланка бракеража (P8).
   *
   * Веса, а не готовые проценты: скрытая графа или своя колонка просто
   * выпадает из массива / добавляется в него, и сетка пересчитывается
   * сама — как в `finished-product-document-client.tsx`. Сумма ВСЕГДА
   * равна 100% вместе с колонкой чекбокса, поэтому `table-fixed` не
   * раздувает таблицу шире бумажного полотна.
   *
   * Порядок весов = порядок `<th>` ниже = набор колонок документа (форма
   * приложения № 5: 13 граф, веса — в реестре `journal-columns.ts`).
   */
  const columnWeights = visibleColumnsView.map((column) => column.weight);
  const columnWeightsTotal = columnWeights.reduce((sum, weight) => sum + weight, 0);
  const columnWidths = columnWeights.map(
    (weight) =>
      `${((weight / columnWeightsTotal) * (100 - CHECKBOX_COL_PERCENT)).toFixed(3)}%`
  );
  /**
   * Подписи комиссии — блоком под таблицей (в форме приложения № 5 для них
   * нет графы; так же в печати). Документ с действующей комиссией — «Подписи
   * бракеражной комиссии», без неё — подписи прежней формы журнала.
   */
  const legacySignatureLines = useMemo(() => perishableSignatureLines(config.rows, locale, t), [config.rows, locale, t]);
  /** Колонка, под ячейкой которой показываем статус подписи: наименование или первая видимая. */
  const statusColumnKey = visibleColumnsView.some((column) => column.key === "product") ? "product" : visibleColumnsView[0]?.key;
  const todaySummary = withCommission && todayKey ? todaySignatureSummary(config, todayKey) : null;
  const commissionLine = config.commissionMembers
    .map((member) => `${shortPersonName(member.employeeName)} (${commissionRoleLabel(member, commissionRoleLabels)})`)
    .join(", ");

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
        heading={<h1 className={DOC_HEADING_CLASS}>{perishableTitle(settingsTitle, settingsDateFrom, locale, t)}</h1>}
        onSettings={!readOnly ? () => setSettingsOpen(true) : undefined}
        menuItems={
          !readOnly
            ? [
                {
                  key: "close-journal",
                  label: t("actions.finish"),
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
          <JournalClosedBanner hint={t("actions.closedHint")} documentId={documentId} />
        </div>
      ) : (
        <div className="mb-4 print:hidden">
          <TodayStripForJournal
            journalCode="perishable_rejection"
            todayCount={
              config.rows.filter((row) => row.arrivalDate === todayKey).length
            }
            label={t("actions.today")}
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
        {/* Своя рамка прокрутки: на 360px шапка была шире экрана на
            96px, и «Начат…/СТР. 1 ИЗ 1» обрезались без прокрутки. */}
        <div
          className={`${JOURNAL_TABLE_SCROLL_CLASS} print:overflow-visible ${
            mobileView === "cards" ? "max-sm:hidden print:block" : ""
          }`}
        >
        <table
          className={`${DOC_PAPER_HEADER_CLASS} w-full border-collapse text-[13px]`}
        >
          <tbody>
            <JournalPaperHeaderRows
              orgName={organizationName}
              title={t("title")}
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
          {t("title")}</h2>

        {/* Action buttons */}
        <div className={DOC_ADD_ROW_CLASS}>
          {!readOnly && (
            <ResponsiveMenu
              title={t("actions.add")}
              align="start"
              items={[
                {
                  key: "add-product",
                  label: t("actions.addProduct"),
                  icon: <Plus className="size-4 text-[#6f7282]" />,
                  onSelect: () => openAddRow(),
                },
                {
                  key: "add-several",
                  label: t("actions.addSeveral"),
                  icon: <Plus className="size-4 text-[#6f7282]" />,
                  onSelect: () => void addSeveralRows(),
                },
                {
                  key: "add-from-list",
                  label: t("actions.fromList"),
                  icon: <List className="size-4 text-[#6f7282]" />,
                  onSelect: addRowsFromList,
                },
                {
                  key: "add-bulk-list",
                  label: t("actions.pasteList"),
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
                  {t("actions.add")}<ChevronDown className="size-4" />
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
              {t("actions.addRow")}</Button>
          )}
          <Button
            type="button"
            variant="outline"
            className={DOC_SECONDARY_BUTTON_CLASS}
            onClick={() => setListModalOpen(true)}
            disabled={readOnly}
          >
            {t("actions.editLists")}</Button>
          {/* Бракеражная комиссия: состав организации, копия — в активные документы. */}
          {!readOnly ? (
            <Button
              type="button"
              variant="outline"
              className={DOC_SECONDARY_BUTTON_CLASS}
              onClick={() => setCommissionOpen(true)}
              data-testid="perishable-commission-button"
            >
              <Users className="size-4" />
              {t("commission.title")}{withCommission ? ` · ${config.commissionMembers.length}` : ""}
            </Button>
          ) : null}
          {/* Кнопки «Сохранить» нет: правки уезжают сами (см. applyConfig). */}
          {isSaving ? (
            <span className="text-[13px] text-[#6f7282]">{t("actions.saving")}</span>
          ) : null}
        </div>
        {withCommission ? (
          <p className="text-[13px] leading-snug text-[#3c4053] print:hidden" data-testid="perishable-commission-members">
            {t("commission.members", { names: commissionLine })}
          </p>
        ) : null}
        {todaySummary ? (
          <p
            data-testid="perishable-today-signatures"
            className={`rounded-2xl px-4 py-2.5 text-[13px] font-medium print:hidden ${
              todaySummary.waiting > 0 ? "bg-[#fff8eb] text-[#9a5b00]" : "bg-[#ecfdf5] text-[#116b2a]"
            }`}
          >
            {perishableTodaySignatures(todaySummary, canSign, t)}
          </p>
        ) : null}

        {!readOnly ? (
          <JournalSelectionBar
            count={selectedRows.length}
            onClear={() => setSelectedRows([])}
            onDelete={() => void removeSelectedRows()}
            hint={t("actions.selectionHint")}
          >
            <SelectionEditButton count={selectedRows.length} disabled={readOnly} onClick={() => seq.start(selectedRows)} />
            <SelectionApplyButton count={selectedRows.length} disabled={readOnly} onClick={() => setApplyOpen(true)} />
            <SelectionRepeatButton count={selectedRows.length} disabled={readOnly} onClick={() => repeatSelectedRows()} />
            {canSign ? <SelectionSignButton count={selectedRows.length} busy={isSigning} onClick={() => void signSelectedRows()} /> : null}
          </JournalSelectionBar>
        ) : null}
        <ApplyToSelectedDialog open={applyOpen} onOpenChange={setApplyOpen} count={selectedRows.length} fields={applyFields} onApply={applyToSelectedRows} />

        {/* View toggle */}

        {/* Карточки — только на телефоне. Раньше обёртки `sm:hidden` не
            было, и на десктопе «Записей пока нет.» висело над таблицей. */}
        {mobileView === "cards" ? (
          <div className="sm:hidden print:hidden">
            <RecordCardsView items={cardItems} emptyLabel={t("actions.empty")} />
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
              её. На десктопе таблица ровно по полотну (правая рамка видна),
              на узких экранах остаётся скролл внутри viewport'а.

              Форма приложения № 5 (2026-09-26): 13 граф вместо 11, минимум
              1120px — иначе длинные слова шапки не помещались в графы. */}
          <table className="w-full min-w-[1120px] table-fixed border-collapse text-[12.5px]">
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
                    aria-label={t("actions.selectAll")}
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
                      <span className="text-[#d43a2f]" title={t("actions.required")}>
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
                    <Checkbox checked={false} disabled aria-label={t("actions.selectRow", { number: 1 })} />
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
              {config.rows.map((row, index) => (
                <tr key={row.id} data-focus-today={row.id === todayFocusRowId ? "" : undefined}>
                  <td className={`${GRID_CELL_CLASS} px-1 py-1 align-top leading-tight print:hidden`}>
                    <Checkbox
                      aria-label={t("actions.selectRow", { number: index + 1 })}
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
                      {/* Статус подписи комиссии — только на экране: в печати
                          подписи идут блоком под таблицей. */}
                      {withCommission && column.key === statusColumnKey ? (
                        <CommissionStatusChip status={perishableCommissionStatus(row, t)} />
                      ) : null}
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
                  «Дата и час, поступления» + «Наименование»: вместе они
                  опознают запись (когда и что поступило). Остальные
                  видимые графы — данные, пустые в новой строке:
                  trailing = видимых граф − 2. Сумма = число колонок таблицы. */}
              {!readOnly ? (
                <JournalAddRow
                  leading={1}
                  labelSpan={Math.min(2, Math.max(1, visibleColumnsView.length))}
                  trailing={Math.max(0, visibleColumnsView.length - 2)}
                  label={t("actions.addRow")}
                  onClick={() => openAddRow()}
                />
              ) : null}
            </tbody>
          </table>
        </MobileViewTableWrapper>
        {/* Подписи бракеражной комиссии: в форме приложения № 5 для них нет
            графы — блоком под таблицей (так же в печати). У документа без
            действующей комиссии — подписи прежней формы журнала. */}
        {legacySignatureLines.length > 0 ? (
          <div
            className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 print:rounded-none print:border-black print:bg-white"
            data-testid="perishable-signatures"
          >
            <div className="text-[13px] font-semibold text-[#0b1024]">
              {config.commissionEnabled ? t("signatures.commissionTitle") : t("signatures.title")}
            </div>
            <ul className="mt-1.5 space-y-1 text-[12.5px] leading-[1.45] text-[#3c4053]">
              {legacySignatureLines.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
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
              {editingRowId ? (seq.progress ? t("row.editProgress", { progress: seq.progress }) : t("row.edit")) : t("row.add")}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
            {/* Дата и время поступления */}
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">
                {t("fields.arrival")}</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
                <Input
                  type="date"
                  aria-label={t("fields.arrivalDate")}
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
                    <SelectValue placeholder={t("fields.hour")} />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={padTwo(i)}>
                        {t("fields.hourOption", { value: padTwo(i) })}
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
                    <SelectValue placeholder={t("fields.minute")} />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 60 }, (_, i) => (
                      <SelectItem key={i} value={padTwo(i)}>
                        {t("fields.minuteOption", { value: padTwo(i) })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Наименование изделия */}
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">
                {t("fields.product")}</Label>
              {/* Одно поле вместо «список + или введите новое»: варианты
                  открываются по стрелке, своё пишется прямо в поле. */}
              <SuggestInput
                ariaLabel={t("fields.product")}
                value={draftRow.productName}
                options={productOptions}
                placeholder={t("fields.productPlaceholder")}
                onChange={(next) =>
                  setDraftRow((prev) => ({ ...prev, productName: next }))
                }
              />
            </div>

            {/* Дата выработки */}
            <div className={`space-y-2${isColumnVisible("productionDate") ? "" : " hidden"}`}>
              <Label className="text-[13px] font-medium text-[#3c4053]">
                {columnLabel("productionDate", t("fields.productionDate"))}
              </Label>
              <Input
                type="date"
                aria-label={columnLabel("productionDate", t("fields.productionDate"))}
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
                {columnLabel("manufacturer", t("fields.manufacturer"))}
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
                  <SelectValue placeholder={t("fields.selectList")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{t("fields.selectList")}</SelectItem>
                  {manufacturerOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                placeholder={t("fields.manufacturerPlaceholder")}
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

            {/* Поставщик — своя графа формы приложения № 5 */}
            <div className={`space-y-2${isColumnVisible("supplier") ? "" : " hidden"}`}>
              <Label className="text-[13px] font-medium text-[#3c4053]">
                {columnLabel("supplier", t("fields.supplier"))}
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
                  <SelectValue placeholder={t("fields.selectList")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{t("fields.selectList")}</SelectItem>
                  {supplierOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                placeholder={t("fields.supplierPlaceholder")}
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

            {/* Фасовка + количество рядом — разные графы формы, у каждой
                своя видимость */}
            <div
              className={`grid grid-cols-1 gap-3 sm:grid-cols-2${
                isColumnVisible("packaging") || isColumnVisible("quantity") ? "" : " hidden"
              }`}
            >
              <div className={`space-y-2${isColumnVisible("packaging") ? "" : " hidden"}`}>
                <Label className="text-[13px] font-medium text-[#3c4053]">
                  {columnLabel("packaging", t("fields.packaging"))}
                </Label>
                <Input
                  className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  placeholder={t("fields.packagingPlaceholder")}
                  value={draftRow.packaging}
                  onChange={(e) =>
                    setDraftRow((prev) => ({
                      ...prev,
                      packaging: e.target.value,
                    }))
                  }
                />
              </div>
              <div className={`space-y-2${isColumnVisible("quantity") ? "" : " hidden"}`}>
                <Label className="text-[13px] font-medium text-[#3c4053]">
                  {columnLabel("quantity", t("fields.quantity"))}
                </Label>
                <Input
                  className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  placeholder={t("fields.quantityPlaceholder")}
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
                {columnLabel("document", t("fields.document"))}
              </Label>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                aria-label={columnLabel("document", t("fields.document"))}
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
                {t("fields.organoleptic")}</Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["compliant", t("organoleptic.compliant"), "#136b2a", "rgba(19,107,42,0.18)"],
                    ["non_compliant", t("organoleptic.non_compliant"), "#d2453d", "rgba(210,69,61,0.18)"],
                    ["good_quality", t("organoleptic.good_quality"), "#136b2a", "rgba(19,107,42,0.18)"],
                    ["poor_quality", t("organoleptic.poor_quality"), "#d2453d", "rgba(210,69,61,0.18)"],
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
                {columnLabel("storage", t("fields.storage"))}
              </Label>
              <div className="flex flex-col gap-2">
                {(
                  storageOptions.map(({ value, label }) => [value, label] as const)
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
                {t("expiry.label")}</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr]">
                <Input
                  type="date"
                  aria-label={t("expiry.label")}
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
                  aria-label={t("expiry.time")}
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
                    {t("expiry.preset", { hours })}
                  </button>
                ))}
              </div>
              <p className="text-[12px] leading-[1.5] text-[#9b9fb3]">
                {draftRow.arrivalDate ? t("expiry.hint", { arrival: perishableDateTime(draftRow.arrivalDate, draftRow.arrivalTime, locale) }) : t("expiry.missingHint")}
              </p>
            </div>

            {/* Дата и время фактической реализации */}
            <div className={`space-y-2${isColumnVisible("sale") ? "" : " hidden"}`}>
              <Label className="text-[13px] font-medium text-[#3c4053]">
                {columnLabel("sale", t("fields.sale"))}
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
                    <SelectValue placeholder={t("fields.hour")} />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={padTwo(i)}>
                        {t("fields.hourOption", { value: padTwo(i) })}
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
                    <SelectValue placeholder={t("fields.minute")} />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 60 }, (_, i) => (
                      <SelectItem key={i} value={padTwo(i)}>
                        {t("fields.minuteOption", { value: padTwo(i) })}
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
                  {t("fields.position")}</Label>
                <Select
                  value={draftPosition}
                  onValueChange={draftCascade.handlePositionChange}
                >
                  <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                    <SelectValue placeholder={t("fields.selectPosition")} />
                  </SelectTrigger>
                  <SelectContent>
                    <PositionSelectItems users={users} />
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">
                  {t("fields.employee")}</Label>
                <Select
                  value={toNone(draftUserId)}
                  onValueChange={(value) => setDraftUserId(fromNone(value))}
                  open={draftCascade.employeeOpen}
                  onOpenChange={draftCascade.setEmployeeOpen}
                >
                  <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                    <SelectValue placeholder={t("fields.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>{t("fields.select")}</SelectItem>
                    {draftCascade.candidates.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {isColumnVisible("responsible") ? (
              <p className="-mt-2 text-[12px] leading-[1.5] text-[#6f7282]">
                {t("fields.responsibleHint", { column: columnLabel("responsible", t("columns.responsible")) })}
              </p>
            ) : null}

            {/* Примечание — факты списания, возврата и т. п. */}
            <div className={`space-y-2${isColumnVisible("note") ? "" : " hidden"}`}>
              <Label className="text-[13px] font-medium text-[#3c4053]">
                {columnLabel("note", t("fields.note"))}
              </Label>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                placeholder={t("fields.notePlaceholder")}
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
              {t("actions.cancel")}</Button>
            <Button
              type="button"
              className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
              onClick={() => {
                void saveDraftRow();
              }}
              disabled={isSaving}
            >
              {isSaving
                ? t("actions.saving")
                : editingRowId
                  ? t("actions.save")
                  : t("actions.addRow")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* «Добавить списком» — многострочная вставка вместо window.prompt. */}
      <Dialog open={readOnly ? false : bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              {t("paste.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 px-6 py-5">
            <p className="text-[13px] leading-[1.55] text-[#6f7282]">
              {t("paste.description")}</p>
            <Textarea
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
              placeholder={t("paste.placeholder")}
              className="min-h-[180px] rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <RecognizeFromPhoto
                kind="raw"
                fields={photoRawFields}
                onItems={addRowsFromPhoto}
                resultLabel={t("paste.photoResult")}
                className="w-full sm:w-auto"
                testId="perishable-photo"
              />
              <div className="text-[12px] text-[#9b9fb3]">
                {t("paste.count", { count: bulkText.split("\n").map((item) => item.trim()).filter(Boolean).length })}
              </div>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none transition-colors hover:bg-[#fafbff] sm:w-auto"
              onClick={() => setBulkOpen(false)}
            >
              {t("actions.cancel")}</Button>
            <Button
              type="button"
              className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] sm:w-auto"
              onClick={addRowsFromText}
              disabled={
                bulkText.split("\n").map((item) => item.trim()).filter(Boolean).length === 0
              }
            >
              {t("actions.add")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Lists Dialog */}
      <Dialog open={readOnly ? false : listModalOpen} onOpenChange={setListModalOpen}>
        <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              {t("actions.editLists")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 px-6 py-5">
            {/* Section tabs */}
            <div className="flex gap-2 border-b pb-2">
              {(
                [
                  ["products", t("lists.products")],
                  ["manufacturers", t("lists.manufacturers")],
                  ["suppliers", t("lists.suppliers")],
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
                  <Label>{t("lists.productLists")}</Label>
                  {config.productLists.map((list) => (
                    <div
                      key={list.id}
                      className="flex items-center gap-2 rounded-lg border p-2"
                    >
                      <Checkbox
                        aria-label={t("lists.select", { name: list.name })}
                        checked={activeListId === list.id}
                        onCheckedChange={(v) =>
                          setActiveListId(v === true ? list.id : "")
                        }
                      />
                      <Input
                        aria-label={t("lists.rename")}
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
                        aria-label={t("lists.delete", { name: list.name })}
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
                      placeholder={t("lists.newList")}
                    />
                    <Button onClick={addProductList} aria-label={t("lists.addList")}>
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t("lists.products")}</Label>
                  {(() => {
                    const activeList = config.productLists.find(
                      (l) => l.id === activeListId
                    );
                    if (activeList) {
                      // Сырьё из мастер-кабинета справочников — с пометкой (правит бэк-офис).
                      const sharedKeys = new Set(
                        (config.sharedProducts ?? []).map((name) => name.trim().toLowerCase())
                      );
                      return Array.from(new Set(activeList.items)).map(
                        (item) => (
                          <div
                            key={item}
                            className="flex items-center gap-2 rounded-lg border p-2"
                          >
                            <div className="flex-1">{item}</div>
                            {sharedKeys.has(item.trim().toLowerCase()) ? (
                              <span
                                className="shrink-0 rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11px] font-medium text-[#3848c7]"
                                title={t("lists.masterHint")}
                              >
                                {t("lists.master")}</span>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              aria-label={t("lists.delete", { name: item })}
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
                            aria-label={t("lists.addItem")}
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
                      placeholder={t("lists.newProduct")}
                    />
                    <Button onClick={addProductItem} aria-label={t("lists.addItem")}>
                      <Plus className="size-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <button
                      type="button"
                      className="text-[#5566f6] underline"
                      onClick={() => void importItemsFromText("products")}
                    >
                      {t("lists.import")}</button>
                    <button
                      type="button"
                      className="text-[#3848c7] underline"
                      onClick={() => setDirectoryKind("product")}
                    >
                      {t("lists.fromOrganization")}</button>
                    <RecognizeFromPhoto
                      kind="raw"
                      fields={["name", "manufacturer", "supplier"]}
                      onItems={addListsFromPhoto}
                      resultLabel={t("lists.photoResult")}
                      hint={t("lists.photoHint")}
                      testId="perishable-lists-photo"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Manufacturers section */}
            {activeListSection === "manufacturers" && (
              <div className="space-y-2">
                <Label>{t("lists.manufacturers")}</Label>
                {Array.from(new Set(config.manufacturers)).map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-2 rounded-lg border p-2"
                  >
                    <div className="flex-1">{item}</div>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={t("lists.delete", { name: item })}
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
                    placeholder={t("lists.newManufacturer")}
                  />
                  <Button onClick={addManufacturerItem} aria-label={t("lists.addItem")}>
                    <Plus className="size-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <button
                    type="button"
                    className="text-[#5566f6] underline"
                    onClick={() => void importItemsFromText("manufacturers")}
                  >
                    {t("lists.import")}</button>
                  <button
                    type="button"
                    className="text-[#3848c7] underline"
                    onClick={() => setDirectoryKind("manufacturer")}
                  >
                    {t("lists.fromOrganization")}</button>
                </div>
              </div>
            )}

            {/* Suppliers section */}
            {activeListSection === "suppliers" && (
              <div className="space-y-2">
                <Label>{t("lists.suppliers")}</Label>
                {Array.from(new Set(config.suppliers)).map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-2 rounded-lg border p-2"
                  >
                    <div className="flex-1">{item}</div>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={t("lists.delete", { name: item })}
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
                    placeholder={t("lists.newSupplier")}
                  />
                  <Button onClick={addSupplierItem} aria-label={t("lists.addItem")}>
                    <Plus className="size-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <button
                    type="button"
                    className="text-[#5566f6] underline"
                    onClick={() => void importItemsFromText("suppliers")}
                  >
                    {t("lists.import")}</button>
                  <button
                    type="button"
                    className="text-[#3848c7] underline"
                    onClick={() => setDirectoryKind("supplier")}
                  >
                    {t("lists.fromOrganization")}</button>
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
                {t("actions.close")}</Button>
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

      {/* Бракеражная комиссия скоропорта: сервер копирует состав в активные
          документы и ставит метку `commissionEnabled`. */}
      <CommissionDialog
        code="perishable_rejection"
        open={commissionOpen}
        onClose={() => setCommissionOpen(false)}
        onSaved={(members) => {
          setConfig((prev) => ({ ...prev, commissionMembers: members, commissionEnabled: true }));
          router.refresh();
        }}
      />

      {/* Настройки журнала — название документа и дата начала. */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              {t("settings.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("settings.name")}</Label>
              <Input
                value={settingsTitle}
                onChange={(event) => setSettingsTitle(event.target.value)}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("settings.start")}</Label>
              <Input
                type="date"
                value={settingsDateFrom}
                onChange={(event) => setSettingsDateFrom(event.target.value)}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              />
            </div>
            <JournalColumnsSettings
              presentColumn={column => perishableColumn(column, config, t)}
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
                {settingsSaving ? t("actions.saving") : t("actions.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
