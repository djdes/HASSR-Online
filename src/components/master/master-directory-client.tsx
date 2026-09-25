"use client";

import { useMemo, useRef, useState } from "react";
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

import { MasterBrakerageDialog } from "@/components/master/master-brakerage-dialog";
import { MasterMenuTableDialog } from "@/components/master/master-menu-table-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { MenuRow } from "@/lib/finished-product-bulk";
import type { SharedItem, SharedKind } from "@/lib/master-directory";
import { pluralRu } from "@/lib/plural-ru";
import { cn } from "@/lib/utils";

export type MasterTab = "menu" | "raw" | "objects";

/** changed — та же позиция меню с другим выходом или временем. */
type Diff = { added: string[]; removed: string[]; changed?: string[]; unchanged: number };
type Preview = { kind: SharedKind; items: SharedItem[]; diff: Diff; source: string };

const PREVIEW_LIMIT = 20;
const PAGE_SIZE = 200;

const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const OUTLINE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const CARD =
  "rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6";

const KIND_META: Record<
  SharedKind,
  { title: string; journal: string; noun: [string, string, string]; example: string; exampleFile: string }
> = {
  dish: {
    title: "Меню для бракеража готовой продукции",
    journal: "журналы бракеража готовой продукции (БЖГП)",
    noun: ["блюдо", "блюда", "блюд"],
    example: "Борщ со сметаной    250      08:30\nПлов с курицей      200/10   11:00\nКомпот из сухофруктов 200   07:30",
    exampleFile:
      "колонка «Наименование» (или просто первая колонка), по желанию «Выход» и «Время изготовления»",
  },
  product: {
    title: "Сырьё для скоропорта",
    journal: "журналы бракеража скоропортящейся продукции",
    noun: ["позиция", "позиции", "позиций"],
    example: "Молоко 3,2% | ООО «Ферма» | Молокозавод №1\nКефир 1% | ООО «Ферма»\nТворог 9%",
    exampleFile: "колонки «Наименование», «Поставщик», «Изготовитель»",
  },
};

function countLabel(count: number, noun: [string, string, string]): string {
  return `${count} ${pluralRu(count, noun[0], noun[1], noun[2])}`;
}

