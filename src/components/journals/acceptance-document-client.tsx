"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  acceptanceServerRevision, acceptanceCalendarCopy, acceptanceEnumLabel, acceptanceImportHeaders, acceptanceProductColumns, acceptanceSummaryDisplay,
  bindAcceptanceSummaryRows, captureAcceptanceDiagnostic, formatAcceptanceDiagnostic,
  isGeneratedAcceptanceImportHeader, tagAcceptanceError,
  type AcceptanceDiagnostic, type AcceptanceMessage, type AcceptanceMessageKey,
  type AcceptanceSummarySidecar, type AcceptanceTranslate,
} from "@/lib/acceptance-document-presentation";
import {
  Archive,
  CalendarDays,
  ChevronDown,
  Package,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { DocumentActionsBar } from "@/components/journals/document-actions-bar";
import {
  DOC_ADD_ROW_CLASS,
  DOC_AUTOFILL_LABEL_CLASS,
  DOC_AUTOFILL_STRIP_CLASS,
  DOC_BODY_STACK_CLASS,
  DOC_CAPS_TITLE_CLASS,
  DOC_HEADING_CLASS,
  DOC_PAPER_CANVAS_CLASS,
  DOC_PAPER_HEADER_CARDS_HIDDEN_CLASS,
  DOC_PAPER_HEADER_CLASS,
  DOC_SECONDARY_BUTTON_CLASS,
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_CONTENT_WIDE_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
} from "@/components/journals/journal-responsive";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { USER_ROLE_LABEL_VALUES, getUserRoleLabel } from "@/lib/user-roles";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACCEPTANCE_DOCUMENT_TEMPLATE_CODE,
  acceptanceRowToBatchDraft,
  canCreateBatchFromAcceptanceRow,
  createAcceptanceRow,
  getIncomingControlRowValues,
  normalizeAcceptanceDocumentConfig,
  formatAcceptanceDateDash,
  type AcceptanceDocumentConfig,
  type AcceptanceRow,
} from "@/lib/acceptance-document";
import { resolveJournalCodeAlias } from "@/lib/source-journal-map";
import { Switch } from "@/components/ui/switch";
import { DateField } from "@/components/journals/journal-dialog-field";
import { useNameSuggestions } from "@/components/journals/use-name-suggestions";
import { mergeSuggestions } from "@/lib/name-suggestions";
import { TimeField, joinTimeValue, splitTimeValue } from "@/components/journals/time-field";
import {
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import { JournalClosedBanner } from "@/components/journals/journal-closed-banner";
import { useJournalDocumentActions } from "@/components/journals/use-journal-document-actions";
import { confirmAsync } from "@/components/ui/confirm-async";
import { toast } from "sonner";
import { saveBlob } from "@/lib/native-bridge";
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
import { localDayKey } from "@/lib/entry-defaults";
import { OrgDirectoryDialog } from "@/components/journals/org-directory-dialog";
import { mergeIntoList, type OrgDirectoryKind } from "@/lib/org-directory";
import { RecognizeFromPhoto, type RecognizeResult } from "@/components/ai/recognize-from-photo";
import type { VisionRawItem } from "@/lib/ai-vision/shared";

type User = { id: string; name: string; role: string };

type Props = {
  documentId: string;
  routeCode: string;
  title: string;
  organizationName: string;
  organizationFallbackSuffix?: string | null;
  /**
   * «Периодичность контроля» — вторая строка бумажной шапки документа
   * (`config.controlPeriodicity`, дефолт — из реестра шаблонов).
   * Пустая строка ⇒ строка в шапке не рендерится.
   */
  controlPeriodicity?: string;
  dateFrom: string;
  dateTo: string;
  status: string;
  config: unknown;
  generatedSummaries?: readonly AcceptanceSummarySidecar[];
  /** Optional witness of persisted source and normalization dependencies, never generated row IDs. */
  sourceIdentity?: string;
  users: User[];
  /** Design v2 toggle. */
  useV2?: boolean;
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
 * под «ничего не выбрано». Пункт «— выберите —» несёт сентинел, который
 * на входе/выходе мапится в пустую строку.
 */
const NONE_VALUE = "__none";
const fromNone = (value: string) => (value === NONE_VALUE ? "" : value);
const toNone = (value: string) => (value ? value : NONE_VALUE);

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const POSITION_OPTIONS = USER_ROLE_LABEL_VALUES;
function getResponsibleLabel(row: AcceptanceRow, users: User[]) {
  const user = users.find((u) => u.id === row.responsibleUserId);
  // Сотрудника могли удалить — тогда читаем ФИО, записанное в строке.
  return user?.name || row.responsibleName || "";
}

function getErrorMessage(error: unknown, fallback = "Ошибка", key: AcceptanceMessageKey = "journalControls.quickAdd.genericError") {
  return captureAcceptanceDiagnostic(error, fallback, key);
}

/** Event continuations read only this instance's latest committed presentation. */
function useAcceptanceCopy() {
  const t = useTranslations() as unknown as AcceptanceTranslate;
  const locale = useLocale();
  const committed = useRef({ t, locale });
  useLayoutEffect(() => { committed.current = { t, locale }; }, [t, locale]);
  const say: AcceptanceTranslate = (key, values) => committed.current.t(key, values);
  const feedback = (error: unknown, fallback: string, key: AcceptanceMessageKey) =>
    formatAcceptanceDiagnostic(getErrorMessage(error, fallback, key), say);
  return { t, say, feedback, committed };
}

function normalizeImportText(value: unknown) {
  return String(value ?? "").trim();
}

function parseImportDate(value: string) {
  const normalized = normalizeImportText(value);
  if (!normalized) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(normalized)) {
    const [day, month, year] = normalized.split(".");
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function parseImportTime(value: string) {
  const normalized = normalizeImportText(value);
  if (!normalized) return { hour: "", minute: "" };
  const parts = normalized.split(":");
  return {
    hour: parts[0]?.padStart(2, "0") || "",
    minute: parts[1]?.padStart(2, "0") || "",
  };
}

/**
 * `null` — ячейка пустая. Раньше пустое читалось как «Удовл./Соотв.»:
 * импорт проставлял оценку, которой в файле не было, а у типа
 * `AcceptanceRow` незаполненного варианта нет — поэтому строка с пустой
 * оценкой уходит в ошибки импорта.
 */
function parseImportBoolean(value: string): boolean | null {
  const normalized = normalizeImportText(value).toLowerCase();
  if (!normalized) return null;
  return ["1", "да", "yes", "ok", "удовл.", "удовл", "соотв.", "соотв", "соответствует"].includes(normalized);
}

function parseListImportItems(rows: unknown[][]) {
  return rows
    .map((row) => normalizeImportText(Array.isArray(row) ? row[0] : ""))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

/**
 * Колонки шаблона импорта журнала приёмки продукции (incoming_control) —
 * ровно те 11, что печатает бланк. Журнал приёмки СЫРЬЯ
 * (incoming_raw_materials_control) остался на старом формате, поэтому
 * шаблон и парсер ветвятся по `isProductAcceptance`.
 */
export const PRODUCT_ACCEPTANCE_IMPORT_COLUMNS = [
  "Дата поставки",
  "Наименование продукции",
  "Годен до",
  "Производитель/поставщик",
  "ТТН, документы соответствия",
  "Объем, номер партии, дата пр-ва",
  "Внутр. темп-ра продукта",
  "Соответствие товара сопроводительной документации",
  "Принять/Отклонить (П/О)",
  "Корректирующие действия",
  "Ответственный",
] as const;

export const RAW_MATERIALS_IMPORT_COLUMNS = [
  "Дата поступления",
  "Время поступления",
  "Наименование",
  "Производитель",
  "Поставщик",
  "Условия транспортировки",
  "Соответствие упаковки",
  "Результаты орг. оценки",
  "Предельный срок реализации, дата",
  "Предельный срок реализации, время",
  "Примечания",
] as const;

/** «П» / «принять» → accept, «О» / «отклонить» → reject, пусто → "". */
export function parseAcceptanceDecision(value: string): "" | "accept" | "reject" {
  const normalized = normalizeImportText(value).toLowerCase();
  if (!normalized) return "";
  if (/^(п|принять|принято|accept|1|да)$/.test(normalized)) return "accept";
  if (/^(о|отклонить|отклонено|reject|0|нет)$/.test(normalized)) return "reject";
  return "";
}

function downloadAcceptanceImportTemplate(isProductAcceptance: boolean, t: AcceptanceTranslate) {
  const header = acceptanceImportHeaders(isProductAcceptance, t).join(";");
  const sample = isProductAcceptance
    ? '11.04.2026;Гастрономия;20.04.2026;ООО "Агро-Юг" / ООО "Метро";ТТН №123 от 11.04.2026;20 кг, партия 45, 09.04.2026;+4;Соответствует;П;;Заведующий производством'
    : '11.04.2026;11:00;Гастрономия;ООО "Агро-Юг";ООО "Метро";1;1;1;11.04.2026;18:00;';
  const blob = new Blob([[header, sample].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  // В браузере — скачивание, в приложении WeSetup — «Поделиться».
  void saveBlob(
    blob,
    isProductAcceptance
      ? "incoming-control-import-example.csv"
      : "incoming-raw-materials-import-example.csv"
  );
}

/**
 * Левая часть футера окна строки: «Создать партию» → после создания
 * ссылка «Партия B-…». Одна и та же в обоих окнах приёмки.
 */
function RowBatchFooterAction(props: {
  row: AcceptanceRow;
  canCreate: boolean;
  busy: boolean;
  onCreate: () => void;
}) {
  const { t } = useAcceptanceCopy();
  if (props.row.batchId) {
    return (
      <a
        href={`/batches/${props.row.batchId}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-[#dcdfed] px-4 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] sm:mr-auto sm:w-auto"
      >
        <Package className="size-4" />
        {t("journalAcceptance.batch.existing", { code: props.row.batchCode || t("journalAcceptance.batch.missingCode") })}
      </a>
    );
  }
  if (!props.canCreate) return null;
  return (
    <Button
      type="button"
      variant="outline"
      disabled={props.busy}
      onClick={props.onCreate}
      title={t("journalAcceptance.batch.createHint")}
      className="h-9 w-full gap-1.5 rounded-xl border-[#5566f6]/30 bg-[#f5f6ff] px-4 text-[13.5px] font-medium text-[#5566f6] shadow-none transition-colors duration-150 hover:bg-[#eef1ff] sm:mr-auto sm:w-auto"
    >
      <Package className="size-4" />{t("journalAcceptance.batch.create")}</Button>
  );
}

/* ─── Row Dialog ─── */

function RowDialog(props: {
  documentKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: User[];
  config: AcceptanceDocumentConfig;
  initialRow: AcceptanceRow | null;
  /** «(k из N)» при правке выделенных строк по очереди. */
  titleSuffix?: string;
  /** Продукция всей организации (последние сверху) — поверх списка документа. */
  recentProducts?: readonly string[];
  onSave: (row: AcceptanceRow, addToLists: { products: string[]; manufacturers: string[]; suppliers: string[] }) => Promise<void>;
  /** Приёмка → партия. Отсутствует, если журнал закрыт. */
  onCreateBatch?: (row: AcceptanceRow) => Promise<AcceptanceRow | null>;
}) {
  const { t, feedback } = useAcceptanceCopy();
  const [row, setRow] = useState<AcceptanceRow>(() => createAcceptanceRow());
  const [newProduct, setNewProduct] = useState("");
  const [newManufacturer, setNewManufacturer] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [manufacturerOptions, setManufacturerOptions] = useState<string[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<string[]>([]);
  const [addedProducts, setAddedProducts] = useState<string[]>([]);
  const [addedManufacturers, setAddedManufacturers] = useState<string[]>([]);
  const [addedSuppliers, setAddedSuppliers] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const incomingRow = JSON.stringify([props.documentKey, props.open, props.initialRow, props.config.defaultResponsibleUserId, props.config.defaultResponsibleTitle, props.config.products, props.config.manufacturers, props.config.suppliers]);
  const lastIncomingRow = useRef<string | null>(null);
  useEffect(() => {
    if (lastIncomingRow.current === incomingRow) return;
    lastIncomingRow.current = incomingRow;
    if (!props.open) return;
    setRow(
      props.initialRow ||
        createAcceptanceRow({
          responsibleUserId: props.config.defaultResponsibleUserId || "",
          responsibleTitle: props.config.defaultResponsibleTitle || "",
          deliveryDate: localDayKey(),
        })
    );
    setNewProduct("");
    setNewManufacturer("");
    setNewSupplier("");
    setProductOptions(mergeSuggestions(props.recentProducts ?? [], props.config.products));
    setManufacturerOptions(props.config.manufacturers);
    setSupplierOptions(props.config.suppliers);
    setAddedProducts([]);
    setAddedManufacturers([]);
    setAddedSuppliers([]);
  }, [
    incomingRow,
    props.config.defaultResponsibleUserId,
    props.config.defaultResponsibleTitle,
    props.config.manufacturers,
    props.config.products,
    props.config.suppliers,
    props.initialRow,
    props.recentProducts,
    props.open,
  ]);

  function setValue<K extends keyof AcceptanceRow>(key: K, value: AcceptanceRow[K]) {
    setRow((current) => ({ ...current, [key]: value }));
  }

  const responsibleCascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: row.responsibleTitle,
    userId: row.responsibleUserId,
    onChange: (next) =>
      setRow((current) => ({
        ...current,
        responsibleTitle: next.positionTitle,
        responsibleUserId: next.userId,
      })),
    autoPick: "first",
  });

  function appendUnique(list: string[], value: string) {
    const normalized = value.trim();
    if (!normalized) return list;
    if (list.some((item) => item.toLowerCase() === normalized.toLowerCase())) return list;
    return [...list, normalized];
  }

  function addInlineOption(kind: "product" | "manufacturer" | "supplier") {
    if (kind === "product") {
      const value = newProduct.trim();
      if (!value) return;
      setProductOptions((current) => appendUnique(current, value));
      setAddedProducts((current) => appendUnique(current, value));
      setValue("productName", value);
      setNewProduct("");
      return;
    }

    if (kind === "manufacturer") {
      const value = newManufacturer.trim();
      if (!value) return;
      setManufacturerOptions((current) => appendUnique(current, value));
      setAddedManufacturers((current) => appendUnique(current, value));
      setValue("manufacturer", value);
      setNewManufacturer("");
      return;
    }

    const value = newSupplier.trim();
    if (!value) return;
    setSupplierOptions((current) => appendUnique(current, value));
    setAddedSuppliers((current) => appendUnique(current, value));
    setValue("supplier", value);
    setNewSupplier("");
  }

  async function handleSave() {
    setIsSubmitting(true);
    try {
      const newProducts = appendUnique(addedProducts, newProduct.trim());
      const newManufacturers = appendUnique(addedManufacturers, newManufacturer.trim());
      const newSuppliers = appendUnique(addedSuppliers, newSupplier.trim());
      // If user typed new product but didn't select, use it
      const finalRow = { ...row };
      if (newProduct.trim() && !finalRow.productName) finalRow.productName = newProduct.trim();
      if (newManufacturer.trim() && !finalRow.manufacturer) finalRow.manufacturer = newManufacturer.trim();
      if (newSupplier.trim() && !finalRow.supplier) finalRow.supplier = newSupplier.trim();
      // ФИО кладём в строку: после удаления сотрудника оно останется.
      const responsible = props.users.find((u) => u.id === finalRow.responsibleUserId);
      if (responsible?.name) finalRow.responsibleName = responsible.name;
      await props.onSave(finalRow, { products: newProducts, manufacturers: newManufacturers, suppliers: newSuppliers });
      // В режиме правки окно закрывает родитель: очередь правок может
      // открыть следующую строку.
      if (!isEdit) props.onOpenChange(false);
    } catch (error) {
      // Без catch ошибка сохранения глохла: окно висело, тоста не было.
      toast.error(feedback(error, "Не удалось сохранить строку", "journalAcceptance.errors.saveRow"));
    } finally {
      setIsSubmitting(false);
    }
  }

  const isEdit = !!props.initialRow;
  // Партию заводим только по уже сохранённой строке: до сохранения её
  // нечем пометить ссылкой.
  const canCreateBatch =
    !!props.onCreateBatch && isEdit && canCreateBatchFromAcceptanceRow(row);

  async function handleCreateBatch() {
    if (!props.onCreateBatch) return;
    setIsSubmitting(true);
    try {
      const nextRow = await props.onCreateBatch(row);
      if (nextRow) setRow(nextRow);
    } catch (error) {
      toast.error(feedback(error, "Не удалось создать партию", "journalAcceptance.errors.createBatch"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            {isEdit ? props.titleSuffix ? t("journalAcceptance.row.editProgressTitle", { progress: `${props.titleSuffix}` }) : t("journalAcceptance.row.editTitle") : t("journalAcceptance.row.addTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
          {/* Дата и время поставки */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.row.deliveryDateTime")}</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
              <Input aria-label={t("journalAcceptance.row.deliveryDateTime")} type="date" value={row.deliveryDate} onChange={(e) => setValue("deliveryDate", e.target.value)} className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
              <Select value={row.deliveryHour || "--"} onValueChange={(value) => setValue("deliveryHour", value === "--" ? "" : value)}>
                <SelectTrigger className={SELECT_TRIGGER_CLASS}><SelectValue placeholder={t("journalAcceptance.row.hourPlaceholder")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="--">{t("journalAcceptance.row.hourPlaceholder")}</SelectItem>
                  {HOURS.map((h) => <SelectItem key={h} value={h}>{t("journalAcceptance.row.hourOption", { hour: h })}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={row.deliveryMinute || "--"} onValueChange={(value) => setValue("deliveryMinute", value === "--" ? "" : value)}>
                <SelectTrigger className={SELECT_TRIGGER_CLASS}><SelectValue placeholder={t("journalAcceptance.row.minutePlaceholder")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="--">{t("journalAcceptance.row.minutePlaceholder")}</SelectItem>
                  {MINUTES.map((m) => <SelectItem key={m} value={m}>{t("journalAcceptance.row.minuteOption", { minute: m })}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Наименование продукции — radio cards */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("foodControlPdf.incomingControl.columns.productName")}</Label>
            <div className="flex flex-col gap-2">
              {Array.from(new Set(productOptions)).map((item) => {
                const active = row.productName === item;
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setValue("productName", item)}
                    className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-[14px] transition-colors ${
                      active
                        ? "border-[#5566f6] bg-[#f5f6ff] text-[#0b1024]"
                        : "border-[#dcdfed] bg-white text-[#3c4053] hover:bg-[#fafbff]"
                    }`}
                  >
                    <span className="font-medium">{item}</span>
                    <span className={`flex size-5 items-center justify-center rounded-full border-2 ${active ? "border-[#5566f6]" : "border-[#c7ccea]"}`}>
                      {active ? <span className="size-2 rounded-full bg-[#5566f6]" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Input value={newProduct} onChange={(e) => setNewProduct(e.target.value)} placeholder={t("journalAcceptance.row.newProduct")} className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
              <Button type="button" className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]" aria-label={t("journalAcceptance.row.newProduct")} onClick={() => addInlineOption("product")}>
                <Plus className="size-5" />
              </Button>
            </div>
          </div>

          {/* Производитель */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.row.manufacturer")}</Label>
            <Select
              value={toNone(row.manufacturer)}
              onValueChange={(value) => setValue("manufacturer", fromNone(value))}
            >
              <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder={t("journalAcceptance.row.chooseOrAdd")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>{t("journalAcceptance.row.chooseOrAdd")}</SelectItem>
                {Array.from(new Set(manufacturerOptions)).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Input value={newManufacturer} onChange={(e) => setNewManufacturer(e.target.value)} placeholder={t("journalAcceptance.row.newManufacturer")} className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
              <Button type="button" className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]" aria-label={t("journalAcceptance.row.newManufacturer")} onClick={() => addInlineOption("manufacturer")}>
                <Plus className="size-5" />
              </Button>
            </div>
          </div>

          {/* Поставщик */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.row.supplier")}</Label>
            <Select
              value={toNone(row.supplier)}
              onValueChange={(value) => setValue("supplier", fromNone(value))}
            >
              <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder={t("journalAcceptance.row.chooseOrAdd")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>{t("journalAcceptance.row.chooseOrAdd")}</SelectItem>
                {Array.from(new Set(supplierOptions)).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Input value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} placeholder={t("journalAcceptance.row.newSupplier")} className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
              <Button type="button" className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]" aria-label={t("journalAcceptance.row.newSupplier")} onClick={() => addInlineOption("supplier")}>
                <Plus className="size-5" />
              </Button>
            </div>
          </div>

          {/* Условия транспортировки — pill segmented */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.row.transport")}</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["satisfactory", t("foodControlPdf.acceptance.status.satisfactory"), "#136b2a", "#ecfdf5"],
                  ["unsatisfactory", t("foodControlPdf.acceptance.status.unsatisfactory"), "#d2453d", "#fff4f2"],
                ] as const
              ).map(([value, label, fg, bg]) => {
                const active = row.transportCondition === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setValue("transportCondition", value)}
                    className={`flex h-9 items-center justify-center gap-2 rounded-xl border px-3.5 text-[14px] font-medium transition-colors ${
                      active ? "border-transparent text-white" : "border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#fafbff]"
                    }`}
                    style={active ? { backgroundColor: fg, color: "white" } : { backgroundColor: bg, color: fg, borderColor: bg }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Соответствие упаковки — pill segmented */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.row.packaging")}</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["compliant", t("journalAcceptance.row.compliantShort"), "#136b2a", "#ecfdf5"],
                  ["non_compliant", t("foodControlPdf.acceptance.status.nonCompliant"), "#d2453d", "#fff4f2"],
                ] as const
              ).map(([value, label, fg, bg]) => {
                const active = row.packagingCompliance === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setValue("packagingCompliance", value)}
                    className={`flex h-9 items-center justify-center gap-2 rounded-xl border px-3.5 text-[14px] font-medium transition-colors ${
                      active ? "border-transparent text-white" : "border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#fafbff]"
                    }`}
                    style={active ? { backgroundColor: fg, color: "white" } : { backgroundColor: bg, color: fg, borderColor: bg }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Результаты орг. оценки — pill segmented */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.row.organoleptic")}</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["satisfactory", t("foodControlPdf.acceptance.status.satisfactory"), "#136b2a", "#ecfdf5"],
                  ["unsatisfactory", t("foodControlPdf.acceptance.status.unsatisfactory"), "#d2453d", "#fff4f2"],
                ] as const
              ).map(([value, label, fg, bg]) => {
                const active = row.organolepticResult === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setValue("organolepticResult", value)}
                    className={`flex h-9 items-center justify-center gap-2 rounded-xl border px-3.5 text-[14px] font-medium transition-colors ${
                      active ? "border-transparent text-white" : "border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#fafbff]"
                    }`}
                    style={active ? { backgroundColor: fg, color: "white" } : { backgroundColor: bg, color: fg, borderColor: bg }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Предельный срок реализации */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              {t(props.config.expiryFieldLabel === "shelf_life" ? "journalAcceptance.row.shelfLifeLabel" : "journalAcceptance.row.expiryDeadline")}
            </Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
              <Input aria-label={t("journalAcceptance.row.expiryDeadline")} type="date" value={row.expiryDate} onChange={(e) => setValue("expiryDate", e.target.value)} className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
              <Select value={row.expiryHour || "--"} onValueChange={(value) => setValue("expiryHour", value === "--" ? "" : value)}>
                <SelectTrigger className={SELECT_TRIGGER_CLASS}><SelectValue placeholder={t("journalAcceptance.row.hourPlaceholder")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="--">{t("journalAcceptance.row.hourPlaceholder")}</SelectItem>
                  {HOURS.map((h) => <SelectItem key={h} value={h}>{t("journalAcceptance.row.hourOption", { hour: h })}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={row.expiryMinute || "--"} onValueChange={(value) => setValue("expiryMinute", value === "--" ? "" : value)}>
                <SelectTrigger className={SELECT_TRIGGER_CLASS}><SelectValue placeholder={t("journalAcceptance.row.minutePlaceholder")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="--">{t("journalAcceptance.row.minutePlaceholder")}</SelectItem>
                  {MINUTES.map((m) => <SelectItem key={m} value={m}>{t("journalAcceptance.row.minuteOption", { minute: m })}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Примечание */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.row.notes")}</Label>
            <Textarea value={row.note} onChange={(e) => setValue("note", e.target.value)} placeholder={t("journalAcceptance.row.notes")} rows={3} className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]" />
          </div>

          {/* Должность ответственного + сотрудник */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.row.responsiblePosition")}</Label>
              <Select
                value={toNone(row.responsibleTitle)}
                onValueChange={(value) => responsibleCascade.handlePositionChange(fromNone(value))}
              >
                <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder={t("journalAcceptance.row.choose")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{t("journalAcceptance.row.choose")}</SelectItem>
                  <PositionSelectItems users={props.users} />
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalControls.positionSelect.employeeLabel")}</Label>
              <Select
                value={toNone(row.responsibleUserId)}
                onValueChange={(value) => {
                  const v = fromNone(value);
                  setValue("responsibleUserId", v);
                  if (!row.responsibleTitle) {
                    const user = props.users.find((u) => u.id === v);
                    if (user) setValue("responsibleTitle", getUserRoleLabel(user.role));
                  }
                }}
                open={responsibleCascade.employeeOpen}
                onOpenChange={responsibleCascade.setEmployeeOpen}
              >
                <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder={t("journalAcceptance.row.choose")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{t("journalAcceptance.row.choose")}</SelectItem>
                  {(row.responsibleTitle ? responsibleCascade.candidates : props.users).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
          <RowBatchFooterAction
            row={row}
            canCreate={canCreateBatch}
            busy={isSubmitting}
            onCreate={handleCreateBatch}
          />
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff] sm:w-auto"
            onClick={() => props.onOpenChange(false)}
          >{t("common.cancel")}</Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting}
            className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
          >
            {isSubmitting ? t("common.saving") : isEdit ? t("common.save") : t("common.add")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Row Dialog v2 · «Приемка и входной контроль продукции» ─── */

/**
 * Форма строки для `incoming_control` — ровно 11 колонок эталона
 * (docs/reference/haccp-online/screenshots/incoming_control-grid.png).
 *
 * Пишет только v2-ключи строки; legacy-поля (`transportCondition` и др.)
 * не трогает — они остаются такими, какими пришли, чтобы старые записи
 * не «переписывались» при редактировании.
 */
function IncomingControlRowDialog(props: {
  documentKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: User[];
  config: AcceptanceDocumentConfig;
  initialRow: AcceptanceRow | null;
  /** «(k из N)» при правке выделенных строк по очереди. */
  titleSuffix?: string;
  /** Продукция всей организации (последние сверху) — поверх списка документа. */
  recentProducts?: readonly string[];
  onSave: (
    row: AcceptanceRow,
    addToLists: { products: string[]; manufacturers: string[]; suppliers: string[] }
  ) => Promise<void>;
  /** Приёмка → партия. Отсутствует, если журнал закрыт. */
  onCreateBatch?: (row: AcceptanceRow) => Promise<AcceptanceRow | null>;
}) {
  const { t, feedback } = useAcceptanceCopy();
  const [row, setRow] = useState<AcceptanceRow>(() => createAcceptanceRow());
  const [newProduct, setNewProduct] = useState("");
  const [newPartner, setNewPartner] = useState("");
  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [partnerOptions, setPartnerOptions] = useState<string[]>([]);
  const [addedProducts, setAddedProducts] = useState<string[]>([]);
  const [addedPartners, setAddedPartners] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const incomingRow = JSON.stringify([props.documentKey, props.open, props.initialRow, props.config.defaultResponsibleUserId, props.config.defaultResponsibleTitle, props.config.products, props.config.manufacturers, props.config.suppliers]);
  const lastIncomingRow = useRef<string | null>(null);
  useEffect(() => {
    if (lastIncomingRow.current === incomingRow) return;
    lastIncomingRow.current = incomingRow;
    if (!props.open) return;
    setRow(
      props.initialRow ||
        createAcceptanceRow({
          responsibleUserId: props.config.defaultResponsibleUserId || "",
          responsibleTitle: props.config.defaultResponsibleTitle || "",
          deliveryDate: localDayKey(),
          shelfLifeDate: "",
          manufacturerSupplier: "",
          accompanyingDocs: "",
          batchInfo: "",
          productTemperature: "",
          documentCompliance: "",
          acceptanceDecision: "accept",
          correctiveActions: "",
        })
    );
    setNewProduct("");
    setNewPartner("");
    setProductOptions(mergeSuggestions(props.recentProducts ?? [], props.config.products));
    setPartnerOptions([
      ...new Set([...props.config.manufacturers, ...props.config.suppliers]),
    ]);
    setAddedProducts([]);
    setAddedPartners([]);
  }, [
    incomingRow,
    props.config.defaultResponsibleUserId,
    props.config.defaultResponsibleTitle,
    props.config.manufacturers,
    props.config.products,
    props.config.suppliers,
    props.initialRow,
    props.recentProducts,
    props.open,
  ]);

  function setValue<K extends keyof AcceptanceRow>(key: K, value: AcceptanceRow[K]) {
    setRow((current) => ({ ...current, [key]: value }));
  }

  const responsibleCascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: row.responsibleTitle,
    userId: row.responsibleUserId,
    onChange: (next) =>
      setRow((current) => ({
        ...current,
        responsibleTitle: next.positionTitle,
        responsibleUserId: next.userId,
      })),
    autoPick: "first",
  });

  function appendUnique(list: string[], value: string) {
    const normalized = value.trim();
    if (!normalized) return list;
    if (list.some((item) => item.toLowerCase() === normalized.toLowerCase())) return list;
    return [...list, normalized];
  }

  async function handleSave() {
    setIsSubmitting(true);
    try {
      const products = appendUnique(addedProducts, newProduct.trim());
      const partners = appendUnique(addedPartners, newPartner.trim());
      const finalRow: AcceptanceRow = { ...row };
      if (newProduct.trim() && !finalRow.productName) finalRow.productName = newProduct.trim();
      if (newPartner.trim() && !finalRow.manufacturerSupplier) {
        finalRow.manufacturerSupplier = newPartner.trim();
      }
      // Зеркалим в legacy-поля: «Годен до» → expiryDate (cron сроков
      // годности), корректирующие действия → note (карточки, mini).
      finalRow.expiryDate = finalRow.shelfLifeDate;
      finalRow.note = finalRow.correctiveActions;
      // ФИО кладём в строку: после удаления сотрудника оно останется.
      const responsible = props.users.find((u) => u.id === finalRow.responsibleUserId);
      if (responsible?.name) finalRow.responsibleName = responsible.name;
      await props.onSave(finalRow, {
        products,
        // Объединённая колонка — новые контрагенты кладём в справочник
        // производителей, он же питает подсказки этой формы.
        manufacturers: partners,
        suppliers: [],
      });
      // См. RowDialog: при правке закрывает родитель (очередь правок).
      if (!isEdit) props.onOpenChange(false);
    } catch (error) {
      toast.error(feedback(error, "Не удалось сохранить строку", "journalAcceptance.errors.saveRow"));
    } finally {
      setIsSubmitting(false);
    }
  }

  const isEdit = !!props.initialRow;
  // См. RowDialog: партия заводится только по сохранённой строке и один раз.
  const canCreateBatch =
    !!props.onCreateBatch && isEdit && canCreateBatchFromAcceptanceRow(row);

  async function handleCreateBatch() {
    if (!props.onCreateBatch) return;
    setIsSubmitting(true);
    try {
      const nextRow = await props.onCreateBatch(row);
      if (nextRow) setRow(nextRow);
    } catch (error) {
      toast.error(feedback(error, "Не удалось создать партию", "journalAcceptance.errors.createBatch"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            {isEdit ? props.titleSuffix ? t("journalAcceptance.row.editProgressTitle", { progress: `${props.titleSuffix}` }) : t("journalAcceptance.row.editTitle") : t("journalAcceptance.row.addTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <DateField
              calendarCopy={acceptanceCalendarCopy(t)}
              label={t("foodControlPdf.incomingControl.columns.deliveryDate")}
              value={row.deliveryDate}
              onChange={(value) => setValue("deliveryDate", value)}
            />
            {/* Время поставки печатается в бланке и показывается в карточке,
                но раньше в этом окне его негде было задать или поправить —
                оно приходило только из импорта, Меркурия и TasksFlow. */}
            <TimeField
              label={t("journalAcceptance.row.deliveryTime")}
              value={joinTimeValue(row.deliveryHour, row.deliveryMinute)}
              onChange={(value) => {
                const { hour, minute } = splitTimeValue(value);
                setRow((current) => ({ ...current, deliveryHour: hour, deliveryMinute: minute }));
              }}
            />
            <DateField
              calendarCopy={acceptanceCalendarCopy(t)}
              label={t("foodControlPdf.incomingControl.columns.shelfLifeDate")}
              value={row.shelfLifeDate}
              onChange={(value) => setValue("shelfLifeDate", value)}
            />
          </div>

          {/* Наименование продукции */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("foodControlPdf.incomingControl.columns.productName")}</Label>
            <div className="flex flex-col gap-2">
              {Array.from(new Set(productOptions)).map((item) => {
                const active = row.productName === item;
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setValue("productName", item)}
                    className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-[14px] transition-colors duration-150 ${
                      active
                        ? "border-[#5566f6] bg-[#f5f6ff] text-[#0b1024]"
                        : "border-[#dcdfed] bg-white text-[#3c4053] hover:bg-[#fafbff]"
                    }`}
                  >
                    <span className="font-medium">{item}</span>
                    <span
                      className={`flex size-5 items-center justify-center rounded-full border-2 ${active ? "border-[#5566f6]" : "border-[#c7ccea]"}`}
                    >
                      {active ? <span className="size-2 rounded-full bg-[#5566f6]" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Input
                value={newProduct}
                onChange={(e) => setNewProduct(e.target.value)}
                placeholder={t("journalAcceptance.row.newProduct")}
                className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
              />
              <Button
                type="button"
                className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
                onClick={() => {
                  const value = newProduct.trim();
                  if (!value) return;
                  setProductOptions((current) => appendUnique(current, value));
                  setAddedProducts((current) => appendUnique(current, value));
                  setValue("productName", value);
                  setNewProduct("");
                }}
              >
                <Plus className="size-5" />
              </Button>
            </div>
          </div>

          {/* Производитель/поставщик — ОДНА колонка */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("foodControlPdf.incomingControl.columns.manufacturerSupplier")}</Label>
            <Select
              value={toNone(row.manufacturerSupplier)}
              onValueChange={(value) => setValue("manufacturerSupplier", fromNone(value))}
            >
              <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder={t("journalAcceptance.row.chooseOrAdd")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>{t("journalAcceptance.row.chooseOrAdd")}</SelectItem>
                {Array.from(new Set(partnerOptions)).map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Input
                value={newPartner}
                onChange={(e) => setNewPartner(e.target.value)}
                placeholder={t("journalAcceptance.row.newManufacturerSupplier")}
                className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
              />
              <Button
                type="button"
                className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
                onClick={() => {
                  const value = newPartner.trim();
                  if (!value) return;
                  setPartnerOptions((current) => appendUnique(current, value));
                  setAddedPartners((current) => appendUnique(current, value));
                  setValue("manufacturerSupplier", value);
                  setNewPartner("");
                }}
              >
                <Plus className="size-5" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("foodControlPdf.incomingControl.columns.accompanyingDocs")}</Label>
            <Textarea
              value={row.accompanyingDocs}
              onChange={(e) => setValue("accompanyingDocs", e.target.value)}
              placeholder={t("journalAcceptance.row.docsExample")}
              rows={2}
              className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("foodControlPdf.incomingControl.columns.batchInfo")}</Label>
            <Textarea
              value={row.batchInfo}
              onChange={(e) => setValue("batchInfo", e.target.value)}
              placeholder={t("journalAcceptance.row.batchExample")}
              rows={2}
              className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.row.temperature")}</Label>
            <Input
              value={row.productTemperature}
              onChange={(e) => setValue("productTemperature", e.target.value)}
              placeholder={t("journalAcceptance.row.temperatureExample")}
              className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
            />
          </div>

          {/* Соответствие товара сопроводительной документации */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("foodControlPdf.incomingControl.columns.documentCompliance")}</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["Соответствует", "journalAcceptance.row.documentCompliantOption", "#136b2a", "#ecfdf5"],
                  ["Не соответствует", "journalAcceptance.row.documentNonCompliantOption", "#d2453d", "#fff4f2"],
                ] as const
              ).map(([label, labelKey, fg, bg]) => {
                const active = row.documentCompliance === label;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setValue("documentCompliance", label)}
                    className={`flex h-9 items-center justify-center gap-2 rounded-xl border px-3.5 text-[14px] font-medium transition-colors duration-150 ${
                      active
                        ? "border-transparent text-white"
                        : "border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#fafbff]"
                    }`}
                    style={
                      active
                        ? { backgroundColor: fg, color: "white" }
                        : { backgroundColor: bg, color: fg, borderColor: bg }
                    }
                  >
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>
            <Textarea
              value={row.documentCompliance}
              onChange={(e) => setValue("documentCompliance", e.target.value)}
              placeholder={t("journalAcceptance.row.documentationPlaceholder")}
              rows={2}
              className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]"
            />
          </div>

          {/* Опциональная 12-я колонка: показывается только когда
              включён тумблер «Добавить поля» (I1 аудита). */}
          {props.config.showPackagingCompliance ? (
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">
                {t("foodControlPdf.incomingControl.columns.packagingCompliance")}
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["compliant", t("foodControlPdf.incomingControl.packaging.compliant"), "#136b2a", "#ecfdf5"],
                    ["non_compliant", t("journalAcceptance.row.nonCompliantFull"), "#d2453d", "#fff4f2"],
                  ] as const
                ).map(([value, label, fg, bg]) => {
                  const active = row.packagingCompliance === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setValue("packagingCompliance", value)}
                      className={`flex h-9 items-center justify-center gap-2 rounded-xl border px-3.5 text-[14px] font-medium transition-colors duration-150 ${
                        active
                          ? "border-transparent text-white"
                          : "border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#fafbff]"
                      }`}
                      style={
                        active
                          ? { backgroundColor: fg, color: "white" }
                          : { backgroundColor: bg, color: fg, borderColor: bg }
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.row.decision")}</Label>
              <Select
                value={toNone(row.acceptanceDecision)}
                onValueChange={(value) =>
                  setValue(
                    "acceptanceDecision",
                    fromNone(value) as AcceptanceRow["acceptanceDecision"]
                  )
                }
              >
                <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder={t("journalAcceptance.row.choose")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{t("journalAcceptance.row.choose")}</SelectItem>
                  <SelectItem value="accept">{t("journalAcceptance.row.acceptFull")}</SelectItem>
                  <SelectItem value="reject">{t("journalAcceptance.row.rejectFull")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.row.correctiveActions")}</Label>
            <Textarea
              value={row.correctiveActions}
              onChange={(e) => setValue("correctiveActions", e.target.value)}
              placeholder={t("journalAcceptance.row.correctiveExample")}
              rows={3}
              className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]"
            />
          </div>

          {/* Ответственный — должность + сотрудник, как в остальных журналах */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.row.responsiblePosition")}</Label>
              <Select
                value={toNone(row.responsibleTitle)}
                onValueChange={(value) => responsibleCascade.handlePositionChange(fromNone(value))}
              >
                <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder={t("journalAcceptance.row.choose")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{t("journalAcceptance.row.choose")}</SelectItem>
                  <PositionSelectItems users={props.users} />
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("foodControlPdf.incomingControl.columns.responsible")}</Label>
              <Select
                value={toNone(row.responsibleUserId)}
                onValueChange={(value) => {
                  const v = fromNone(value);
                  setValue("responsibleUserId", v);
                  if (!row.responsibleTitle) {
                    const user = props.users.find((u) => u.id === v);
                    if (user) setValue("responsibleTitle", getUserRoleLabel(user.role));
                  }
                }}
                open={responsibleCascade.employeeOpen}
                onOpenChange={responsibleCascade.setEmployeeOpen}
              >
                <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder={t("journalAcceptance.row.choose")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{t("journalAcceptance.row.choose")}</SelectItem>
                  {(row.responsibleTitle
                    ? responsibleCascade.candidates
                    : props.users
                  ).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
          <RowBatchFooterAction
            row={row}
            canCreate={canCreateBatch}
            busy={isSubmitting}
            onCreate={handleCreateBatch}
          />
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff] sm:w-auto"
            onClick={() => props.onOpenChange(false)}
          >{t("common.cancel")}</Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting}
            className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0] sm:w-auto"
          >
            {isSubmitting ? t("common.saving") : isEdit ? t("common.save") : t("common.add")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Settings Dialog ─── */

function EditableListSection(props: {
  title: string;
  items: string[];
  placeholder: string;
  onChange: (items: string[]) => void;
  /** Встречается ли позиция в строках журнала — для предупреждения. */
  isUsed?: (item: string) => boolean;
  /** Вид общего справочника организации, откуда можно добрать позиции. */
  directoryKind?: OrgDirectoryKind;
}) {
  const { t, say, committed } = useAcceptanceCopy();
  const [draft, setDraft] = useState("");
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [importError, setImportError] = useState<AcceptanceDiagnostic | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function upsertValue(nextValue: string) {
    const trimmed = nextValue.trim();
    if (!trimmed) return;
    const withoutEdited = editingValue
      ? props.items.filter((item) => item !== editingValue)
      : props.items;
    if (withoutEdited.includes(trimmed)) {
      setDraft("");
      setEditingValue(null);
      return;
    }
    props.onChange([...withoutEdited, trimmed]);
    setDraft("");
    setEditingValue(null);
  }

  /** Удаление ошибочно добавленной позиции справочника. */
  async function removeValue(item: string) {
    const used = props.isUsed?.(item) === true;
    const confirmed = await confirmAsync({
      locale: committed.current.locale,
      title: say("journalAcceptance.lists.removeTitle", { item: `${item}` }),
      description: say("journalAcceptance.lists.removeDescription"),
      variant: used ? "warn" : "danger",
      confirmLabel: say("common.delete"),
      bullets: used
        ? [
            {
              label: say("journalAcceptance.lists.usedWarning"),
              tone: "warn" as const,
            },
          ]
        : undefined,
    });
    if (!confirmed) return;
    props.onChange(props.items.filter((value) => value !== item));
    if (editingValue === item) {
      setEditingValue(null);
      setDraft("");
    }
    toast.success(say("journalAcceptance.lists.removed", { item: `${item}` }));
  }

  async function handleImport(file: File) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw tagAcceptanceError(new Error("Файл не содержит листов"), [{ key: "journalAcceptance.errors.fileNoSheets" }]);
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    const importedItems = parseListImportItems(rawRows);
    if (importedItems.length === 0) {
      throw tagAcceptanceError(new Error("Не удалось найти значения в первом столбце первого листа"), [{ key: "journalAcceptance.errors.fileNoValues" }]);
    }
    props.onChange(
      [...props.items, ...importedItems].filter(
        (value, index, list) => list.indexOf(value) === index
      )
    );
    setImportOpen(false);
    setImportError(null);
  }

  return (
    <div className="space-y-3">
      <div className="text-[16px] font-semibold">{props.title}</div>
      {Array.from(new Set(props.items)).map((item) => (
        <div
          key={item}
          className="flex items-center justify-between rounded-xl bg-[#f9f9fc] px-4 py-3"
        >
          {/* Чекбокс убран: он ничего не выбирал и вводил в заблуждение. */}
          <span className="text-[15px]">{item}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-lg p-2 text-[#5566f6] transition-colors duration-150 hover:bg-[#eef1ff] hover:text-[#4a5bf0]"
              title={t("journalAcceptance.lists.rename")}
              onClick={() => {
                setDraft(item);
                setEditingValue(item);
              }}
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              className="rounded-lg p-2 text-[#9a9db0] transition-colors duration-150 hover:bg-[#fff2f1] hover:text-[#ff3b30]"
              title={t("journalAcceptance.lists.remove")}
              onClick={() => void removeValue(item)}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={props.placeholder}
          className="h-12 rounded-xl border-[#dcdfed] px-4 text-[15px]"
        />
        <Button
          type="button"
          className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
          onClick={() => upsertValue(draft)}
        >
          <Plus className="size-5" />
        </Button>
      </div>
      <button
        type="button"
        className="text-left text-[15px] text-[#5566f6] underline underline-offset-4"
        onClick={() => {
          setImportOpen((current) => !current);
          setImportError(null);
        }}
      >{t("journalAcceptance.lists.addFromFile")}</button>
      {props.directoryKind ? (
        <>
          <button
            type="button"
            className="ml-4 text-left text-[15px] text-[#3848c7] underline underline-offset-4"
            onClick={() => setDirectoryOpen(true)}
            title={t("journalAcceptance.lists.directoryTitle")}
          >{t("journalAcceptance.lists.directoryAction")}</button>
          <OrgDirectoryDialog
            open={directoryOpen}
            onClose={() => setDirectoryOpen(false)}
            kind={props.directoryKind}
            existing={props.items}
            onAdd={(items) => props.onChange(mergeIntoList(props.items, items))}
          />
        </>
      ) : null}
      {importOpen && (
        <div className="space-y-3 rounded-2xl border border-[#e3e5ef] bg-white p-4">
          <div className="text-[14px] leading-6 text-[#3d4152]">
            {t("journalAcceptance.lists.fileHelp")}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void handleImport(file).catch((error) =>
                setImportError(getErrorMessage(error, "Ошибка импорта", "journalAcceptance.errors.import"))
              );
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              const file = event.dataTransfer.files?.[0];
              if (file) {
                void handleImport(file).catch((error) =>
                  setImportError(getErrorMessage(error, "Ошибка импорта", "journalAcceptance.errors.import"))
                );
              }
            }}
            className={`flex min-h-[148px] w-full flex-col items-center justify-center gap-3 rounded-[24px] border border-dashed px-6 py-8 text-center ${
              dragActive ? "border-[#5566f6] bg-[#f6f7ff]" : "border-[#dcdfed] bg-white"
            }`}
          >
            <Paperclip className="size-8 text-[#6f7282]" />
            <span className="text-[18px] text-[#5566f6]">{t("journalAcceptance.import.chooseFile")}</span>
            <span className="text-[16px] text-[#3d4152]">{t("journalAcceptance.import.dropFile")}</span>
          </button>
          {importError ? (
            <div className="rounded-xl bg-[#fff2f1] px-4 py-3 text-[14px] text-[#d43a2f]">
              {formatAcceptanceDiagnostic(importError, t)}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function IncomingControlEditListsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: AcceptanceDocumentConfig;
  setConfig: (config: AcceptanceDocumentConfig) => void;
}) {
  const { t } = useAcceptanceCopy();
  const [products, setProducts] = useState<string[]>(() => [...props.config.products]);
  const [manufacturers, setManufacturers] = useState<string[]>(() => [...props.config.manufacturers]);
  const [suppliers, setSuppliers] = useState<string[]>(() => [...props.config.suppliers]);

  function handleClose() {
    props.setConfig({ ...props.config, products, manufacturers, suppliers });
    props.onOpenChange(false);
  }

  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open) handleClose(); else props.onOpenChange(true); }}>
      <DialogContent closeLabel={t("common.close")} className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>{t("journalAcceptance.lists.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 px-6 py-5">
          <EditableListSection
            title={t("journalAcceptance.lists.products")}
            items={products}
            placeholder={t("journalAcceptance.lists.newProduct")}
            onChange={setProducts}
            directoryKind="product"
            isUsed={(item) => props.config.rows.some((row) => row.productName === item)}
          />
          <EditableListSection
            title={t("journalAcceptance.lists.manufacturers")}
            items={manufacturers}
            placeholder={t("journalAcceptance.lists.newManufacturer")}
            onChange={setManufacturers}
            directoryKind="manufacturer"
            isUsed={(item) =>
              props.config.rows.some(
                (row) =>
                  row.manufacturer === item || row.manufacturerSupplier.includes(item)
              )
            }
          />
          <EditableListSection
            title={t("journalAcceptance.lists.suppliers")}
            items={suppliers}
            placeholder={t("journalAcceptance.lists.newSupplier")}
            onChange={setSuppliers}
            directoryKind="supplier"
            isUsed={(item) =>
              props.config.rows.some(
                (row) => row.supplier === item || row.manufacturerSupplier.includes(item)
              )
            }
          />
          <div className="flex justify-end">
            <Button type="button" onClick={handleClose} className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4a5bf0]">{t("common.close")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog(props: {
  documentKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  dateFrom: string;
  users: User[];
  config: AcceptanceDocumentConfig;
  onSave: (params: { title: string; dateFrom: string; config: AcceptanceDocumentConfig }) => Promise<void>;
  useV2?: boolean;
  /**
   * Выбор подписи колонки срока относился к таблице контроля СЫРЬЯ.
   * В приёмке продукции колонка называется «Годен до» всегда — группу
   * там не показываем.
   */
  showExpiryLabelChoice?: boolean;
}) {
  const { t } = useAcceptanceCopy();
  const [title, setTitle] = useState(props.title);
  const [dateFrom, setDateFrom] = useState(props.dateFrom);
  const [expiryLabel, setExpiryLabel] = useState(props.config.expiryFieldLabel);
  const [responsibleTitle, setResponsibleTitle] = useState(props.config.defaultResponsibleTitle || "");
  const [responsibleUserId, setResponsibleUserId] = useState(props.config.defaultResponsibleUserId || "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const settingsCascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: responsibleTitle,
    userId: responsibleUserId,
    onChange: (next) => {
      setResponsibleTitle(next.positionTitle);
      setResponsibleUserId(next.userId);
    },
    autoPick: "none",
  });

  const incomingSettings = JSON.stringify([props.documentKey, props.open, props.title, props.dateFrom, props.config]);
  const lastIncomingSettings = useRef<string | null>(null);
  useEffect(() => {
    if (lastIncomingSettings.current === incomingSettings) return;
    lastIncomingSettings.current = incomingSettings;
    if (!props.open) return;
    setTitle(props.title);
    setDateFrom(props.dateFrom);
    setExpiryLabel(props.config.expiryFieldLabel);
    setResponsibleTitle(props.config.defaultResponsibleTitle || "");
    setResponsibleUserId(props.config.defaultResponsibleUserId || "");
  }, [incomingSettings, props.open, props.title, props.dateFrom, props.config]);

  async function handleSave() {
    setIsSubmitting(true);
    try {
      await props.onSave({
        title: title.trim(),
        dateFrom,
        config: {
          ...props.config,
          expiryFieldLabel: expiryLabel,
          defaultResponsibleTitle: responsibleTitle || null,
          defaultResponsibleUserId: responsibleUserId || null,
        },
      });
      props.onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  const fields = (
    <>
      <div className="space-y-2">
        <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{t("journalAcceptance.settings.documentTitle")}</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{t("journalAcceptance.settings.dateFrom")}</Label>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
        />
      </div>
      {props.showExpiryLabelChoice === false ? null : (
      <div className="space-y-2">
        <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{t("journalAcceptance.settings.fieldNameV2")}</div>
        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 transition-colors hover:bg-[#f5f6ff]">
          <input
            type="radio"
            name="expiryLabel-v2"
            checked={expiryLabel === "expiry_deadline"}
            onChange={() => setExpiryLabel("expiry_deadline")}
            className="size-4 accent-[#5566f6]"
          />
          <span className="text-[14px] text-[#0b1024]">
            «{t("journalAcceptance.settings.expiryDeadlineChoice")}»
          </span>
        </label>
        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 transition-colors hover:bg-[#f5f6ff]">
          <input
            type="radio"
            name="expiryLabel-v2"
            checked={expiryLabel === "shelf_life"}
            onChange={() => setExpiryLabel("shelf_life")}
            className="size-4 accent-[#5566f6]"
          />
          <span className="text-[14px] text-[#0b1024]">«{t("journalAcceptance.settings.shelfLifeChoice")}»</span>
        </label>
      </div>
      )}
      <div className="space-y-2">
        <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{t("journalAcceptance.row.responsiblePosition")}</Label>
        <Select
          value={
            // Если title не задан, но employee есть — деривируем title
            // из его должности, чтобы dropdown показывал что-то осмысленное.
            responsibleTitle ||
            (() => {
              const u = props.users.find((u2) => u2.id === responsibleUserId);
              return u ? getUserRoleLabel(u.role) : "";
            })()
          }
          onValueChange={settingsCascade.handlePositionChange}
        >
          <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
            <SelectValue placeholder={t("journalAcceptance.row.choose")} />
          </SelectTrigger>
          <SelectContent>
            <PositionSelectItems users={props.users} />
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{t("journalControls.positionSelect.employeeLabel")}</Label>
        <Select
          value={responsibleUserId}
          onValueChange={(v) => {
            setResponsibleUserId(v);
            // Auto-sync title с фактической должностью сотрудника, чтобы
            // preview-карточка показывала «Должность: ФИО».
            const user = props.users.find((u) => u.id === v);
            if (user) setResponsibleTitle(getUserRoleLabel(user.role));
          }}
          open={settingsCascade.employeeOpen}
          onOpenChange={settingsCascade.setEmployeeOpen}
        >
          <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
            <SelectValue placeholder={t("journalAcceptance.row.choose")} />
          </SelectTrigger>
          <SelectContent>
            {(responsibleTitle
              ? settingsCascade.candidates
              : props.users
            ).map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );

  if (props.useV2) {
    return (
      <JournalSettingsModal
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={t("journalAcceptance.settings.title")}
        description={t("journalAcceptance.settings.description")}
        size="md"
        isSaving={isSubmitting}
        onSave={handleSave}
        onCancel={() => props.onOpenChange(false)}
      >
        {fields}
      </JournalSettingsModal>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>{t("journalAcceptance.settings.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6 py-5">
          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.settings.documentTitle")}</Label>
            <Input aria-label={t("journalAcceptance.settings.documentTitle")} value={title} onChange={(e) => setTitle(e.target.value)} className="h-10 rounded-xl border-[#dcdfed] px-5 text-[16px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.settings.dateFrom")}</Label>
            <Input aria-label={t("journalAcceptance.settings.dateFrom")} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-10 rounded-xl border-[#dcdfed] px-5 text-[16px]" />
          </div>
          {props.showExpiryLabelChoice === false ? null : (
          <div className="space-y-2">
            <div className="text-[14px] font-semibold">{t("journalAcceptance.settings.fieldName")}</div>
            <label className="flex items-center gap-2 text-[15px]">
              <input type="radio" name="expiryLabel" checked={expiryLabel === "expiry_deadline"} onChange={() => setExpiryLabel("expiry_deadline")} className="size-4 accent-[#5566f6]" />
              &quot;{t("journalAcceptance.settings.expiryDeadlineChoice")}&quot;
            </label>
            <label className="flex items-center gap-2 text-[15px]">
              <input type="radio" name="expiryLabel" checked={expiryLabel === "shelf_life"} onChange={() => setExpiryLabel("shelf_life")} className="size-4 accent-[#5566f6]" />
              &quot;{t("journalAcceptance.settings.shelfLifeChoice")}&quot;
            </label>
          </div>
          )}
          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.row.responsiblePosition")}</Label>
            <Select
              value={
                responsibleTitle ||
                (() => {
                  const u = props.users.find((u2) => u2.id === responsibleUserId);
                  return u ? getUserRoleLabel(u.role) : "";
                })()
              }
              onValueChange={settingsCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#f3f4fb] px-3.5 text-[16px]"><SelectValue placeholder={t("journalControls.positionSelect.chooseEmployee")} /></SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={props.users} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalControls.positionSelect.employeeLabel")}</Label>
            <Select value={responsibleUserId} onValueChange={(v) => {
              setResponsibleUserId(v);
              const user = props.users.find((u) => u.id === v);
              if (user) setResponsibleTitle(getUserRoleLabel(user.role));
            }} open={settingsCascade.employeeOpen} onOpenChange={settingsCascade.setEmployeeOpen}>
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#f3f4fb] px-3.5 text-[16px]"><SelectValue placeholder={t("journalControls.positionSelect.chooseEmployee")} /></SelectTrigger>
              <SelectContent>
                {(responsibleTitle ? settingsCascade.candidates : props.users).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end pt-2">
            <Button type="button" onClick={handleSave} disabled={isSubmitting} className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4a5bf0]">
              {isSubmitting ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportRowsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  responsibleTitle: string;
  responsibleUserId: string;
  users: User[];
  /** true — журнал приёмки продукции (11 колонок бланка incoming_control). */
  isProductAcceptance: boolean;
  onFileSelect: (file: File) => Promise<void>;
}) {
  const { t, say } = useAcceptanceCopy();
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<AcceptanceDiagnostic | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setDragActive(false);
    setSubmitting(false);
    setErrorMessage(null);
  }, [props.open]);

  async function handleFile(file: File) {
    setSubmitting(true);
    try {
      setErrorMessage(null);
      await props.onFileSelect(file);
      props.onOpenChange(false);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Ошибка импорта", "journalAcceptance.errors.import"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>{t("journalAcceptance.import.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 px-6 py-5 text-[16px] text-black">
          <div className="space-y-3 leading-7 text-[#333]">
            <p>{t("journalAcceptance.import.help")}</p>
            <p>{t("journalAcceptance.import.columnsHelp")}</p>
            {props.isProductAcceptance ? (
              <div className="space-y-1">
                <div>{t("journalAcceptance.import.productColumn1")}</div>
                <div>{t("journalAcceptance.import.productColumn2")}</div>
                <div>{t("journalAcceptance.import.productColumn3")}</div>
                <div>{t("journalAcceptance.import.productColumn4")}</div>
                <div>{t("journalAcceptance.import.productColumn5")}</div>
                <div>{t("journalAcceptance.import.productColumn6")}</div>
                <div>{t("journalAcceptance.import.productColumn7")}</div>
                <div>{t("journalAcceptance.import.productColumn8")}</div>
                <div>{t("journalAcceptance.import.productColumn9")}</div>
                <div>{t("journalAcceptance.import.productColumn10")}</div>
                <div>{t("journalAcceptance.import.productColumn11")}</div>
              </div>
            ) : (
              <div className="space-y-1">
                <div>{t("journalAcceptance.import.rawColumn1")}</div>
                <div>{t("journalAcceptance.import.rawColumn2")}</div>
                <div>{t("journalAcceptance.import.rawColumn3")}</div>
                <div>{t("journalAcceptance.import.rawColumn4")}</div>
                <div>{t("journalAcceptance.import.rawColumn5")}</div>
                <div>{t("journalAcceptance.import.rawColumn6")}</div>
                <div>{t("journalAcceptance.import.rawColumn7")}</div>
                <div>{t("journalAcceptance.import.rawColumn8")}</div>
                <div>{t("journalAcceptance.import.rawColumn9")}</div>
                <div>{t("journalAcceptance.import.rawColumn10")}</div>
                <div>{t("journalAcceptance.import.rawColumn11")}</div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => downloadAcceptanceImportTemplate(props.isProductAcceptance, say)}
            className="text-[16px] text-[#5566f6] underline underline-offset-4"
          >{t("journalAcceptance.import.downloadExample")}</button>

          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
              event.currentTarget.value = "";
            }}
          />

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void handleFile(file);
            }}
            className={`flex min-h-[200px] w-full flex-col items-center justify-center gap-4 rounded-[24px] border border-dashed px-6 py-8 text-center ${
              dragActive ? "border-[#5566f6] bg-[#f6f7ff]" : "border-[#dcdfed] bg-white"
            }`}
          >
            <Paperclip className="size-10 text-[#6f7282]" />
            <span className="text-[15px] text-[#5566f6]">{t("journalAcceptance.import.chooseFile")}</span>
            <span className="text-[18px] text-[#3d4152]">{t("journalAcceptance.import.dropFile")}</span>
          </button>
          {errorMessage ? (
            <div className="whitespace-pre-line rounded-xl bg-[#fff2f1] px-4 py-3 text-[14px] text-[#d43a2f]">
              {formatAcceptanceDiagnostic(errorMessage, t)}
            </div>
          ) : null}

          <div className="space-y-3">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.row.responsiblePosition")}</Label>
            <div className="flex h-14 items-center rounded-2xl border border-[#dcdfed] bg-[#f3f4fb] px-5 text-[16px]">
              {props.responsibleTitle || "—"}
            </div>
          </div>
          <div className="space-y-3">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalControls.positionSelect.employeeLabel")}</Label>
            <div className="flex h-14 items-center rounded-2xl border border-[#dcdfed] bg-[#f3f4fb] px-5 text-[16px]">
              {props.users.find((user) => user.id === props.responsibleUserId)?.name || "—"}
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              disabled={submitting}
              onClick={() => inputRef.current?.click()}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4a5bf0]"
            >
              {submitting ? t("journalAcceptance.actions.adding") : t("common.add")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── iiko Dialog ─── */

function AddMultipleRowsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (count: number) => Promise<void>;
  /** «С фото накладной»: распознанные позиции — сразу строками журнала. */
  onPhotoItems: (items: VisionRawItem[]) => Promise<RecognizeResult>;
}) {
  const { t } = useAcceptanceCopy();
  const [count, setCount] = useState("5");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<AcceptanceDiagnostic | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setCount("5");
    setSubmitting(false);
    setErrorMessage(null);
  }, [props.open]);

  async function handleSubmit() {
    const parsed = Number(count);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 100) {
      setErrorMessage({ raw: "Укажите количество строк от 1 до 100.", messages: [{ key: "journalAcceptance.bulk.countRange" }] });
      return;
    }

    setSubmitting(true);
    try {
      await props.onSubmit(parsed);
      props.onOpenChange(false);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Ошибка добавления строк", "journalAcceptance.errors.addRows"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>{t("journalAcceptance.bulk.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 px-6 py-5">
          <div className="space-y-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
            <p className="text-[13px] leading-[1.5] text-[#3c4053]">{t("journalAcceptance.bulk.photoHelp")}</p>
            <RecognizeFromPhoto
              kind="raw"
              onItems={async (items) => {
                const result = await props.onPhotoItems(items);
                props.onOpenChange(false);
                return result;
              }}
              label={t("journalAcceptance.bulk.photoLabel")}
              resultLabel={t("journalAcceptance.bulk.photoResult")}
              className="w-full sm:w-auto"
              testId="acceptance-photo"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">{t("journalAcceptance.bulk.emptyCount")}</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={1}
              max={100}
              value={count}
              onChange={(event) => setCount(event.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-5 text-[16px]"
            />
          </div>
          {errorMessage ? (
            <div className="rounded-xl bg-[#fff2f1] px-4 py-3 text-[14px] text-[#d43a2f]">
              {formatAcceptanceDiagnostic(errorMessage, t)}
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4a5bf0]"
            >
              {submitting ? t("journalAcceptance.actions.adding") : t("common.add")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IikoDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useAcceptanceCopy();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>{t("journalAcceptance.iiko.title")}</DialogTitle>
        </DialogHeader>
        <div className="px-6 py-5 text-[15px] text-[#555]">{t("journalAcceptance.iiko.description")}</div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main Component ─── */

export function AcceptanceDocumentClient(props: Props) {
  return <AcceptanceDocumentEditor key={props.documentId} {...props} />;
}

function AcceptanceDocumentEditor(props: Props) {
  const { t, say, feedback, committed } = useAcceptanceCopy();
  const tUi = useTranslations("journalUi.acceptance");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [documentState, setDocumentState] = useState(() => {
    const config = normalizeAcceptanceDocumentConfig(props.config, props.users);
    return { config, summaryBindings: bindAcceptanceSummaryRows(config, props.generatedSummaries ?? []) };
  });
  const { config, summaryBindings } = documentState;
  function setConfig(next: AcceptanceDocumentConfig) {
    setDocumentState((current) => current.config === next ? current : { ...current, config: next });
  }

  // Единый источник status/pdf-действий над журнальным документом.
  const { setStatus } = useJournalDocumentActions(props.documentId);
  const [title, setTitle] = useState(props.title);
  const [dateFrom, setDateFrom] = useState(props.dateFrom);
  // Тумблер сортировки сбрасывался при каждом заходе в документ — держим
  // выбор в localStorage по id документа.
  const sortStorageKey = `wesetup.acceptance-sort-by-expiry.${props.documentId}`;
  const [sortByExpiry, setSortByExpiryState] = useState(false);
  useEffect(() => {
    try {
      setSortByExpiryState(window.localStorage.getItem(sortStorageKey) === "1");
    } catch {
      /* приватное окно / заблокированные site data */
    }
  }, [sortStorageKey]);
  const setSortByExpiry = (next: boolean) => {
    setSortByExpiryState(next);
    try {
      window.localStorage.setItem(sortStorageKey, next ? "1" : "0");
    } catch {
      /* см. выше */
    }
  };
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editListsOpen, setEditListsOpen] = useState(false);
  const [rowDialogOpen, setRowDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<AcceptanceRow | null>(null);
  const [iikoOpen, setIikoOpen] = useState(false);
  const [rowsImportOpen, setRowsImportOpen] = useState(false);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<AcceptanceDiagnostic | null>(null);

  const incomingConfig = acceptanceServerRevision(props.documentId, props.config, props.users, props.generatedSummaries, props.sourceIdentity);
  const lastIncomingConfig = useRef(incomingConfig);
  useEffect(() => { setTitle(props.title); setDateFrom(props.dateFrom); }, [props.documentId, props.dateFrom, props.title]);

  const rows = config.rows;
  const routeCode = props.routeCode;
  // routeCode может прийти алиасом источника (`acceptance1journal`), поэтому
  // тип журнала определяем по разрешённому коду шаблона, а не по URL-сегменту.
  const isProductAcceptance =
    resolveJournalCodeAlias(routeCode) === ACCEPTANCE_DOCUMENT_TEMPLATE_CODE;
  /** Заголовки v2-таблицы с учётом опциональной 12-й колонки (I1). */
  const incomingControlColumns = useMemo(
    () => acceptanceProductColumns(config.showPackagingCompliance, t),
    [config.showPackagingCompliance, t]
  );
  const allSelected = rows.length > 0 && selectedRowIds.length === rows.length;
  const isClosed = props.status === "closed";
  const responsibleTitle = config.defaultResponsibleTitle || "";
  const responsibleUserId = config.defaultResponsibleUserId || "";
  // Сортировка — по колонке «Годен до» (v2) / «{t("journalAcceptance.settings.expiryDeadlineChoice")}»
  // (legacy). `shelfLifeDate` зеркалит `expiryDate`, поэтому одна формула.
  const displayedRows = useMemo(() => {
    if (!sortByExpiry) return rows;
    // Строки без срока — в конец: иначе пустые всплывали наверх и
    // закрывали собой то, что сгорит первым.
    const key = (row: AcceptanceRow) => row.shelfLifeDate || row.expiryDate || "";
    return [...rows].sort((a, b) => {
      const left = key(a);
      const right = key(b);
      if (!left || !right) return left === right ? 0 : left ? -1 : 1;
      return left.localeCompare(right);
    });
  }, [rows, sortByExpiry]);
  const { mobileView, switchMobileView } = useMobileView(routeCode);

  const cardItems: RecordCardItem[] = displayedRows.map((row, index) => ({
    id: row.id,
    title: `№${index + 1} · ${row.productName || "—"}`,
    // В карточке — общий формат «дд.мм.гггг чч:мм» (в самом бланке
    // формат прежний, его диктует форма документа).
    subtitle:
      formatCardDateTime(
        row.deliveryDate,
        row.deliveryHour ? `${row.deliveryHour}:${row.deliveryMinute || "00"}` : null
      ) || undefined,
    leading: !isClosed ? (
      <Checkbox
        checked={selectedRowIds.includes(row.id)}
        onCheckedChange={(c) =>
          setSelectedRowIds((cur) =>
            c === true
              ? [...new Set([...cur, row.id])]
              : cur.filter((id) => id !== row.id)
          )
        }
        className="size-5"
      />
    ) : null,
    fields: isProductAcceptance
      ? (() => {
          const values = getIncomingControlRowValues(row);
          return [
            { label: t("foodControlPdf.incomingControl.columns.shelfLifeDate"), value: values.shelfLifeDate, hideIfEmpty: true },
            { label: t("foodControlPdf.incomingControl.columns.manufacturerSupplier"), value: values.manufacturerSupplier, hideIfEmpty: true },
            { label: t("foodControlPdf.incomingControl.columns.accompanyingDocs"), value: values.accompanyingDocs, hideIfEmpty: true },
            { label: t("foodControlPdf.incomingControl.columns.batchInfo"), value: values.batchInfo, hideIfEmpty: true },
            { label: t("journalAcceptance.row.cardTemperature"), value: values.productTemperature, hideIfEmpty: true },
            { label: t("journalAcceptance.row.cardDocumentation"), value: acceptanceSummaryDisplay(row, summaryBindings, t), hideIfEmpty: true },
            { label: t("journalAcceptance.row.cardDecision"), value: acceptanceEnumLabel("decision", row.acceptanceDecision, t), hideIfEmpty: true },
            { label: t("journalAcceptance.csv.productColumn10"), value: values.correctiveActions, hideIfEmpty: true },
            { label: t("foodControlPdf.incomingControl.columns.responsible"), value: getResponsibleLabel(row, props.users), hideIfEmpty: true },
          ];
        })()
      : [
      { label: t("journalAcceptance.row.manufacturer"), value: row.manufacturer, hideIfEmpty: true },
      { label: t("journalAcceptance.row.supplier"), value: row.supplier, hideIfEmpty: true },
      {
        label: t("journalAcceptance.cards.transportLabel"),
        value: acceptanceEnumLabel("transport", row.transportCondition, t),
        hideIfEmpty: true,
      },
      {
        label: t("journalAcceptance.cards.packagingLabel"),
        value: acceptanceEnumLabel("packaging", row.packagingCompliance, t),
        hideIfEmpty: true,
      },
      {
        label: t("journalAcceptance.cards.organolepticLabel"),
        value: acceptanceEnumLabel("organoleptic", row.organolepticResult, t),
        hideIfEmpty: true,
      },
      {
        label: t(config.expiryFieldLabel === "shelf_life" ? "journalAcceptance.row.shelfLifeLabel" : "journalAcceptance.row.expiryDeadline"),
        value: `${formatAcceptanceDateDash(row.expiryDate)}${row.expiryHour ? ` ${row.expiryHour}:${row.expiryMinute || "00"}` : ""}`,
        hideIfEmpty: true,
      },
      { label: t("foodControlPdf.acceptance.columns.notes"), value: row.note, hideIfEmpty: true },
      {
        label: t("foodControlPdf.incomingControl.columns.responsible"),
        value: getResponsibleLabel(row, props.users),
        hideIfEmpty: true,
      },
    ],
    onClick: !isClosed
      ? () => {
          setEditingRow(row);
          setRowDialogOpen(true);
        }
      : undefined,
  }));

  /** Правка выделенных строк по очереди — тем же окном. */
  const seq = useSequentialEdit({
    open: (id) => {
      const row = config.rows.find((item) => item.id === id);
      if (!row || isClosed) return false;
      setEditingRow(row);
      setRowDialogOpen(true);
      return true;
    },
    close: () => {
      setRowDialogOpen(false);
      setEditingRow(null);
    },
  });

  const cancelSequentialEdit = seq.cancelled;
  useEffect(() => {
    if (lastIncomingConfig.current === incomingConfig) return;
    lastIncomingConfig.current = incomingConfig;
    const config = normalizeAcceptanceDocumentConfig(props.config, props.users);
    setDocumentState({ config, summaryBindings: bindAcceptanceSummaryRows(config, props.generatedSummaries ?? []) });
    setSelectedRowIds((current) => current.filter((id) => config.rows.some((row) => row.id === id)));
    if (editingRow) {
      const incomingRow = config.rows.find((row) => row.id === editingRow.id) ?? null;
      setEditingRow(incomingRow);
      if (!incomingRow) cancelSequentialEdit();
    }
  }, [incomingConfig, props.config, props.users, props.generatedSummaries, editingRow, cancelSequentialEdit]);

  async function persist(nextTitle: string, nextDateFrom: string, nextConfig: AcceptanceDocumentConfig) {
    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: nextTitle, dateFrom: nextDateFrom, config: nextConfig }),
    });
    if (!response.ok) throw tagAcceptanceError(new Error("Не удалось сохранить документ"), [{ key: "journalAcceptance.errors.saveDocument" }]);
    setErrorMessage(null);
    setTitle(nextTitle);
    setDateFrom(nextDateFrom);
    setConfig(nextConfig);
    startTransition(() => router.refresh());
  }

  const productSuggestions = useNameSuggestions("product");

  async function handleSaveRow(row: AcceptanceRow, addToLists: { products: string[]; manufacturers: string[]; suppliers: string[] }) {
    void productSuggestions.remember([row.productName]);
    const nextRows = editingRow
      ? config.rows.map((item) => (item.id === editingRow.id ? row : item))
      : [...config.rows, row];
    const nextProducts = [...new Set([...config.products, ...addToLists.products])];
    const nextManufacturers = [...new Set([...config.manufacturers, ...addToLists.manufacturers])];
    const nextSuppliers = [...new Set([...config.suppliers, ...addToLists.suppliers])];
    await persist(title, dateFrom, { ...config, rows: nextRows, products: nextProducts, manufacturers: nextManufacturers, suppliers: nextSuppliers });
    if (editingRow) {
      // Очередь правок откроет следующую строку или закроет окно.
      seq.saved();
      return;
    }
    setEditingRow(null);
  }

  /**
   * Приёмка → партия. Строка приёмки уже содержит всё, что нужно складу,
   * поэтому партию заводим по ней, а в строке оставляем ссылку: второй
   * раз по той же строке партия не создаётся (см.
   * `canCreateBatchFromAcceptanceRow`).
   */
  async function handleCreateBatchFromRow(row: AcceptanceRow): Promise<AcceptanceRow | null> {
    if (!canCreateBatchFromAcceptanceRow(row)) return null;
    const draft = acceptanceRowToBatchDraft(row);
    const response = await fetch("/api/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, sourceEntryId: props.documentId }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      toast.error(payload?.error || say("journalAcceptance.errors.createBatch"));
      return null;
    }
    const batch = (await response.json()) as { id: string; code: string };
    const nextRow: AcceptanceRow = { ...row, batchId: batch.id, batchCode: batch.code };
    await persist(title, dateFrom, {
      ...config,
      rows: config.rows.map((item) => (item.id === row.id ? nextRow : item)),
    });
    toast.success(say("journalAcceptance.batch.created", { code: `${batch.code}` }), {
      action: { label: say("journalAcceptance.actions.openBatch"), onClick: () => router.push(`/batches/${batch.id}`) },
    });
    return nextRow;
  }

  async function handleDeleteSelected() {
    if (selectedRowIds.length === 0) return;
    const names = config.rows
      .filter((r) => selectedRowIds.includes(r.id))
      .map((r) => r.productName)
      .filter(Boolean);
    const confirmed = await confirmAsync({
      locale: committed.current.locale,
      title: say("journalAcceptance.confirm.deleteTitle"),
      description: say("journalAcceptance.confirm.deleteDescription"),
      variant: "danger",
      confirmLabel: say("common.delete"),
      bullets: [
        { label: say("journalAcceptance.confirm.deleteCount", { count: selectedRowIds.length }), tone: "warn" },
        names.length > 0
          ? {
              label: ((namesText: string) => say(names.length > 4 ? "journalAcceptance.confirm.productsMore" : "journalAcceptance.confirm.products", { names: namesText }))(names.slice(0, 4).join(", ")),
              tone: "info" as const,
            }
          : { label: say("journalAcceptance.confirm.productsMissing"), tone: "info" as const },
        {
          label: say("journalAcceptance.confirm.remainingCount", { count: config.rows.length - selectedRowIds.length }),
          tone: "default",
        },
      ],
    });
    if (!confirmed) return;
    const count = selectedRowIds.length;
    await persist(title, dateFrom, { ...config, rows: config.rows.filter((r) => !selectedRowIds.includes(r.id)) });
    setSelectedRowIds([]);
    toast.success(say("journalAcceptance.feedback.rowsDeleted", { count }));
  }

  async function handleCloseJournal() {
    const confirmed = await confirmAsync({
      locale: committed.current.locale,
      title: say("journalAcceptance.confirm.closeTitle"),
      description: say("journalAcceptance.confirm.closeDescription", { title: `${title}` }),
      variant: "warn",
      confirmLabel: say("journalControls.closeDocument.close"),
      bullets: [
        { label: say("journalAcceptance.confirm.closeCount", { count: config.rows.length }), tone: "info" },
        { label: say("journalAcceptance.confirm.closeLocked"), tone: "warn" },
        { label: say("journalAcceptance.confirm.closeReopen"), tone: "default" },
      ],
    });
    if (!confirmed) return;
    setErrorMessage(null);
    await setStatus("closed");
  }

  async function addMultipleRows(count: number) {
    const nextRows = [...config.rows];
    for (let i = 0; i < Math.min(count, 100); i++) {
      nextRows.push(createAcceptanceRow({ responsibleUserId, responsibleTitle }));
    }
    await persist(title, dateFrom, { ...config, rows: nextRows });
    setBulkAddOpen(false);
  }

  /**
   * «С фото накладной»: распознанное сырьё — строками журнала. Количество и
   * дата выработки — в «Объем, номер партии, дата пр-ва», срок — в «Годен до».
   */
  async function addRowsFromPhoto(items: VisionRawItem[]) {
    const rows = items.slice(0, 100).map((item) =>
      createAcceptanceRow({
        responsibleUserId,
        responsibleTitle,
        productName: item.name,
        manufacturer: item.manufacturer,
        supplier: item.supplier,
        expiryDate: item.expiryDate,
        batchInfo: [
          item.quantity,
          item.productionDate ? `дата пр-ва ${item.productionDate.split("-").reverse().join(".")}` : "",
        ]
          .filter(Boolean)
          .join(", "),
      })
    );
    await persist(title, dateFrom, { ...config, rows: [...config.rows, ...rows] });
    void productSuggestions.remember(items.map((item) => item.name));
    return { added: rows.length };
  }

  async function handleImportFile(file: File) {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return;
    const normalizedRows = XLSX.utils
      .sheet_to_json<unknown[]>(sheet, { header: 1, raw: false })
      .filter((row) => Array.isArray(row))
      .map((row) => row.map((cell) => normalizeImportText(cell)));
    if (normalizedRows.length === 0) return;

    const hasHeader = (normalizedRows[0] ?? []).some((cell) => {
      const value = cell.toLowerCase();
      return value.includes("дата") || value.includes("наименование") || value.includes("поставщик");
    }) || isGeneratedAcceptanceImportHeader(normalizedRows[0] ?? [], isProductAcceptance);
    const dataRows = (hasHeader ? normalizedRows.slice(1) : normalizedRows).filter((row) =>
      row.some((cell) => normalizeImportText(cell))
    );
    if (dataRows.length === 0) return;

    const errors: string[] = [];
    const errorDetails: AcceptanceMessage[] = [];
    const productsToAdd: string[] = [];
    const manufacturersToAdd: string[] = [];
    const suppliersToAdd: string[] = [];
    /* Журнал приёмки ПРОДУКЦИИ — 11 колонок бланка incoming_control.
       Журнал приёмки СЫРЬЯ остаётся на старом формате (ветка ниже). */
    const importedProduct = !isProductAcceptance
      ? []
      : dataRows.flatMap((cols, index) => {
          const rowNumber = index + (hasHeader ? 2 : 1);
          const deliveryDate = parseImportDate(cols[0] || "");
          const productName = normalizeImportText(cols[1]);
          const shelfLifeRaw = normalizeImportText(cols[2]);
          const shelfLifeDate = parseImportDate(shelfLifeRaw);
          const manufacturerSupplier = normalizeImportText(cols[3]);

          if (!deliveryDate)
            { errors.push(`Строка ${rowNumber}: заполните корректную дату поставки`); errorDetails.push({ key: "journalAcceptance.errors.productDeliveryDate", values: { rowNumber } }); }
          if (!productName)
            { errors.push(`Строка ${rowNumber}: заполните наименование продукции`); errorDetails.push({ key: "journalAcceptance.errors.productName", values: { rowNumber } }); }
          if (shelfLifeRaw && !shelfLifeDate)
            { errors.push(`Строка ${rowNumber}: заполните корректную дату «Годен до»`); errorDetails.push({ key: "journalAcceptance.errors.shelfLifeDate", values: { rowNumber } }); }
          if (!deliveryDate || !productName || (shelfLifeRaw && !shelfLifeDate)) return [];

          if (productName) productsToAdd.push(productName);
          if (manufacturerSupplier) suppliersToAdd.push(manufacturerSupplier);

          return [
            createAcceptanceRow({
              deliveryDate,
              productName,
              shelfLifeDate,
              manufacturerSupplier,
              accompanyingDocs: normalizeImportText(cols[4]),
              batchInfo: normalizeImportText(cols[5]),
              productTemperature: normalizeImportText(cols[6]),
              documentCompliance: normalizeImportText(cols[7]),
              acceptanceDecision: parseAcceptanceDecision(cols[8] || ""),
              correctiveActions: normalizeImportText(cols[9]),
              responsibleTitle: normalizeImportText(cols[10]) || responsibleTitle,
              responsibleUserId,
            }),
          ];
        });

    const importedLegacy = isProductAcceptance ? [] : dataRows.flatMap((cols, index) => {
      const rowNumber = index + (hasHeader ? 2 : 1);
      const deliveryDate = parseImportDate(cols[0] || "");
      const deliveryTime = parseImportTime(cols[1] || "");
      const productName = normalizeImportText(cols[2]);
      const manufacturer = normalizeImportText(cols[3]);
      const supplier = normalizeImportText(cols[4]);
      const expiryDateRaw = normalizeImportText(cols[8]);
      const expiryDate = parseImportDate(expiryDateRaw);
      const expiryTime = parseImportTime(cols[9] || "");
      const transportCondition = parseImportBoolean(cols[5] || "");
      const packagingCompliance = parseImportBoolean(cols[6] || "");
      const organolepticResult = parseImportBoolean(cols[7] || "");

      if (!deliveryDate) { errors.push(`Строка ${rowNumber}: заполните корректную дату поступления`); errorDetails.push({ key: "journalAcceptance.errors.rawDeliveryDate", values: { rowNumber } }); }
      if (!productName) { errors.push(`Строка ${rowNumber}: заполните наименование продукции`); errorDetails.push({ key: "journalAcceptance.errors.productName", values: { rowNumber } }); }
      if (!supplier) { errors.push(`Строка ${rowNumber}: заполните поставщика`); errorDetails.push({ key: "journalAcceptance.errors.supplier", values: { rowNumber } }); }
      if (transportCondition === null) { errors.push(`Строка ${rowNumber}: заполните условия транспортировки`); errorDetails.push({ key: "journalAcceptance.errors.transport", values: { rowNumber } }); }
      if (packagingCompliance === null) { errors.push(`Строка ${rowNumber}: заполните соответствие упаковки`); errorDetails.push({ key: "journalAcceptance.errors.packaging", values: { rowNumber } }); }
      if (organolepticResult === null) { errors.push(`Строка ${rowNumber}: заполните результаты орг. оценки`); errorDetails.push({ key: "journalAcceptance.errors.organoleptic", values: { rowNumber } }); }
      if (expiryDateRaw && !expiryDate) { errors.push(`Строка ${rowNumber}: заполните корректную дату срока реализации`); errorDetails.push({ key: "journalAcceptance.errors.expiryDate", values: { rowNumber } }); }
      if (
        !deliveryDate ||
        !productName ||
        !supplier ||
        transportCondition === null ||
        packagingCompliance === null ||
        organolepticResult === null ||
        (expiryDateRaw && !expiryDate)
      )
        return [];

      if (productName) productsToAdd.push(productName);
      if (manufacturer) manufacturersToAdd.push(manufacturer);
      if (supplier) suppliersToAdd.push(supplier);

      return [
        createAcceptanceRow({
          deliveryDate,
          deliveryHour: deliveryTime.hour,
          deliveryMinute: deliveryTime.minute,
          productName,
          manufacturer,
          supplier,
          transportCondition: transportCondition ? "satisfactory" : "unsatisfactory",
          packagingCompliance: packagingCompliance ? "compliant" : "non_compliant",
          organolepticResult: organolepticResult ? "satisfactory" : "unsatisfactory",
          expiryDate,
          expiryHour: expiryTime.hour,
          expiryMinute: expiryTime.minute,
          note: normalizeImportText(cols[10]),
          responsibleTitle,
          responsibleUserId,
        }),
      ];
    });
    const imported = isProductAcceptance ? importedProduct : importedLegacy;
    if (errors.length > 0) throw tagAcceptanceError(new Error(errors.slice(0, 8).join("\n")), errorDetails.slice(0, 8));
    if (imported.length === 0) return;
    await persist(title, dateFrom, {
      ...config,
      rows: [...config.rows, ...imported],
      products: [...new Set([...config.products, ...productsToAdd])],
      manufacturers: [...new Set([...config.manufacturers, ...manufacturersToAdd])],
      suppliers: [...new Set([...config.suppliers, ...suppliersToAdd])],
    });
    setRowsImportOpen(false);
  }

  const organizationLabel = props.organizationFallbackSuffix != null
    ? t("journalControls.guidePage.organizationFallback") + props.organizationFallbackSuffix
    : props.organizationName || t("journalControls.guidePage.organizationFallback");
  const pageTitle = t(isProductAcceptance ? "journals.names.incoming_control" : "journals.names.incoming_raw_materials_control");
  const documentTitle = title || t(isProductAcceptance ? "journals.names.incoming_control" : "foodControlPdf.acceptance.title.rawMaterials");
  const journalHeaderTitle = isProductAcceptance
    ? t("journals.names.incoming_control").toUpperCase()
    : t("journals.names.incoming_raw_materials_control").toUpperCase();

  return (
    <div className="bg-white text-black">
      <div className={`${DOC_BODY_STACK_CLASS} py-4 sm:py-6`}>
        {/* Полоса действий над выделенными строками — общая для 13 журналов */}
        {!isClosed ? (
          <JournalSelectionBar
            count={selectedRowIds.length}
            onClear={() => setSelectedRowIds([])}
            onDelete={() =>
              void handleDeleteSelected().catch((error) =>
                toast.error(feedback(error, "Не удалось удалить строки", "journalAcceptance.errors.deleteRows"))
              )
            }
            hint={t("journalAcceptance.screen.selectionHint")}
          >
            <SelectionEditButton count={selectedRowIds.length} disabled={isClosed} onClick={() => seq.start(selectedRowIds)} />
          </JournalSelectionBar>
        ) : null}

        {errorMessage ? (
          <div className="whitespace-pre-line rounded-2xl bg-[#fff2f1] px-5 py-4 text-[14px] text-[#d43a2f]">
            {formatAcceptanceDiagnostic(errorMessage, t)}
          </div>
        ) : null}

        <FocusTodayScroller selector="[data-focus-today]" emptyTitle={t("journalAcceptance.screen.emptyTitle")} emptyBody={t("journalAcceptance.screen.emptyBody")} copy={{ noCreateBody: t("journalAcceptance.focus.noCreateBody"), later: t("journalAcceptance.focus.later"), close: t("common.close") }} />
        <DocumentActionsBar
          backHref={`/journals/${routeCode}`}
          documentId={props.documentId}
          heading={<h1 className={DOC_HEADING_CLASS}>{documentTitle}</h1>}
          onSettings={() => setSettingsOpen(true)}
          menuItems={
            !isClosed
              ? [
                  {
                    key: "close-journal",
                    label: t("journalControls.closeDocument.close"),
                    icon: <Archive className="size-4" />,
                    onSelect: () => void handleCloseJournal(),
                  },
                ]
              : []
          }
        />

        {/* Полоса настроек журнала — на месте полосы автозаполнения эталона:
            между строкой заголовка и бумажной шапкой, во всю ширину.
            Для incoming_control эталон рисует её лентой без скруглений
            и с тумблером (incoming_control-grid.png). */}
        {isProductAcceptance ? (
          // Radix Switch — это <button>, поэтому обёртка <label> его бы не
          // переключала по клику на текст: вешаем подпись на htmlFor.
          // Q3: та же геометрия, что у полосы автозаполнения (48px, gap-3,
          // подпись 15px/600) — раньше лента была 56px с подписью 16px/400.
          <div className={DOC_AUTOFILL_STRIP_CLASS}>
            <Switch
              id="acceptance-sort-by-expiry"
              checked={sortByExpiry}
              onCheckedChange={(checked) => setSortByExpiry(checked === true)}
            />
            <label
              htmlFor="acceptance-sort-by-expiry"
              className={`cursor-pointer select-none ${DOC_AUTOFILL_LABEL_CLASS}`}
            >{t("journalAcceptance.screen.sortByExpiry")}</label>
          </div>
        ) : (
          <label className={`${DOC_AUTOFILL_STRIP_CLASS} cursor-pointer`}>
            <Checkbox checked={sortByExpiry} onCheckedChange={(checked) => setSortByExpiry(checked === true)} />
            <span className={DOC_AUTOFILL_LABEL_CLASS}>{t("journalAcceptance.screen.sortByExpiry")}</span>
          </label>
        )}

        {/* R1: бумажное полотно — во всю ширину контентной колонки.
            11 колонок приёмки шире полотна и продолжают скроллиться
            внутри своего GRID_VIEWPORT_CLASS. */}
        <div className="mb-4 sm:hidden print:hidden">
          <MobileViewToggle mobileView={mobileView} onChange={switchMobileView} />
        </div>

        <div className={DOC_PAPER_CANVAS_CLASS}>
        {/* HACCP header */}

        <div
          className={`${DOC_PAPER_HEADER_CLASS} ${GRID_VIEWPORT_CLASS} ${
            mobileView === "cards" ? DOC_PAPER_HEADER_CARDS_HIDDEN_CLASS : ""
          }`}
        >
        <table className="w-full min-w-[640px] border-collapse text-[13px] sm:min-w-0">
          <tbody>
            <JournalPaperHeaderRows
              orgName={organizationLabel}
              title={journalHeaderTitle}
              startedAt={dateFrom}
              finishedAt={isClosed ? props.dateTo : null}
              controlPeriodicity={props.controlPeriodicity}
              orgCellClass="w-[220px]"
              sideCellClass="w-[200px]"
            />
          </tbody>
        </table>
        </div>

        <div className={`${DOC_CAPS_TITLE_CLASS} text-center text-[16px] font-semibold leading-tight sm:text-[20px]`}>{journalHeaderTitle}</div>

        {isClosed ? (
          <div className="mb-5">
            <JournalClosedBanner hint={t("journalAcceptance.screen.closedHint")} documentId={props.documentId} />
          </div>
        ) : null}

        {/* Toolbar */}
        {!isClosed && (
          <div className={DOC_ADD_ROW_CLASS}>
            <ResponsiveMenu
              title={t("common.add")}
              align="start"
              items={[
                {
                  key: "add-row",
                  label: t("common.add"),
                  icon: <Plus className="size-4 text-[#6f7282]" />,
                  onSelect: () => {
                    setEditingRow(null);
                    setRowDialogOpen(true);
                  },
                },
                {
                  key: "add-bulk",
                  label: t("journalAcceptance.bulk.title"),
                  icon: <Plus className="size-4 text-[#6f7282]" />,
                  onSelect: () => setBulkAddOpen(true),
                },
                {
                  key: "add-file",
                  label: t("journalAcceptance.lists.addFromFile"),
                  icon: <Upload className="size-4 text-[#6f7282]" />,
                  onSelect: () => setRowsImportOpen(true),
                },
                {
                  key: "add-iiko",
                  label: t("journalAcceptance.screen.addIiko"),
                  icon: <span aria-hidden>📋</span>,
                  onSelect: () => setIikoOpen(true),
                },
              ]}
              trigger={
                <Button type="button" className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white hover:bg-[#4a5bf0]">
                  <Plus className="size-5" strokeWidth={2.5} />{t("common.add")}<ChevronDown className="size-4" />
                </Button>
              }
            />

            {/* Эталон держит рядом со сплит-кнопкой ОТДЕЛЬНУЮ обычную
                «+ Добавить» — добавление одной строки в один клик,
                без раскрытия меню. */}
            <Button
              type="button"
              className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
              onClick={() => {
                setEditingRow(null);
                setRowDialogOpen(true);
              }}
            >
              {/* Рядом стоит сплит-кнопка с такой же подписью «Добавить».
                  На телефоне, где меню не раскрыто, различить их было
                  нельзя — уточняем, что здесь добавляется. */}
              <Plus className="size-5" strokeWidth={2.5} />
              <span className="hidden sm:inline">{t("journalAcceptance.screen.addDeliveryDesktop")}</span><span className="sm:hidden">{t("journalAcceptance.screen.addDeliveryMobile")}</span>
            </Button>

            <Button type="button" variant="outline" className={DOC_SECONDARY_BUTTON_CLASS} onClick={() => setEditListsOpen(true)}>{t("journalAcceptance.screen.editLists")}</Button>

          </div>
        )}


        {mobileView === "cards" ? (
          <RecordCardsView items={cardItems} emptyLabel={t("journalAcceptance.screen.cardsEmpty")} />
        ) : null}

        {/* Data table — v2 (11 колонок эталона) для приёмки продукции */}
        {isProductAcceptance ? (
          <MobileViewTableWrapper mobileView={mobileView} className={GRID_VIEWPORT_CLASS}>
            {/*
              `table-fixed` + colgroup в процентах: 11 колонок помещаются в
              1248px контента на 1440px без горизонтального выезда страницы.
              `min-w-[1120px]` включает скролл ВНУТРИ viewport-контейнера на
              узких экранах — страница по горизонтали не едет.
            */}
            <table className="w-full min-w-[1120px] table-fixed border-collapse text-[12.5px]">
              <colgroup>
                {/* I2: колонка чекбокса на эталоне ~24px, у нас была 36px
                    (+ px-1.5 = 37px по факту) и съедала ширину у контентных
                    колонок. Чекбокс 16px + 2×4px паддинга укладывается в 26px. */}
                {/* Q2-3: колонка выделения не печатается — прячем сам
                    <col>, иначе процентные ширины сдвинутся на одну. */}
                <col className="w-[26px] print:hidden" />
                <col className="w-[7%]" />
                <col className="w-[10%]" />
                <col className="w-[6.5%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[10%]" />
                <col className="w-[11%]" />
                {config.showPackagingCompliance ? <col className="w-[10%]" /> : null}
                <col className="w-[6.5%]" />
                <col className="w-[11%]" />
                <col className="w-[11%]" />
              </colgroup>
              <thead>
                <tr>
                  <th className={`${GRID_HEAD_CELL_CLASS} px-1 py-1.5 leading-tight print:hidden`}>
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(c) => setSelectedRowIds(c === true ? displayedRows.map((r) => r.id) : [])}
                      disabled={displayedRows.length === 0 || isClosed}
                    />
                  </th>
                  {/* R5-13: заголовки колонок рвались ПО ДЕФИСУ —
                      «дата пр-/ва», «Внутр. темп-/ра». Дефис внутри
                      сокращения не точка переноса, это часть слова.
                      Подменяем его неразрывным дефисом U+2011 прямо на
                      рендере: строки-константы (в т.ч.
                      PRODUCT_ACCEPTANCE_IMPORT_COLUMNS, по которым
                      парсится импорт) остаются нетронутыми, меняется
                      только то, что видит глаз. */}
                  {incomingControlColumns.map((column) => (
                    <th
                      key={column}
                      className={`${GRID_HEAD_CELL_CLASS} px-1.5 py-1.5 text-center text-[11.5px] font-semibold leading-[1.25]`}
                    >
                      {column.replace(/-/g, "‑")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedRows.map((row) => {
                  const values = getIncomingControlRowValues(row);
                  return (
                    <tr
                      key={row.id}
                      className={!isClosed ? "cursor-pointer hover:bg-[#f5f6ff]" : ""}
                      onClick={() => {
                        if (isClosed) return;
                        setEditingRow(row);
                        setRowDialogOpen(true);
                      }}
                    >
                      <td
                        className={`${GRID_CELL_CLASS} px-1 py-1 text-center leading-tight print:hidden`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedRowIds.includes(row.id)}
                          onCheckedChange={(c) =>
                            setSelectedRowIds((cur) =>
                              c === true ? [...new Set([...cur, row.id])] : cur.filter((id) => id !== row.id)
                            )
                          }
                          disabled={isClosed}
                        />
                      </td>
                      {/* R5-8: даты формата ДД-ММ-ГГГГ рвались по дефису
                          («17-04-» / «2026») — колонки дат узкие (6.5%),
                          и перенос срабатывал на каждом разделителе.
                          Дата обязана читаться одной строкой. */}
                      {/* Даты без `whitespace-nowrap`: на телефоне колонка
                          ~70px, а «06-09-2026» просит 77px — дата просто
                          не влезала и обрезалась. Перенос по дефису
                          показывает её целиком в две строки. */}
                      <td className={`${GRID_CELL_CLASS} px-1.5 py-1 text-center leading-tight break-words`}>{values.deliveryDate}</td>
                      <td className={`${GRID_CELL_CLASS} px-1.5 py-1.5 leading-tight break-words`}>{values.productName}</td>
                      <td className={`${GRID_CELL_CLASS} px-1.5 py-1 text-center leading-tight break-words`}>{values.shelfLifeDate}</td>
                      <td className={`${GRID_CELL_CLASS} px-1.5 py-1.5 leading-tight break-words`}>{values.manufacturerSupplier}</td>
                      <td className={`${GRID_CELL_CLASS} px-1.5 py-1.5 leading-tight break-words`}>{values.accompanyingDocs}</td>
                      <td className={`${GRID_CELL_CLASS} px-1.5 py-1.5 leading-tight break-words`}>{values.batchInfo}</td>
                      <td className={`${GRID_CELL_CLASS} px-1.5 py-1 text-center leading-tight break-words`}>{values.productTemperature}</td>
                      <td className={`${GRID_CELL_CLASS} px-1.5 py-1.5 leading-tight break-words`}>{acceptanceSummaryDisplay(row, summaryBindings, t)}</td>
                      {config.showPackagingCompliance ? (
                        <td className={`${GRID_CELL_CLASS} px-1.5 py-1 text-center leading-tight break-words`}>
                          {acceptanceEnumLabel("packaging", row.packagingCompliance, t)}
                        </td>
                      ) : null}
                      <td className={`${GRID_CELL_CLASS} px-1.5 py-1 text-center font-semibold leading-tight break-words`}>{acceptanceEnumLabel("decision", row.acceptanceDecision, t)}</td>
                      <td className={`${GRID_CELL_CLASS} px-1.5 py-1.5 leading-tight break-words`}>{values.correctiveActions}</td>
                      <td className={`${GRID_CELL_CLASS} px-1.5 py-1.5 leading-tight break-words`}>{getResponsibleLabel(row, props.users)}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={incomingControlColumns.length + 1}
                      className={`${GRID_CELL_CLASS} p-8 text-center leading-tight text-[#80849a]`}
                    >{t("journalAcceptance.screen.tableEmpty")}</td>
                  </tr>
                )}
                {/* R5-13: пустая строка-хвост с ОТКЛЮЧЁННЫМ чекбоксом была
                    удалена — задумывалась как аффорданс «добавить», но
                    кликом ничего не добавляла (Checkbox disabled, у tr
                    нет onClick). Теперь вместо неё настоящая кликабельная
                    строка `JournalAddRow`: открывает то же окно, что и
                    кнопка «Добавить» в DOC_ADD_ROW_CLASS над таблицей.
                    leading=1 (чекбокс), labelSpan=2 — подпись растянута на
                    «Дата поставки» + «Наименование продукции» (первые две
                    колонки INCOMING_CONTROL_COLUMNS): вместе они опознают
                    поставку. Остальные колонки бланка (годен до,
                    производитель/поставщик, документы, партия, температура
                    и т.д.) остаются пустыми — trailing = длина массива
                    колонок минус эти 2. Сумма 1+2+(N-2)=N+1 — тот же
                    colSpan, что был раньше. */}
                {!isClosed ? (
                  <JournalAddRow
                    leading={1}
                    labelSpan={2}
                    trailing={incomingControlColumns.length - 2}
                    label={t("common.add")}
                    onClick={() => {
                      setEditingRow(null);
                      setRowDialogOpen(true);
                    }}
                  />
                ) : null}
              </tbody>
            </table>
          </MobileViewTableWrapper>
        ) : (
        <MobileViewTableWrapper mobileView={mobileView} className={GRID_VIEWPORT_CLASS}>
          <table className="min-w-[960px] w-full border-collapse text-[13px] sm:min-w-[1400px]">
            <thead>
              <tr>
                <th className={`w-[44px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight print:hidden`}>
                  <Checkbox checked={allSelected} onCheckedChange={(c) => setSelectedRowIds(c === true ? displayedRows.map((r) => r.id) : [])} disabled={displayedRows.length === 0 || isClosed} />
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>
                  {isProductAcceptance
                    ? tUi("productDeliveryDateTime")
                    : t("journalAcceptance.rawTable.deliveryDateTime")}
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>
                  {isProductAcceptance ? t("foodControlPdf.incomingControl.columns.productName") : t("journalAcceptance.csv.rawColumn3")}
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>{t("journalAcceptance.row.manufacturer")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>{t("journalAcceptance.row.supplier")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>{t("journalAcceptance.row.transport")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>
                  {isProductAcceptance
                    ? tUi("productPackagingCompliance")
                    : t("journalAcceptance.rawTable.packagingCompliance")}
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>{t("journalAcceptance.rawTable.organoleptic")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>{t(config.expiryFieldLabel === "shelf_life" ? "journalAcceptance.row.shelfLifeLabel" : "journalAcceptance.row.expiryDeadline")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>{t("foodControlPdf.acceptance.columns.notes")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>{t("foodControlPdf.incomingControl.columns.responsible")}</th>
              </tr>
            </thead>
            <tbody>
              {displayedRows.map((row) => (
                <tr
                  key={row.id}
                  className={!isClosed ? "cursor-pointer hover:bg-[#f5f6ff]" : ""}
                  onClick={() => {
                    if (isClosed) return;
                    setEditingRow(row);
                    setRowDialogOpen(true);
                  }}
                >
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight print:hidden`} onClick={(event) => event.stopPropagation()}>
                    <Checkbox checked={selectedRowIds.includes(row.id)} onCheckedChange={(c) => setSelectedRowIds((cur) => c === true ? [...new Set([...cur, row.id])] : cur.filter((id) => id !== row.id))} disabled={isClosed} />
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center whitespace-pre-line leading-tight`}>
                    {formatAcceptanceDateDash(row.deliveryDate)}
                    {row.deliveryHour ? `\n${row.deliveryHour}:${row.deliveryMinute || "00"}` : ""}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                    <div className="text-left hover:text-[#5566f6]">
                      {row.productName || "—"}
                    </div>
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.manufacturer || "—"}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.supplier || "—"}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{acceptanceEnumLabel("transport", row.transportCondition, t)}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{acceptanceEnumLabel("packaging", row.packagingCompliance, t)}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{acceptanceEnumLabel("organoleptic", row.organolepticResult, t)}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center whitespace-pre-line leading-tight`}>
                    {formatAcceptanceDateDash(row.expiryDate)}
                    {row.expiryHour ? `\n${row.expiryHour}:${row.expiryMinute || "00"}` : ""}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>{row.note || ""}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>{getResponsibleLabel(row, props.users)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={11} className={`${GRID_CELL_CLASS} p-8 text-center text-[#80849a] leading-tight`}>{t("journalAcceptance.screen.tableEmpty")}</td></tr>
              )}
              {/* leading=1 (чекбокс), labelSpan=2 — подпись растянута на
                  «Дата, время поступления» + «Наименование продукции»:
                  вместе они опознают запись (когда и что поступило).
                  Остальные 8 колонок бланка (производитель, поставщик,
                  условия транспортировки, соответствие упаковки,
                  органолептика, срок годности, примечания, ответственный)
                  остаются пустыми — trailing=8. Сумма 1+2+8=11 — тот же
                  colSpan, что был раньше. */}
              {!isClosed ? (
                <JournalAddRow
                  leading={1}
                  labelSpan={2}
                  trailing={8}
                  label={t("common.add")}
                  onClick={() => {
                    setEditingRow(null);
                    setRowDialogOpen(true);
                  }}
                />
              ) : null}
              {/* Пустая строка только для печати: на бумаге инспектор
                  дописывает запись от руки. На экране она была
                  некликабельной заглушкой (Checkbox disabled, у tr нет
                  onClick) — теперь кликабельность даёт JournalAddRow выше,
                  а эта строка остаётся только в печатной вёрстке. */}
              <tr className="hidden print:table-row"><td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}><Checkbox disabled /></td><td colSpan={10} className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`} /></tr>
            </tbody>
          </table>
        </MobileViewTableWrapper>
        )}
        </div>
      </div>

      <SettingsDialog documentKey={props.documentId} open={settingsOpen} onOpenChange={setSettingsOpen} title={title} dateFrom={dateFrom} users={props.users} config={config} onSave={async (params) => { await persist(params.title, params.dateFrom, params.config); }} useV2={props.useV2} showExpiryLabelChoice={!isProductAcceptance} />
      {editListsOpen && (
        <IncomingControlEditListsDialog
          key={JSON.stringify([props.documentId, config.products, config.manufacturers, config.suppliers])}
          open={editListsOpen}
          onOpenChange={setEditListsOpen}
          config={config}
          setConfig={(nextConfig) => {
            void persist(title, dateFrom, nextConfig).catch((error) =>
              setErrorMessage(getErrorMessage(error, "Ошибка сохранения списков", "journalAcceptance.errors.saveLists"))
            );
          }}
        />
      )}
      {isProductAcceptance ? (
        <IncomingControlRowDialog
          documentKey={props.documentId}
          open={rowDialogOpen}
          onOpenChange={(open) => { if (open) setRowDialogOpen(true); else seq.cancelled(); }}
          users={props.users}
          config={config}
          initialRow={editingRow}
          titleSuffix={seq.progress ?? undefined}
          recentProducts={productSuggestions.recent}
          onSave={handleSaveRow}
          onCreateBatch={isClosed ? undefined : handleCreateBatchFromRow}
        />
      ) : (
        <RowDialog documentKey={props.documentId} open={rowDialogOpen} onOpenChange={(open) => { if (open) setRowDialogOpen(true); else seq.cancelled(); }} users={props.users} config={config} initialRow={editingRow} titleSuffix={seq.progress ?? undefined} recentProducts={productSuggestions.recent} onSave={handleSaveRow} onCreateBatch={isClosed ? undefined : handleCreateBatchFromRow} />
      )}
      <ImportRowsDialog open={rowsImportOpen} onOpenChange={setRowsImportOpen} users={props.users} responsibleTitle={responsibleTitle} responsibleUserId={responsibleUserId} isProductAcceptance={isProductAcceptance} onFileSelect={handleImportFile} />
      <AddMultipleRowsDialog
        open={bulkAddOpen}
        onOpenChange={setBulkAddOpen}
        onSubmit={addMultipleRows}
        onPhotoItems={addRowsFromPhoto}
      />
      <IikoDialog open={iikoOpen} onOpenChange={setIikoOpen} />
    </div>
  );
}
