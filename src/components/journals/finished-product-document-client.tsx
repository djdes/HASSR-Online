"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Archive,
  ChevronDown,
  Database,
  ListPlus,
  Plus,
  Trash2,
  Check,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DocumentActionsBar } from "@/components/journals/document-actions-bar";
import {
  DOC_ADD_ROW_CLASS,
  DOC_BODY_STACK_CLASS,
  DOC_SECONDARY_BUTTON_CLASS,
  DOC_TITLE_ROW_NO_STRIP_CLASS,
  DOC_CAPS_TITLE_CLASS,
  DOC_EXTRA_BLOCK_CLASS,
  DOC_HEADING_CLASS,
  DOC_PAPER_CANVAS_CLASS,
  DOC_PAPER_HEADER_CARDS_HIDDEN_CLASS,
  DOC_PAPER_HEADER_CLASS,
  JOURNAL_DIALOG_CONTENT_WIDE_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
} from "@/components/journals/journal-responsive";
import { JournalCellInput } from "@/components/journals/journal-cell-input";
import { ApplyToSelectedDialog, type ApplyToSelectedField } from "@/components/journals/apply-to-selected-dialog";
import { SelectionApplyButton, SelectionEditButton, SelectionRepeatButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { SuggestInput } from "@/components/journals/suggest-input";
import { useNameSuggestions } from "@/components/journals/use-name-suggestions";
import { suggestionKey } from "@/lib/name-suggestions";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import {
  FINISHED_PRODUCT_ORGANOLEPTIC_DISH,
  FINISHED_PRODUCT_QUALITY_GUIDE_TITLE,
  FINISHED_PRODUCT_TIME_DEFAULTS,
  FINISHED_PRODUCT_TIME_MINUTES_MAX,
  createFinishedProductRow,
  finishedProductCellText,
  getFinishedProductOrganolepticOptions,
  normalizeFinishedProductDocumentConfig,
  type FinishedProductDocumentConfig,
  type FinishedProductDocumentRow,
  type FinishedProductTimeDefaults,
} from "@/lib/finished-product-document";
import { useDocumentCloseAction } from "@/components/journals/document-close-button";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  MobileViewToggle,
  MobileViewTableWrapper,
} from "@/components/journals/mobile-view-toggle";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";
import { JournalClosedBanner } from "@/components/journals/journal-closed-banner";
import { confirmAsync } from "@/components/ui/confirm-async";
import { promptAsync } from "@/components/ui/prompt-async";

import { toast } from "sonner";
import {
  GRID_CELL_CLASS,
  GRID_HEAD_CELL_CLASS,
  GRID_VIEWPORT_CLASS,
} from "@/components/journals/journal-grid";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { JournalPaperHeaderRows } from "@/components/journals/journal-document-header";
import { useTodayKey } from "@/lib/use-today-key";
import { TodayStripForJournal } from "@/components/journals/today-strip-for-journal";
import { localDayKey } from "@/lib/entry-defaults";
import {
  JournalColumnsSettings,
  useColumnHeaderMenu,
} from "@/components/journals/journal-columns-settings";
import { useJournalHeaderEdit } from "@/components/journals/journal-header-edit";
import {
  legacyFlagsFromColumns,
  resolveColumns,
  type JournalColumnsConfig,
  type JournalCustomColumn,
} from "@/lib/journal-columns";
import {
  JournalCustomCell,
  customCellValue,
  withCustomCell,
} from "@/components/journals/journal-custom-cell";
import { OrgDirectoryDialog } from "@/components/journals/org-directory-dialog";
import { mergeIntoList } from "@/lib/org-directory";
import { useLiveEvents } from "@/lib/use-live-events";
import { formatRowSignatures, hasCommission, normalizeRowSignatures } from "@/lib/brakerage-commission";
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
  dateTo: string;
  status: string;
  initialConfig: FinishedProductDocumentConfig;
  users: { id: string; name: string; role: string }[];
  /** Ответственный документа — «Ответственный исполнитель» новой строки. */
  responsibleUserId?: string | null;
  /** Проверяющий документа — «ФИО лица, проводившего бракераж». */
  verifierUserId?: string | null;
  /** Design v2 toggle. */
  useV2?: boolean;
};

/**
 * ЭКРАН = WeSetup (мягкие серые рамки `#ececf4`, шапка `#f8f9fc`),
 * ПЕЧАТЬ (Ctrl+P) = «бумага» для инспектора РПН/СЭС (чёрные рамки,
 * белая шапка). Поэтому каждый токен несёт пару screen + `print:`.
 */
/** Скруглённый viewport вокруг таблицы; в печати — прозрачный wrapper. */

/** Сколько строк максимум разрешаем добавить одной пачкой. */
const BULK_ROWS_MAX = 50;

/** Пауза до автосохранения после последнего нажатия клавиши в ячейке. */
const AUTOSAVE_DELAY_MS = 800;

const ORGANOLEPTIC_CUSTOM = "__custom__";

/** Текстовые поля строки — только они рендерятся колонками таблицы. */
type FinishedProductTextField =
  | "productionDateTime"
  | "rejectionTime"
  | "productName"
  | "organoleptic"
  | "productTemp"
  | "correctiveAction"
  | "oxygenLevel"
  | "releasePermissionTime"
  | "courierTransferTime"
  | "responsiblePerson"
  | "inspectorName"
  | "portionWeight"
  | "note";

/** Поле строки и справочник подсказок для каждой колонки реестра. */
const FINISHED_PRODUCT_COLUMN_FIELDS: Record<string, { field: FinishedProductTextField; list?: string }> = {
  production: { field: "productionDateTime" },
  rejection: { field: "rejectionTime" },
  name: { field: "productName", list: "finished-product-items" },
  organoleptic: { field: "organoleptic", list: "finished-product-organoleptic" },
  temp: { field: "productTemp" },
  corrective: { field: "correctiveAction" },
  oxygen: { field: "oxygenLevel" },
  portion: { field: "portionWeight" },
  note: { field: "note" },
  courier: { field: "courierTransferTime" },
  responsible: { field: "responsiblePerson", list: "finished-product-users" },
  inspector: { field: "inspectorName", list: "finished-product-users" },
};

type FinishedProductColumn = {
  key: string;
  label: string;
  /** Доля ширины: процент = weight / Σweight. */
  weight: number;
  /** Нет у колонок, которые рисуются своим контролом (Да/Нет). */
  field?: FinishedProductTextField;
  align?: "center";
  /** id `<datalist>` с подсказками, если у колонки есть справочник. */
  list?: string;
  /** Своя колонка организации — значение лежит в `row.custom`. */
  custom?: JournalCustomColumn | null;
  /** Отмечена «обязательно заполнять»: пустая ячейка подсвечивается. */
  mustFill?: boolean;
};

const QUALITY_GUIDELINES = [
  "Контроль за доброкачественностью пищи проводится органолептическим методом.",
  "Осмотр лучше проводить при дневном свете, запах и вкус оценивать при характерной температуре блюда.",
  "Для измерения температуры используйте только исправные термометры-зонды.",
];

const TEMPERATURE_GUIDELINES = [
  ["A", "Натуральные рубленые изделия из мяса", "+85"],
  ["B", "Изделия из фарша: котлеты, биточки, тефтели, зразы", "+90"],
  ["C", "Мясо, рыба, ракообразные", "+68"],
  ["D", "Домашняя птица, яйца, рыба, мясо измельченное", "+74"],
  ["E", "Цельная говядина, баранина, рыба для холодного употребления", "+65"],
  ["G", "Холодные блюда: салаты, десерты", "+2..+5"],
  ["H", "Горячие блюда: супы, соусы", ">+75"],
] as const;

function nowDate() {
  return localDayKey();
}

function nowTime() {
  const dt = new Date();
  return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}

function parseDateTime(value: string) {
  const [date = nowDate(), time = nowTime()] = value.split(" ");
  return { date, time };
}

function mergeDateTime(date: string, time: string) {
  return `${date} ${time}`;
}

/** «YYYY-MM-DD HH:MM» для момента `minutesAgo` минут назад (локальное время). */
function dateTimeMinutesAgo(minutesAgo: number): string {
  const dt = new Date(Date.now() - minutesAgo * 60_000);
  const date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  const time = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
  return mergeDateTime(date, time);
}

/**
 * Быстрые сдвиги времени под полем: «−15 мин … −1 ч» от текущего момента
 * и «Сейчас». Бракераж снимают уже после готовки — по умолчанию
 * изготовление стоит на 30 минут раньше, а точнее — одним касанием.
 */
const PRODUCTION_OFFSETS = [
  { minutes: 15, label: "−15 мин" },
  { minutes: 30, label: "−30 мин" },
  { minutes: 45, label: "−45 мин" },
  { minutes: 60, label: "−1 ч" },
] as const;