/** «во всех 3 объектах» / «в 1 объекте». */
function inObjects(count: number): string {
  if (count === 0) return "во всех объектах с кодом справочника (пока ни одного)";
  if (count === 1) return "в 1 объекте";
  return `во всех ${count} ${pluralRu(count, "объекте", "объектах", "объектах")}`;
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
 * Мастер-кабинет: вкладки «Меню → БЖГП», «Сырьё → Скоропорт», «Объекты».
 * Любое изменение списка идёт одним путём: файл или текст → предпросмотр
 * различий → «Сохранить и разослать» (замена списка + раздача в журналы
 * всех объектов пула).
 */
export function MasterDirectoryClient({
  initialTab,
  initialDishes,
  initialProducts,
  organizations,
}: {
  initialTab: MasterTab;
  initialDishes: SharedItem[];
  initialProducts: SharedItem[];
  organizations: Array<{ id: string; name: string }>;
}) {
  const [tab, setTab] = useState<MasterTab>(initialTab);
  const [lists, setLists] = useState<Record<SharedKind, SharedItem[]>>({
    dish: initialDishes,
    product: initialProducts,
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pasteKind, setPasteKind] = useState<SharedKind | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [uploading, setUploading] = useState<SharedKind | null>(null);
  /** Меню вводится таблицей «Наименование | Выход | Время», сырьё — текстом. */
  const [menuTableOpen, setMenuTableOpen] = useState(false);
  /** «Добавить в журналы на дату» — строки БЖГП во все пищеблоки пула. */
  const [brakerageOpen, setBrakerageOpen] = useState(false);
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
    source: string
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
      toast.error(json?.error ?? "Не удалось прочитать список. Проверьте интернет и попробуйте ещё раз.");
      return false;
    }
    setPreview({ kind, items: json.items, diff: json.diff, source });
    return true;
  }

  function pickFile(kind: SharedKind) {
    fileKind.current = kind;
    fileInput.current?.click();
  }

  async function onFileChosen(file: File | undefined) {
    if (!file) return;
    const kind = fileKind.current;
    setUploading(kind);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      await requestPreview(kind, form, `файл «${file.name}»`);
    } finally {
      setUploading(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function openPaste(kind: SharedKind) {
    if (kind === "dish") {
      setMenuTableOpen(true);
      return;
    }
    setPasteText(itemsToText(kind, lists[kind]));
    setPasteKind(kind);
  }

  function submitMenuTable(rows: MenuRow[]) {
    return requestPreview(
      "dish",
      {
        items: rows.map((row) => ({
          name: row.name,
          supplier: null,
          manufacturer: null,
          portion: row.yield || null,
          time: row.time || null,
        })),
      },
      "таблица меню"
    );
  }

  async function submitPaste() {
    if (!pasteKind) return;
    const ok = await requestPreview(pasteKind, { text: pasteText }, "вставленный список");
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
      toast.error(json?.error ?? "Не удалось сохранить. Список не изменился — попробуйте ещё раз.");
      return;
    }
    const orgs = json.organizations ?? 0;
    const docs = json.documents ?? 0;
    setLists((prev) => ({ ...prev, [preview.kind]: preview.items }));
    setPreview(null);
    toast.success(
      `Готово: список обновлён в ${orgs} ${pluralRu(orgs, "объекте", "объектах", "объектах")} (${docs} ${pluralRu(
        docs,
        "журнал",
        "журнала",
        "журналов"
      )})`
    );
  }

  const tabs: Array<{ key: MasterTab; label: string; short: string; icon: typeof Package; count: number }> = [
    { key: "menu", label: "Меню → БЖГП", short: "Меню", icon: UtensilsCrossed, count: lists.dish.length },
    { key: "raw", label: "Сырьё → Скоропорт", short: "Сырьё", icon: Package, count: lists.product.length },
    { key: "objects", label: "Объекты", short: "Объекты", icon: Building2, count: organizations.length },
  ];

  const pasteMeta = pasteKind ? KIND_META[pasteKind] : null;
  const previewMeta = preview ? KIND_META[preview.kind] : null;

  return (
    <div className="space-y-5">
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
        className="hidden"
        onChange={(event) => void onFileChosen(event.target.files?.[0])}
        data-testid="master-file-input"
      />

      <nav aria-label="Разделы мастер-кабинета" className="-mx-4 px-4 md:mx-0 md:px-0">
        <div
          role="tablist"
          className="flex flex-nowrap! gap-1 overflow-x-auto rounded-2xl border border-[#ececf4] bg-white p-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:inline-flex [&::-webkit-scrollbar]:hidden"
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
                  "inline-flex h-10 flex-1 shrink-0 items-center justify-center gap-1.5 rounded-xl px-2.5 sm:flex-none sm:gap-2 sm:px-3.5 text-[14px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                  active ? "bg-[#5566f6] text-white" : "text-[#3c4053] hover:bg-[#f5f6ff] hover:text-[#0b1024]"
                )}
                data-testid={`master-tab-${item.key}`}
              >
                <Icon className="size-4 shrink-0" />
                <span className="sm:hidden">{item.short}</span>
                <span className="hidden sm:inline">{item.label}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11.5px] font-semibold leading-none tabular-nums",
                    active ? "bg-white/20 text-white" : "bg-[#eef1ff] text-[#3848c7]"
                  )}
                >
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {tab === "menu" ? (
        <BrakerageCard objectsCount={organizations.length} onOpen={() => setBrakerageOpen(true)} />
      ) : null}

      {tab === "menu" || tab === "raw" ? (
        <ListPanel
          key={tab}
          kind={tab === "menu" ? "dish" : "product"}
          items={lists[tab === "menu" ? "dish" : "product"]}
          objectsCount={organizations.length}
          uploading={uploading === (tab === "menu" ? "dish" : "product")}
          onUpload={pickFile}
          onPaste={openPaste}
        />
      ) : (
        <ObjectsPanel organizations={organizations} />
      )}

      <MasterBrakerageDialog
        open={brakerageOpen}
        onOpenChange={setBrakerageOpen}
        menu={lists.dish}
        organizationsCount={organizations.length}
      />

      <MasterMenuTableDialog
        open={menuTableOpen}
        items={lists.dish}
        onClose={() => setMenuTableOpen(false)}
        onSubmit={submitMenuTable}
      />

      {/* Вставка списком (сырьё): текущий список уже в поле — правьте, удаляйте строки, добавляйте новые. */}
      <ConfirmDialog
        open={pasteKind !== null}
        onClose={() => setPasteKind(null)}
        onConfirm={submitPaste}
        title="Вставить списком"
        icon={ClipboardPaste}
        description={
          pasteMeta ? (
            <>
              Одна позиция — одна строка (или через «;»).
              {pasteKind === "product" ? " Поставщик и изготовитель — через «|», по желанию." : ""} В поле уже
              текущий список: удалите строку — позиция уберётся, допишите — добавится.
            </>
          ) : null
        }
        confirmLabel="Показать изменения"
        confirmDisabled={pasteText.trim().length === 0}
      >
        <textarea
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
          rows={10}
          autoFocus
          placeholder={pasteMeta?.example}
          aria-label="Список позиций"
          className="w-full resize-y rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[14px] leading-[1.6] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          data-testid="master-paste-text"
        />
        <p className="mt-2 text-[12px] text-[#6f7282]">
          Строк в поле: {pasteText.split(/[\r\n;]+/).filter((line) => line.trim()).length}
        </p>
      </ConfirmDialog>

      {/* Предпросмотр различий перед раздачей. */}
      <ConfirmDialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        onConfirm={saveAndDistribute}
        title="Проверьте изменения"
        icon={Send}
        description={
          preview && previewMeta ? (
            <>
              {previewMeta.title}, {preview.source}. После сохранения список получат {previewMeta.journal}{" "}
              {inObjects(organizations.length)}.
            </>
          ) : null
        }
        confirmLabel="Сохранить и разослать"
      >
        {preview ? <PreviewBody preview={preview} /> : null}
      </ConfirmDialog>
    </div>
  );
}

