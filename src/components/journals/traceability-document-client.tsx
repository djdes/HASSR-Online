"use client";

import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { GRID_CELL_CLASS, GRID_HEAD_CELL_CLASS } from "@/components/journals/journal-grid";
import { DOC_SECONDARY_BUTTON_CLASS } from "@/components/journals/journal-responsive";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  CalendarDays,
  ChevronDown,
  Package,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  USER_ROLE_LABEL_VALUES,
  getRowEmployeeTitle,
  getUserDisplayTitle,
} from "@/lib/user-roles";
import { buildStaffOptionLabel } from "@/lib/journal-staff-binding";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  TRACEABILITY_DOCUMENT_TITLE,
  TRACEABILITY_IMPORT_COLUMNS,
  createTraceabilityRow,
  formatTraceabilityQuantity,
  normalizeTraceabilityDocumentConfig,
  normalizeTraceabilityRow,
  validateTraceabilityRow,
  type TraceabilityDocumentConfig,
  type TraceabilityRow,
} from "@/lib/traceability-document";

import { toast } from "sonner";
import { useJournalUndo } from "@/lib/journal-undo";
import { confirmAsync } from "@/components/ui/confirm-async";
import { PositionSelectItems } from "@/components/shared/position-select";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";
import { localDayKey } from "@/lib/entry-defaults";
import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
import { OrgDirectoryDialog } from "@/components/journals/org-directory-dialog";

// Должность из карточки (как в UserLike) — её пишем в строку и показываем.
type PersonItem = {
  id: string;
  name: string;
  role?: string | null;
  positionTitle?: string | null;
  jobPosition?: { name: string; categoryKey: string } | null;
};
type TraceabilitySettingsDraft = { title: string; dateFrom: string; showShockTempField: boolean; showShipmentBlock: boolean };
type TraceabilityRowDraft = {
  id: string;
  date: string;
  incomingRawMaterialName: string;
  incomingBatchNumber: string;
  /** Партия склада, из которой взято сырьё (необязательно). */
  incomingBatchId: string;
  incomingPackagingDate: string;
  incomingQuantityPieces: string;
  incomingQuantityKg: string;
  outgoingProductName: string;
  outgoingQuantityPieces: string;
  outgoingQuantityKg: string;
  outgoingShockTemp: string;
  responsibleRole: string;
  responsibleEmployeeId: string;
  responsibleEmployee: string;
};
type TraceabilityImportError = { rowNumber: number; errors: string[] };

