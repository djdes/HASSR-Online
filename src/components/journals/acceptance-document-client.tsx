"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  ACCEPTANCE_DECISION_FULL_LABELS,
  ACCEPTANCE_DOCUMENT_TEMPLATE_CODE,
  acceptanceRowToBatchDraft,
  canCreateBatchFromAcceptanceRow,
  createAcceptanceRow,
  getIncomingControlRowValues,
  normalizeAcceptanceDocumentConfig,
  formatAcceptanceDateDash,
  getAcceptanceDocumentTitle,
  getAcceptancePageTitle,
  getExpiryFieldDisplayLabel,
  TRANSPORT_LABELS,
  COMPLIANCE_LABELS,
  INCOMING_CONTROL_PACKAGING_COLUMN,
  getIncomingControlColumns,
  ORGANOLEPTIC_LABELS,
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
import { localDayKey } from "@/lib/entry-defaults";
import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";

type User = { id: string; name: string; role: string };

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
  dateFrom: string;
  dateTo: string;
  status: string;
  config: unknown;
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

function getErrorMessage(error: unknown, fallback = "Ошибка") {
  return error instanceof Error ? error.message : fallback;
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

const RAW_MATERIALS_IMPORT_COLUMNS = [
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

function downloadAcceptanceImportTemplate(isProductAcceptance: boolean) {
  const header = (
    isProductAcceptance
      ? PRODUCT_ACCEPTANCE_IMPORT_COLUMNS
      : RAW_MATERIALS_IMPORT_COLUMNS
  ).join(";");
  const sample = isProductAcceptance
    ? '11.04.2026;Гастрономия;20.04.2026;ООО "Агро-Юг" / ООО "Метро";ТТН №123 от 11.04.2026;20 кг, партия 45, 09.04.2026;+4;Соответствует;П;;Заведующий производством'
    : '11.04.2026;11:00;Гастрономия;ООО "Агро-Юг";ООО "Метро";1;1;1;11.04.2026;18:00;';
  const blob = new Blob([[header, sample].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = isProductAcceptance
    ? "incoming-control-import-example.csv"
    : "incoming-raw-materials-import-example.csv";
  link.click();
  URL.revokeObjectURL(url);
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
  if (props.row.batchId) {
    return (
      <a
        href={`/batches/${props.row.batchId}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-[#dcdfed] px-4 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] sm:mr-auto sm:w-auto"
      >
        <Package className="size-4" />
        Партия {props.row.batchCode || "№ —"}
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
      title="Заведёт партию на складе по данным этой строки: продукт, поставщик, количество, дата поступления и срок годности"
      className="h-9 w-full gap-1.5 rounded-xl border-[#5566f6]/30 bg-[#f5f6ff] px-4 text-[13.5px] font-medium text-[#5566f6] shadow-none transition-colors duration-150 hover:bg-[#eef1ff] sm:mr-auto sm:w-auto"
    >
      <Package className="size-4" />
      Создать партию
    </Button>
  );
}

/* ─── Row Dialog ─── */

function RowDialog(props: {
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

  useEffect(() => {
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
    props.config.defaultResponsibleUserId,
    props.config.defaultResponsibleTitle,
    props.config.manufacturers,
    props.config.products,
    props.config.suppliers,
    props.initialRow,
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
      toast.error(getErrorMessage(error, "Не удалось сохранить строку"));
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
      toast.error(getErrorMessage(error, "Не удалось создать партию"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            {isEdit ? `Редактирование строки${props.titleSuffix ? ` ${props.titleSuffix}` : ""}` : "Добавление новой строки"}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
          {/* Дата и время поставки */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Дата и время поставки</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
              <Input type="date" value={row.deliveryDate} onChange={(e) => setValue("deliveryDate", e.target.value)} className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
              <Select value={row.deliveryHour || "--"} onValueChange={(value) => setValue("deliveryHour", value === "--" ? "" : value)}>
                <SelectTrigger className={SELECT_TRIGGER_CLASS}><SelectValue placeholder="-- ч" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="--">-- ч</SelectItem>
                  {HOURS.map((h) => <SelectItem key={h} value={h}>{h} ч</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={row.deliveryMinute || "--"} onValueChange={(value) => setValue("deliveryMinute", value === "--" ? "" : value)}>
                <SelectTrigger className={SELECT_TRIGGER_CLASS}><SelectValue placeholder="-- мин" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="--">-- мин</SelectItem>
                  {MINUTES.map((m) => <SelectItem key={m} value={m}>{m} мин</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Наименование продукции — radio cards */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Наименование продукции</Label>
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
              <Input value={newProduct} onChange={(e) => setNewProduct(e.target.value)} placeholder="Добавить название новой продукции" className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
              <Button type="button" className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]" onClick={() => addInlineOption("product")}>
                <Plus className="size-5" />
              </Button>
            </div>
          </div>

          {/* Производитель */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Производитель</Label>
            <Select
              value={toNone(row.manufacturer)}
              onValueChange={(value) => setValue("manufacturer", fromNone(value))}
            >
              <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder="Выберите из списка или добавьте нового" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>Выберите из списка или добавьте нового</SelectItem>
                {Array.from(new Set(manufacturerOptions)).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Input value={newManufacturer} onChange={(e) => setNewManufacturer(e.target.value)} placeholder="Добавить название нового производителя" className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
              <Button type="button" className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]" onClick={() => addInlineOption("manufacturer")}>
                <Plus className="size-5" />
              </Button>
            </div>
          </div>

          {/* Поставщик */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Поставщик</Label>
            <Select
              value={toNone(row.supplier)}
              onValueChange={(value) => setValue("supplier", fromNone(value))}
            >
              <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder="Выберите из списка или добавьте нового" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>Выберите из списка или добавьте нового</SelectItem>
                {Array.from(new Set(supplierOptions)).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Input value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} placeholder="Добавить название нового поставщика" className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
              <Button type="button" className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]" onClick={() => addInlineOption("supplier")}>
                <Plus className="size-5" />
              </Button>
            </div>
          </div>

          {/* Условия транспортировки — pill segmented */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Условия транспортировки</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["satisfactory", "Удовл.", "#136b2a", "#ecfdf5"],
                  ["unsatisfactory", "Не удовл.", "#d2453d", "#fff4f2"],
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
            <Label className="text-[13px] font-medium text-[#3c4053]">Соответствие упаковки</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["compliant", "Соотв.", "#136b2a", "#ecfdf5"],
                  ["non_compliant", "Не соотв.", "#d2453d", "#fff4f2"],
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
            <Label className="text-[13px] font-medium text-[#3c4053]">Результаты орг. оценки</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["satisfactory", "Удовл.", "#136b2a", "#ecfdf5"],
                  ["unsatisfactory", "Не удовл.", "#d2453d", "#fff4f2"],
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
              {getExpiryFieldDisplayLabel(props.config.expiryFieldLabel)}
            </Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
              <Input type="date" value={row.expiryDate} onChange={(e) => setValue("expiryDate", e.target.value)} className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
              <Select value={row.expiryHour || "--"} onValueChange={(value) => setValue("expiryHour", value === "--" ? "" : value)}>
                <SelectTrigger className={SELECT_TRIGGER_CLASS}><SelectValue placeholder="-- ч" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="--">-- ч</SelectItem>
                  {HOURS.map((h) => <SelectItem key={h} value={h}>{h} ч</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={row.expiryMinute || "--"} onValueChange={(value) => setValue("expiryMinute", value === "--" ? "" : value)}>
                <SelectTrigger className={SELECT_TRIGGER_CLASS}><SelectValue placeholder="-- мин" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="--">-- мин</SelectItem>
                  {MINUTES.map((m) => <SelectItem key={m} value={m}>{m} мин</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Примечание */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Примечание</Label>
            <Textarea value={row.note} onChange={(e) => setValue("note", e.target.value)} placeholder="Примечание" rows={3} className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]" />
          </div>

          {/* Должность ответственного + сотрудник */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Должность ответственного</Label>
              <Select
                value={toNone(row.responsibleTitle)}
                onValueChange={(value) => responsibleCascade.handlePositionChange(fromNone(value))}
              >
                <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder="— выберите —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— выберите —</SelectItem>
                  <PositionSelectItems users={props.users} />
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Сотрудник</Label>
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
                  <SelectValue placeholder="— выберите —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— выберите —</SelectItem>
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
          >
            Отмена
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting}
            className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
          >
            {isSubmitting ? "Сохранение..." : isEdit ? "Сохранить" : "Добавить"}
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
  const [row, setRow] = useState<AcceptanceRow>(() => createAcceptanceRow());
  const [newProduct, setNewProduct] = useState("");
  const [newPartner, setNewPartner] = useState("");
  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [partnerOptions, setPartnerOptions] = useState<string[]>([]);
  const [addedProducts, setAddedProducts] = useState<string[]>([]);
  const [addedPartners, setAddedPartners] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
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
    props.config.defaultResponsibleUserId,
    props.config.defaultResponsibleTitle,
    props.config.manufacturers,
    props.config.products,
    props.config.suppliers,
    props.initialRow,
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
      toast.error(getErrorMessage(error, "Не удалось сохранить строку"));
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
      toast.error(getErrorMessage(error, "Не удалось создать партию"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            {isEdit ? `Редактирование строки${props.titleSuffix ? ` ${props.titleSuffix}` : ""}` : "Добавление новой строки"}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <DateField
              label="Дата поставки"
              value={row.deliveryDate}
              onChange={(value) => setValue("deliveryDate", value)}
            />
            {/* Время поставки печатается в бланке и показывается в карточке,
                но раньше в этом окне его негде было задать или поправить —
                оно приходило только из импорта, Меркурия и TasksFlow. */}
            <TimeField
              label="Время поставки"
              value={joinTimeValue(row.deliveryHour, row.deliveryMinute)}
              onChange={(value) => {
                const { hour, minute } = splitTimeValue(value);
                setRow((current) => ({ ...current, deliveryHour: hour, deliveryMinute: minute }));
              }}
            />
            <DateField
              label="Годен до"
              value={row.shelfLifeDate}
              onChange={(value) => setValue("shelfLifeDate", value)}
            />
          </div>

          {/* Наименование продукции */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Наименование продукции</Label>
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
                placeholder="Добавить название новой продукции"
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
            <Label className="text-[13px] font-medium text-[#3c4053]">Производитель/поставщик</Label>
            <Select
              value={toNone(row.manufacturerSupplier)}
              onValueChange={(value) => setValue("manufacturerSupplier", fromNone(value))}
            >
              <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder="Выберите из списка или добавьте нового" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>Выберите из списка или добавьте нового</SelectItem>
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
                placeholder="Добавить производителя/поставщика"
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
            <Label className="text-[13px] font-medium text-[#3c4053]">
              ТТН, документы соответствия
            </Label>
            <Textarea
              value={row.accompanyingDocs}
              onChange={(e) => setValue("accompanyingDocs", e.target.value)}
              placeholder="Например: ТТН №1245 от 10.08.2026, декларация о соответствии"
              rows={2}
              className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              Объем, номер партии, дата пр-ва
            </Label>
            <Textarea
              value={row.batchInfo}
              onChange={(e) => setValue("batchInfo", e.target.value)}
              placeholder="Например: 20 кг, партия 45-А, дата пр-ва 08.08.2026"
              rows={2}
              className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              Внутр-яя темп-ра продукта (для скоропортящихся и замороженных)
            </Label>
            <Input
              value={row.productTemperature}
              onChange={(e) => setValue("productTemperature", e.target.value)}
              placeholder="Например: +2 °C"
              className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
            />
          </div>

          {/* Соответствие товара сопроводительной документации */}
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              Соответствие товара сопроводительной документации
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["Соответствует", "#136b2a", "#ecfdf5"],
                  ["Не соответствует", "#d2453d", "#fff4f2"],
                ] as const
              ).map(([label, fg, bg]) => {
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
                    {label}
                  </button>
                );
              })}
            </div>
            <Textarea
              value={row.documentCompliance}
              onChange={(e) => setValue("documentCompliance", e.target.value)}
              placeholder="Соответствует / расхождения по документам"
              rows={2}
              className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]"
            />
          </div>

          {/* Опциональная 12-я колонка: показывается только когда
              включён тумблер «Добавить поля» (I1 аудита). */}
          {props.config.showPackagingCompliance ? (
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">
                {INCOMING_CONTROL_PACKAGING_COLUMN}
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["compliant", "Соответствует", "#136b2a", "#ecfdf5"],
                    ["non_compliant", "Не соответствует", "#d2453d", "#fff4f2"],
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
              <Label className="text-[13px] font-medium text-[#3c4053]">
                Принять/Отклонить, П/О
              </Label>
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
                  <SelectValue placeholder="— выберите —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— выберите —</SelectItem>
                  <SelectItem value="accept">{ACCEPTANCE_DECISION_FULL_LABELS.accept}</SelectItem>
                  <SelectItem value="reject">{ACCEPTANCE_DECISION_FULL_LABELS.reject}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              Корректирующие действия для забракованного товара
            </Label>
            <Textarea
              value={row.correctiveActions}
              onChange={(e) => setValue("correctiveActions", e.target.value)}
              placeholder="Например: возврат поставщику по акту №12"
              rows={3}
              className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]"
            />
          </div>

          {/* Ответственный — должность + сотрудник, как в остальных журналах */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Должность ответственного</Label>
              <Select
                value={toNone(row.responsibleTitle)}
                onValueChange={(value) => responsibleCascade.handlePositionChange(fromNone(value))}
              >
                <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder="— выберите —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— выберите —</SelectItem>
                  <PositionSelectItems users={props.users} />
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Ответственный</Label>
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
                  <SelectValue placeholder="— выберите —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— выберите —</SelectItem>
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
          >
            Отмена
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting}
            className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0] sm:w-auto"
          >
            {isSubmitting ? "Сохранение..." : isEdit ? "Сохранить" : "Добавить"}
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
}) {
  const [draft, setDraft] = useState("");
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
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
      title: `Удалить «${item}» из списка?`,
      description: "Позиция исчезнет из подсказок этого журнала.",
      variant: used ? "warn" : "danger",
      confirmLabel: "Удалить",
      bullets: used
        ? [
            {
              label: "Позиция уже стоит в записях журнала — там название останется как есть",
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
    toast.success(`Удалено из списка: ${item}`);
  }

  async function handleImport(file: File) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("Файл не содержит листов");
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    const importedItems = parseListImportItems(rawRows);
    if (importedItems.length === 0) {
      throw new Error("Не удалось найти значения в первом столбце первого листа");
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
              title="Переименовать"
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
              title="Удалить из списка"
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
      >
        Добавить из файла
      </button>
      {importOpen && (
        <div className="space-y-3 rounded-2xl border border-[#e3e5ef] bg-white p-4">
          <div className="text-[14px] leading-6 text-[#3d4152]">
            Список должен быть в файле Excel, на первом листе в первом столбце и
            начинаться с первой строки.
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
                setImportError(getErrorMessage(error, "Ошибка импорта"))
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
                  setImportError(getErrorMessage(error, "Ошибка импорта"))
                );
              }
            }}
            className={`flex min-h-[148px] w-full flex-col items-center justify-center gap-3 rounded-[24px] border border-dashed px-6 py-8 text-center ${
              dragActive ? "border-[#5566f6] bg-[#f6f7ff]" : "border-[#dcdfed] bg-white"
            }`}
          >
            <Paperclip className="size-8 text-[#6f7282]" />
            <span className="text-[18px] text-[#5566f6]">Выберите файл</span>
            <span className="text-[16px] text-[#3d4152]">или перетащите его сюда</span>
          </button>
          {importError ? (
            <div className="rounded-xl bg-[#fff2f1] px-4 py-3 text-[14px] text-[#d43a2f]">
              {importError}
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
  const [products, setProducts] = useState<string[]>(() => [...props.config.products]);
  const [manufacturers, setManufacturers] = useState<string[]>(() => [...props.config.manufacturers]);
  const [suppliers, setSuppliers] = useState<string[]>(() => [...props.config.suppliers]);

  function handleClose() {
    props.setConfig({ ...props.config, products, manufacturers, suppliers });
    props.onOpenChange(false);
  }

  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open) handleClose(); else props.onOpenChange(true); }}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>Редактировать список изделий</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 px-6 py-5">
          <EditableListSection
            title="Продукция"
            items={products}
            placeholder="Введите название новой продукции"
            onChange={setProducts}
            isUsed={(item) => props.config.rows.some((row) => row.productName === item)}
          />
          <EditableListSection
            title="Производители"
            items={manufacturers}
            placeholder="Введите название нового производителя"
            onChange={setManufacturers}
            isUsed={(item) =>
              props.config.rows.some(
                (row) =>
                  row.manufacturer === item || row.manufacturerSupplier.includes(item)
              )
            }
          />
          <EditableListSection
            title="Поставщики"
            items={suppliers}
            placeholder="Введите название нового поставщика"
            onChange={setSuppliers}
            isUsed={(item) =>
              props.config.rows.some(
                (row) => row.supplier === item || row.manufacturerSupplier.includes(item)
              )
            }
          />
          <div className="flex justify-end">
            <Button type="button" onClick={handleClose} className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4a5bf0]">
              Закрыть
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog(props: {
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

  useEffect(() => {
    if (!props.open) return;
    setTitle(props.title);
    setDateFrom(props.dateFrom);
    setExpiryLabel(props.config.expiryFieldLabel);
    setResponsibleTitle(props.config.defaultResponsibleTitle || "");
    setResponsibleUserId(props.config.defaultResponsibleUserId || "");
  }, [props.open, props.title, props.dateFrom, props.config]);

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
        <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          Название документа
        </Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
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
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
        />
      </div>
      {props.showExpiryLabelChoice === false ? null : (
      <div className="space-y-2">
        <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          Название поля для срока
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 transition-colors hover:bg-[#f5f6ff]">
          <input
            type="radio"
            name="expiryLabel-v2"
            checked={expiryLabel === "expiry_deadline"}
            onChange={() => setExpiryLabel("expiry_deadline")}
            className="size-4 accent-[#5566f6]"
          />
          <span className="text-[14px] text-[#0b1024]">
            «Предельный срок реализации»
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
          <span className="text-[14px] text-[#0b1024]">«Срок годности»</span>
        </label>
      </div>
      )}
      <div className="space-y-2">
        <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          Должность ответственного
        </Label>
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
            <SelectValue placeholder="— Выберите —" />
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
        title="Настройки журнала"
        description="Название журнала, дата начала, формат поля срока и ответственный по умолчанию."
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
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>Настройки журнала</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6 py-5">
          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Название документа</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-10 rounded-xl border-[#dcdfed] px-5 text-[16px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Дата начала</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-10 rounded-xl border-[#dcdfed] px-5 text-[16px]" />
          </div>
          {props.showExpiryLabelChoice === false ? null : (
          <div className="space-y-2">
            <div className="text-[14px] font-semibold">Название поля</div>
            <label className="flex items-center gap-2 text-[15px]">
              <input type="radio" name="expiryLabel" checked={expiryLabel === "expiry_deadline"} onChange={() => setExpiryLabel("expiry_deadline")} className="size-4 accent-[#5566f6]" />
              &quot;Предельный срок реализации&quot;
            </label>
            <label className="flex items-center gap-2 text-[15px]">
              <input type="radio" name="expiryLabel" checked={expiryLabel === "shelf_life"} onChange={() => setExpiryLabel("shelf_life")} className="size-4 accent-[#5566f6]" />
              &quot;Срок годности&quot;
            </label>
          </div>
          )}
          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Должность ответственного</Label>
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
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#f3f4fb] px-3.5 text-[16px]"><SelectValue placeholder="- Выберите значение -" /></SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={props.users} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Сотрудник</Label>
            <Select value={responsibleUserId} onValueChange={(v) => {
              setResponsibleUserId(v);
              const user = props.users.find((u) => u.id === v);
              if (user) setResponsibleTitle(getUserRoleLabel(user.role));
            }} open={settingsCascade.employeeOpen} onOpenChange={settingsCascade.setEmployeeOpen}>
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#f3f4fb] px-3.5 text-[16px]"><SelectValue placeholder="- Выберите значение -" /></SelectTrigger>
              <SelectContent>
                {(responsibleTitle ? settingsCascade.candidates : props.users).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end pt-2">
            <Button type="button" onClick={handleSave} disabled={isSubmitting} className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4a5bf0]">
              {isSubmitting ? "Сохранение..." : "Сохранить"}
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
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
      setErrorMessage(getErrorMessage(error, "Ошибка импорта"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            Добавление списка изделий из файла в формате Excel
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 px-6 py-5 text-[16px] text-black">
          <div className="space-y-3 leading-7 text-[#333]">
            <p>Список должен быть в файле Excel, на первом листе и начинаться с первой строки.</p>
            <p>Столбцы должны быть в следующем формате:</p>
            {props.isProductAcceptance ? (
              <div className="space-y-1">
                <div>1-й столбец - дата поставки (не может быть пустым или строкой)</div>
                <div>2-й столбец - наименование продукции (не может быть пустым)</div>
                <div>3-й столбец - годен до</div>
                <div>4-й столбец - производитель/поставщик</div>
                <div>5-й столбец - ТТН, документы соответствия</div>
                <div>6-й столбец - объем, номер партии, дата пр-ва</div>
                <div>7-й столбец - внутр. темп-ра продукта</div>
                <div>8-й столбец - соответствие товара сопроводительной документации</div>
                <div>9-й столбец - принять/отклонить (П - принять, О - отклонить)</div>
                <div>10-й столбец - корректирующие действия</div>
                <div>11-й столбец - ответственный (должность)</div>
              </div>
            ) : (
              <div className="space-y-1">
                <div>1-й столбец - дата поступления (не может быть пустым или строкой)</div>
                <div>2-й столбец - время поступления</div>
                <div>3-й столбец - наименование (не может быть пустым)</div>
                <div>4-й столбец - производитель</div>
                <div>5-й столбец - поставщик (не может быть пустым)</div>
                <div>6-й столбец - условия транспортировки (0 - Не удовл., 1 - Удовл.)</div>
                <div>7-й столбец - соответствие упаковки (0 - Не соотв., 1 - Соотв.)</div>
                <div>8-й столбец - результаты орг. оценки (0 - Не удовл., 1 - Удовл.)</div>
                <div>9-й столбец - предельный срок реализации, дата</div>
                <div>10-й столбец - предельный срок реализации, время</div>
                <div>11-й столбец - примечания</div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => downloadAcceptanceImportTemplate(props.isProductAcceptance)}
            className="text-[16px] text-[#5566f6] underline underline-offset-4"
          >
            Скачать пример файла
          </button>

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
            <span className="text-[15px] text-[#5566f6]">Выберите файл</span>
            <span className="text-[18px] text-[#3d4152]">или перетащите его сюда</span>
          </button>
          {errorMessage ? (
            <div className="whitespace-pre-line rounded-xl bg-[#fff2f1] px-4 py-3 text-[14px] text-[#d43a2f]">
              {errorMessage}
            </div>
          ) : null}

          <div className="space-y-3">
            <Label className="text-[13px] font-medium text-[#3c4053]">Должность ответственного</Label>
            <div className="flex h-14 items-center rounded-2xl border border-[#dcdfed] bg-[#f3f4fb] px-5 text-[16px]">
              {props.responsibleTitle || "—"}
            </div>
          </div>
          <div className="space-y-3">
            <Label className="text-[13px] font-medium text-[#3c4053]">Сотрудник</Label>
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
              {submitting ? "Добавление..." : "Добавить"}
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
}) {
  const [count, setCount] = useState("5");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setCount("5");
    setSubmitting(false);
    setErrorMessage(null);
  }, [props.open]);

  async function handleSubmit() {
    const parsed = Number(count);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 100) {
      setErrorMessage("Укажите количество строк от 1 до 100.");
      return;
    }

    setSubmitting(true);
    try {
      await props.onSubmit(parsed);
      props.onOpenChange(false);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Ошибка добавления строк"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            Добавить несколько строк
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 px-6 py-5">
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Количество строк</Label>
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
              {errorMessage}
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4a5bf0]"
            >
              {submitting ? "Добавление..." : "Добавить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IikoDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>Добавление списка из Iiko (Приходные накладные)</DialogTitle>
        </DialogHeader>
        <div className="px-6 py-5 text-[15px] text-[#555]">
          Для настройки синхронизации с Iiko обратитесь к разработчикам сервиса WeSetup.
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main Component ─── */

export function AcceptanceDocumentClient(props: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [config, setConfig] = useState(() => normalizeAcceptanceDocumentConfig(props.config, props.users));
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => { setConfig(normalizeAcceptanceDocumentConfig(props.config, props.users)); }, [props.config, props.users]);
  useEffect(() => { setTitle(props.title); setDateFrom(props.dateFrom); }, [props.dateFrom, props.title]);

  const rows = config.rows;
  const routeCode = props.routeCode;
  // routeCode может прийти алиасом источника (`acceptance1journal`), поэтому
  // тип журнала определяем по разрешённому коду шаблона, а не по URL-сегменту.
  const isProductAcceptance =
    resolveJournalCodeAlias(routeCode) === ACCEPTANCE_DOCUMENT_TEMPLATE_CODE;
  /** Заголовки v2-таблицы с учётом опциональной 12-й колонки (I1). */
  const incomingControlColumns = useMemo(
    () => getIncomingControlColumns(config.showPackagingCompliance),
    [config.showPackagingCompliance]
  );
  const allSelected = rows.length > 0 && selectedRowIds.length === rows.length;
  const isClosed = props.status === "closed";
  const responsibleTitle = config.defaultResponsibleTitle || "";
  const responsibleUserId = config.defaultResponsibleUserId || "";
  // Сортировка — по колонке «Годен до» (v2) / «Предельный срок реализации»
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
    subtitle:
      [
        formatAcceptanceDateDash(row.deliveryDate),
        row.deliveryHour ? `${row.deliveryHour}:${row.deliveryMinute || "00"}` : "",
      ]
        .filter(Boolean)
        .join(" ") || undefined,
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
            { label: "Годен до", value: values.shelfLifeDate, hideIfEmpty: true },
            { label: "Производитель/поставщик", value: values.manufacturerSupplier, hideIfEmpty: true },
            { label: "ТТН, документы соответствия", value: values.accompanyingDocs, hideIfEmpty: true },
            { label: "Объем, номер партии, дата пр-ва", value: values.batchInfo, hideIfEmpty: true },
            { label: "Внутр-яя темп-ра продукта", value: values.productTemperature, hideIfEmpty: true },
            { label: "Соответствие сопр. документации", value: values.documentCompliance, hideIfEmpty: true },
            { label: "Принять/Отклонить", value: values.acceptanceDecision, hideIfEmpty: true },
            { label: "Корректирующие действия", value: values.correctiveActions, hideIfEmpty: true },
            { label: "Ответственный", value: getResponsibleLabel(row, props.users), hideIfEmpty: true },
          ];
        })()
      : [
      { label: "Производитель", value: row.manufacturer, hideIfEmpty: true },
      { label: "Поставщик", value: row.supplier, hideIfEmpty: true },
      {
        label: "Транспортировка",
        value: TRANSPORT_LABELS[row.transportCondition],
        hideIfEmpty: true,
      },
      {
        label: "Упаковка/маркировка",
        value: COMPLIANCE_LABELS[row.packagingCompliance],
        hideIfEmpty: true,
      },
      {
        label: "Органолептика",
        value: ORGANOLEPTIC_LABELS[row.organolepticResult],
        hideIfEmpty: true,
      },
      {
        label: getExpiryFieldDisplayLabel(config.expiryFieldLabel),
        value: `${formatAcceptanceDateDash(row.expiryDate)}${row.expiryHour ? ` ${row.expiryHour}:${row.expiryMinute || "00"}` : ""}`,
        hideIfEmpty: true,
      },
      { label: "Примечания", value: row.note, hideIfEmpty: true },
      {
        label: "Ответственный",
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

  async function persist(nextTitle: string, nextDateFrom: string, nextConfig: AcceptanceDocumentConfig) {
    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: nextTitle, dateFrom: nextDateFrom, config: nextConfig }),
    });
    if (!response.ok) throw new Error("Не удалось сохранить документ");
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
      toast.error(payload?.error || "Не удалось создать партию");
      return null;
    }
    const batch = (await response.json()) as { id: string; code: string };
    const nextRow: AcceptanceRow = { ...row, batchId: batch.id, batchCode: batch.code };
    await persist(title, dateFrom, {
      ...config,
      rows: config.rows.map((item) => (item.id === row.id ? nextRow : item)),
    });
    toast.success(`Партия ${batch.code} создана`, {
      action: { label: "Открыть", onClick: () => router.push(`/batches/${batch.id}`) },
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
      title: "Удалить выбранные строки?",
      description: "Записи о приёмке исчезнут из журнала безвозвратно.",
      variant: "danger",
      confirmLabel: "Удалить",
      bullets: [
        { label: `Строк будет удалено: ${selectedRowIds.length}`, tone: "warn" },
        names.length > 0
          ? {
              label: `Продукция: ${names.slice(0, 4).join(", ")}${names.length > 4 ? " и др." : ""}`,
              tone: "info" as const,
            }
          : { label: "У выбранных строк не заполнено наименование", tone: "info" as const },
        {
          label: `Останется строк: ${config.rows.length - selectedRowIds.length}`,
          tone: "default",
        },
      ],
    });
    if (!confirmed) return;
    const count = selectedRowIds.length;
    await persist(title, dateFrom, { ...config, rows: config.rows.filter((r) => !selectedRowIds.includes(r.id)) });
    setSelectedRowIds([]);
    toast.success(`Удалено строк: ${count}`);
  }

  async function handleCloseJournal() {
    const confirmed = await confirmAsync({
      title: "Закончить журнал?",
      description: `Документ «${title}» перейдёт в закладку «Закрытые» и станет доступен только для просмотра.`,
      variant: "warn",
      confirmLabel: "Закончить журнал",
      bullets: [
        { label: `Строк в журнале: ${config.rows.length}`, tone: "info" },
        { label: "Добавлять и редактировать поставки будет нельзя", tone: "warn" },
        { label: "Журнал можно вернуть в активные из списка документов", tone: "default" },
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
    });
    const dataRows = (hasHeader ? normalizedRows.slice(1) : normalizedRows).filter((row) =>
      row.some((cell) => normalizeImportText(cell))
    );
    if (dataRows.length === 0) return;

    const errors: string[] = [];
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
            errors.push(`Строка ${rowNumber}: заполните корректную дату поставки`);
          if (!productName)
            errors.push(`Строка ${rowNumber}: заполните наименование продукции`);
          if (shelfLifeRaw && !shelfLifeDate)
            errors.push(`Строка ${rowNumber}: заполните корректную дату «Годен до»`);
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

      if (!deliveryDate) errors.push(`Строка ${rowNumber}: заполните корректную дату поступления`);
      if (!productName) errors.push(`Строка ${rowNumber}: заполните наименование продукции`);
      if (!supplier) errors.push(`Строка ${rowNumber}: заполните поставщика`);
      if (transportCondition === null) errors.push(`Строка ${rowNumber}: заполните условия транспортировки`);
      if (packagingCompliance === null) errors.push(`Строка ${rowNumber}: заполните соответствие упаковки`);
      if (organolepticResult === null) errors.push(`Строка ${rowNumber}: заполните результаты орг. оценки`);
      if (expiryDateRaw && !expiryDate) errors.push(`Строка ${rowNumber}: заполните корректную дату срока реализации`);
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
    if (errors.length > 0) throw new Error(errors.slice(0, 8).join("\n"));
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

  const organizationLabel = props.organizationName || ORG_NAME_FALLBACK;
  const pageTitle = getAcceptancePageTitle(routeCode);
  const documentTitle = title || getAcceptanceDocumentTitle(routeCode);
  const journalHeaderTitle = isProductAcceptance
    ? "ЖУРНАЛ ПРИЕМКИ И ВХОДНОГО КОНТРОЛЯ ПРОДУКЦИИ"
    : "ЖУРНАЛ ВХОДНОГО КОНТРОЛЯ СЫРЬЯ, ИНГРЕДИЕНТОВ, УПАКОВОЧНЫХ МАТЕРИАЛОВ";

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
                toast.error(getErrorMessage(error, "Не удалось удалить строки"))
              )
            }
            hint="Записи приёмки будут удалены без возможности отмены"
          >
            <SelectionEditButton count={selectedRowIds.length} disabled={isClosed} onClick={() => seq.start(selectedRowIds)} />
          </JournalSelectionBar>
        ) : null}

        {errorMessage ? (
          <div className="whitespace-pre-line rounded-2xl bg-[#fff2f1] px-5 py-4 text-[14px] text-[#d43a2f]">
            {errorMessage}
          </div>
        ) : null}

        <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />
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
                    label: "Закончить журнал",
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
            >
              Сортировать по сроку годности
            </label>
          </div>
        ) : (
          <label className={`${DOC_AUTOFILL_STRIP_CLASS} cursor-pointer`}>
            <Checkbox checked={sortByExpiry} onCheckedChange={(checked) => setSortByExpiry(checked === true)} />
            <span className={DOC_AUTOFILL_LABEL_CLASS}>Сортировать по сроку годности</span>
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
            <JournalClosedBanner hint="Верните журнал в активные, чтобы снова регистрировать поставки и входной контроль." />
          </div>
        ) : null}

        {/* Toolbar */}
        {!isClosed && (
          <div className={DOC_ADD_ROW_CLASS}>
            <ResponsiveMenu
              title="Добавить"
              align="start"
              items={[
                {
                  key: "add-row",
                  label: "Добавить",
                  icon: <Plus className="size-4 text-[#6f7282]" />,
                  onSelect: () => {
                    setEditingRow(null);
                    setRowDialogOpen(true);
                  },
                },
                {
                  key: "add-bulk",
                  label: "Добавить несколько строк",
                  icon: <Plus className="size-4 text-[#6f7282]" />,
                  onSelect: () => setBulkAddOpen(true),
                },
                {
                  key: "add-file",
                  label: "Добавить из файла",
                  icon: <Upload className="size-4 text-[#6f7282]" />,
                  onSelect: () => setRowsImportOpen(true),
                },
                {
                  key: "add-iiko",
                  label: "Добавить из Айко",
                  icon: <span aria-hidden>📋</span>,
                  onSelect: () => setIikoOpen(true),
                },
              ]}
              trigger={
                <Button type="button" className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white hover:bg-[#4a5bf0]">
                  <Plus className="size-5" strokeWidth={2.5} /> Добавить <ChevronDown className="size-4" />
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
              <span>Добавить<span className="sm:hidden">&nbsp;поставку</span></span>
            </Button>

            <Button type="button" variant="outline" className={DOC_SECONDARY_BUTTON_CLASS} onClick={() => setEditListsOpen(true)}>
              Редактировать списки
            </Button>

          </div>
        )}


        {mobileView === "cards" ? (
          <RecordCardsView items={cardItems} emptyLabel="Поставок пока не зарегистрировано." />
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
                      <td className={`${GRID_CELL_CLASS} px-1.5 py-1.5 leading-tight break-words`}>{values.documentCompliance}</td>
                      {config.showPackagingCompliance ? (
                        <td className={`${GRID_CELL_CLASS} px-1.5 py-1 text-center leading-tight break-words`}>
                          {COMPLIANCE_LABELS[row.packagingCompliance]}
                        </td>
                      ) : null}
                      <td className={`${GRID_CELL_CLASS} px-1.5 py-1 text-center font-semibold leading-tight break-words`}>{values.acceptanceDecision}</td>
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
                    >
                      Строк пока нет
                    </td>
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
                    label="Добавить"
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
                    ? "Дата, время поступления продукции, товара"
                    : "Дата, время поступления"}
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>
                  {isProductAcceptance ? "Наименование продукции" : "Наименование"}
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>Производитель</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>Поставщик</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>Условия транспортировки</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>
                  {isProductAcceptance
                    ? "Соответствие упаковки, маркировки, гигиенические требования, наличие и правильность оформления товаросопроводительной документации"
                    : "Соответствие упаковки, маркировки и товаросопроводительной документации"}
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>Результаты органолептической оценки доброкачественности</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>{getExpiryFieldDisplayLabel(config.expiryFieldLabel)}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>Примечания</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center leading-tight`}>Ответственный</th>
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
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{TRANSPORT_LABELS[row.transportCondition]}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{COMPLIANCE_LABELS[row.packagingCompliance]}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{ORGANOLEPTIC_LABELS[row.organolepticResult]}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center whitespace-pre-line leading-tight`}>
                    {formatAcceptanceDateDash(row.expiryDate)}
                    {row.expiryHour ? `\n${row.expiryHour}:${row.expiryMinute || "00"}` : ""}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>{row.note || ""}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>{getResponsibleLabel(row, props.users)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={11} className={`${GRID_CELL_CLASS} p-8 text-center text-[#80849a] leading-tight`}>Строк пока нет</td></tr>
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
                  label="Добавить"
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

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} title={title} dateFrom={dateFrom} users={props.users} config={config} onSave={async (params) => { await persist(params.title, params.dateFrom, params.config); }} useV2={props.useV2} showExpiryLabelChoice={!isProductAcceptance} />
      {editListsOpen && (
        <IncomingControlEditListsDialog
          key={`${config.products.join("|")}::${config.manufacturers.join("|")}::${config.suppliers.join("|")}`}
          open={editListsOpen}
          onOpenChange={setEditListsOpen}
          config={config}
          setConfig={(nextConfig) => {
            void persist(title, dateFrom, nextConfig).catch((error) =>
              setErrorMessage(getErrorMessage(error, "Ошибка сохранения списков"))
            );
          }}
        />
      )}
      {isProductAcceptance ? (
        <IncomingControlRowDialog
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
        <RowDialog open={rowDialogOpen} onOpenChange={(open) => { if (open) setRowDialogOpen(true); else seq.cancelled(); }} users={props.users} config={config} initialRow={editingRow} titleSuffix={seq.progress ?? undefined} recentProducts={productSuggestions.recent} onSave={handleSaveRow} onCreateBatch={isClosed ? undefined : handleCreateBatchFromRow} />
      )}
      <ImportRowsDialog open={rowsImportOpen} onOpenChange={setRowsImportOpen} users={props.users} responsibleTitle={responsibleTitle} responsibleUserId={responsibleUserId} isProductAcceptance={isProductAcceptance} onFileSelect={handleImportFile} />
      <AddMultipleRowsDialog open={bulkAddOpen} onOpenChange={setBulkAddOpen} onSubmit={addMultipleRows} />
      <IikoDialog open={iikoOpen} onOpenChange={setIikoOpen} />
    </div>
  );
}
