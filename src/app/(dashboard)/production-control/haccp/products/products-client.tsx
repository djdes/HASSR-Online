"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PPK_PRODUCT_CATEGORIES, type ProductCategory, type ProductData } from "@/lib/ppk/records";
import { productIndicatorPreset } from "@/lib/ppk/haccp-presets";
import { usePpkRecords, type PpkRecordRow } from "@/components/production-control/use-ppk-records";
import {
  PPK_BUTTON_OUTLINE_CLASS,
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_BUTTON_TEXT_CLASS,
  PPK_BUTTON_TEXT_DANGER_CLASS,
  PPK_FIELD_CLASS,
  PPK_LABEL_CLASS,
  PPK_SELECT_CLASS,
  PPK_TEXTAREA_CLASS,
  PPK_ICON_BUTTON_CLASS,
  PpkBlockActionProvider,
  PpkEmptyState,
} from "@/components/production-control/ppk-ui";

type Row = PpkRecordRow<ProductData>;
type Indicator = ProductData["indicators"][number];

/** Больше стольких продуктов — над списком появляется поиск по названию. */
const SEARCH_FROM = 7;
/** Предел показателей — тот же, что в схеме записи. */
const INDICATORS_MAX = 30;

/**
 * Описание продукции (ХАССП, шаг 2): карточки продуктов, поиск, окно правки.
 * Записи приходят с сервера (`initial`), после каждого изменения список
 * перечитывается через `usePpkRecords`.
 */
