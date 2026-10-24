"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Building2,
  CalendarPlus,
  ClipboardPaste,
  FileSpreadsheet,
  Loader2,
  Minus,
  Package,
  PenLine,
  Plus,
  Search,
  Send,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { RecognizeFromPhoto, type RecognizeResult } from "@/components/ai/recognize-from-photo";
import type { BulkDishRow } from "@/components/journals/finished-product-bulk-dialog";
import {
  itemsToExportRows,
  MASTER_EXPORT_ROWS_MAX,
  MasterBrakerageDialog,
  readMenuFile,
} from "@/components/master/master-brakerage-dialog";
import { MasterBrakerageHistory } from "@/components/master/master-brakerage-history";
import type { MasterBrakerageHistoryBatch } from "@/lib/master-brakerage-history";
import { MasterObjectsPanel } from "@/components/master/master-objects-panel";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { SharedItem, SharedKind } from "@/lib/master-directory";
import { cn } from "@/lib/utils";

export type MasterTab = "menu" | "raw" | "objects";

/** changed — та же позиция меню с другим выходом или временем. */
type Diff = { added: string[]; removed: string[]; changed?: string[]; unchanged: number };
type PreviewSource = { type: "file"; name: string } | { type: "paste" } | { type: "photo" };
type Preview = { kind: SharedKind; items: SharedItem[]; diff: Diff; source: PreviewSource };

const PREVIEW_LIMIT = 20;
const PAGE_SIZE = 200;

const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const OUTLINE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const CARD =
  "rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6";

type T = ReturnType<typeof useTranslations<"masterUi.masterDirectoryClient">>;

type KindMeta = { title: string; journal: string; example: string; exampleFile: string; count: (count: number) => string };

function kindMeta(t: T, kind: SharedKind): KindMeta {
  if (kind === "dish") {
    return {
      title: t("dishTitle"),
      journal: t("dishJournal"),
      example: t("dishExample"),
      exampleFile: t("dishExampleFile"),
      count: (count) => t("dishCount", { count }),
    };
  }
  return {
    title: t("productTitle"),
    journal: t("productJournal"),
    example: t("productExample"),
    exampleFile: t("productExampleFile"),
    count: (count) => t("productCount", { count }),
  };
}

/** «во всех 3 объектах» / «в 1 объекте». */
function inObjects(t: T, count: number): string {
  if (count === 0) return t("inObjectsNone");
  if (count === 1) return t("inObjectsOne");
  return t("inObjectsMany", { count });
}

function itemsToText(kind: SharedKind, items: SharedItem[]): string {
  return items
    .map((item) => {
      if (kind === "dish" || (!item.supplier && !item.manufacturer)) return item.name;
      return item.manufacturer
        ? `${item.name} | ${item.supplier ?? ""} | ${item.manufacturer}`
        : `${item.name} | ${item.supplier}`;
    })
    .join("\n");
}

/**
 * Мастер-кабинет: вкладки «Мастер-справочник журнала бракеража готовой
 * продукции» (выгрузка блюд в журналы на дату — таблица не сохраняется),
 * «…скоропортящейся продукции» (список сырья: файл или текст → предпросмотр
 * различий → «Сохранить и разослать» в журналы всех объектов пула) и
 * «Подключённые объекты».
 */