/**
 * Главное действие вкладки меню: строки бракеража на дату — в БЖГП всех
 * пищеблоков. Меню ниже — справочник подсказок и «Взять меню».
 */
function BrakerageCard({ objectsCount, onOpen }: { objectsCount: number; onOpen: () => void }) {
  return (
    <section
      className="rounded-3xl border border-[#dfe3ff] bg-gradient-to-br from-[#f5f6ff] to-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6"
      aria-labelledby="master-brakerage-title"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <CalendarPlus className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id="master-brakerage-title" className="text-[18px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
              Бракераж на дату — во все пищеблоки
            </h2>
            <p className="mt-1 text-[13.5px] leading-[1.55] text-[#6f7282]">
              Составьте список блюд на день — строки появятся в журнале бракеража готовой продукции{" "}
              {objectsCount === 1 ? "подключённого пищеблока" : `всех ${objectsCount} ${pluralRu(objectsCount, "пищеблока", "пищеблоков", "пищеблоков")}`}{" "}
              на выбранную дату.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpen}
          disabled={objectsCount === 0}
          className={cn(PRIMARY, "shrink-0")}
          data-testid="master-brakerage-open"
        >
          <CalendarPlus className="size-4" />
          Добавить в журналы на дату
        </button>
      </div>
      {objectsCount === 0 ? (
        <p className="mt-3 text-[12.5px] text-[#a13a32]">Пока ни один пищеблок не подключён к коду справочника.</p>
      ) : null}
    </section>
  );
}