export function ProductsClient({ initial, header }: { initial: Row[]; header: ReactNode }) {
  const t = useTranslations("productionControl.products");
  const { records, create, update, remove } = usePpkRecords<ProductData>("products", initial);

  /** `null` — окно закрыто; `{ row: null }` — создание; иначе — правка строки. */
  const [dialog, setDialog] = useState<{ row: Row | null } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Row | null>(null);
  const [query, setQuery] = useState("");

  const openCreate = () => setDialog({ row: null });
  const needle = query.trim().toLowerCase();
  const shown = needle ? records.filter((row) => row.data.name.toLowerCase().includes(needle)) : records;

  return (
    <PpkBlockActionProvider openCreate={openCreate}>
      {header}

      {records.length === 0 ? (
        <PpkEmptyState title={t("emptyTitle")} hint={t("emptyHint")}>
          <button type="button" onClick={openCreate} className={PPK_BUTTON_PRIMARY_CLASS}>
            <Plus className="size-4" />
            {t("add")}
          </button>
        </PpkEmptyState>
      ) : (
        <div className="space-y-4">
          {records.length >= SEARCH_FROM ? (
            <label className="relative block max-w-[360px]">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#9b9fb3]" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("search")}
                aria-label={t("search")}
                className={`${PPK_FIELD_CLASS} pl-11`}
              />
            </label>
          ) : null}

          {shown.length === 0 ? (
            <p className="text-[14px] text-[#6f7282]">{t("notFound")}</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {shown.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-shadow duration-200 hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)]"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-[#0b1024]">{row.data.name}</div>
                    <span className="mt-1.5 inline-flex rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] text-[#3848c7]">
                      {t(`categories.${row.data.category}`)}
                    </span>
                  </div>
                  <dl className="grid gap-1.5 text-[13px]">
                    <div className="flex gap-2">
                      <dt className="w-[130px] shrink-0 text-[#9b9fb3]">{t("storage")}</dt>
                      <dd className="min-w-0 text-[#3c4053]">{row.data.storage || "—"}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-[130px] shrink-0 text-[#9b9fb3]">{t("shelfLife")}</dt>
                      <dd className="min-w-0 text-[#3c4053]">{row.data.shelfLife || "—"}</dd>
                    </div>
                  </dl>
                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-[#ececf4] pt-3">
                    <span className="text-[13px] tabular-nums text-[#6f7282]">
                      {t("indicatorsCount", { count: String(row.data.indicators.length) })}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setDialog({ row })}
                        className={PPK_BUTTON_TEXT_CLASS}
                      >
                        <Pencil className="size-4" />
                        {t("edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingRemove(row)}
                        className={PPK_BUTTON_TEXT_DANGER_CLASS}
                      >
                        <Trash2 className="size-4" />
                        {t("remove")}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dialog ? (
        <ProductDialog
          key={dialog.row?.id ?? "new"}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onSave={(data) => (dialog.row ? update(dialog.row.id, data) : create(data))}
        />
      ) : null}

      <ConfirmDialog
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={async () => {
          if (pendingRemove) await remove(pendingRemove.id);
        }}
        title={pendingRemove ? t("removeTitle", { name: pendingRemove.data.name }) : ""}
        description={t("removeBody")}
        variant="danger"
        confirmLabel={t("remove")}
        cancelLabel={t("cancel")}
      />
    </PpkBlockActionProvider>
  );
}

/** Окно продукта: поля в две колонки на десктопе и таблица показателей. */
function ProductDialog({
  row,
  onClose,
  onSave,
}: {
  row: Row | null;
  onClose: () => void;
  onSave: (data: ProductData) => Promise<boolean>;
}) {
  const t = useTranslations("productionControl.products");
  const [form, setForm] = useState<ProductData>(() =>
    row
      ? { ...row.data, indicators: row.data.indicators.map((item) => ({ ...item })) }
      : {
          name: "",
          category: "ready-meals",
          composition: "",
          storage: "",
          shelfLife: "",
          usage: "",
          packaging: "",
          indicators: productIndicatorPreset("ready-meals"),
        },
  );
  const [saving, setSaving] = useState(false);
  /** Окно закрываем на время подтверждения: вложенный диалог иначе не получает кликов. */
  const [presetOpen, setPresetOpen] = useState(false);

  const setField = <K extends keyof ProductData>(key: K, value: ProductData[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  /** Группа без показателей сразу получает типовые; с показателями — только по кнопке. */
  const changeCategory = (category: ProductCategory) =>
    setForm((current) => ({
      ...current,
      category,
      indicators: current.indicators.length === 0 ? productIndicatorPreset(category) : current.indicators,
    }));

  const updateIndicator = (index: number, patch: Partial<Indicator>) =>
    setForm((current) => ({
      ...current,
      indicators: current.indicators.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));

  const removeIndicator = (index: number) =>
    setForm((current) => ({
      ...current,
      indicators: current.indicators.filter((_, i) => i !== index),
    }));

  const submit = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    const data: ProductData = {
      ...form,
      name: form.name.trim(),
      indicators: form.indicators
        .filter((item) => item.name.trim().length > 0)
        .map((item) => ({ name: item.name.trim(), norm: item.norm.trim() })),
    };
    const saved = await onSave(data);
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <>
      <Dialog open={!presetOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="flex max-h-[90vh] max-w-[720px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 gap-0 border-b border-[#ececf4] px-6 py-4 pr-14 text-left">
            <DialogTitle className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
              {row ? t("edit") : t("add")}
            </DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="md:col-span-2">
                <span className={PPK_LABEL_CLASS}>{t("name")}</span>
                <input
                  value={form.name}
                  onChange={(event) => setField("name", event.target.value)}
                  autoFocus
                  className={PPK_FIELD_CLASS}
                />
              </label>
              <div>
                <span className={PPK_LABEL_CLASS}>{t("category")}</span>
                <Select value={form.category} onValueChange={(value) => changeCategory(value as ProductCategory)}>
                  <SelectTrigger className={PPK_SELECT_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PPK_PRODUCT_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {t(`categories.${category}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label>
                <span className={PPK_LABEL_CLASS}>{t("storage")}</span>
                <input
                  value={form.storage}
                  onChange={(event) => setField("storage", event.target.value)}
                  className={PPK_FIELD_CLASS}
                />
              </label>
              <label>
                <span className={PPK_LABEL_CLASS}>{t("shelfLife")}</span>
                <input
                  value={form.shelfLife}
                  onChange={(event) => setField("shelfLife", event.target.value)}
                  className={PPK_FIELD_CLASS}
                />
              </label>
              <label>
                <span className={PPK_LABEL_CLASS}>{t("usage")}</span>
                <input
                  value={form.usage}
                  onChange={(event) => setField("usage", event.target.value)}
                  className={PPK_FIELD_CLASS}
                />
              </label>
              <label>
                <span className={PPK_LABEL_CLASS}>{t("packaging")}</span>
                <input
                  value={form.packaging}
                  onChange={(event) => setField("packaging", event.target.value)}
                  className={PPK_FIELD_CLASS}
                />
              </label>
              <label className="md:col-span-2">
                <span className={PPK_LABEL_CLASS}>{t("composition")}</span>
                <textarea
                  value={form.composition}
                  onChange={(event) => setField("composition", event.target.value)}
                  rows={3}
                  className={PPK_TEXTAREA_CLASS}
                />
              </label>
            </div>

            <section className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-[15px] font-semibold text-[#0b1024]">{t("indicators")}</h3>
                <button
                  type="button"
                  onClick={() => setPresetOpen(true)}
                  className={PPK_BUTTON_TEXT_CLASS}
                >
                  <Sparkles className="size-4" />
                  {t("usePreset")}
                </button>
              </div>

              <div className="mt-3 grid gap-2">
                <div className="hidden gap-2 px-1 text-[12px] font-medium text-[#9b9fb3] sm:grid sm:grid-cols-[1fr_1fr_36px]">
                  <span>{t("indicatorName")}</span>
                  <span>{t("indicatorNorm")}</span>
                  <span />
                </div>
                {form.indicators.map((item, index) => (
                  <div
                    key={index}
                    className="grid gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-2 sm:grid-cols-[1fr_1fr_36px] sm:border-0 sm:bg-transparent sm:p-0"
                  >
                    <input
                      value={item.name}
                      aria-label={t("indicatorName")}
                      onChange={(event) => updateIndicator(index, { name: event.target.value })}
                      className={PPK_FIELD_CLASS}
                    />
                    <input
                      value={item.norm}
                      aria-label={t("indicatorNorm")}
                      onChange={(event) => updateIndicator(index, { norm: event.target.value })}
                      className={PPK_FIELD_CLASS}
                    />
                    <button
                      type="button"
                      onClick={() => removeIndicator(index)}
                      aria-label={t("remove")}
                      title={t("remove")}
                      className={PPK_ICON_BUTTON_CLASS}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    indicators: [...current.indicators, { name: "", norm: "" }],
                  }))
                }
                disabled={form.indicators.length >= INDICATORS_MAX}
                className={`${PPK_BUTTON_OUTLINE_CLASS} mt-3`}
              >
                <Plus className="size-4" />
                {t("addIndicator")}
              </button>
              <p className="mt-3 text-[12.5px] leading-[1.6] text-[#9b9fb3]">{t("indicatorsNote")}</p>
            </section>
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t border-[#ececf4] px-6 py-4">
            <button type="button" onClick={onClose} className={PPK_BUTTON_OUTLINE_CLASS}>
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!form.name.trim() || saving}
              className={PPK_BUTTON_PRIMARY_CLASS}
            >
              {t("save")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={presetOpen}
        onClose={() => setPresetOpen(false)}
        onConfirm={() => {
          setForm((current) => ({ ...current, indicators: productIndicatorPreset(current.category) }));
          setPresetOpen(false);
        }}
        title={t("usePresetTitle")}
        description={t("usePresetBody")}
        variant="warn"
        confirmLabel={t("usePreset")}
        cancelLabel={t("cancel")}
      />
    </>
  );
}