export function MasterDirectoryClient({
  initialTab,
  initialDishes,
  initialProducts,
  organizations: initialOrganizations,
}: {
  initialTab: MasterTab;
  initialDishes: SharedItem[];
  initialProducts: SharedItem[];
  organizations: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("masterUi.masterDirectoryClient");
  const tDialog = useTranslations("masterUi.masterBrakerageDialog");
  const router = useRouter();
  const [interactive, setInteractive] = useState(false);
  useEffect(() => { setInteractive(true); }, []);
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [tab, setTab] = useState<MasterTab>(initialTab);
  const [lists, setLists] = useState<Record<SharedKind, SharedItem[]>>({
    dish: initialDishes,
    product: initialProducts,
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pasteKind, setPasteKind] = useState<SharedKind | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [uploading, setUploading] = useState<SharedKind | null>(null);
  /** «Выгрузить в журналы» — строки БЖГП в отмеченные пищеблоки пула. */
  const [brakerageOpen, setBrakerageOpen] = useState(false);
  /** Строки из файла или с фото, с которыми открыть выгрузку. */
  const [exportRows, setExportRows] = useState<BulkDishRow[] | null>(null);
  const [editingBrakerageBatch, setEditingBrakerageBatch] = useState<MasterBrakerageHistoryBatch | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const fileKind = useRef<SharedKind>("dish");

  function switchTab(next: MasterTab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "menu") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  }

  async function requestPreview(
    kind: SharedKind,
    body: FormData | { text: string } | { items: SharedItem[] },
    source: PreviewSource
  ) {
    const isForm = body instanceof FormData;
    const response = await fetch("/api/master/directory/preview", {
      method: "POST",
      headers: isForm ? undefined : { "Content-Type": "application/json" },
      body: isForm ? body : JSON.stringify({ kind, ...body }),
    }).catch(() => null);
    const json = (await response?.json().catch(() => null)) as
      | { error?: string; items?: SharedItem[]; diff?: Diff }
      | null;
    if (!response?.ok || !json?.items || !json.diff) {
      toast.error(json?.error ?? t("previewFailed"));
      return false;
    }
    setPreview({ kind, items: json.items, diff: json.diff, source });
    return true;
  }

  function pickFile(kind: SharedKind) {
    fileKind.current = kind;
    fileInput.current?.click();
  }

  /** Выгрузка в журналы: пустая таблица или строки из файла / с фото. */
  function openExport(rows: BulkDishRow[] | null = null) {
    setEditingBrakerageBatch(null);
    setExportRows(rows);
    setBrakerageOpen(true);
  }

  async function onFileChosen(file: File | undefined) {
    if (!file) return;
    const kind = fileKind.current;
    setUploading(kind);
    try {
      if (kind === "dish") {
        // Блюда из файла не сохраняются — сразу в окно выгрузки.
        const rows = await readMenuFile(file, tDialog);
        if (rows) openExport(rows);
        return;
      }
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      await requestPreview(kind, form, { type: "file", name: file.name });
    } finally {
      setUploading(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function openPaste(kind: SharedKind) {
    setPasteText(itemsToText(kind, lists[kind]));
    setPasteKind(kind);
  }

  /**
   * «С фото»: распознанные позиции — тем же путём, что файл и текст:
   * текущий список + новые → предпросмотр различий → «Сохранить и
   * разослать». То, что уже есть в списке (по наименованию), не дублируем.
   * Блюда с фото не сохраняются — открывается выгрузка с ними.
   */
  async function addFromPhoto(kind: SharedKind, items: SharedItem[]) {
    if (kind === "dish") {
      openExport(itemsToExportRows(items));
      return {
        added: Math.min(items.length, MASTER_EXPORT_ROWS_MAX),
        skipped: Math.max(0, items.length - MASTER_EXPORT_ROWS_MAX),
      };
    }
    const known = new Set(lists[kind].map((item) => item.name.replace(/\s+/g, " ").trim().toLowerCase()));
    const fresh = items.filter((item) => !known.has(item.name.replace(/\s+/g, " ").trim().toLowerCase()));
    if (fresh.length === 0) return { added: 0, skipped: items.length };
    const ok = await requestPreview(kind, { items: [...lists[kind], ...fresh] }, { type: "photo" });
    if (!ok) throw new Error(t("photoPrepareFailed"));
    return { added: fresh.length, skipped: items.length - fresh.length };
  }

  async function submitPaste() {
    if (!pasteKind) return;
    const ok = await requestPreview(pasteKind, { text: pasteText }, { type: "paste" });
    if (ok) setPasteKind(null);
  }

  async function saveAndDistribute() {
    if (!preview) return;
    const response = await fetch("/api/master/directory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: preview.kind, items: preview.items }),
    }).catch(() => null);
    const json = (await response?.json().catch(() => null)) as
      | { error?: string; total?: number; organizations?: number; documents?: number }
      | null;
    if (!response?.ok || !json) {
      toast.error(json?.error ?? t("saveFailed"));
      return;
    }
    const orgs = json.organizations ?? 0;
    const docs = json.documents ?? 0;
    setLists((prev) => ({ ...prev, [preview.kind]: preview.items }));
    setPreview(null);
    toast.success(t("distributed", { orgs, docs }));
  }

  // Подписи вкладок — как у партнёра (правки 19.10): журнал, для которого справочник.
  // У выгрузки счётчика нет — таблица не хранится.
  const tabs: Array<{ key: MasterTab; label: string; short: string; icon: typeof Package; count: number | null }> = [
    {
      key: "menu",
      label: t("tabMenuLabel"),
      short: t("tabMenuShort"),
      icon: UtensilsCrossed,
      count: null,
    },
    {
      key: "raw",
      label: t("tabRawLabel"),
      short: t("tabRawShort"),
      icon: Package,
      count: lists.product.length,
    },
    { key: "objects", label: t("tabObjectsLabel"), short: t("tabObjectsShort"), icon: Building2, count: organizations.length },
  ];

  const pasteMeta = pasteKind ? kindMeta(t, pasteKind) : null;
  const previewMeta = preview ? kindMeta(t, preview.kind) : null;
  const previewSource = !preview
    ? ""
    : preview.source.type === "file"
      ? t("sourceFile", { name: preview.source.name })
      : preview.source.type === "paste"
        ? t("sourcePaste")
        : t("sourcePhoto");

  return (
    <fieldset disabled={!interactive} data-ready={interactive ? "true" : "false"} data-testid="master-directory-client" className="m-0 min-w-0 space-y-5 border-0 p-0">
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
        className="hidden"
        onChange={(event) => void onFileChosen(event.target.files?.[0])}
        data-testid="master-file-input"
      />

      <nav aria-label={t("navAria")} className="-mx-4 px-4 md:mx-0 md:px-0">
        <div
          role="tablist"
          className="no-mobile-shrink grid grid-cols-3 gap-1 rounded-2xl border border-[#ececf4] bg-white p-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
        >
          {tabs.map((item) => {
            const active = tab === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => switchTab(item.key)}
                className={cn(
                  "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-center text-[13.5px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 sm:min-h-12 sm:justify-start sm:gap-2 sm:px-3.5 sm:py-2 sm:text-left sm:text-[14px] sm:leading-snug",
                  active ? "bg-[#5566f6] text-white" : "text-[#3c4053] hover:bg-[#f5f6ff] hover:text-[#0b1024]"
                )}
                data-testid={`master-tab-${item.key}`}
              >
                {/* На телефоне — короткие подписи без значка в три колонки
                    (все вкладки видны сразу). На компьютере полное название
                    журнала переносится на вторую строку. */}
                <Icon className="size-4 shrink-0 max-sm:hidden" />
                <span className="sm:hidden">{item.short}</span>
                <span className="hidden min-w-0 [text-wrap:balance] sm:block">{item.label}</span>
                {item.count !== null ? (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[11.5px] font-semibold leading-none tabular-nums",
                      active ? "bg-white/20 text-white" : "bg-[#eef1ff] text-[#3848c7]"
                    )}
                  >
                    {item.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>


      {tab === "menu" ? (
        <MenuExportPanel
          objectsCount={organizations.length}
          uploading={uploading === "dish"}
          onExport={() => openExport()}
          onUpload={() => pickFile("dish")}
          onPhotoItems={addFromPhoto}
          onConnect={() => switchTab("objects")}
        />
      ) : tab === "raw" ? (
        <ListPanel
          key={tab}
          kind="product"
          items={lists.product}
          objectsCount={organizations.length}
          uploading={uploading === "product"}
          onUpload={pickFile}
          onPaste={openPaste}
          onPhotoItems={addFromPhoto}
        />
      ) : (
        <MasterObjectsPanel organizations={organizations} onChange={(items) => { setOrganizations(items); router.refresh(); }} />
      )}

      <MasterBrakerageDialog
        open={brakerageOpen}
        onOpenChange={setBrakerageOpen}
        organizations={organizations}
        initialRows={exportRows}
        editingBatch={editingBrakerageBatch}
      />

      {tab === "menu" ? <MasterBrakerageHistory onEdit={(batch) => { setEditingBrakerageBatch(batch); setBrakerageOpen(true); }} /> : null}

      {/* Вставка списком (сырьё): текущий список уже в поле — правьте, удаляйте строки, добавляйте новые. */}
      <ConfirmDialog
        open={pasteKind !== null}
        onClose={() => setPasteKind(null)}
        onConfirm={submitPaste}
        title={t("pasteTitle")}
        icon={ClipboardPaste}
        description={
          pasteMeta ? (
            <>{t("pasteDescription", { extra: pasteKind === "product" ? t("pasteProductExtra") : "" })}</>
          ) : null
        }
        confirmLabel={t("showChanges")}
        confirmDisabled={pasteText.trim().length === 0}
      >
        <textarea
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
          rows={10}
          autoFocus
          placeholder={pasteMeta?.example}
          aria-label={t("itemsListAria")}
          className="w-full resize-y rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[14px] leading-[1.6] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          data-testid="master-paste-text"
        />
        <p className="mt-2 text-[12px] text-[#6f7282]">
          {t("rowsInField", { count: pasteText.split(/[\r\n;]+/).filter((line) => line.trim()).length })}
        </p>
      </ConfirmDialog>

      {/* Предпросмотр различий перед раздачей. */}
      <ConfirmDialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        onConfirm={saveAndDistribute}
        title={t("previewTitle")}
        icon={Send}
        description={
          preview && previewMeta ? (
            <>{t("previewDescription", { title: previewMeta.title, source: previewSource, journal: previewMeta.journal, where: inObjects(t, organizations.length) })}</>
          ) : null
        }
        confirmLabel={t("saveAndSend")}
      >
        {preview ? <PreviewBody preview={preview} /> : null}
      </ConfirmDialog>
    </fieldset>
  );
}

function PreviewBody({ preview }: { preview: Preview }) {
  const t = useTranslations("masterUi.masterDirectoryClient");
  const { added, removed, unchanged } = preview.diff;
  const changed = preview.diff.changed ?? [];
  const isMenu = preview.kind === "dish";
  const byName = new Map(preview.items.map((item) => [item.name.toLowerCase(), item]));
  /** «Борщ — 250 · 08:30»: что станет у изменённого блюда. */
  const changedLabel = (name: string) => {
    const item = byName.get(name.toLowerCase());
    const parts = [item?.portion ? t("withYield", { value: item.portion }) : t("noYield"), item?.time ? t("withTime", { value: item.time }) : t("noTime")];
    return `${name} — ${parts.join(", ")}`;
  };
  return (
    <div className="space-y-4" data-testid="master-preview">
      <div className={cn("grid gap-2 text-center", isMenu ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
        <Stat label={t("statAdded")} value={added.length} tone="ok" />
        <Stat label={t("statRemoved")} value={removed.length} tone={removed.length > 0 ? "warn" : "neutral"} />
        {isMenu ? <Stat label={t("statChanged")} value={changed.length} tone="neutral" /> : null}
        <Stat label={t("statUnchanged")} value={unchanged} tone="neutral" />
      </div>
      <p className="text-[12.5px] text-[#6f7282]" data-testid="master-preview-summary">
        {isMenu
          ? t("summaryMenu", { added: added.length, removed: removed.length, changed: changed.length, unchanged, total: preview.items.length })
          : t("summaryRaw", { added: added.length, removed: removed.length, unchanged, total: preview.items.length })}
      </p>
      {added.length > 0 ? <NameList title={t("listNew")} names={added} tone="ok" /> : null}
      {changed.length > 0 ? <NameList title={t("listChanged")} names={changed.map(changedLabel)} tone="edit" /> : null}
      {removed.length > 0 ? (
        <>
          <NameList title={t("listRemoved")} names={removed} tone="warn" />
          <p className="rounded-2xl bg-[#fafbff] px-3 py-2 text-[12.5px] leading-[1.5] text-[#3c4053]">
            {t("removedNote")}
          </p>
        </>
      ) : null}
      {added.length === 0 && removed.length === 0 && changed.length === 0 ? (
        <p className="rounded-2xl bg-[#fafbff] px-3 py-2 text-[12.5px] leading-[1.5] text-[#3c4053]">
          {isMenu
            ? t("menuUnchanged")
            : t("rawUnchanged")}
        </p>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "ok" | "warn" | "neutral" }) {
  return (
    <div
      className={cn(
        "rounded-2xl px-2 py-3",
        tone === "ok" ? "bg-[#ecfdf5] text-[#116b2a]" : tone === "warn" ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#f5f6ff] text-[#3848c7]"
      )}
    >
      <div className="text-[22px] font-semibold leading-none tabular-nums">{value}</div>
      <div className="mt-1 text-[11.5px] leading-tight">{label}</div>
    </div>
  );
}

function NameList({ title, names, tone }: { title: string; names: string[]; tone: "ok" | "warn" | "edit" }) {
  const t = useTranslations("masterUi.masterDirectoryClient");
  const shown = names.slice(0, PREVIEW_LIMIT);
  const Icon = tone === "ok" ? Plus : tone === "edit" ? PenLine : Minus;
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
        {title}
        {names.length > PREVIEW_LIMIT ? t("firstOf", { limit: PREVIEW_LIMIT, total: names.length }) : ""}
      </div>
      <ul className="space-y-1">
        {shown.map((name) => (
          <li key={name} className="flex items-start gap-2 text-[13.5px] leading-[1.45] text-[#0b1024]">
            <Icon
              className={cn(
                "mt-0.5 size-3.5 shrink-0",
                tone === "ok" ? "text-[#116b2a]" : tone === "edit" ? "text-[#3848c7]" : "text-[#a13a32]"
              )}
            />
            <span className="min-w-0 break-words">{name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Вкладка «Мастер-справочник журнала бракеража готовой продукции»: блюда
 * не хранятся — каждая выгрузка начинается с чистой таблицы (правки
 * партнёра 19.10). Файл и фото сразу открывают выгрузку с этими блюдами.
 */
function MenuExportPanel({
  objectsCount,
  uploading,
  onExport,
  onUpload,
  onPhotoItems,
  onConnect,
}: {
  objectsCount: number;
  uploading: boolean;
  onExport: () => void;
  onUpload: () => void;
  onPhotoItems: (kind: SharedKind, items: SharedItem[]) => Promise<RecognizeResult>;
  onConnect: () => void;
}) {
  const t = useTranslations("masterUi.masterDirectoryClient");
  const noObjects = objectsCount === 0;
  const steps = [t("step1"), t("step2"), t("step3"), t("step4")];
  return (
    <section className={CARD} aria-labelledby="master-export-title" data-testid="master-export-panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 id="master-export-title" className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
            {t("exportTitle")}
          </h1>
          <p className="mt-1.5 max-w-[640px] text-[14px] leading-[1.55] text-[#6f7282]">
            {t("exportDescription")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onExport} disabled={noObjects} className={PRIMARY} data-testid="master-brakerage-open">
            <CalendarPlus className="size-4" />
            {t("exportToJournals")}
          </button>
          <button type="button" onClick={onUpload} disabled={noObjects || uploading} className={OUTLINE} data-testid="master-upload-dish">
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4 text-[#5566f6]" />}
            {t("uploadFile")}
          </button>
          {noObjects ? null : (
            <RecognizeFromPhoto
              kind="menu"
              onItems={(photoItems) =>
                onPhotoItems(
                  "dish",
                  photoItems.map((item) => ({
                    name: item.name,
                    supplier: null,
                    manufacturer: null,
                    portion: item.yield || null,
                    time: item.time || null,
                  }))
                )
              }
              resultLabel={t("photoResultExport")}
              className="sm:h-11 sm:rounded-2xl"
              testId="master-photo-dish"
            />
          )}
        </div>
      </div>

      {noObjects ? (
        <div className="mt-5 rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-5 py-8 text-center sm:px-6">
          <div className="text-[15px] font-medium text-[#0b1024]">{t("noObjectsTitle")}</div>
          <p className="mx-auto mt-1.5 max-w-[460px] text-[13px] leading-[1.55] text-[#6f7282]">
            {t("noObjectsText")}
          </p>
          <button type="button" onClick={onConnect} className={cn(OUTLINE, "mt-4")} data-testid="master-export-connect">
            <Building2 className="size-4 text-[#5566f6]" />
            {t("connectKitchen")}
          </button>
        </div>
      ) : (
        <ol className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("stepsAria")}>
          {steps.map((step, index) => (
            <li key={step} className="flex items-start gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[13px] font-semibold tabular-nums text-[#3848c7]">
                {index + 1}
              </span>
              <span className="text-[13px] leading-[1.5] text-[#3c4053]">{step}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ListPanel({
  kind,
  items,
  objectsCount,
  uploading,
  onUpload,
  onPaste,
  onPhotoItems,
}: {
  kind: SharedKind;
  items: SharedItem[];
  objectsCount: number;
  uploading: boolean;
  onUpload: (kind: SharedKind) => void;
  onPaste: (kind: SharedKind) => void;
  /** «С фото»: распознанные позиции → предпросмотр различий. */
  onPhotoItems: (kind: SharedKind, items: SharedItem[]) => Promise<RecognizeResult>;
}) {
  const t = useTranslations("masterUi.masterDirectoryClient");
  const meta = kindMeta(t, kind);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      needle
        ? items.filter((item) =>
            [item.name, item.supplier ?? "", item.manufacturer ?? ""].some((value) =>
              value.toLowerCase().includes(needle)
            )
          )
        : items,
    [items, needle]
  );
  const visible = filtered.slice(0, limit);

  const actions = (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onUpload(kind)}
        disabled={uploading}
        className={PRIMARY}
        data-testid={`master-upload-${kind}`}
      >
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
        {t("uploadFile")}
      </button>
      <button type="button" onClick={() => onPaste(kind)} className={OUTLINE} data-testid={`master-paste-${kind}`}>
        <ClipboardPaste className="size-4 text-[#5566f6]" />
        {t("pasteList")}
      </button>
      {kind === "dish" ? (
        <RecognizeFromPhoto
          kind="menu"
          onItems={(photoItems) =>
            onPhotoItems(
              "dish",
              photoItems.map((item) => ({
                name: item.name,
                supplier: null,
                manufacturer: null,
                portion: item.yield || null,
                time: item.time || null,
              }))
            )
          }
          resultLabel={t("resultNewDishes")}
          className="sm:h-11 sm:rounded-2xl"
          testId="master-photo-dish"
        />
      ) : (
        <RecognizeFromPhoto
          kind="raw"
          fields={["name", "supplier", "manufacturer"]}
          onItems={(photoItems) =>
            onPhotoItems(
              "product",
              photoItems.map((item) => ({
                name: item.name,
                supplier: item.supplier || null,
                manufacturer: item.manufacturer || null,
              }))
            )
          }
          resultLabel={t("resultNewItems")}
          className="sm:h-11 sm:rounded-2xl"
          testId="master-photo-product"
        />
      )}
    </div>
  );

  return (
    <section className={CARD} aria-labelledby={`master-list-${kind}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 id={`master-list-${kind}`} className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
            {meta.title}
          </h1>
          <p className="mt-1.5 text-[14px] leading-[1.55] text-[#6f7282]">
            {kind === "dish" ? t("listDishDescription") : t("listProductDescription", { journal: meta.journal, where: inObjects(t, objectsCount) })}
          </p>
        </div>
        {items.length > 0 ? actions : null}
      </div>

      {items.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-5 py-10 text-center sm:px-6">
          <div className="text-[15px] font-medium text-[#0b1024]">{t("emptyTitle")}</div>
          <p className="mx-auto mt-1.5 max-w-[460px] text-[13px] leading-[1.55] text-[#6f7282]">
            {kind === "dish" ? t("emptyDishText") : t("emptyProductText", { journal: meta.journal, where: inObjects(t, objectsCount) })}
          </p>
          <div className="mt-5 flex justify-center">{actions}</div>
          <div className="mx-auto mt-6 grid max-w-[640px] gap-3 text-left sm:grid-cols-2">
            <div className="rounded-2xl border border-[#ececf4] bg-white p-4">
              <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("asList")}</div>
              <p className="mt-1 text-[12.5px] text-[#3c4053]">
                {kind === "dish" ? t("dishListHint") : t("productListHint")}
              </p>
              <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-[#f5f6ff] px-3 py-2 font-mono text-[12px] leading-[1.6] text-[#3848c7]">
                {meta.example}
              </pre>
            </div>
            <div className="rounded-2xl border border-[#ececf4] bg-white p-4">
              <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("asFile")}</div>
              <p className="mt-1 text-[12.5px] leading-[1.55] text-[#3c4053]">
                {t("fileHint", { columns: meta.exampleFile })}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block w-full sm:max-w-[360px]">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setLimit(PAGE_SIZE);
                }}
                placeholder={kind === "dish" ? t("searchDish") : t("searchRaw")}
                aria-label={t("searchAria")}
                className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white pl-10 pr-10 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={t("clearSearch")}
                  className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-[#9b9fb3] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#0b1024]"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </label>
            <span className="text-[13px] tabular-nums text-[#6f7282]" data-testid={`master-count-${kind}`}>
              {needle ? t("foundOf", { found: filtered.length, total: items.length }) : t("inList", { count: meta.count(items.length) })}
            </span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[#ececf4]">
            {kind === "product" ? (
              <div className="hidden grid-cols-[56px_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.3fr)] gap-3 border-b border-[#ececf4] bg-[#fafbff] px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6f7282] md:grid">
                <span>№</span>
                <span>{t("colName")}</span>
                <span>{t("colSupplier")}</span>
                <span>{t("colManufacturer")}</span>
              </div>
            ) : (
              <div className="hidden grid-cols-[56px_minmax(0,1fr)_120px_96px] gap-3 border-b border-[#ececf4] bg-[#fafbff] px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6f7282] md:grid">
                <span>№</span>
                <span>{t("colName")}</span>
                <span>{t("colYield")}</span>
                <span>{t("colTime")}</span>
              </div>
            )}
            {visible.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13.5px] text-[#6f7282]">{t("nothingFound")}</div>
            ) : (
              <ul className="divide-y divide-[#ececf4]" data-testid={`master-list-${kind}`}>
                {visible.map((item) => {
                  const index = items.indexOf(item) + 1;
                  return (
                    <li
                      key={item.name}
                      className={cn(
                        "flex gap-3 px-4 py-2.5 text-[14px] text-[#0b1024] transition-colors duration-150 hover:bg-[#fafbff] md:grid md:items-center",
                        kind === "product"
                          ? "md:grid-cols-[56px_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.3fr)]"
                          : "md:grid-cols-[56px_minmax(0,1fr)_120px_96px]"
                      )}
                    >
                      <span className="w-7 shrink-0 text-[12.5px] leading-[21px] tabular-nums text-[#9b9fb3] md:w-auto">{index}</span>
                      {kind === "product" ? (
                        <>
                          <span className="min-w-0 flex-1 md:contents">
                            <span className="block break-words font-medium md:font-normal">{item.name}</span>
                            <span className="mt-0.5 block text-[12.5px] text-[#6f7282] md:hidden">
                              {[item.supplier, item.manufacturer].filter(Boolean).join(" · ") || t("supplierNotSpecified")}
                            </span>
                            <span className="hidden break-words text-[#3c4053] md:block">{item.supplier ?? "—"}</span>
                            <span className="hidden break-words text-[#3c4053] md:block">{item.manufacturer ?? "—"}</span>
                          </span>
                        </>
                      ) : (
                        <span className="min-w-0 flex-1 md:contents">
                          <span className="block break-words">{item.name}</span>
                          {item.portion || item.time ? (
                            <span className="mt-0.5 block text-[12.5px] tabular-nums text-[#6f7282] md:hidden">
                              {[item.portion ? t("yieldCapital", { value: item.portion }) : "", item.time ? t("withTime", { value: item.time }) : ""]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          ) : null}
                          <span className="hidden tabular-nums text-[#3c4053] md:block">{item.portion || "—"}</span>
                          <span className="hidden tabular-nums text-[#3c4053] md:block">{item.time || "—"}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {filtered.length > visible.length ? (
            <div className="flex justify-center">
              <button type="button" onClick={() => setLimit((value) => value + PAGE_SIZE)} className={OUTLINE}>
                {t("showMore", { count: Math.min(PAGE_SIZE, filtered.length - visible.length) })}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