function PreviewBody({ preview }: { preview: Preview }) {
  const { added, removed, unchanged } = preview.diff;
  const changed = preview.diff.changed ?? [];
  const isMenu = preview.kind === "dish";
  const byName = new Map(preview.items.map((item) => [item.name.toLowerCase(), item]));
  /** «Борщ — 250 · 08:30»: что станет у изменённого блюда. */
  const changedLabel = (name: string) => {
    const item = byName.get(name.toLowerCase());
    const parts = [item?.portion ? `выход ${item.portion}` : "без выхода", item?.time ? `время ${item.time}` : "без времени"];
    return `${name} — ${parts.join(", ")}`;
  };
  return (
    <div className="space-y-4" data-testid="master-preview">
      <div className={cn("grid gap-2 text-center", isMenu ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
        <Stat label="Добавится" value={added.length} tone="ok" />
        <Stat label="Уберётся" value={removed.length} tone={removed.length > 0 ? "warn" : "neutral"} />
        {isMenu ? <Stat label="Изменится" value={changed.length} tone="neutral" /> : null}
        <Stat label="Без изменений" value={unchanged} tone="neutral" />
      </div>
      <p className="text-[12.5px] text-[#6f7282]" data-testid="master-preview-summary">
        Добавится {added.length} · Уберётся {removed.length}
        {isMenu ? ` · Изменится ${changed.length}` : ""} · Без изменений {unchanged} · всего в списке{" "}
        {preview.items.length}
      </p>
      {added.length > 0 ? <NameList title="Новые" names={added} tone="ok" /> : null}
      {changed.length > 0 ? <NameList title="Изменятся выход или время" names={changed.map(changedLabel)} tone="edit" /> : null}
      {removed.length > 0 ? (
        <>
          <NameList title="Уберутся" names={removed} tone="warn" />
          <p className="rounded-2xl bg-[#fafbff] px-3 py-2 text-[12.5px] leading-[1.5] text-[#3c4053]">
            У объектов уйдут только эти позиции. То, что объекты внесли сами, останется.
          </p>
        </>
      ) : null}
      {added.length === 0 && removed.length === 0 && changed.length === 0 ? (
        <p className="rounded-2xl bg-[#fafbff] px-3 py-2 text-[12.5px] leading-[1.5] text-[#3c4053]">
          {isMenu
            ? "Меню не изменилось."
            : "Названия не изменились. Сохраните, если поменяли поставщиков или изготовителей."}
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
  const shown = names.slice(0, PREVIEW_LIMIT);
  const Icon = tone === "ok" ? Plus : tone === "edit" ? PenLine : Minus;
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
        {title}
        {names.length > PREVIEW_LIMIT ? ` · первые ${PREVIEW_LIMIT} из ${names.length}` : ""}
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

function ListPanel({
  kind,
  items,
  objectsCount,
  uploading,
  onUpload,
  onPaste,
}: {
  kind: SharedKind;
  items: SharedItem[];
  objectsCount: number;
  uploading: boolean;
  onUpload: (kind: SharedKind) => void;
  onPaste: (kind: SharedKind) => void;
}) {
  const meta = KIND_META[kind];
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
    <div className="flex flex-col gap-2 sm:flex-row">
      <button
        type="button"
        onClick={() => onUpload(kind)}
        disabled={uploading}
        className={PRIMARY}
        data-testid={`master-upload-${kind}`}
      >
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
        Загрузить Excel/CSV
      </button>
      <button type="button" onClick={() => onPaste(kind)} className={OUTLINE} data-testid={`master-paste-${kind}`}>
        <ClipboardPaste className="size-4 text-[#5566f6]" />
        Вставить списком
      </button>
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
            Этот список получат {meta.journal} {inObjects(objectsCount)}.
          </p>
        </div>
        {items.length > 0 ? actions : null}
      </div>

      {items.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-5 py-10 text-center sm:px-6">
          <div className="text-[15px] font-medium text-[#0b1024]">Список пока пуст</div>
          <p className="mx-auto mt-1.5 max-w-[460px] text-[13px] leading-[1.55] text-[#6f7282]">
            Загрузите файл или вставьте список — перед сохранением покажем, что добавится. После сохранения{" "}
            {meta.journal} {inObjects(objectsCount)} получат его сразу.
          </p>
          <div className="mt-5 flex justify-center">{actions}</div>
          <div className="mx-auto mt-6 grid max-w-[640px] gap-3 text-left sm:grid-cols-2">
            <div className="rounded-2xl border border-[#ececf4] bg-white p-4">
              <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">Списком</div>
              <p className="mt-1 text-[12.5px] text-[#3c4053]">
                {kind === "dish"
                  ? "Таблица «Наименование — Выход — Время», можно вставить из Excel:"
                  : "Одна позиция в строке:"}
              </p>
              <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-[#f5f6ff] px-3 py-2 font-mono text-[12px] leading-[1.6] text-[#3848c7]">
                {meta.example}
              </pre>
            </div>
            <div className="rounded-2xl border border-[#ececf4] bg-white p-4">
              <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">Файлом</div>
              <p className="mt-1 text-[12.5px] leading-[1.55] text-[#3c4053]">
                Excel (.xlsx, .xls) или CSV: {meta.exampleFile}. Первый лист, строка заголовков по желанию.
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
                placeholder={kind === "dish" ? "Найти блюдо" : "Найти сырьё, поставщика, изготовителя"}
                aria-label="Поиск по списку"
                className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white pl-10 pr-10 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Очистить поиск"
                  className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-[#9b9fb3] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#0b1024]"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </label>
            <span className="text-[13px] tabular-nums text-[#6f7282]" data-testid={`master-count-${kind}`}>
              {needle ? `Найдено ${filtered.length} из ${items.length}` : `В списке ${countLabel(items.length, meta.noun)}`}
            </span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[#ececf4]">
            {kind === "product" ? (
              <div className="hidden grid-cols-[56px_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.3fr)] gap-3 border-b border-[#ececf4] bg-[#fafbff] px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6f7282] md:grid">
                <span>№</span>
                <span>Наименование</span>
                <span>Поставщик</span>
                <span>Изготовитель</span>
              </div>
            ) : (
              <div className="hidden grid-cols-[56px_minmax(0,1fr)_120px_96px] gap-3 border-b border-[#ececf4] bg-[#fafbff] px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6f7282] md:grid">
                <span>№</span>
                <span>Наименование</span>
                <span>Выход</span>
                <span>Время</span>
              </div>
            )}
            {visible.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13.5px] text-[#6f7282]">Ничего не нашли — измените запрос.</div>
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
                              {[item.supplier, item.manufacturer].filter(Boolean).join(" · ") || "Поставщик не указан"}
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
                              {[item.portion ? `Выход ${item.portion}` : "", item.time ? `время ${item.time}` : ""]
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
                Показать ещё {Math.min(PAGE_SIZE, filtered.length - visible.length)}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ObjectsPanel({ organizations }: { organizations: Array<{ id: string; name: string }> }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section className={CARD} aria-labelledby="master-objects">
        <h1 id="master-objects" className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
          Подключённые объекты
        </h1>
        <p className="mt-1.5 text-[14px] leading-[1.55] text-[#6f7282]">
          Эти объекты получают меню и сырьё из кабинета при каждом сохранении.
        </p>
        {organizations.length > 0 ? (
          <ul className="mt-4 divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]" data-testid="master-objects-list">
            {organizations.map((org) => (
              <li key={org.id} className="flex min-w-0 items-center gap-3 px-4 py-3 text-[14px] text-[#0b1024]">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
                  <Building2 className="size-4" />
                </span>
                <span className="min-w-0 break-words">{org.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-8 text-center text-[13.5px] text-[#6f7282]">
            Пока ни один объект не подключён к коду справочника.
          </div>
        )}
      </section>
      <section className={CARD} aria-labelledby="master-objects-howto">
        <h2 id="master-objects-howto" className="text-[16px] font-semibold text-[#0b1024]">
          Как подключить новый объект
        </h2>
        <ol className="mt-3 space-y-2.5 text-[13.5px] leading-[1.55] text-[#3c4053]">
          <li className="flex gap-2.5">
            <Step n={1} />
            <span>
              Руководитель объекта открывает документ журнала бракеража готовой продукции → «Настройки документа»
              (или «Настройки» → «Мастер-кабинет справочников» → «Подключиться к коду другой организации»).
            </span>
          </li>
          <li className="flex gap-2.5">
            <Step n={2} />
            <span>
              В блоке «Общий справочник блюд» вводит код справочника (он в шапке кабинета) и нажимает «Привязать».
            </span>
          </li>
          <li className="flex gap-2.5">
            <Step n={3} />
            <span>Меню и сырьё сразу появляются в его журналах. Своё, что объект вносил раньше, остаётся.</span>
          </li>
        </ol>
      </section>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[12px] font-semibold tabular-nums text-[#3848c7]">
      {n}
    </span>
  );
}