type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  dateFrom: string;
  status: string;
  initialConfig?: unknown;
  config?: unknown;
  routeCode?: string;
  users?: PersonItem[];
  employees?: PersonItem[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

const DEFAULT_TITLE = TRACEABILITY_DOCUMENT_TITLE;
const ROLE_OPTIONS = USER_ROLE_LABEL_VALUES;

function todayIso() { return localDayKey(); }
function normalizeIsoDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? todayIso() : date.toISOString().slice(0, 10);
}
function formatDashDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${normalizeIsoDate(value)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getUTCDate()).padStart(2, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${date.getUTCFullYear()}`;
}
/**
 * «Кол-во, шт./кг.» — одна колонка бланка на обе меры. Печать давно
 * выводит обе через «/», а экран показывал только килограммы: если
 * заполнены и штуки, и кг, половина данных пропадала.
 */
function formatQuantityPair(
  pieces: number | null | undefined,
  kg: number | null | undefined
) {
  return [formatTraceabilityQuantity(pieces), formatTraceabilityQuantity(kg)]
    .filter(Boolean)
    .join(" / ");
}
function parseLooseNumber(value: string) {
  const normalized = value.trim().replace(/\s+/g, "").replace(",", ".");
  if (!normalized) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}
function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}
function mergeUnique(base: string[], extra: string[]) { return uniqueStrings([...base, ...extra]); }

/** Позиция справочника в окне «Редактировать списки». */
type ListDraftItem = { original: string | null; value: string };

/** Карта «старое наименование → новое» по переименованным позициям. */
function renameMap(items: ListDraftItem[]) {
  const map = new Map<string, string>();
  for (const item of items) {
    const next = item.value.trim();
    if (!item.original || !next || item.original === next) continue;
    map.set(item.original, next);
  }
  return map;
}

function defaultSettings(config: TraceabilityDocumentConfig, title: string, dateFrom: string): TraceabilitySettingsDraft {
  return {
    title: title || config.documentTitle || DEFAULT_TITLE,
    dateFrom: normalizeIsoDate(dateFrom || config.dateFrom || todayIso()),
    showShockTempField: config.showShockTempField,
    showShipmentBlock: config.showShipmentBlock,
  };
}
function defaultRow(config: TraceabilityDocumentConfig): TraceabilityRow {
  // Новая строка — про СЕГОДНЯ, а не про дату начала журнала; дату
  // фасовки подставлять нельзя, её знает только человек.
  return createTraceabilityRow({
    date: todayIso(),
    incoming: { rawMaterialName: config.rawMaterialList[0] || "", batchNumber: "", packagingDate: "", quantityPieces: null, quantityKg: null },
    outgoing: { productName: config.productList[0] || "", quantityPacksPieces: null, quantityPacksKg: null, shockTemp: null },
    responsibleRole: config.defaultResponsibleRole || "",
    responsibleEmployeeId: config.defaultResponsibleEmployeeId || "",
    responsibleEmployee: config.defaultResponsibleEmployee || "",
  });
}
function rowToDraft(row: TraceabilityRow, config: TraceabilityDocumentConfig): TraceabilityRowDraft {
  return {
    id: row.id,
    date: normalizeIsoDate(row.date || todayIso()),
    incomingRawMaterialName: row.incoming.rawMaterialName || config.rawMaterialList[0] || "",
    incomingBatchNumber: row.incoming.batchNumber || "",
    incomingBatchId: row.incoming.batchId || "",
    // Пустая дата фасовки остаётся пустой: подставленная дата журнала
    // выглядела как заполненная и уезжала в бланк.
    incomingPackagingDate: row.incoming.packagingDate ? normalizeIsoDate(row.incoming.packagingDate) : "",
    incomingQuantityPieces: row.incoming.quantityPieces != null ? String(row.incoming.quantityPieces) : "",
    incomingQuantityKg: row.incoming.quantityKg != null ? String(row.incoming.quantityKg) : "",
    outgoingProductName: row.outgoing.productName || config.productList[0] || "",
    outgoingQuantityPieces: row.outgoing.quantityPacksPieces != null ? String(row.outgoing.quantityPacksPieces) : "",
    outgoingQuantityKg: row.outgoing.quantityPacksKg != null ? String(row.outgoing.quantityPacksKg) : "",
    outgoingShockTemp: row.outgoing.shockTemp != null ? String(row.outgoing.shockTemp) : "",
    // Человек в строке уже есть — его должность, а не должность
    // ответственного документа (другого человека). Пара по умолчанию —
    // только для строки без ответственного.
    ...(row.responsibleEmployeeId || row.responsibleEmployee
      ? {
          responsibleRole: row.responsibleRole || "",
          responsibleEmployeeId: row.responsibleEmployeeId || "",
          responsibleEmployee: row.responsibleEmployee || "",
        }
      : {
          responsibleRole: config.defaultResponsibleRole || "",
          responsibleEmployeeId: config.defaultResponsibleEmployeeId || "",
          responsibleEmployee: config.defaultResponsibleEmployee || "",
        }),
  };
}
function draftToRow(draft: TraceabilityRowDraft) {
  return normalizeTraceabilityRow({
    id: draft.id,
    date: normalizeIsoDate(draft.date),
    incoming: {
      rawMaterialName: draft.incomingRawMaterialName,
      batchNumber: draft.incomingBatchNumber,
      batchId: draft.incomingBatchId,
      packagingDate: normalizeIsoDate(draft.incomingPackagingDate),
      quantityPieces: parseLooseNumber(draft.incomingQuantityPieces),
      quantityKg: parseLooseNumber(draft.incomingQuantityKg),
    },
    outgoing: {
      productName: draft.outgoingProductName,
      quantityPacksPieces: parseLooseNumber(draft.outgoingQuantityPieces),
      quantityPacksKg: parseLooseNumber(draft.outgoingQuantityKg),
      shockTemp: parseLooseNumber(draft.outgoingShockTemp),
    },
    responsibleRole: draft.responsibleRole,
    responsibleEmployeeId: draft.responsibleEmployeeId,
    responsibleEmployee: draft.responsibleEmployee,
  });
}
function formatImportErrors(errors: TraceabilityImportError[]) {
  return errors.slice(0, 8).map((item) => `Строка ${item.rowNumber}: ${item.errors.join("; ")}`).join("\n");
}

function SettingsDialog(props: {
  open: boolean;
  title: string;
  initial: TraceabilitySettingsDraft | null;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: TraceabilitySettingsDraft) => Promise<void>;
  useV2?: boolean;
}) {
  const [draft, setDraft] = useState<TraceabilitySettingsDraft | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (props.open) setDraft(props.initial); }, [props.initial, props.open]);
  async function save() {
    if (!draft) return;
    setLoading(true);
    try {
      await props.onSave(draft);
      props.onOpenChange(false);
    } catch (error) {
      // Без catch ошибка сохранения глохла: окно висело, тоста не было.
      toast.error(humanizeFetchError(error, "Не удалось сохранить настройки"));
    } finally {
      setLoading(false);
    }
  }

  if (props.useV2) {
    return (
      <JournalSettingsModal
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={props.title}
        description="Название документа, дата начала и опциональные блоки."
        size="md"
        isSaving={loading}
        saveDisabled={!draft}
        onSave={save}
        onCancel={() => props.onOpenChange(false)}
      >
        {draft && (
          <>
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                Название документа
              </Label>
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                Дата начала
              </Label>
              <Input
                type="date"
                value={draft.dateFrom}
                onChange={(e) => setDraft({ ...draft, dateFrom: normalizeIsoDate(e.target.value) })}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="space-y-2">
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                Дополнительные поля
              </div>
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 transition-colors hover:bg-[#f5f6ff]">
                <span className="text-[14px] text-[#0b1024]">T °C продукта после шоковой заморозки</span>
                <Switch
                  checked={draft.showShockTempField}
                  onCheckedChange={(checked) => setDraft({ ...draft, showShockTempField: checked })}
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 transition-colors hover:bg-[#f5f6ff]">
                <span className="text-[14px] text-[#0b1024]">Блок «Отгружено»</span>
                <Switch
                  checked={draft.showShipmentBlock}
                  onCheckedChange={(checked) => setDraft({ ...draft, showShipmentBlock: checked })}
                />
              </label>
            </div>
          </>
        )}
      </JournalSettingsModal>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[28px] border-0 p-0 sm:max-w-[700px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">{props.title}</DialogTitle>
            <button type="button" className="rounded-xl p-2" onClick={() => props.onOpenChange(false)}><X className="size-7" /></button>
          </div>
        </DialogHeader>
        {draft && (
          <div className="space-y-5 px-8 py-6">
            <div className="space-y-2"><Label className="text-[14px] text-[#7a7c8e]">Название документа</Label><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" /></div>
            <div className="space-y-2"><Label className="text-[14px] text-[#7a7c8e]">Дата начала</Label><div className="relative"><Input type="date" value={draft.dateFrom} onChange={(e) => setDraft({ ...draft, dateFrom: normalizeIsoDate(e.target.value) })} className="h-10 rounded-xl border-[#d8dae6] px-6 pr-14 text-[13.5px]" /><CalendarDays className="pointer-events-none absolute right-5 top-1/2 size-6 -translate-y-1/2 text-[#6e7080]" /></div></div>
            <div className="space-y-4 rounded-[28px] border border-[#e3e5f0] px-5 py-5"><div className="text-[20px] font-medium tracking-[-0.02em] text-black">Добавить поле</div><div className="flex items-center justify-between gap-4 rounded-[24px] bg-[#f7f8fd] px-5 py-4"><Label className="text-[18px] leading-tight text-black">T °C продукта после шоковой заморозки</Label><Switch checked={draft.showShockTempField} onCheckedChange={(checked) => setDraft({ ...draft, showShockTempField: checked })} /></div></div>
            <div className="space-y-4 rounded-[28px] border border-[#e3e5f0] px-5 py-5"><div className="text-[20px] font-medium tracking-[-0.02em] text-black">Добавить блок</div><div className="flex items-center justify-between gap-4 rounded-[24px] bg-[#f7f8fd] px-5 py-4"><Label className="text-[18px] leading-tight text-black">Отгружено</Label><Switch checked={draft.showShipmentBlock} onCheckedChange={(checked) => setDraft({ ...draft, showShipmentBlock: checked })} /></div></div>
            <div className="flex justify-end pt-2"><Button type="button" onClick={save} disabled={loading} className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4654ff]">{loading ? "Сохранение..." : "Сохранить"}</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
function ListsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: TraceabilityDocumentConfig;
  onSave: (nextConfig: TraceabilityDocumentConfig) => Promise<void>;
}) {
  // `original` — имя позиции на момент открытия окна (null у только что
  // добавленной). По нему строится карта переименований: строки журнала
  // хранят наименование ТЕКСТОМ, и без переноса Select переставал
  // находить значение — строка «осиротевала».
  const [rawMaterials, setRawMaterials] = useState<ListDraftItem[]>([]);
  const [products, setProducts] = useState<ListDraftItem[]>([]);
  const [newRaw, setNewRaw] = useState("");
  const [newProduct, setNewProduct] = useState("");
  const [loading, setLoading] = useState(false);
  // «Из справочника организации» — общий справочник продуктов организации
  // вместо отдельной загрузки в каждом журнале.
  const [directoryList, setDirectoryList] = useState<"raw" | "product" | null>(null);

  /** Добавление имён из общего справочника — без повторов и переименований. */
  function addFromDirectory(list: "raw" | "product", items: string[]) {
    const setter = list === "raw" ? setRawMaterials : setProducts;
    setter((current) => {
      const have = new Set(current.map((item) => item.value.trim().toLowerCase()));
      const additions = items
        .filter((item) => !have.has(item.trim().toLowerCase()))
        .map((value) => ({ original: null, value }));
      return [...current, ...additions];
    });
  }

  useEffect(() => {
    if (!props.open) return;
    setRawMaterials(props.config.rawMaterialList.map((value) => ({ original: value, value })));
    setProducts(props.config.productList.map((value) => ({ original: value, value })));
    setNewRaw("");
    setNewProduct("");
  }, [props.config.productList, props.config.rawMaterialList, props.open]);

  function update(list: "raw" | "product", index: number, value: string) {
    const patch = (current: ListDraftItem[]) =>
      current.map((item, i) => (i === index ? { ...item, value } : item));
    if (list === "raw") setRawMaterials(patch);
    else setProducts(patch);
  }

  function remove(list: "raw" | "product", index: number) {
    if (list === "raw") setRawMaterials((current) => current.filter((_, i) => i !== index));
    else setProducts((current) => current.filter((_, i) => i !== index));
  }

  async function save() {
    setLoading(true);
    try {
      const rawRenames = renameMap(rawMaterials);
      const productRenames = renameMap(products);
      const rows =
        rawRenames.size === 0 && productRenames.size === 0
          ? props.config.rows
          : props.config.rows.map((row) => ({
              ...row,
              incoming: {
                ...row.incoming,
                rawMaterialName:
                  rawRenames.get(row.incoming.rawMaterialName) ?? row.incoming.rawMaterialName,
              },
              outgoing: {
                ...row.outgoing,
                productName:
                  productRenames.get(row.outgoing.productName) ?? row.outgoing.productName,
              },
            }));
      await props.onSave({
        ...props.config,
        rawMaterialList: uniqueStrings(rawMaterials.map((item) => item.value)),
        productList: uniqueStrings(products.map((item) => item.value)),
        rows,
      });
      props.onOpenChange(false);
    } catch (error) {
      toast.error(humanizeFetchError(error, "Не удалось сохранить списки"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[28px] border-0 p-0 sm:max-w-[920px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">Редактировать списки</DialogTitle>
            <button type="button" className="rounded-xl p-2" onClick={() => props.onOpenChange(false)}><X className="size-7" /></button>
          </div>
        </DialogHeader>

        <div className="grid gap-5 px-8 py-6 md:grid-cols-2">
          <section className="space-y-4 rounded-[24px] border border-[#e6e9f5] p-5">
            <div className="text-[20px] font-semibold tracking-[-0.02em] text-black">Сырье</div>
            <div className="space-y-2">
              {rawMaterials.map((item, index) => (
                <div key={`${item.original ?? "new"}-${index}`} className="flex items-center gap-2">
                  <Input value={item.value} onChange={(e) => update("raw", index, e.target.value)} className="h-12 rounded-2xl border-[#dfe1ec] px-4 text-[16px]" />
                  <button type="button" className="rounded-xl p-2 text-[#6f7282] hover:bg-[#fff2f1] hover:text-[#ff3b30]" onClick={() => remove("raw", index)}><Trash2 className="size-5" /></button>
                </div>
              ))}
              {rawMaterials.length === 0 && <div className="rounded-2xl border border-dashed border-[#dfe1ec] px-4 py-4 text-[15px] text-[#6f7282]">Список пуст</div>}
            </div>
            <button
              type="button"
              className="text-left text-[14px] text-[#3848c7] underline underline-offset-4"
              onClick={() => setDirectoryList("raw")}
              title="Добавить сырьё из общего справочника организации"
            >
              Из справочника организации
            </button>
            <div className="flex items-center gap-2"><Input value={newRaw} onChange={(e) => setNewRaw(e.target.value)} placeholder="Добавить новое сырье" className="h-12 rounded-2xl border-[#dfe1ec] px-4 text-[16px]" /><Button type="button" onClick={() => { const v = newRaw.trim(); if (!v) return; setRawMaterials((current) => [...current, { original: null, value: v }]); setNewRaw(""); }} className="h-12 rounded-2xl bg-[#5563ff] px-4 text-white hover:bg-[#4654ff]"><Plus className="size-5" /></Button></div>
          </section>
          <section className="space-y-4 rounded-[24px] border border-[#e6e9f5] p-5">
            <div className="text-[20px] font-semibold tracking-[-0.02em] text-black">Продукция</div>
            <div className="space-y-2">
              {products.map((item, index) => (
                <div key={`${item.original ?? "new"}-${index}`} className="flex items-center gap-2">
                  <Input value={item.value} onChange={(e) => update("product", index, e.target.value)} className="h-12 rounded-2xl border-[#dfe1ec] px-4 text-[16px]" />
                  <button type="button" className="rounded-xl p-2 text-[#6f7282] hover:bg-[#fff2f1] hover:text-[#ff3b30]" onClick={() => remove("product", index)}><Trash2 className="size-5" /></button>
                </div>
              ))}
              {products.length === 0 && <div className="rounded-2xl border border-dashed border-[#dfe1ec] px-4 py-4 text-[15px] text-[#6f7282]">Список пуст</div>}
            </div>
            <button
              type="button"
              className="text-left text-[14px] text-[#3848c7] underline underline-offset-4"
              onClick={() => setDirectoryList("product")}
              title="Добавить продукцию из общего справочника организации"
            >
              Из справочника организации
            </button>
            <div className="flex items-center gap-2"><Input value={newProduct} onChange={(e) => setNewProduct(e.target.value)} placeholder="Добавить новую продукцию" className="h-12 rounded-2xl border-[#dfe1ec] px-4 text-[16px]" /><Button type="button" onClick={() => { const v = newProduct.trim(); if (!v) return; setProducts((current) => [...current, { original: null, value: v }]); setNewProduct(""); }} className="h-12 rounded-2xl bg-[#5563ff] px-4 text-white hover:bg-[#4654ff]"><Plus className="size-5" /></Button></div>
          </section>
        </div>

        <OrgDirectoryDialog
          open={directoryList !== null}
          onClose={() => setDirectoryList(null)}
          kind={directoryList === "product" ? "dish" : "product"}
          existing={(directoryList === "product" ? products : rawMaterials).map((item) => item.value)}
          onAdd={(items) => addFromDirectory(directoryList ?? "raw", items)}
        />

        <div className="flex justify-end px-8 pb-6"><Button type="button" onClick={save} disabled={loading} className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4654ff]">{loading ? "Сохранение..." : "Сохранить"}</Button></div>
      </DialogContent>
    </Dialog>
  );
}

type ActiveBatch = {
  id: string;
  code: string;
  productName: string;
  supplier: string | null;
  quantity: number;
  unit: string;
  expiryDate: string | null;
};

/**
 * Выбор сырья «из партий»: активные партии организации со складa.
 * Список бывает длинным, поэтому popover с поиском, а не нативный select.
 * Выбранная партия сохраняется id'шником И снимком текста (название,
 * номер) — чтобы журнал читался, даже если партию потом переименуют.
 */
function BatchPicker(props: {
  onPick: (batch: ActiveBatch) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [batches, setBatches] = useState<ActiveBatch[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || batches) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/batches?status=received");
        if (!response.ok) throw new Error("load failed");
        const data = (await response.json()) as ActiveBatch[];
        if (!cancelled) setBatches(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [batches, open]);

  const filtered = (batches ?? []).filter((batch) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${batch.code} ${batch.productName} ${batch.supplier ?? ""}`
      .toLowerCase()
      .includes(needle);
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={props.disabled}
          className="h-10 w-full justify-between rounded-xl border-[#d8dae6] px-3.5 text-[13.5px] font-medium text-[#3848c7] shadow-none transition-colors duration-150 hover:bg-[#f5f6ff]"
        >
          <span className="flex items-center gap-1.5">
            <Package className="size-4" />
            Выбрать из партий
          </span>
          <ChevronDown className="size-4 text-[#9b9fb3]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(420px,calc(100vw-3rem))] rounded-2xl border-[#ececf4] p-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по продукту, номеру, поставщику"
          className="h-9 rounded-xl border-[#dcdfed] px-3 text-[13px]"
        />
        <div className="mt-2 max-h-[280px] space-y-1 overflow-y-auto">
          {failed ? (
            <p className="px-2 py-4 text-center text-[13px] text-[#a13a32]">
              Не удалось загрузить партии
            </p>
          ) : batches === null ? (
            <p className="px-2 py-4 text-center text-[13px] text-[#9b9fb3]">Загрузка…</p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-4 text-center text-[13px] text-[#9b9fb3]">
              {batches.length === 0
                ? "Активных партий нет — заведите их в «Партиях» или из приёмки"
                : "Ничего не найдено"}
            </p>
          ) : (
            filtered.map((batch) => (
              <button
                key={batch.id}
                type="button"
                onClick={() => {
                  props.onPick(batch);
                  setOpen(false);
                }}
                className="block w-full rounded-xl px-3 py-2 text-left transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:bg-[#f5f6ff] focus-visible:outline-none"
              >
                <span className="block text-[13.5px] font-medium text-[#0b1024]">
                  {batch.productName}
                </span>
                <span className="mt-0.5 block text-[12px] text-[#6f7282]">
                  № {batch.code} · остаток {batch.quantity} {batch.unit}
                  {batch.expiryDate
                    ? ` · до ${new Date(batch.expiryDate).toLocaleDateString("ru-RU")}`
                    : ""}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RowDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: TraceabilityDocumentConfig;
  employees: PersonItem[];
  initialRow: TraceabilityRow | null;
  /** «(k из N)» при правке выделенных строк по очереди. */
  titleSuffix?: string;
  dateFrom: string;
  onSave: (row: TraceabilityRow, additions: { rawMaterials: string[]; products: string[] }) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TraceabilityRowDraft | null>(null);
  const [rawOptions, setRawOptions] = useState<string[]>([]);
  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [newRaw, setNewRaw] = useState("");
  const [newProduct, setNewProduct] = useState("");
  const [createdRaw, setCreatedRaw] = useState<string[]>([]);
  const [createdProducts, setCreatedProducts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!props.open) return;
    const base = props.initialRow ?? defaultRow(props.config);
    setDraft(rowToDraft(base, props.config));
    setRawOptions(props.config.rawMaterialList);
    setProductOptions(props.config.productList);
    setNewRaw("");
    setNewProduct("");
    setCreatedRaw([]);
    setCreatedProducts([]);
    setError("");
  }, [props.config, props.initialRow, props.open]);

  function setField<K extends keyof TraceabilityRowDraft>(key: K, value: TraceabilityRowDraft[K]) {
    if (!draft) return;
    setDraft({ ...draft, [key]: value });
  }

  function addCustom(list: "raw" | "product") {
    if (!draft) return;
    if (list === "raw") {
      const v = newRaw.trim();
      if (!v) return;
      setRawOptions((current) => mergeUnique(current, [v]));
      setCreatedRaw((current) => mergeUnique(current, [v]));
      setField("incomingRawMaterialName", v);
      setNewRaw("");
    } else {
      const v = newProduct.trim();
      if (!v) return;
      setProductOptions((current) => mergeUnique(current, [v]));
      setCreatedProducts((current) => mergeUnique(current, [v]));
      setField("outgoingProductName", v);
      setNewProduct("");
    }
  }

  async function save() {
    if (!draft) return;
    const row = draftToRow(draft);
    const issues = validateTraceabilityRow(row);
    if (issues.length > 0) {
      setError(issues.map((item) => item.message).join(" "));
      return;
    }
    setLoading(true);
    try {
      // Окно закрывает родитель: при правке по очереди он откроет следующую строку.
      await props.onSave(row, { rawMaterials: createdRaw, products: createdProducts });
    } catch (err) {
      toast.error(humanizeFetchError(err, "Не удалось сохранить строку"));
    } finally {
      setLoading(false);
    }
  }

  const employees = props.employees;
  const roleOptions = useMemo(() => (draft ? uniqueStrings([draft.responsibleRole, ...ROLE_OPTIONS]) : ROLE_OPTIONS), [draft]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[28px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">{props.initialRow ? `Редактирование строки${props.titleSuffix ? ` ${props.titleSuffix}` : ""}` : "Добавление новой строки"}</DialogTitle>
            <button type="button" className="rounded-xl p-2" onClick={() => props.onOpenChange(false)}><X className="size-7" /></button>
          </div>
        </DialogHeader>

        {draft && (
          <div className="space-y-5 px-8 py-6">
            <div className="space-y-2"><Label className="text-[16px] text-[#7a7c8e]">Дата</Label><div className="relative"><Input type="date" value={draft.date} onChange={(e) => setField("date", normalizeIsoDate(e.target.value))} className="h-10 rounded-xl border-[#d8dae6] px-5 pr-14 text-[13.5px]" /><CalendarDays className="pointer-events-none absolute right-5 top-1/2 size-6 -translate-y-1/2 text-[#6e7080]" /></div></div>

            <div className="space-y-3 rounded-[28px] border border-[#e3e5f0] px-4 py-4">
              <div className="text-[20px] font-semibold tracking-[-0.02em] text-black">Поступило</div>
              <div className="space-y-2">
                <Label className="text-[15px] text-[#7a7c8e]">Наименование сырья</Label>
                <Select value={draft.incomingRawMaterialName || "__empty__"} onValueChange={(value) => setField("incomingRawMaterialName", value === "__empty__" ? "" : value)}>
                  <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-white px-3.5 text-[18px]"><SelectValue placeholder="Выберите из списка или добавьте новое" /></SelectTrigger>
                  {/* Своё значение строки — первым: после удаления позиции
                      из справочника Select переставал его находить и строка
                      выглядела пустой. */}
                  <SelectContent><SelectItem value="__empty__">Выберите из списка</SelectItem>{Array.from(new Set([draft.incomingRawMaterialName, ...rawOptions].filter(Boolean))).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex items-center gap-2"><Input value={newRaw} onChange={(e) => setNewRaw(e.target.value)} placeholder="Добавить название нового сырья" className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[16px]" /><Button type="button" onClick={() => addCustom("raw")} className="h-10 rounded-xl bg-[#5563ff] px-3.5 text-white hover:bg-[#4654ff]"><Plus className="size-5" /></Button></div>
                {/* Сырьё со склада: партия подставляет название и номер
                    и остаётся связанной со строкой. */}
                <BatchPicker
                  onPick={(batch) => {
                    setRawOptions((current) => mergeUnique(current, [batch.productName]));
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            incomingRawMaterialName: batch.productName,
                            incomingBatchNumber: batch.code,
                            incomingBatchId: batch.id,
                          }
                        : current
                    );
                  }}
                />
                {draft.incomingBatchId ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-[#ececf4] bg-[#fafbff] px-3 py-2">
                    <span className="min-w-0 truncate text-[12.5px] text-[#6f7282]">
                      Из партии № {draft.incomingBatchNumber || "—"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setField("incomingBatchId", "")}
                      className="shrink-0 rounded-lg px-2 py-1 text-[12.5px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2]"
                    >
                      Отвязать
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="space-y-2"><Label className="text-[13.5px] text-[#7a7c8e]">Номер партии ПФ</Label><Input value={draft.incomingBatchNumber} onChange={(e) => setField("incomingBatchNumber", e.target.value)} placeholder="Введите номер партии ПФ" className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" /></div>
              <div className="space-y-2"><Label className="text-[13.5px] text-[#7a7c8e]">Дата фасовки</Label><div className="relative"><Input type="date" value={draft.incomingPackagingDate} onChange={(e) => setField("incomingPackagingDate", normalizeIsoDate(e.target.value))} className="h-10 rounded-xl border-[#d8dae6] px-3.5 pr-14 text-[13.5px]" /><CalendarDays className="pointer-events-none absolute right-5 top-1/2 size-6 -translate-y-1/2 text-[#6e7080]" /></div></div>
              <div className="grid gap-3 md:grid-cols-2"><div className="space-y-2"><Label className="text-[13.5px] text-[#7a7c8e]">Кол-во, шт.</Label><Input value={draft.incomingQuantityPieces} onChange={(e) => setField("incomingQuantityPieces", e.target.value)} inputMode="decimal" placeholder="0" className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" /></div><div className="space-y-2"><Label className="text-[13.5px] text-[#7a7c8e]">Кол-во, кг.</Label><Input value={draft.incomingQuantityKg} onChange={(e) => setField("incomingQuantityKg", e.target.value)} inputMode="decimal" placeholder="0" className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" /></div></div>
            </div>

            <div className="space-y-3 rounded-[28px] border border-[#e3e5f0] px-4 py-4">
              <div className="text-[20px] font-semibold tracking-[-0.02em] text-black">Выпущено</div>
              <div className="space-y-2">
                <Label className="text-[15px] text-[#7a7c8e]">Наименование ПФ</Label>
                <Select value={draft.outgoingProductName || "__empty__"} onValueChange={(value) => setField("outgoingProductName", value === "__empty__" ? "" : value)}>
                  <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-white px-3.5 text-[18px]"><SelectValue placeholder="Выберите из списка или добавьте новое" /></SelectTrigger>
                  <SelectContent><SelectItem value="__empty__">Выберите из списка</SelectItem>{Array.from(new Set([draft.outgoingProductName, ...productOptions].filter(Boolean))).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex items-center gap-2"><Input value={newProduct} onChange={(e) => setNewProduct(e.target.value)} placeholder="Добавить название нового ПФ" className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[16px]" /><Button type="button" onClick={() => addCustom("product")} className="h-10 rounded-xl bg-[#5563ff] px-3.5 text-white hover:bg-[#4654ff]"><Plus className="size-5" /></Button></div>
              </div>
              <div className="grid gap-3 md:grid-cols-2"><div className="space-y-2"><Label className="text-[13.5px] text-[#7a7c8e]">Кол-во фасовок, шт.</Label><Input value={draft.outgoingQuantityPieces} onChange={(e) => setField("outgoingQuantityPieces", e.target.value)} inputMode="decimal" placeholder="0" className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" /></div><div className="space-y-2"><Label className="text-[13.5px] text-[#7a7c8e]">Кол-во фасовок, кг.</Label><Input value={draft.outgoingQuantityKg} onChange={(e) => setField("outgoingQuantityKg", e.target.value)} inputMode="decimal" placeholder="0" className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" /></div></div>
              {props.config.showShockTempField && <div className="space-y-2"><Label className="text-[13.5px] text-[#7a7c8e]">T °C продукта после шоковой заморозки</Label><Input value={draft.outgoingShockTemp} onChange={(e) => setField("outgoingShockTemp", e.target.value)} inputMode="decimal" placeholder="0" className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" /></div>}
            </div>

            <div className="space-y-2 rounded-[28px] border border-[#e3e5f0] px-4 py-4">
              <div className="text-[20px] font-semibold tracking-[-0.02em] text-black">Ответственный</div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2"><Label className="text-[13.5px] text-[#7a7c8e]">Должность ответственного</Label><Select value={draft.responsibleRole || "__empty__"} onValueChange={(value) => setField("responsibleRole", value === "__empty__" ? "" : value)} disabled={employees.length > 0}><SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f3f4fb] px-3.5 text-[13.5px]"><SelectValue placeholder="Выберите сотрудника" /></SelectTrigger><SelectContent><SelectItem value="__empty__">- Выберите значение -</SelectItem><PositionSelectItems users={props.employees} /></SelectContent></Select></div>
                <div className="space-y-2"><Label className="text-[15px] text-[#7a7c8e]">Сотрудник</Label>{employees.length > 0 ? <Select value={draft.responsibleEmployeeId || "__empty__"} onValueChange={(value) => {
                  // Одним setDraft: три setField подряд брали один и тот же
                  // устаревший draft, и применялся только последний — выбор
                  // сотрудника не сохранялся, менялась лишь должность.
                  if (value === "__empty__") {
                    setDraft({ ...draft, responsibleEmployeeId: "", responsibleEmployee: "", responsibleRole: "" });
                    return;
                  }
                  const employee = employees.find((item) => item.id === value);
                  setDraft({
                    ...draft,
                    responsibleEmployeeId: value,
                    responsibleEmployee: employee?.name || "",
                    responsibleRole: employee ? getUserDisplayTitle(employee) : draft.responsibleRole,
                  });
                }}><SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f3f4fb] px-3.5 text-[13.5px]"><SelectValue placeholder="Выберите сотрудника" /></SelectTrigger><SelectContent><SelectItem value="__empty__">- Выберите значение -</SelectItem>{employees.map((employee) => <SelectItem key={employee.id} value={employee.id}>{buildStaffOptionLabel(employee)}</SelectItem>)}</SelectContent></Select> : <Input value={draft.responsibleEmployee} onChange={(e) => setField("responsibleEmployee", e.target.value)} placeholder="ФИО ответственного" className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" />}</div>
              </div>
            </div>

            {error && <div className="rounded-[20px] border border-[#ffd7d3] bg-[#fff4f2] px-4 py-3 text-[15px] text-[#d2453d]">{error}</div>}
            <div className="flex justify-end pt-1"><Button type="button" onClick={save} disabled={loading} className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4654ff]">{loading ? "Сохранение..." : "Сохранить"}</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
function ImportDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (file: File) => Promise<{ importedCount: number; errors: TraceabilityImportError[] }>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (props.open) setFile(null); }, [props.open]);

  async function save() {
    if (!file) return;
    setLoading(true);
    try {
      await props.onImport(file);
      props.onOpenChange(false);
    } catch (error) {
      toast.error(humanizeFetchError(error, "Не удалось импортировать файл"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[28px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-8 py-6"><div className="flex items-center justify-between gap-4"><DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">Добавление из Excel</DialogTitle><button type="button" className="rounded-xl p-2" onClick={() => props.onOpenChange(false)}><X className="size-7" /></button></div></DialogHeader>
        <div className="space-y-5 px-8 py-6">
          <div className="rounded-[24px] border border-[#e6e9f5] bg-[#fbfbff] px-5 py-4 text-[15px] leading-7 text-[#505469]"><p>Список должен быть в Excel-файле на первом листе и начинаться с первой строки.</p><p className="mt-3">Столбцы должны быть в фиксированном порядке:</p><ol className="mt-2 space-y-1 pl-5">{TRACEABILITY_IMPORT_COLUMNS.map((column, index) => <li key={column}>{index + 1}-й столбец - {column}</li>)}</ol></div>
          <div className="space-y-2"><Button type="button" variant="outline" className="h-12 rounded-2xl border-[#dfe1ec] px-4 text-[16px]" onClick={() => fileInputRef.current?.click()}><Upload className="size-4" />Выберите файл</Button><div className="text-[15px] text-[#6f7282]">{file ? file.name : "Файл не выбран"}</div><input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }} /></div>
          <div className="flex justify-end pt-2"><Button type="button" onClick={save} disabled={!file || loading} className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4654ff]">{loading ? "Импорт..." : "Добавить"}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FinishDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; title: string; onFinish: () => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  async function finish() {
    setLoading(true);
    try {
      await props.onFinish();
      props.onOpenChange(false);
    } catch (error) {
      toast.error(humanizeFetchError(error, "Не удалось закончить журнал"));
    } finally {
      setLoading(false);
    }
  }
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[640px]">
        <DialogHeader className="border-b px-8 py-6"><div className="flex items-center justify-between gap-4"><DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">Закончить журнал &quot;{props.title}&quot;</DialogTitle><button type="button" className="rounded-xl p-2" onClick={() => props.onOpenChange(false)}><X className="size-7" /></button></div></DialogHeader>
        <div className="space-y-4 px-8 py-8"><div className="text-[17px] leading-7 text-[#505469]">Документ станет доступен только для чтения.</div><div className="flex justify-end"><Button type="button" onClick={finish} disabled={loading} className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4654ff]">{loading ? "Сохранение..." : "Закончить"}</Button></div></div>
      </DialogContent>
    </Dialog>
  );
}

export function TraceabilityDocumentClient(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [config, setConfig] = useState<TraceabilityDocumentConfig>(() =>
    normalizeTraceabilityDocumentConfig(props.initialConfig ?? props.config)
  );
  const [title, setTitle] = useState(props.title || DEFAULT_TITLE);
  const [dateFrom, setDateFrom] = useState(normalizeIsoDate(props.dateFrom || todayIso()));
  const [status, setStatus] = useState(props.status || "active");
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const [rowOpen, setRowOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<TraceabilityRow | null>(null);
  const [saving, setSaving] = useState(false);

  const isClosed = status === "closed";
  // История отмены: только правки строк, сделанные этим человеком в
  // этой вкладке. Настройки документа и списки в неё не идут.
  const undoStack = useJournalUndo({ enabled: !isClosed });
  const employees = props.employees ?? props.users ?? [];
  const organizationName = props.organizationName || ORG_NAME_FALLBACK;
  const allSelected = config.rows.length > 0 && selectedRowIds.length === config.rows.length;
  const { mobileView, switchMobileView } = useMobileView("traceability_test");

  /**
   * ФИО ответственного: в строке хранится снимок имени, но у строк,
   * заполненных выбором сотрудника, остаётся только id — печать берёт
   * имя из ростера, а экран показывал «—».
   */
  const responsibleName = (row: TraceabilityRow) =>
    row.responsibleEmployee ||
    employees.find((employee) => employee.id === row.responsibleEmployeeId)?.name ||
    "";

  const cardItems: RecordCardItem[] = config.rows.map((row, index) => {
    const incomingQty = formatQuantityPair(row.incoming.quantityPieces, row.incoming.quantityKg);
    const outgoingQty = formatQuantityPair(
      row.outgoing.quantityPacksPieces,
      row.outgoing.quantityPacksKg
    );
    return {
      id: row.id,
      title: `№${index + 1} · ${formatDashDate(row.date) || "—"}`,
      subtitle: row.incoming.rawMaterialName || undefined,
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
        { label: "№ партии / дата фасовки", value: [row.incoming.batchNumber, row.incoming.packagingDate].filter(Boolean).join(" · "), hideIfEmpty: true },
        { label: "Кол-во сырья", value: incomingQty, hideIfEmpty: true },
        { label: "Наименование ПФ", value: row.outgoing.productName, hideIfEmpty: true },
        { label: "Кол-во фасовок", value: outgoingQty, hideIfEmpty: true },
        config.showShockTempField
          ? { label: "T°C после шока", value: row.outgoing.shockTemp != null ? String(row.outgoing.shockTemp) : "", hideIfEmpty: true }
          : null,
        {
          label: "Ответственный",
          // Должность этого человека из карточки, копия строки — если его нет.
          value: [
            getRowEmployeeTitle(
              employees.find((employee) => employee.id === row.responsibleEmployeeId),
              row.responsibleRole
            ),
            responsibleName(row),
          ]
            .filter(Boolean)
            .join(", "),
          hideIfEmpty: true,
        },
      ].filter((f): f is { label: string; value: string; hideIfEmpty: boolean } => f !== null),
      onClick: !isClosed
        ? () => {
            setEditingRow(row);
            setRowOpen(true);
          }
        : undefined,
      actions: !isClosed ? (
        <button
          type="button"
          onClick={() => {
            setEditingRow(row);
            setRowOpen(true);
          }}
          className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#5563ff] px-4 text-[14px] font-medium text-white hover:bg-[#4554ff]"
        >
          Редактировать
        </button>
      ) : null,
    };
  });
  const headerSettings = useMemo(() => defaultSettings(config, title, dateFrom), [config, dateFrom, title]);
  const rowById = useMemo(() => new Map(config.rows.map((row) => [row.id, row])), [config.rows]);

  useEffect(() => {
    setConfig(normalizeTraceabilityDocumentConfig(props.initialConfig ?? props.config));
  }, [props.config, props.initialConfig]);
  useEffect(() => { setTitle(props.title || DEFAULT_TITLE); setDateFrom(normalizeIsoDate(props.dateFrom || todayIso())); }, [props.dateFrom, props.title]);
  useEffect(() => { setStatus(props.status || "active"); }, [props.status]);
  useEffect(() => { setSelectedRowIds((current) => current.filter((id) => config.rows.some((row) => row.id === id))); }, [config.rows]);

  async function patchDocument(payload: Record<string, unknown>) {
    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || "Не удалось сохранить документ");
    return result;
  }

  async function persistConfig(nextConfig: TraceabilityDocumentConfig) {
    setSaving(true);
    try {
      await patchDocument({ title, dateFrom, config: nextConfig });
      setConfig(nextConfig);
      startTransition(() => router.refresh());
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings(draft: TraceabilitySettingsDraft) {
    const nextTitle = draft.title.trim() || DEFAULT_TITLE;
    const nextDateFrom = normalizeIsoDate(draft.dateFrom);
    const nextConfig: TraceabilityDocumentConfig = { ...config, documentTitle: nextTitle, dateFrom: nextDateFrom, showShockTempField: draft.showShockTempField, showShipmentBlock: draft.showShipmentBlock };
    setSaving(true);
    try {
      await patchDocument({ title: nextTitle, dateFrom: nextDateFrom, config: nextConfig });
      setTitle(nextTitle);
      setDateFrom(nextDateFrom);
      setConfig(nextConfig);
      startTransition(() => router.refresh());
    } finally { setSaving(false); }
  }

  async function saveLists(nextConfig: TraceabilityDocumentConfig) {
    // `rows` берём из nextConfig: окно списков переносит переименования
    // в строки, иначе они бы терялись здесь.
    await persistConfig({ ...config, rows: nextConfig.rows, rawMaterialList: uniqueStrings(nextConfig.rawMaterialList), productList: uniqueStrings(nextConfig.productList) });
  }

  /**
   * Запись строки. Отмена (Ctrl+Z) — это повторный PATCH прежнего
   * набора строк тем же роутом, а не правка состояния на клиенте:
   * серверные проверки обязаны сработать и на откате.
   */
  /** Правка выделенных строк по очереди — тем же окном. */
  const seq = useSequentialEdit({
    open: (id) => {
      const row = rowById.get(id);
      if (!row || isClosed) return false;
      setEditingRow(row);
      setRowOpen(true);
      return true;
    },
    close: () => {
      setRowOpen(false);
      setEditingRow(null);
    },
  });

  async function saveRow(row: TraceabilityRow, additions: { rawMaterials: string[]; products: string[] }) {
    const previousConfig = config;
    const isEdit = rowById.has(row.id);
    const nextRows = isEdit ? config.rows.map((item) => (item.id === row.id ? row : item)) : [...config.rows, row];
    const nextConfig = { ...config, rows: nextRows, rawMaterialList: mergeUnique(config.rawMaterialList, additions.rawMaterials), productList: mergeUnique(config.productList, additions.products) };
    await persistConfig(nextConfig);
    undoStack.push({
      undo: () => persistConfig(previousConfig),
      redo: () => persistConfig(nextConfig),
    });
    if (isEdit) {
      // Очередь правок откроет следующую строку или закроет окно.
      seq.saved();
      return;
    }
    setEditingRow(null);
    setRowOpen(false);
  }

  async function deleteSelected() {
    if (selectedRowIds.length === 0) return;
    const count = selectedRowIds.length;
    if (!(await confirmAsync({ title: "Удалить выбранные строки?", description: `Будет удалено строк: ${count}. Восстановить нельзя.`, variant: "danger", confirmLabel: "Удалить" }))) return;
    const idsToRemove = [...selectedRowIds];
    try {
      setSelectedRowIds([]);
      await persistConfig({ ...config, rows: config.rows.filter((row) => !idsToRemove.includes(row.id)) });
      toast.success(`Удалено строк: ${count}`);
    } catch (error) {
      toast.error(humanizeFetchError(error, "Не удалось удалить выбранные строки"));
    }
  }

  async function finishJournal() {
    setSaving(true);
    try { await patchDocument({ status: "closed" }); setStatus("closed"); startTransition(() => router.refresh()); } finally { setSaving(false); }
  }

  async function importFile(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`/api/journal-documents/${props.documentId}/traceability/import`, { method: "POST", body: formData });
    const result = (await response.json().catch(() => null)) as { rows?: unknown[]; errors?: TraceabilityImportError[]; error?: string } | null;
    if (!response.ok && !result?.error) throw new Error("Не удалось импортировать файл");
    const rows = Array.isArray(result?.rows) ? result.rows.map((item) => normalizeTraceabilityRow(item)) : [];
    const errors = Array.isArray(result?.errors) ? result.errors : [];
    if (rows.length === 0 && errors.length > 0) throw new Error(formatImportErrors(errors) || "Импорт не выполнен");
    if (rows.length > 0) {
      await persistConfig({ ...config, rows: [...config.rows, ...rows], rawMaterialList: mergeUnique(config.rawMaterialList, rows.map((row) => row.incoming.rawMaterialName).filter(Boolean)), productList: mergeUnique(config.productList, rows.map((row) => row.outgoing.productName).filter(Boolean)) });
    }
    if (errors.length > 0) toast.error(`Импорт выполнен частично.\n\n${formatImportErrors(errors)}`);
    else toast.success(`Импортировано строк: ${rows.length}`);
    return { importedCount: rows.length, errors };
  }

  return (
    <div className="space-y-6 text-black">
      {selectedRowIds.length > 0 && !isClosed ? (
        <JournalSelectionBar
          count={selectedRowIds.length}
          onClear={() => setSelectedRowIds([])}
          onDelete={() => {
            deleteSelected().catch((error) => toast.error(humanizeFetchError(error, "Не удалось удалить строки")));
          }}
          hint="Строки прослеживаемости будут удалены без возможности отмены"
        >
          <SelectionEditButton count={selectedRowIds.length} onClick={() => seq.start(selectedRowIds)} />
        </JournalSelectionBar>
      ) : null}

      <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />
      <JournalDocumentShell
        title={title || DEFAULT_TITLE}
        subtitle={`Начат ${formatDashDate(dateFrom)}`}
        documentId={props.documentId}
        backHref={props.routeCode ? `/journals/${props.routeCode}` : undefined}
        onSettings={!isClosed ? () => setSettingsOpen(true) : undefined}
        settingsLabel="Настройки документа"
        closed={isClosed}
        closedHint="Журнал закрыт и доступен только для чтения."
        menuItems={
          !isClosed
            ? [
                {
                  key: "close-journal",
                  label: "Закончить журнал",
                  icon: <Archive className="size-4" />,
                  onSelect: () => setFinishOpen(true),
                },
              ]
            : []
        }
        undo={
          !isClosed
            ? {
                canUndo: undoStack.canUndo,
                canRedo: undoStack.canRedo,
                onUndo: () => void undoStack.undo(),
                onRedo: () => void undoStack.redo(),
                undoCount: undoStack.undoCount,
              }
            : undefined
        }
        mobileView={mobileView}
        onMobileView={switchMobileView}
        cards={
          <RecordCardsView items={cardItems} emptyLabel="Записей по прослеживаемости нет." />
        }
        paperHeader={
          <JournalDocumentHeader
            orgName={organizationName}
            title="ЖУРНАЛ ПРОСЛЕЖИВАЕМОСТИ ПРОДУКЦИИ"
            startedAt={dateFrom}
            finishedAt={null}
          />
        }
        sheetTitle="ЖУРНАЛ ПРОСЛЕЖИВАЕМОСТИ ПРОДУКЦИИ"
        sheetMinWidth={1480}
        toolbar={
          !isClosed ? (
            // Свой flex-wrap: в карточном виде на телефоне оболочка
            // отдаёт тулбар без ряда-обёртки, и кнопки слипались.
            <div className="flex flex-wrap items-center gap-2">
              <ResponsiveMenu
              title="Добавить"
              align="start"
              contentClassName="min-w-[280px] rounded-[22px] border-0 p-2 shadow-xl"
              items={[
                {
                  key: "add-row",
                  label: "Добавить",
                  icon: <Plus className="size-4 text-[#6f7282]" />,
                  onSelect: () => {
                    setEditingRow(null);
                    setRowOpen(true);
                  },
                },
                {
                  key: "add-file",
                  label: "Добавить из файла",
                  icon: <Upload className="size-4 text-[#6f7282]" />,
                  onSelect: () => setImportOpen(true),
                },
              ]}
              trigger={
                <Button
                  type="button"
                  disabled={saving || isPending}
                  className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] font-medium text-white shadow-md shadow-[#5563ff]/20 hover:bg-[#4957fb]"
                >
                  <Plus className="size-6" />
                  Добавить
                  <ChevronDown className="size-4" />
                </Button>
              }
            />
              <button type="button" onClick={() => setListsOpen(true)} className={DOC_SECONDARY_BUTTON_CLASS}>
                Редактировать списки
              </button>
            </div>
          ) : null
        }
      >
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {!isClosed && <th rowSpan={2} className={`w-[44px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}><Checkbox checked={allSelected} disabled={config.rows.length === 0} onCheckedChange={(checked) => setSelectedRowIds(checked === true ? config.rows.map((row) => row.id) : [])} /></th>}
              <th rowSpan={2} className={`w-[140px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Дата</th>
              <th colSpan={3} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Поступило в цех сырья</th>
              <th colSpan={config.showShockTempField ? 3 : 2} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Выпущено цехом</th>
              <th rowSpan={2} className={`w-[210px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>ФИО ответственного</th>
            </tr>
            <tr>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Наименование сырья</th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Номер партии ПФ<br />Дата фасовки</th>
              <th className={`w-[120px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Кол-во<br />шт./кг.</th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Наименование ПФ</th>
              <th className={`w-[120px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Кол-во фасовок<br />шт./кг.</th>
              {config.showShockTempField && <th className={`w-[140px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>T °C<br />продукта после<br />шоковой<br />заморозки</th>}
            </tr>
          </thead>
          <tbody>
            {config.rows.length > 0 ? config.rows.map((row) => {
              const incomingQty = formatQuantityPair(row.incoming.quantityPieces, row.incoming.quantityKg);
              const outgoingQty = formatQuantityPair(
                row.outgoing.quantityPacksPieces,
                row.outgoing.quantityPacksKg
              );
              const selected = selectedRowIds.includes(row.id);
              return (
                <tr key={row.id} className={cn("transition-colors", !isClosed && "cursor-pointer hover:bg-[#fafbff]", selected && "bg-[#eef1ff]")} onClick={() => { if (!isClosed) setEditingRow(row); if (!isClosed) setRowOpen(true); }}>
                  {!isClosed && <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`} onClick={(event) => event.stopPropagation()}><Checkbox checked={selected} onCheckedChange={(checked) => setSelectedRowIds((current) => checked === true ? uniqueStrings([...current, row.id]) : current.filter((id) => id !== row.id))} /></td>}
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{formatDashDate(row.date)}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.incoming.rawMaterialName || "—"}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight whitespace-pre-line`}>{[row.incoming.batchNumber, formatDashDate(row.incoming.packagingDate)].filter(Boolean).join("\n") || "—"}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{incomingQty || "—"}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.outgoing.productName || "—"}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{outgoingQty || "—"}</td>
                  {config.showShockTempField && <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.outgoing.shockTemp != null ? formatTraceabilityQuantity(row.outgoing.shockTemp) : "—"}</td>}
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{responsibleName(row) || "—"}</td>
                </tr>
              );
            }) : <tr><td colSpan={isClosed ? 8 : config.showShockTempField ? 9 : 8} className={`${GRID_CELL_CLASS} px-2 py-6 text-center text-[#6f7282]`}>Строк пока нет</td></tr>}
            {!isClosed ? (
              <JournalAddRow
                // Галочка — leading, подпись растянута на «Дата» +
                // «Наименование сырья», остальные колонки (партия, кол-во,
                // выпуск, при необходимости T° шоковой заморозки, ФИО
                // ответственного) остаются пустыми ячейками.
                leading={1}
                labelSpan={2}
                trailing={config.showShockTempField ? 6 : 5}
                label="Добавить"
                onClick={() => {
                  setEditingRow(null);
                  setRowOpen(true);
                }}
              />
            ) : null}
          </tbody>
        </table>
      </JournalDocumentShell>

      <SettingsDialog open={settingsOpen} title="Настройки документа" initial={headerSettings} onOpenChange={setSettingsOpen} onSave={saveSettings} useV2={props.useV2} />
      <ListsDialog open={listsOpen} onOpenChange={setListsOpen} config={config} onSave={saveLists} />
      {/* Закрытие без сохранения прерывает очередь («Изменено k из N»). */}
      <RowDialog open={rowOpen} onOpenChange={(open) => { if (open) { setRowOpen(true); return; } seq.cancelled(); }} config={config} employees={employees} initialRow={editingRow} titleSuffix={seq.progress ?? undefined} dateFrom={dateFrom} onSave={saveRow} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImport={importFile} />
      <FinishDialog open={finishOpen} onOpenChange={setFinishOpen} title={title || DEFAULT_TITLE} onFinish={finishJournal} />
    </div>
  );
}