function QuickTimeChips({
  value,
  onChange,
  offsets,
  nowLabel = "Сейчас",
}: {
  value: string;
  onChange: (next: string) => void;
  offsets?: ReadonlyArray<{ minutes: number; label: string }>;
  nowLabel?: string;
}) {
  const active = (candidate: string) => candidate === value;
  const chip = (label: string, next: () => string, key: string) => {
    const current = active(next());
    return (
      <button
        key={key}
        type="button"
        onClick={() => onChange(next())}
        aria-pressed={current}
        className={`inline-flex h-8 items-center rounded-full border px-3 text-[12.5px] font-medium tabular-nums transition-colors duration-150 ${
          current
            ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]"
            : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        }`}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {(offsets ?? []).map((offset) =>
        chip(offset.label, () => dateTimeMinutesAgo(offset.minutes), `m${offset.minutes}`)
      )}
      {chip(nowLabel, () => dateTimeMinutesAgo(0), "now")}
    </div>
  );
}

/**
 * Новая строка. Люди — только назначенные в документе: ответственный и
 * проверяющий. Раньше сюда вписывались первые два сотрудника по алфавиту,
 * и в бланке оказывались случайные люди.
 */
function createDraft(
  users: Props["users"],
  productName = "",
  people: { responsibleUserId?: string | null; verifierUserId?: string | null } = {},
  times: FinishedProductTimeDefaults = FINISHED_PRODUCT_TIME_DEFAULTS,
  organolepticOptions: string[] = FINISHED_PRODUCT_ORGANOLEPTIC_DISH
): FinishedProductDocumentRow {
  const nameOf = (id: string | null | undefined) =>
    (id && users.find((user) => user.id === id)?.name) || "";
  return createFinishedProductRow({
    productName,
    // Бракераж снимают после готовки: сдвиг изготовления задаётся в
    // настройках журнала («Константы времени»), по умолчанию 30 минут.
    productionDateTime: dateTimeMinutesAgo(times.productionMinutesAgo),
    rejectionTime: dateTimeMinutesAgo(times.rejectionMinutesAgo),
    releasePermissionTime: mergeDateTime(nowDate(), nowTime()),
    courierTransferTime: mergeDateTime(nowDate(), nowTime()),
    responsiblePerson: nameOf(people.responsibleUserId),
    inspectorName: nameOf(people.verifierUserId),
    releaseAllowed: "yes",
    // По умолчанию «Отлично»: в норме бракераж проходит, хуже — выберут.
    organoleptic: organolepticOptions[0] ?? "",
  });
}

/** Поле ввода даты/времени: `min-w-0`, иначе на iPhone нативные
    date/time-инпуты держат свою ширину, наезжают друг на друга и
    уводят окно в горизонтальный скролл. */
/**
 * iOS Safari рисует date/time-инпуты по своей внутренней ширине и
 * центрирует текст: без `appearance-none` + `block` + `min-w-0` они
 * вылезали из колонок и наезжали друг на друга. Высота 44px — под палец.
 */
const DATE_TIME_INPUT_CLASS =
  "block h-11 w-full min-w-0 appearance-none rounded-xl border-[#dcdfed] px-3 text-left text-[15px] leading-none [&::-webkit-date-and-time-value]:min-h-[1.2em] [&::-webkit-date-and-time-value]:text-left";

function DateTimePair({
  value,
  onChange,
  dateLabel,
  timeLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  dateLabel: string;
  timeLabel: string;
}) {
  const parts = parseDateTime(value);
  return (
    <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-2">
      <Input type="date" aria-label={dateLabel} className={DATE_TIME_INPUT_CLASS} value={parts.date} onChange={(e) => onChange(mergeDateTime(e.target.value, parts.time))} />
      <Input type="time" aria-label={timeLabel} className={DATE_TIME_INPUT_CLASS} value={parts.time} onChange={(e) => onChange(mergeDateTime(parts.date, e.target.value))} />
    </div>
  );
}

export function FinishedProductDocumentClient({
  documentId,
  title,
  organizationName,
  controlPeriodicity = "",
  dateFrom,
  dateTo,
  status,
  initialConfig,
  users,
  responsibleUserId = null,
  verifierUserId = null,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const draftPeople = { responsibleUserId, verifierUserId };
  const [isSaving, setIsSaving] = useState(false);
  const [config, setConfig] = useState(() => normalizeFinishedProductDocumentConfig(initialConfig));
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [addModalOpen, setAddModalOpen] = useState(false);
  /** «Применить ко всем выделенным» — одно окно на несколько строк. */
  const [applyOpen, setApplyOpen] = useState(false);
  // id строки, которую правим. null — режим добавления. Одна модалка на
  // оба сценария: на телефоне карточка открывает её же, иначе бракераж
  // (до 50 записей за смену) правился только в таблице на 1100px.
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeAction = useDocumentCloseAction({ documentId, title });
  const [catalogOpen, setCatalogOpen] = useState(false);
  /** «Из справочника организации» для списка изделий этого журнала. */
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [newItemName, setNewItemName] = useState("");
  // Оценки документа: свои из настроек или стандартные по режиму
  // наименования (у полуфабрикатов — про соответствие, а не баллы).
  const organolepticOptions = useMemo(
    () => getFinishedProductOrganolepticOptions(config),
    [config]
  );
  const [draftRow, setDraftRow] = useState<FinishedProductDocumentRow>(() => createDraft(users, "", draftPeople, config.timeDefaults, organolepticOptions));
  /**
   * «Т°C внутри продукта» подставлена по прошлой записи этого блюда.
   * Ручной ввод снимает флаг — смена блюда больше не перезапишет число.
   */
  const [productTempAuto, setProductTempAuto] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const readOnly = status === "closed";
  const { mobileView, switchMobileView } = useMobileView("finished_product");

  /* ── Автосохранение ячеек ───────────────────────────────────────────
   * Кнопки «Сохранить» на эталоне нет: правки ячеек уезжают на сервер
   * сами. Копим последнее состояние в ref и шлём один PATCH через
   * AUTOSAVE_DELAY_MS после последнего нажатия клавиши; blur и любые
   * структурные операции (добавить/удалить строку, правка справочника)
   * сбрасывают очередь немедленно. `router.refresh()` здесь НЕ зовём —
   * он перерисовывает серверный компонент и сбивает фокус в поле.
   */
  const pendingConfigRef = useRef<FinishedProductDocumentConfig | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  /**
   * Строки, которые эта страница видела. Сервер по ним отличает строку,
   * удалённую здесь, от строки, добавленной по QR после загрузки страницы
   * (см. brakerage-row-merge.ts), — иначе сохранение с сайта стирало бы
   * блюда, внесённые с телефонов, и подписи комиссии.
   */
  const knownRowIdsRef = useRef<Set<string>>(new Set(config.rows.map((row) => row.id)));
  const rememberRows = useCallback((rows: readonly { id: string }[]) => {
    for (const row of rows) knownRowIdsRef.current.add(row.id);
  }, []);
  const inFlightRef = useRef(0);
  /** Принять строки с сервера (слияние после сохранения, QR, подписи), если нет своих несохранённых правок. */
  const adoptServerRows = useCallback(
    (rawConfig: unknown) => {
      if (pendingConfigRef.current || saveTimerRef.current || inFlightRef.current > 0) return;
      const fresh = normalizeFinishedProductDocumentConfig(rawConfig);
      rememberRows(fresh.rows);
      setConfig((prev) => {
        const same =
          prev.rows.length === fresh.rows.length &&
          prev.rows.every((row, index) => JSON.stringify(row) === JSON.stringify(fresh.rows[index]));
        return same ? prev : { ...prev, rows: fresh.rows };
      });
    },
    [rememberRows]
  );

  const flushConfigSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const next = pendingConfigRef.current;
    pendingConfigRef.current = null;
    if (!next) return;
    setIsAutoSaving(true);
    rememberRows(next.rows);
    inFlightRef.current += 1;
    void fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: next, knownRowIds: [...knownRowIdsRef.current] }),
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
      .finally(() => setIsAutoSaving(false));
  }, [documentId, adoptServerRows, rememberRows]);

  /** Применить новое состояние конфига и поставить его в очередь записи. */
  const commitConfig = useCallback(
    (next: FinishedProductDocumentConfig, immediate = false) => {
      setConfig(next);
      pendingConfigRef.current = next;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (immediate) {
        flushConfigSave();
        return;
      }
      saveTimerRef.current = setTimeout(flushConfigSave, AUTOSAVE_DELAY_MS);
    },
    [flushConfigSave]
  );

  // Уход со страницы не должен съедать последний недописанный ввод.
  useEffect(() => () => flushConfigSave(), [flushConfigSave]);

  // Блюда с телефонов (QR) и подписи комиссии появляются здесь сами:
  // живое событие «журнал изменился» → перечитать строки документа.
  const refreshRowsFromServer = useCallback(() => {
    if (readOnly) return;
    void fetch(`/api/journal-documents/${documentId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { document?: { config?: unknown } } | null) => {
        if (body?.document) adoptServerRows(body.document.config);
      })
      .catch(() => undefined);
  }, [adoptServerRows, documentId, readOnly]);
  useLiveEvents((event) => {
    const data = (event as { type?: string; data?: { documentIds?: unknown } }).data;
    if ((event as { type?: string }).type !== "journal") return;
    const ids = Array.isArray(data?.documentIds) ? (data?.documentIds as unknown[]) : [];
    if (ids.includes(documentId)) refreshRowsFromServer();
  });

  // Карточки (телефон, Mini App) — те же колонки и подписи, что у таблицы.
  const cardColumns = resolveColumns("finished_product", config);
  const cardVisible = (key: string) => cardColumns.find((column) => column.key === key)?.hidden !== true;
  const cardItems: RecordCardItem[] = config.rows.map((row, index) => ({
    id: row.id,
    title: `№${index + 1} · ${row.productName || "—"}`,
    subtitle: row.productionDateTime || undefined,
    // Тап по карточке открывает ту же модалку, что и строка таблицы.
    onClick: readOnly ? undefined : () => openEditRow(row),
    leading: !readOnly ? (
      <Checkbox
        checked={selectedRows.includes(row.id)}
        onCheckedChange={(value) =>
          setSelectedRows((prev) =>
            value === true
              ? [...new Set([...prev, row.id])]
              : prev.filter((item) => item !== row.id)
          )
        }
        className="size-5"
      />
    ) : null,
    // Те же колонки, что у таблицы и печати, тем же текстом ячейки.
    fields: cardColumns
      .filter((column) => !column.hidden && column.key !== "name" && column.key !== "production")
      .map((column) => ({
        label: column.label,
        value: column.custom
          ? customCellValue(row, column.key)
          : column.key === "signatures" && hasCommission(config) && normalizeRowSignatures(row.signatures).length === 0
            ? "Ждёт подписи комиссии"
            : finishedProductCellText(row, column.key, { inspectorFallback: !cardVisible("inspector") }),
        hideIfEmpty: column.key !== "release",
      })),
  }));

  // Наименования всей организации (последние сверху) + справочник документа.
  const dishSuggestions = useNameSuggestions("dish");
  const productOptions = useMemo(
    () => dishSuggestions.options(config.itemsCatalog),
    [dishSuggestions, config.itemsCatalog]
  );

  /** Температура блюда по прошлой записи: память организации, иначе строки этого документа. */
  function rememberedTemp(name: string): string | null {
    const key = suggestionKey(name);
    if (!key) return null;
    const fromMemory = dishSuggestions.metaFor(name)?.productTemp;
    if (fromMemory) return fromMemory;
    for (let i = config.rows.length - 1; i >= 0; i -= 1) {
      const row = config.rows[i];
      if (row.id !== editingRowId && suggestionKey(row.productName) === key && row.productTemp.trim() !== "") return row.productTemp;
    }
    return null;
  }

  /** Выбор блюда (список, чип, ввод): при видимой колонке подставляет температуру, если поле пустое или было подставлено. */
  function pickProductName(name: string) {
    setDraftRow((prev) => {
      const next = { ...prev, productName: name };
      if (!isColumnVisible("temp")) return next;
      if (prev.productTemp.trim() !== "" && !productTempAuto) return next;
      const temp = rememberedTemp(name);
      if (temp) {
        setProductTempAuto(true);
        return { ...next, productTemp: temp };
      }
      if (productTempAuto) {
        setProductTempAuto(false);
        return { ...next, productTemp: "" };
      }
      return next;
    });
  }
  // Dedupe by name — multiple staff records can carry identical full
  // names ("Титов Максим Андреевич"), and React would warn about
  // duplicate keys in the <datalist> below. The select still falls
  // back to a free-text input, so dropping ID-disambiguation here is
  // safe for the autosuggest UX.
  const personOptions = useMemo(
    // Аккаунт «имя = почта» (мгновенная регистрация) — не сотрудник для подписи бракеража.
    () => Array.from(new Set(users.map((item) => item.name).filter((name) => Boolean(name) && !name.includes("@")))),
    [users]
  );

  /**
   * Колонки таблицы одним описанием: заголовок + вес для colgroup.
   * Базовые 7 колонок дают ровно 100 «весов» — сумма процентов совпадает
   * с эталоном; включение опций пересчитывает доли автоматически.
   *
   * F6: веса пересняты с живого эталона (finished_product-2-doc.png,
   * таблица 1150px): органолептика ~350px (31), ФИО-колонки ~150-158px
   * (14 и 13) с заголовками в 2-3 строки, «Разрешение к реализации»
   * ~150px (13). Раньше ФИО-колонки были по 18 и съедали органолептику.
   */
  const resolvedColumns = useMemo(() => resolveColumns("finished_product", config), [config]);
  const columnByKey = useMemo(
    () => new Map(resolvedColumns.map((column) => [column.key, column])),
    [resolvedColumns]
  );
  /** Видна ли колонка в таблице, карточках, диалоге строки и печати. */
  const isColumnVisible = (key: string) => columnByKey.get(key)?.hidden !== true;
  /** Подпись колонки: своя из набора документа или стандартная `fallback`. */
  const columnLabel = (key: string, fallback: string) => {
    const column = columnByKey.get(key);
    return column && column.label !== column.defaultLabel ? column.label : fallback;
  };
  const columns = useMemo<FinishedProductColumn[]>(
    () =>
      resolvedColumns
        .filter((column) => !column.hidden)
        .map((column) => ({
          key: column.key,
          label: column.label,
          weight: column.weight,
          align: column.align,
          custom: column.custom,
          mustFill: column.mustFill,
          ...FINISHED_PRODUCT_COLUMN_FIELDS[column.key],
        })),
    [resolvedColumns]
  );

  // Набор колонок: из «Настроек журнала» — в черновик (сохранит кнопка
  // модалки), из меню заголовка таблицы — сразу. Старые флаги `showX`
  // обновляются вместе с набором: их читают печать и TasksFlow.
  const withColumns = (base: FinishedProductDocumentConfig, next: JournalColumnsConfig): FinishedProductDocumentConfig => ({
    ...base,
    columns: next,
    ...(legacyFlagsFromColumns("finished_product", next) as Pick<
      FinishedProductDocumentConfig,
      | "showProductTemp"
      | "showCorrectiveAction"
      | "showOxygenLevel"
      | "showCourierTime"
      | "showReleaseAllowed"
    >),
  });
  const headerEdit = useJournalHeaderEdit();
  const canManageColumns = headerEdit?.canEditDocument === true;
  // Поля записи — одно окно для «Добавить изделие», правки строки и «Добавить
  // списком» (там наименования приходят списком, остальное общее).
  const [organolepticCustom, setOrganolepticCustom] = useState(false);
  const organolepticSelectValue = organolepticOptions.includes(draftRow.organoleptic) && !organolepticCustom
    ? draftRow.organoleptic
    : draftRow.organoleptic || organolepticCustom
      ? ORGANOLEPTIC_CUSTOM
      : "";
  const rowFields = ({ withProductName, leading }: { withProductName: boolean; leading?: React.ReactNode }) => (
    <div className="max-h-[calc(92vh-160px)] min-w-0 space-y-5 overflow-x-hidden overflow-y-auto px-6 py-5">
      {leading}
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Дата и время изготовления</Label>
              <DateTimePair dateLabel="Дата изготовления" timeLabel="Время изготовления" value={draftRow.productionDateTime} onChange={(next) => setDraftRow((prev) => ({ ...prev, productionDateTime: next }))} />
              <QuickTimeChips
                value={draftRow.productionDateTime}
                offsets={PRODUCTION_OFFSETS}
                onChange={(next) => setDraftRow((prev) => ({ ...prev, productionDateTime: next }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Время снятия бракеража</Label>
              <DateTimePair dateLabel="Дата снятия бракеража" timeLabel="Время снятия бракеража" value={draftRow.rejectionTime} onChange={(next) => setDraftRow((prev) => ({ ...prev, rejectionTime: next }))} />
              <QuickTimeChips
                value={draftRow.rejectionTime}
                onChange={(next) => setDraftRow((prev) => ({ ...prev, rejectionTime: next, releasePermissionTime: next }))}
                nowLabel="Сейчас (и разрешение тем же временем)"
              />
            </div>
            {withProductName ? (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">Наименование изделия</Label>
                <SuggestInput ariaLabel="Наименование изделия" value={draftRow.productName} options={productOptions} onChange={pickProductName} />
                {/* Последние блюда — одним касанием, без открытия списка. */}
                {productOptions.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5" aria-label="Недавние наименования">
                    {productOptions.slice(0, 6).map((name) => {
                      const current = draftRow.productName === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          aria-pressed={current}
                          onClick={() => pickProductName(name)}
                          className={`inline-flex h-8 max-w-full items-center truncate rounded-full border px-3 text-[12.5px] font-medium transition-colors duration-150 ${
                            current
                              ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]"
                              : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                          }`}
                        >
                          {name}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Органолептическая оценка</Label>
              <Select
                value={organolepticSelectValue}
                onValueChange={(next) => {
                  if (next === ORGANOLEPTIC_CUSTOM) {
                    setOrganolepticCustom(true);
                    setDraftRow((prev) => ({ ...prev, organoleptic: "" }));
                    return;
                  }
                  setOrganolepticCustom(false);
                  setDraftRow((prev) => ({ ...prev, organoleptic: next }));
                }}
              >
                <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]" aria-label="Органолептическая оценка">
                  <SelectValue placeholder="— Выберите оценку —" />
                </SelectTrigger>
                <SelectContent>
                  {organolepticOptions.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                  <SelectItem value={ORGANOLEPTIC_CUSTOM}>Своя формулировка…</SelectItem>
                </SelectContent>
              </Select>
              {organolepticSelectValue === ORGANOLEPTIC_CUSTOM ? (
                <Input
                  className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  value={draftRow.organoleptic}
                  placeholder="Например: соответствует требованиям"
                  aria-label="Своя формулировка оценки"
                  autoFocus
                  onChange={(e) => setDraftRow((prev) => ({ ...prev, organoleptic: e.target.value }))}
                />
              ) : null}
            </div>
            {isColumnVisible("temp") ? (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">{columnLabel("temp", "T°C внутри продукта")}</Label>
                <Input
                  className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  value={draftRow.productTemp}
                  onChange={(e) => {
                    setProductTempAuto(false);
                    setDraftRow((prev) => ({ ...prev, productTemp: e.target.value }));
                  }}
                />
                {productTempAuto && draftRow.productTemp.trim() !== "" ? (
                  <p className="text-[11.5px] leading-snug text-[#6f7282]" data-testid="product-temp-auto-hint">
                    По прошлой записи «{draftRow.productName}». Исправьте, если сегодня иначе.
                  </p>
                ) : null}
              </div>
            ) : null}
            {isColumnVisible("portion") ? (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">Вес выход, г</Label>
                <Input
                  className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  value={draftRow.portionWeight}
                  inputMode="decimal"
                  maxLength={20}
                  placeholder="Например: 150 или 200/10"
                  aria-label="Вес выход, г"
                  onChange={(e) => setDraftRow((prev) => ({ ...prev, portionWeight: e.target.value }))}
                />
                <p className="text-[11.5px] leading-snug text-[#6f7282]">{columnLabel("portion", "Результат взвешивания порционных блюд")}</p>
              </div>
            ) : null}
            {isColumnVisible("note") ? (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">{columnLabel("note", "Примечание")}</Label>
                <Input
                  className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  value={draftRow.note}
                  maxLength={500}
                  aria-label="Примечание"
                  onChange={(e) => setDraftRow((prev) => ({ ...prev, note: e.target.value }))}
                />
              </div>
            ) : null}
            {isColumnVisible("oxygen") ? (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">{columnLabel("oxygen", "Остаточный уровень кислорода, % об.")}</Label>
                <Input className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" value={draftRow.oxygenLevel} onChange={(e) => setDraftRow((prev) => ({ ...prev, oxygenLevel: e.target.value }))} />
              </div>
            ) : null}
            {isColumnVisible("corrective") ? (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">{columnLabel("corrective", "Корректирующие действия")}</Label>
                <Textarea className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]" value={draftRow.correctiveAction} onChange={(e) => setDraftRow((prev) => ({ ...prev, correctiveAction: e.target.value }))} />
              </div>
            ) : null}
            {/* Колонка выключена ⇒ и в окне не спрашиваем: иначе выбор
                «Нет» некуда деть — его не видно ни в таблице, ни в
                карточке, ни на печати. */}
            {isColumnVisible("release_allowed") || isColumnVisible("release") ? (
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Разрешение к реализации</Label>
              {/* Выбранный вариант — заливка + галочка + кольцо; невыбранный —
                  белый с рамкой. Раньше оба были цветными, и было не понятно,
                  какой из них нажат. */}
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Разрешение к реализации">
                {(
                  [
                    ["yes", "Разрешено", "#136b2a", "rgba(19,107,42,0.18)"],
                    ["no", "Не разрешено", "#d2453d", "rgba(210,69,61,0.18)"],
                  ] as const
                ).map(([value, label, fg, ring]) => {
                  const active = draftRow.releaseAllowed === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setDraftRow((prev) => ({ ...prev, releaseAllowed: value }))}
                      className={`flex h-10 items-center justify-center gap-1.5 rounded-xl border px-3.5 text-[14px] font-medium transition-all duration-150 ${active ? "border-transparent text-white shadow-[0_8px_20px_-10px_rgba(11,16,36,0.35)]" : "border-[#dcdfed] bg-white text-[#6f7282] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024]"}`}
                      style={active ? { backgroundColor: fg, boxShadow: `0 0 0 4px ${ring}` } : undefined}
                    >
                      {active ? <Check className="size-4" strokeWidth={3} /> : null}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            ) : null}
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Дата и время разрешения</Label>
              <DateTimePair dateLabel="Дата разрешения" timeLabel="Время разрешения" value={draftRow.releasePermissionTime} onChange={(next) => setDraftRow((prev) => ({ ...prev, releasePermissionTime: next }))} />
            </div>
            {isColumnVisible("courier") ? (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">{columnLabel("courier", "Дата и время передачи блюд курьеру")}</Label>
                <DateTimePair dateLabel="Дата передачи курьеру" timeLabel="Время передачи курьеру" value={draftRow.courierTransferTime} onChange={(next) => setDraftRow((prev) => ({ ...prev, courierTransferTime: next }))} />
              </div>
            ) : null}
            {isColumnVisible("responsible") ? (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">{columnLabel("responsible", "Ответственный исполнитель")}</Label>
                <SuggestInput ariaLabel="Ответственный исполнитель" value={draftRow.responsiblePerson} options={personOptions} placeholder="Выберите сотрудника или впишите ФИО" onChange={(next) => setDraftRow((prev) => ({ ...prev, responsiblePerson: next }))} />
              </div>
            ) : null}
            {/* При составе комиссии бракераж подписывают её члены своим входом —
                вписывать ФИО проверяющего вручную не нужно. */}
            {isColumnVisible("inspector") && !hasCommission(config) ? (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">{config.inspectorMode === "commission_signatures" ? "Подписи членов комиссии" : "Лицо, проводившее бракераж"}</Label>
                <SuggestInput ariaLabel="Лицо, проводившее бракераж" value={draftRow.inspectorName} options={personOptions} placeholder="Выберите сотрудника или впишите ФИО" onChange={(next) => setDraftRow((prev) => ({ ...prev, inspectorName: next }))} />
              </div>
            ) : null}
            {/* Свои колонки организации — и в окне строки: на телефоне
                карточка открывает именно это окно, и без полей своя
                колонка была бы доступна только на большом экране. */}
            {resolvedColumns
              .flatMap((column) =>
                column.custom && !column.hidden ? [{ column, custom: column.custom }] : []
              )
              .map(({ column, custom }) => (
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
                    employees={personOptions}
                    className="h-11 rounded-2xl border border-[#dcdfed] px-3 text-[14px]"
                  />
                </div>
              ))}
          
    </div>
  );

  const headerMenu = useColumnHeaderMenu({
    code: "finished_product",
    config: config as unknown as Record<string, unknown>,
    enabled: !readOnly,
    canApplyToAll: canManageColumns,
    onChange: (next) => commitConfig(withColumns(config, next), true),
  });

  const columnsWeight = columns.reduce((sum, column) => sum + column.weight, 0);
  // Подпись «Добавить изделие» встаёт под колонкой наименования, где бы она ни была.
  const nameColumnIndex = columns.findIndex((column) => column.key === "name");
  /**
   * Ниже этой ширины колонки перестают читаться — включаем скролл внутри
   * viewport'а таблицы. 7 базовых колонок помещаются в контент 1248px,
   * каждая опциональная добавляет свои ~130px.
   */
  const tableMinWidth = 960 + Math.max(columns.length - 7, 0) * 130;

  /**
   * Явное сохранение (диалог настроек, добавление строки из модалки).
   * Гасит очередь автосохранения — иначе отложенный PATCH со старым
   * состоянием мог бы «догнать» и перетереть только что записанное.
   */
  async function saveConfig(nextConfig = config) {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingConfigRef.current = null;
    setIsSaving(true);
    try {
      rememberRows(nextConfig.rows);
      const response = await fetch(`/api/journal-documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: nextConfig, knownRowIds: [...knownRowIdsRef.current] }),
      });
      if (!response.ok) throw new Error();
      const body = (await response.json().catch(() => null)) as { document?: { config?: unknown } } | null;
      if (body?.document) adoptServerRows(body.document.config);
      startTransition(() => router.refresh());
    } catch {
      toast.error("Не удалось сохранить журнал");
    } finally {
      setIsSaving(false);
    }
  }

  function updateRow(id: string, patch: Partial<FinishedProductDocumentRow>) {
    commitConfig({
      ...config,
      rows: config.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });
  }

  /** Поля, которые имеет смысл менять у нескольких строк сразу. */
  const applyFields: ApplyToSelectedField[] = [
    { key: "rejectionTime", label: columnLabel("rejection", "Время снятия бракеража"), type: "time" },
    { key: "organoleptic", label: columnLabel("organoleptic", "Органолептическая оценка"), type: "select", options: organolepticOptions.map((value) => ({ value, label: value })) },
    { key: "releaseAllowed", label: columnLabel("release", "Разрешение к реализации"), type: "select", options: [{ value: "yes", label: "Разрешено" }, { value: "no", label: "Не разрешено" }] },
    { key: "releasePermissionTime", label: "Время разрешения к реализации", type: "time" },
    { key: "portionWeight", label: "Вес выход, г", type: "text" },
    { key: "courierTransferTime", label: columnLabel("courier", "Время передачи блюд курьеру"), type: "time" },
    { key: "responsiblePerson", label: columnLabel("responsible", "Ответственный исполнитель"), type: "text", suggestions: personOptions },
    { key: "inspectorName", label: columnLabel("inspector", "Лицо, проводившее бракераж"), type: "text", suggestions: personOptions },
  ];

  /** Поля «дата время»: из окна приходит только ЧЧ:ММ — дата берётся из строки (иначе сегодня). */
  const DATE_TIME_KEYS = new Set(["rejectionTime", "releasePermissionTime", "courierTransferTime"]);
  function patchRow(row: FinishedProductDocumentRow, patch: Record<string, string>): FinishedProductDocumentRow {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (DATE_TIME_KEYS.has(key) && /^\d{2}:\d{2}$/.test(value)) {
        const current = String((row as unknown as Record<string, string>)[key] ?? "");
        const date = /^\d{4}-\d{2}-\d{2}/.test(current) ? current.slice(0, 10) : nowDate();
        next[key] = mergeDateTime(date, value);
      } else {
        next[key] = value;
      }
    }
    return createFinishedProductRow({ ...row, ...next });
  }

  async function applyToSelectedRows(patch: Record<string, string>) {
    if (readOnly || selectedRows.length === 0) return;
    const nextConfig = {
      ...config,
      rows: config.rows.map((row) => (selectedRows.includes(row.id) ? patchRow(row, patch) : row)),
    };
    setConfig(nextConfig);
    await saveConfig(nextConfig);
    toast.success(`Изменено строк: ${selectedRows.length}`);
  }

  /** Копия выделенных строк с временем «сейчас» — повторная партия того же блюда. */
  async function repeatSelectedRows() {
    if (readOnly || selectedRows.length === 0) return;
    const copies = config.rows
      .filter((row) => selectedRows.includes(row.id))
      .map((row) =>
        createFinishedProductRow({
          ...row,
          id: undefined,
          productionDateTime: dateTimeMinutesAgo(0),
          rejectionTime: nowTime(),
          releasePermissionTime: row.releasePermissionTime ? nowTime() : "",
          courierTransferTime: "",
          sourceRowKey: undefined,
          // Повторная партия — новая порция: подпись комиссии, вес и
          // примечание прежней строки к ней не относятся.
          signatures: undefined,
          portionWeight: "",
          note: "",
        })
      );
    const nextConfig = { ...config, rows: [...config.rows, ...copies] };
    setConfig(nextConfig);
    await saveConfig(nextConfig);
    setSelectedRows(copies.map((row) => row.id));
    toast.success(copies.length > 1 ? `Добавлено копий: ${copies.length}` : `Повторено: ${copies[0]?.productName || "строка"}`);
  }

  async function removeSelectedRows() {
    if (readOnly || selectedRows.length === 0) return;
    const names = config.rows
      .filter((row) => selectedRows.includes(row.id))
      .map((row) => row.productName)
      .filter(Boolean);
    const signedCount = config.rows.filter(
      (row) => selectedRows.includes(row.id) && normalizeRowSignatures(row.signatures).length > 0
    ).length;
    const confirmed = await confirmAsync({
      title: "Удалить выбранные записи?",
      description: "Записи бракеража исчезнут из журнала после сохранения.",
      variant: "danger",
      confirmLabel: "Удалить",
      bullets: [
        { label: `Записей будет удалено: ${selectedRows.length}`, tone: "warn" },
        ...(signedCount > 0
          ? [{ label: `Подписано комиссией: ${signedCount} — подписи останутся в журнале подписей`, tone: "warn" as const }]
          : []),
        names.length > 0
          ? {
              label: `Изделия: ${names.slice(0, 4).join(", ")}${names.length > 4 ? " и др." : ""}`,
              tone: "info" as const,
            }
          : { label: "У выбранных записей не заполнено наименование", tone: "info" as const },
        { label: `Останется записей: ${config.rows.length - selectedRows.length}`, tone: "default" },
      ],
    });
    if (!confirmed) return;
    commitConfig(
      { ...config, rows: config.rows.filter((row) => !selectedRows.includes(row.id)) },
      true
    );
    setSelectedRows([]);
  }

  /** «Добавить несколько изделий» — пачка пустых строк. */
  async function addSeveralRows() {
    const raw = await promptAsync({
      title: "Добавить несколько изделий",
      description:
        "В таблицу добавятся пустые строки с текущей датой и временем — останется только вписать наименования.",
      label: "Сколько строк добавить",
      type: "number",
      defaultValue: "3",
      placeholder: "3",
      confirmLabel: "Добавить",
      validate: (value) => {
        const count = Number(value);
        if (!value.trim()) return "Введите число";
        if (!Number.isInteger(count) || count <= 0) return "Нужно целое число больше нуля";
        if (count > BULK_ROWS_MAX) return `За один раз можно добавить не больше ${BULK_ROWS_MAX} строк`;
        return null;
      },
    });
    if (raw === null) return;
    const count = Number(raw);
    if (!Number.isInteger(count) || count <= 0 || count > BULK_ROWS_MAX) return;
    commitConfig(
      {
        ...config,
        rows: [...config.rows, ...Array.from({ length: count }, () => createDraft(users, "", draftPeople, config.timeDefaults, organolepticOptions))],
      },
      true
    );
  }

  /** «Добавить из файла» — многострочная вставка списка наименований. */
  function addRowsFromText() {
    const items = bulkText
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length === 0) return;
    // Общие поля из окна (даты, оценка, ответственные) — каждому изделию списка.
    const { id: _templateId, ...template } = draftRow;
    void _templateId;
    commitConfig(
      {
        ...config,
        rows: [...config.rows, ...items.map((item) => createFinishedProductRow({ ...template, productName: item }))],
      },
      true
    );
    void dishSuggestions.remember(items);
    setBulkText("");
    setBulkOpen(false);
    toast.success(`Добавлено строк: ${items.length}`);
  }

  function openAddRow() {
    setEditingRowId(null);
    setOrganolepticCustom(false);
    setProductTempAuto(false);
    setDraftRow(createDraft(users, "", draftPeople, config.timeDefaults, organolepticOptions));
    setAddModalOpen(true);
  }

  /** Правка существующей строки — та же модалка, засеянная её значениями. */
  function openEditRow(row: FinishedProductDocumentRow) {
    if (readOnly) return;
    setEditingRowId(row.id);
    setOrganolepticCustom(false);
    setProductTempAuto(false);
    setDraftRow({ ...row });
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

  /**
   * `keepOpen` — «Сохранить и добавить ещё»: серия блюд одного бракеража
   * вносится без повторного выбора времени, оценки и людей — меняется
   * только наименование.
   */
  async function saveDraftRow(options: { keepOpen?: boolean } = {}) {
    const nextConfig = {
      ...config,
      rows: editingRowId
        ? config.rows.map((row) => (row.id === editingRowId ? draftRow : row))
        : [...config.rows, draftRow],
    };
    setConfig(nextConfig);
    await saveConfig(nextConfig);
    void dishSuggestions.remember(
      [draftRow.productName],
      draftRow.productTemp.trim() !== "" ? { [draftRow.productName]: { productTemp: draftRow.productTemp.trim() } } : undefined
    );
    setProductTempAuto(false);
    if (options.keepOpen && !editingRowId) {
      toast.success(`Записано: ${draftRow.productName || "без названия"}. Следующее изделие.`);
      setDraftRow({
        ...createDraft(users, "", draftPeople, config.timeDefaults, organolepticOptions),
        productionDateTime: draftRow.productionDateTime,
        rejectionTime: draftRow.rejectionTime,
        releasePermissionTime: draftRow.releasePermissionTime,
        courierTransferTime: draftRow.courierTransferTime,
        organoleptic: draftRow.organoleptic,
        releaseAllowed: draftRow.releaseAllowed,
        responsiblePerson: draftRow.responsiblePerson,
        inspectorName: draftRow.inspectorName,
      });
      return;
    }
    setDraftRow(createDraft(users, "", draftPeople, config.timeDefaults, organolepticOptions));
    if (editingRowId) {
      // Очередь правок откроет следующую строку или закроет окно.
      seq.saved();
      return;
    }
    setEditingRowId(null);
    setAddModalOpen(false);
  }

  // «Сегодня» — после mount (useTodayKey): new Date() в рендере
  // расходился между сервером (UTC) и браузером и врал подсветкой.
  const todayKey = useTodayKey();
  const todayFocusRowId = config.rows.find((row) => row.productionDateTime.slice(0, 10) === todayKey)?.id;

  return (
    <div className="text-black">
      <FocusTodayScroller
        onCreate={!readOnly ? () => openAddRow() : undefined}
      />
      {/* Q3: белая карточка-призрак (`rounded-[28px] shadow-sm py-5 sm:py-7`)
          вокруг шапки убрана — она давала под H1 пустой бордюр ~99px,
          которого нет ни у эталона, ни у остальных 12 журналов. */}
        <DocumentActionsBar
          className={DOC_TITLE_ROW_NO_STRIP_CLASS}
          backHref="/journals/finished_product"
          documentId={documentId}
          heading={<h1 className={DOC_HEADING_CLASS}>{title}</h1>}
          onSettings={!readOnly ? () => setSettingsOpen(true) : undefined}
          menuItems={
            !readOnly
              ? [
                  {
                    key: "close-journal",
                    label: "Закончить журнал",
                    icon: <Archive className="size-4" />,
                    onSelect: () => void closeAction.closeDocument(),
                    disabled: closeAction.isClosing,
                  },
                ]
              : []
          }
        />

      {!readOnly ? (
        <div className="mb-4 print:hidden">
          <TodayStripForJournal
            journalCode="finished_product"
            todayCount={
              config.rows.filter(
                (row) => row.productionDateTime.slice(0, 10) === todayKey
              ).length
            }
            label="запись бракеража за сегодня"
          />
        </div>
      ) : null}

      {readOnly ? (
        <div className="mb-6">
          <JournalClosedBanner hint="Верните журнал в активные, чтобы снова вносить записи бракеража." documentId={documentId} />
        </div>
      ) : null}

      {/* Карточной обёртки (рамка + скругление) нет — как в incoming_control
          и uv_lamp_runtime и как на эталоне: документ лежит прямо на белом
          фоне раздела, горизонтальную геометрию задаёт контейнер страницы. */}
      {/* R1: бумажное полотно — во всю ширину контентной колонки. */}
      {/* Q3: `py-4 sm:py-6` снят — зазор «H1 → бумажная шапка» держит
          DOC_TITLE_ROW_NO_STRIP_CLASS (28px), один для всех журналов
          без полосы автозаполнения. */}
        <div className="mb-4 sm:hidden print:hidden">
          <MobileViewToggle mobileView={mobileView} onChange={switchMobileView} />
        </div>

      <div className={`${DOC_BODY_STACK_CLASS} ${DOC_PAPER_CANVAS_CLASS}`}>


        {!readOnly && <div className={DOC_ADD_ROW_CLASS}>
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
                key: "add-bulk-list",
                label: "Добавить списком",
                icon: <ListPlus className="size-4 text-[#6f7282]" />,
                onSelect: () => {
                  setBulkText("");
                  { setDraftRow(createDraft(users, "", draftPeople, config.timeDefaults, organolepticOptions)); setBulkOpen(true); };
                },
              },
            ]}
            trigger={
              <Button type="button" className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]"><Plus className="size-5" strokeWidth={2.5} />Добавить<ChevronDown className="size-4" /></Button>
            }
          />
          {/* Тот же обработчик, что у пункта «Добавить изделие» в дропдауне —
              на эталоне это отдельная кнопка рядом. */}
          <Button type="button" className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]" onClick={() => openAddRow()}><Plus className="size-5" strokeWidth={2.5} />Добавить изделие</Button>
          <Button type="button" variant="outline" className={DOC_SECONDARY_BUTTON_CLASS} onClick={() => setCatalogOpen(true)}>Редактировать список изделий</Button>
          {/* Кнопки «Сохранить» нет: правки уезжают сами (см. commitConfig). */}
          {isAutoSaving || isSaving || isPending ? (
            <span className="text-[13px] text-[#6f7282]">Сохранение…</span>
          ) : null}
        </div>}
        <JournalSelectionBar
          count={selectedRows.length}
          onClear={() => setSelectedRows([])}
          onDelete={() => void removeSelectedRows()}
          hint="Строки журнала будут удалены без возможности отмены"
        >
          <SelectionEditButton count={selectedRows.length} disabled={readOnly} onClick={() => seq.start(selectedRows)} />
          <SelectionApplyButton count={selectedRows.length} disabled={readOnly} onClick={() => setApplyOpen(true)} />
          <SelectionRepeatButton count={selectedRows.length} disabled={readOnly} onClick={() => void repeatSelectedRows()} />
        </JournalSelectionBar>
        <ApplyToSelectedDialog open={applyOpen} onOpenChange={setApplyOpen} count={selectedRows.length} fields={applyFields} onApply={applyToSelectedRows} />


        {mobileView === "cards" ? (
          <RecordCardsView items={cardItems} emptyLabel="Бракеража пока не зарегистрировано." />
        ) : null}
        {headerMenu.element}

        <MobileViewTableWrapper mobileView={mobileView} className={GRID_VIEWPORT_CLASS}>
          {/*
            `table-fixed` + colgroup в процентах: все колонки укладываются в
            1248px контента на 1440px, последние («Ответственный исполнитель»,
            «ФИО лица, проводившего бракераж») больше не уезжают за контейнер.
            Проценты считаются из весов, поэтому включение любой из четырёх
            опциональных колонок пересчитывает сетку, а не ломает её.
            `minWidth` включает скролл ВНУТРИ viewport-контейнера — страница
            по горизонтали не едет.
          */}
          <div
            data-journal-blank-column
            className="min-w-full"
            style={{ minWidth: `max(100%, ${tableMinWidth}px)` }}
          >
        {/* Шапка бланка и таблица — ОДИН лист в одном скроллере и одной
            ширины (как холодильники/фритюр): на печати правая вертикаль
            шапки совпадает с колонками таблицы, даже когда таблица шире
            листа и раскладывается по содержимому. */}
        <div className={DOC_PAPER_HEADER_CLASS}>
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              <JournalPaperHeaderRows
                orgName={organizationName}
                title="ЖУРНАЛ БРАКЕРАЖА ГОТОВОЙ ПИЩЕВОЙ ПРОДУКЦИИ"
                startedAt={dateFrom}
                finishedAt={readOnly ? dateTo : null}
                controlPeriodicity={controlPeriodicity}
                orgCellClass="w-[18%]"
                sideCellClass="w-[20%]"
              />
            </tbody>
          </table>
        </div>

        {/* Кегль КАПС-заголовка — по эталону (finished_product-grid.png):
            ~14px bold, а не «плакат» на 30px. */}
        <h2 className={`${DOC_CAPS_TITLE_CLASS} text-center text-[13px] font-bold uppercase leading-tight sm:text-[14px]`}>Журнал бракеража готовой пищевой продукции</h2>
          <table className="w-full table-fixed border-collapse text-[12.5px]">
            <colgroup>
              {/* P8: 26px, как в приёмке — служебная колонка чекбокса не
                  должна отъедать ширину у содержательных колонок бланка. */}
              {/* R5-12: сумма ширин колонок ПЕРЕВАЛИВАЛА за 100%.
                  Служебная колонка чекбоксов занимала 26px, а
                  содержательные — ещё ровно 100% ширины таблицы, то есть
                  запрошено было «100% + 26px». При `table-fixed` Chrome
                  раскладывает такую сетку с выносом за контур, и колонка
                  чекбоксов вылезала ЗА ЛЕВУЮ РАМКУ бланка (x≈45 при
                  рамке на 57).

                  Считаем проценты от ОСТАТКА — `100% - 26px`: тогда
                  сумма всех колонок ровно 100%, и чекбоксы стоят внутри
                  рамки. Пропорции между содержательными колонками при
                  этом не меняются. */}
              <col className="print:hidden" style={{ width: "26px" }} />
              {columns.map((column) => (
                <col
                  key={column.key}
                  style={{
                    width: `calc(${(column.weight / columnsWeight) * 100}% - ${
                      (column.weight / columnsWeight) * 26
                    }px)`,
                  }}
                />
              ))}
            </colgroup>
            <thead><tr>
              {/* Select-all — как в остальных журналах: одна галочка
                  отмечает все строки листа, снятие очищает выделение. */}
              <th className={`${GRID_HEAD_CELL_CLASS} px-1 py-1.5 text-center leading-tight print:hidden`}>
                <Checkbox
                  checked={config.rows.length > 0 && selectedRows.length === config.rows.length}
                  onCheckedChange={(value) =>
                    !readOnly &&
                    setSelectedRows(value === true ? config.rows.map((row) => row.id) : [])
                  }
                  disabled={readOnly || config.rows.length === 0}
                  aria-label="Выбрать все строки"
                />
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`${GRID_HEAD_CELL_CLASS} px-1.5 py-1.5 text-center text-[11.5px] font-semibold leading-[1.25]`}
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
            </tr></thead>
            <tbody>{config.rows.map((row) => <tr key={row.id} data-focus-today={row.id === todayFocusRowId ? "" : undefined}>
              <td className={`${GRID_CELL_CLASS} px-1 py-1 text-center align-middle leading-tight print:hidden`}><Checkbox checked={selectedRows.includes(row.id)} onCheckedChange={(value) => !readOnly && setSelectedRows((prev) => value === true ? [...new Set([...prev, row.id])] : prev.filter((item) => item !== row.id))} disabled={readOnly} /></td>
              {columns.map((column) => (
                <td key={column.key} className={`${GRID_CELL_CLASS} p-0.5 align-middle leading-tight`}>
                  {/* Ячейка с переносом: органолептика и корректирующее
                      действие — предложения на 40-80 знаков, а колонка
                      бланка ~127px, и в однострочном input они были
                      видны на четверть. Колонки со справочником
                      (`column.list`) на время правки подменяются
                      настоящим <input list>, поэтому подсказки из
                      каталога остаются на месте. */}
                  {column.custom ? (
                    <JournalCustomCell
                      column={column.custom}
                      value={customCellValue(row, column.key)}
                      onChange={(value) =>
                        updateRow(row.id, { custom: withCustomCell(row, column.key, value) })
                      }
                      onBlur={flushConfigSave}
                      disabled={readOnly}
                      mustFill={column.mustFill}
                      employees={personOptions}
                    />
                  ) : column.key === "signatures" ? (
                    <SignaturesCell row={row} commission={hasCommission(config)} inspectorFallback={!isColumnVisible("inspector")} />
                  ) : column.key === "release" ? (
                    <div className="flex flex-col items-center gap-0.5 py-0.5">
                      <div className="flex items-center gap-1">
                        {(["yes", "no"] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            disabled={readOnly}
                            onClick={() => {
                              updateRow(row.id, { releaseAllowed: value });
                              flushConfigSave();
                            }}
                            className={`rounded-lg px-1.5 py-1 text-[11.5px] leading-none transition-colors duration-150 disabled:opacity-60 ${
                              row.releaseAllowed === value
                                ? value === "yes"
                                  ? "bg-[#e9f7ee] font-semibold text-[#1f8a45]"
                                  : "bg-[#fff2f1] font-semibold text-[#d43a2f]"
                                : "text-[#9b9fb3] hover:bg-[#f5f6ff]"
                            }`}
                          >
                            {value === "yes" ? "Разрешено" : "Не разрешено"}
                          </button>
                        ))}
                      </div>
                      {row.releaseAllowed !== "no" ? (
                        <JournalCellInput
                          value={row.releasePermissionTime}
                          onChange={(event) => updateRow(row.id, { releasePermissionTime: event.target.value })}
                          onBlur={flushConfigSave}
                          className="rounded-none text-center"
                          disabled={readOnly}
                          aria-label="Время разрешения"
                        />
                      ) : null}
                    </div>
                  ) : column.field ? (
                    <JournalCellInput
                      value={row[column.field]}
                      onChange={(event) =>
                        updateRow(row.id, {
                          [column.field as FinishedProductTextField]: event.target.value,
                        } as Partial<FinishedProductDocumentRow>)
                      }
                      onBlur={flushConfigSave}
                      className={`rounded-none ${column.align === "center" ? "text-center" : ""}`}
                      disabled={readOnly}
                      list={column.list}
                    />
                  ) : (
                    /* «Разрешение к реализации: Да/Нет» — не текст, а две
                       кнопки: свободный ввод здесь только портил бы поле. */
                    <div className="flex items-center justify-center gap-1 py-0.5">
                      {(["yes", "no"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          disabled={readOnly}
                          onClick={() => {
                            updateRow(row.id, { releaseAllowed: value });
                            flushConfigSave();
                          }}
                          className={`rounded-lg px-2 py-1 text-[12px] leading-none transition-colors duration-150 disabled:opacity-60 ${
                            row.releaseAllowed === value
                              ? value === "yes"
                                ? "bg-[#e9f7ee] font-semibold text-[#1f8a45]"
                                : "bg-[#fff2f1] font-semibold text-[#d43a2f]"
                              : "text-[#9b9fb3] hover:bg-[#f5f6ff]"
                          }`}
                        >
                          {value === "yes" ? "Да" : "Нет"}
                        </button>
                      ))}
                    </div>
                  )}
                </td>
              ))}
            </tr>)}
            {/* Последняя строка — кликабельная «пустая»: открывает то же
                окно, что и «Добавить изделие» над таблицей. Хвостовых
                заготовок здесь не было (строки только реальные), поэтому
                добавлять больше нечего скрывать.
                leading=3 — чекбокс + первые две колонки `columns`
                («Дата, время изготовления», «Время снятия бракеража»):
                это данные, а не идентификатор блюда, поэтому подпись под
                ними не встаёт. labelSpan=1 — подпись именно под
                «Наименование блюд (изделий)» (3-я колонка `columns`),
                единственным содержательным полем «что за изделие
                добавляем». Остальные (опциональные показатели,
                разрешение к реализации, ответственный, бракераж) —
                trailing = columns.length - 3. Сумма
                3+1+(columns.length-3) = columns.length+1 — тот же colSpan,
                что был раньше. */}
            {!readOnly ? (
              <JournalAddRow
                leading={nameColumnIndex >= 0 ? nameColumnIndex + 1 : 1}
                labelSpan={nameColumnIndex >= 0 ? 1 : Math.max(1, columns.length)}
                trailing={nameColumnIndex >= 0 ? columns.length - nameColumnIndex - 1 : 0}
                label="Добавить изделие"
                onClick={() => openAddRow()}
              />
            ) : null}</tbody>
          </table>
          </div>
          <datalist id="finished-product-items">{productOptions.map((item) => <option key={item} value={item} />)}</datalist>
          <datalist id="finished-product-users">{personOptions.map((item) => <option key={item} value={item} />)}</datalist>
          <datalist id="finished-product-organoleptic">{organolepticOptions.map((item) => <option key={item} value={item} />)}</datalist>
        </MobileViewTableWrapper>

        {/* «Примечание:» под таблицей — как на эталоне, и на экране, и в печати.
            Пустое примечание блок не рисует. */}
        {config.footerNote ? (
          <div className={`${DOC_EXTRA_BLOCK_CLASS} text-[12.5px] leading-[1.5]`}>
            <div className="font-bold">Примечание:</div>
            <div className="whitespace-pre-line">{config.footerNote}</div>
          </div>
        ) : null}

        {/* Справочный блок — только ссылка, раскрывается по клику.
            В бумажную форму эталона он не входит → print:hidden.

            F2: на эталоне это полужирная ссылка 16px, отдалённая от
            таблицы/примечания примерно на 55px, — раньше у нас был
            текст 13px вплотную к таблице. */}
        <div className="mt-[52px] print:hidden">
          <button
            type="button"
            onClick={() => setGuideOpen((prev) => !prev)}
            aria-expanded={guideOpen}
            className="rounded-md text-left text-[16px] font-semibold leading-[1.4] text-[#0b1024] underline decoration-1 underline-offset-4 transition-colors duration-150 hover:text-[#3848c7] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            {/* Шеврона нет: на эталоне это обычная подчёркнутая ссылка-текст,
                раскрытие остаётся по клику. */}
            {FINISHED_PRODUCT_QUALITY_GUIDE_TITLE}
          </button>
          {guideOpen ? (
            <div className="mt-4 space-y-3 rounded-[16px] border border-[#ececf4] bg-[#fafbff] p-4 sm:p-5">
              {QUALITY_GUIDELINES.map((item) => <p key={item} className="text-[13.5px] leading-[1.55] text-[#3c4053]">{item}</p>)}
              <div className={GRID_VIEWPORT_CLASS}>
                <table className="w-full min-w-[520px] border-collapse text-[12.5px]"><thead><tr><th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight`}>Группа</th><th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight`}>Наименование продукта</th><th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight`}>°C</th></tr></thead><tbody>{TEMPERATURE_GUIDELINES.map(([group, name, temperature]) => <tr key={group}><td className={`${GRID_CELL_CLASS} px-2 py-1 text-center font-semibold leading-tight`}>{group}</td><td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>{name}</td><td className={`${GRID_CELL_CLASS} px-2 py-1 text-center font-semibold leading-tight`}>{temperature}</td></tr>)}</tbody></table>
              </div>
            </div>
          ) : null}
        </div>
      </div>

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
          {rowFields({ withProductName: true })}
          <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff] sm:w-auto" onClick={closeRowModal}>Отмена</Button>
            {!editingRowId ? (
              <Button
                type="button"
                variant="outline"
                title="Сохранить это изделие и сразу открыть чистую строку с теми же временем, оценкой и людьми"
                className="h-10 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#3848c7] shadow-none hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:w-auto"
                onClick={() => { void saveDraftRow({ keepOpen: true }); }}
                disabled={isSaving || !draftRow.productName.trim()}
              >
                Сохранить и добавить ещё
              </Button>
            ) : null}
            <Button type="button" className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto" onClick={() => { void saveDraftRow(); }} disabled={isSaving}>
              {isSaving
                ? "Сохранение…"
                : editingRowId
                  ? "Сохранить"
                  : "Добавить запись"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <JournalSettingsModal
        open={readOnly ? false : settingsOpen}
          onOpenChange={setSettingsOpen}
          title="Настройки документа"
          description="Колонки таблицы и подпись внизу журнала."
          size="md"
          isSaving={isSaving}
          onSave={async () => {
            await saveConfig();
            setSettingsOpen(false);
          }}
          onCancel={() => setSettingsOpen(false)}
        >
          <JournalColumnsSettings
            code="finished_product"
            config={config as unknown as Record<string, unknown>}
            canApplyToAll={canManageColumns}
            onChange={(next) => setConfig((prev) => withColumns(prev, next))}
            onApplyToAll={(next) => {
              setSettingsOpen(false);
              headerMenu.openApplyToAll(next);
            }}
          />

          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Константы времени
            </Label>
            <p className="text-[12.5px] leading-[1.45] text-[#6f7282]">
              На сколько минут назад ставить время в новой строке. Бракераж снимают после готовки, поэтому изготовление
              обычно раньше самой проверки.
            </p>
            <div className="flex flex-wrap gap-3">
              {([
                ["productionMinutesAgo", "Изготовление, мин назад"],
                ["rejectionMinutesAgo", "Снятие бракеража, мин назад"],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-[13px] text-[#6f7282]">
                  {label}
                  <input
                    type="number"
                    min={0}
                    max={FINISHED_PRODUCT_TIME_MINUTES_MAX}
                    value={config.timeDefaults[key]}
                    onChange={(event) =>
                      setConfig((prev) => ({
                        ...prev,
                        timeDefaults: { ...prev.timeDefaults, [key]: Number(event.target.value) || 0 },
                      }))
                    }
                    className="h-9 w-24 rounded-xl border border-[#dcdfed] bg-white px-2 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Оценки
            </Label>
            <p className="text-[12.5px] leading-[1.45] text-[#6f7282]">
              Варианты органолептической оценки. Пусто — стандартные:{" "}
              {config.fieldNameMode === "semi"
                ? "для полуфабрикатов (соответствует / требует доработки / не соответствует)"
                : "для блюд (отлично / хорошо / удовлетворительно / неудовлетворительно)"}
              .
            </p>
            <div className="space-y-1.5">
              {config.organolepticOptions.map((option, index) => (
                <div key={`${option}-${index}`} className="flex items-center gap-1.5">
                  <input
                    value={option}
                    onChange={(event) =>
                      setConfig((prev) => {
                        const next = [...prev.organolepticOptions];
                        next[index] = event.target.value;
                        return { ...prev, organolepticOptions: next };
                      })
                    }
                    maxLength={80}
                    className="h-9 flex-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setConfig((prev) => ({
                        ...prev,
                        organolepticOptions: prev.organolepticOptions.filter((_, i) => i !== index),
                      }))
                    }
                    className="rounded-xl p-2 text-[#a13a32] hover:bg-[#fff4f2]"
                    aria-label={`Удалить оценку «${option}»`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setConfig((prev) => ({
                    ...prev,
                    organolepticOptions: [
                      ...(prev.organolepticOptions.length > 0
                        ? prev.organolepticOptions
                        : getFinishedProductOrganolepticOptions(prev)),
                      "",
                    ],
                  }))
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-[#dcdfed] px-3 text-[13px] font-medium text-[#3848c7] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                <Plus className="size-4" /> Добавить оценку
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Состав бракеражной комиссии
            </Label>
            <p className="text-[12.5px] leading-[1.45] text-[#6f7282]">
              Кто подписывает журнал. Состав печатается под таблицей и предлагается при заполнении по QR-коду.
            </p>
            <div className="space-y-1.5">
              {config.commissionMembers.map((member, index) => (
                <div key={member.id} className="flex flex-wrap items-center gap-1.5">
                  <input
                    value={member.role}
                    onChange={(event) =>
                      setConfig((prev) => {
                        const next = [...prev.commissionMembers];
                        next[index] = { ...next[index], role: event.target.value };
                        return { ...prev, commissionMembers: next };
                      })
                    }
                    placeholder="Роль"
                    maxLength={80}
                    className="h-9 w-[40%] min-w-[120px] rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
                  />
                  <input
                    value={member.employeeName}
                    onChange={(event) =>
                      setConfig((prev) => {
                        const next = [...prev.commissionMembers];
                        const name = event.target.value;
                        next[index] = {
                          ...next[index],
                          employeeName: name,
                          employeeId: users.find((user) => user.name === name)?.id ?? "",
                        };
                        return { ...prev, commissionMembers: next };
                      })
                    }
                    placeholder="ФИО"
                    list="finished-product-users"
                    maxLength={120}
                    className="h-9 flex-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setConfig((prev) => ({
                        ...prev,
                        commissionMembers: prev.commissionMembers.filter((item) => item.id !== member.id),
                      }))
                    }
                    className="rounded-xl p-2 text-[#a13a32] hover:bg-[#fff4f2]"
                    aria-label={`Убрать ${member.employeeName || "члена комиссии"} из комиссии`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              {config.commissionMembers.length < 10 ? (
                <button
                  type="button"
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      commissionMembers: [
                        ...prev.commissionMembers,
                        {
                          id: `commission-${Date.now()}-${prev.commissionMembers.length}`,
                          role: prev.commissionMembers.length === 0 ? "Председатель" : "Член комиссии",
                          employeeId: "",
                          employeeName: "",
                        },
                      ],
                    }))
                  }
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-[#dcdfed] px-3 text-[13px] font-medium text-[#3848c7] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                >
                  <Plus className="size-4" /> Добавить члена комиссии
                </button>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Примечание под таблицей
            </Label>
            <Textarea
              value={config.footerNote}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, footerNote: e.target.value }))
              }
              className="min-h-[80px] rounded-2xl border-[#dcdfed] px-4 py-3 text-[14px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
        </JournalSettingsModal>


      {/* «Добавить списком» — многострочная вставка вместо window.prompt. */}
      <Dialog open={readOnly ? false : bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
          <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              Добавить изделия списком
            </DialogTitle>
          </DialogHeader>
          {rowFields({
            withProductName: false,
            leading: (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">Наименования изделий — каждое с новой строки</Label>
                <Textarea
                  value={bulkText}
                  onChange={(event) => setBulkText(event.target.value)}
                  placeholder={"Борщ\nКотлета по-киевски\nСалат «Цезарь»"}
                  aria-label="Наименования изделий списком"
                  className="min-h-[140px] rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
                />
                <div className="text-[12px] leading-[1.45] text-[#6f7282]">
                  Будет добавлено строк:{" "}
                  <span className="font-medium text-[#0b1024]">{bulkText.split("\n").map((item) => item.trim()).filter(Boolean).length}</span>.
                  Поля ниже — общие для всех изделий списка, как в окне «Добавить изделие».
                </div>
              </div>
            ),
          })}
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
              disabled={bulkText.split("\n").map((item) => item.trim()).filter(Boolean).length === 0}
            >
              Добавить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={readOnly ? false : catalogOpen} onOpenChange={setCatalogOpen}>
        <DialogContent className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
          <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>Список изделий</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <p className="text-[13px] text-[#6f7282]">
              Эти изделия появятся в выпадающем списке при добавлении строки журнала.
            </p>
            {Array.from(new Set(config.itemsCatalog)).length === 0 ? (
              <p className="rounded-[14px] bg-[#f6f7fb] px-4 py-3 text-[13px] text-[#6f7282]">
                Список пуст. Введите название изделия ниже и нажмите «+».
              </p>
            ) : null}
            {Array.from(new Set(config.itemsCatalog)).map((item) => <div key={item} className="flex items-center gap-2 rounded-xl border border-[#e6e6f0] px-3 py-2"><div className="flex-1 text-[14px]">{item}</div><Button type="button" variant="ghost" title="Удалить изделие из списка" onClick={() => commitConfig({ ...config, itemsCatalog: config.itemsCatalog.filter((catalogItem) => catalogItem !== item) }, true)}><Trash2 className="size-4" /></Button></div>)}
            <div className="flex gap-2"><Input value={newItemName} onChange={(e) => setNewItemName(e.target.value)} placeholder="Введите название нового изделия" className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" /><Button className="h-10 rounded-lg bg-[#5566f6] px-4 text-white hover:bg-[#4a5bf0]" title="Добавить изделие в список" onClick={() => { if (!newItemName.trim()) return; commitConfig({ ...config, itemsCatalog: Array.from(new Set([...config.itemsCatalog, newItemName.trim()])) }, true); setNewItemName(""); }}><Plus className="size-4" /></Button></div>
            <Button type="button" variant="outline" className="h-10 w-full rounded-xl border-[#dcdfed] text-[13.5px] font-medium text-[#3848c7] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]" onClick={() => setDirectoryOpen(true)} title="Добавить изделия из общего справочника организации">
              <Database className="mr-1.5 size-4" /> Из справочника организации
            </Button>
            <OrgDirectoryDialog
              open={directoryOpen}
              onClose={() => setDirectoryOpen(false)}
              kind="product"
              existing={config.itemsCatalog}
              onAdd={(items) => commitConfig({ ...config, itemsCatalog: mergeIntoList(config.itemsCatalog, items) }, true)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Ячейка «Подпись бракеражной комиссии»: только чтение. Подписи ставят сами
 * члены комиссии (QR с ПИН или «Подписать» на сайте), руками их не впишешь.
 */
function SignaturesCell({
  row,
  commission,
  inspectorFallback,
}: {
  row: FinishedProductDocumentRow;
  commission: boolean;
  inspectorFallback: boolean;
}) {
  const signatures = normalizeRowSignatures(row.signatures);
  if (signatures.length > 0) {
    return (
      <div className="px-1.5 py-1 text-center text-[12px] leading-snug text-[#0b1024]">
        {formatRowSignatures(signatures)}
        {signatures.some((signature) => signature.outdated) ? (
          <div className="mt-0.5 text-[10.5px] text-[#b25c00]" title="Строку меняли после подписи">
            изменено после подписи
          </div>
        ) : null}
      </div>
    );
  }
  if (commission) {
    return (
      <div className="px-1.5 py-1 text-center print:hidden">
        <span className="inline-flex rounded-full bg-[#fff8eb] px-2 py-0.5 text-[11px] font-medium text-[#7a4a00]">
          Ждёт подписи комиссии
        </span>
      </div>
    );
  }
  return (
    <div className="px-1.5 py-1 text-center text-[12px] leading-snug text-[#3c4053]">
      {inspectorFallback ? row.inspectorName : ""}
    </div>
  );
}
