"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Languages, Loader2, RotateCcw, Save, Search, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/i18n/locales";
import type { CategoryStats, TranslationEntry } from "@/lib/translations/editor.server";
import { AUTO_TRANSLATE_BATCH } from "@/lib/translations/auto-translate";
import { cn } from "@/lib/utils";

/**
 * Редактор переводов: категории слева, строки ru/en/uz справа. Правки
 * копятся черновиками (в том числе черновики автоперевода) и уходят на
 * сервер по «Сохранить» у строки или «Сохранить всё».
 */

type Filter = "all" | "modified" | "untranslated";
type TargetLocale = Exclude<Locale, "ru">;

const PAGE = 100;
const ALL = "all";
const KNOWN_ERRORS = [
  "forbidden", "bad_request", "unknown_key", "unknown_locale", "too_long", "corrupted",
  "invalid_icu", "argument_mismatch", "rate_limited", "ai_not_configured", "ai_failed",
] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

const draftId = (key: string, locale: Locale) => `${locale}\u0000${key}`;

function splitDraftId(id: string): { locale: Locale; key: string } {
  const [locale, key] = id.split("\u0000");
  return { locale: locale as Locale, key };
}

export function TranslationEditor({ initialCategories }: { initialCategories: CategoryStats[] }) {
  const t = useTranslations("translationEditor");
  const [categories, setCategories] = useState(initialCategories);
  const [category, setCategory] = useState<string>(initialCategories[0]?.id ?? ALL);
  const [otherQuery, setOtherQuery] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [entries, setEntries] = useState<TranslationEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [autoProgress, setAutoProgress] = useState<{ done: number; total: number } | null>(null);
  const [autoRow, setAutoRow] = useState<string | null>(null);
  const request = useRef(0);

  const errorText = useCallback(
    (body: { error?: string; expected?: string[] } | null) => {
      const code = body?.error;
      if (code === "argument_mismatch") return t("errors.argument_mismatch", { expected: (body?.expected ?? []).map((name) => `{${name}}`).join(", ") || "—" });
      if (code && (KNOWN_ERRORS as readonly string[]).includes(code)) return t(`errors.${code as Exclude<KnownError, "argument_mismatch">}`);
      return t("errors.generic");
    },
    [t],
  );

  const load = useCallback(
    async (offset: number) => {
      const id = ++request.current;
      setLoading(true);
      const params = new URLSearchParams({ filter, offset: String(offset), limit: String(PAGE) });
      if (category !== ALL) params.set("category", category);
      if (query.trim()) params.set("q", query.trim());
      try {
        const response = await fetch(`/api/translations?${params}`, { cache: "no-store" });
        const body = await response.json().catch(() => null);
        if (id !== request.current) return;
        if (!response.ok) {
          toast.error(errorText(body));
          return;
        }
        setTotal(body.total);
        setEntries((previous) => (offset === 0 ? body.entries : [...previous, ...body.entries]));
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [category, filter, query, errorText],
  );

  // Поиск — с паузой, переключение категории и фильтра — сразу.
  useEffect(() => {
    const timer = setTimeout(() => void load(0), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const refreshCategories = useCallback(async () => {
    const response = await fetch("/api/translations/categories", { cache: "no-store" });
    if (response.ok) setCategories((await response.json()).categories);
  }, []);

  const applyEntry = useCallback((entry: TranslationEntry) => {
    setEntries((previous) => previous.map((item) => (item.key === entry.key ? entry : item)));
  }, []);

  const setDraft = (key: string, locale: Locale, value: string | null) => {
    setDrafts((previous) => {
      const next = { ...previous };
      if (value === null) delete next[draftId(key, locale)];
      else next[draftId(key, locale)] = value;
      return next;
    });
  };

  /** Одна строка одного языка; `null` — вернуть файл. */
  const persist = useCallback(
    async (key: string, locale: Locale, value: string | null): Promise<boolean> => {
      const id = draftId(key, locale);
      setSaving((previous) => new Set(previous).add(id));
      try {
        const response = await fetch("/api/translations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, locale, value }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          toast.error(`${key} (${locale}): ${errorText(body)}`);
          return false;
        }
        applyEntry(body.entry);
        // Пока шёл запрос, строку могли править дальше — такой черновик не трогаем.
        setDrafts((previous) => {
          if (value !== null && previous[id] !== value) return previous;
          const next = { ...previous };
          delete next[id];
          return next;
        });
        return true;
      } finally {
        setSaving((previous) => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        });
      }
    },
    [applyEntry, errorText],
  );

  const saveOne = async (key: string, locale: Locale) => {
    const value = drafts[draftId(key, locale)];
    if (value === undefined) return;
    if (await persist(key, locale, value)) {
      toast.success(t("toasts.saved"));
      void refreshCategories();
    }
  };

  const resetOne = async (key: string, locale: Locale) => {
    if (await persist(key, locale, null)) {
      toast.success(t("toasts.reset"));
      void refreshCategories();
    }
  };

  const draftIds = Object.keys(drafts);
  const saveAll = async () => {
    let saved = 0;
    for (const id of draftIds) {
      const { key, locale } = splitDraftId(id);
      if (await persist(key, locale, drafts[id])) saved++;
    }
    if (saved) toast.success(t("toasts.savedMany", { count: String(saved) }));
    void refreshCategories();
  };

  const requestAuto = useCallback(
    async (locale: TargetLocale, keys: string[]): Promise<{ translations: Record<string, string>; rejected: string[] } | null> => {
      const response = await fetch("/api/translations/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale, keys }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(errorText(body));
        return null;
      }
      return body;
    },
    [errorText],
  );

  const applyAuto = (locale: TargetLocale, translations: Record<string, string>) => {
    setDrafts((previous) => {
      const next = { ...previous };
      // Черновик, который человек уже правит, автоперевод не затирает.
      for (const [key, value] of Object.entries(translations)) next[draftId(key, locale)] ??= value;
      return next;
    });
  };

  const autoOne = async (key: string, locale: TargetLocale) => {
    setAutoRow(draftId(key, locale));
    try {
      const result = await requestAuto(locale, [key]);
      if (!result) return;
      applyAuto(locale, result.translations);
      if (result.rejected.length) toast.error(t("toasts.autoRejected", { count: String(result.rejected.length) }));
    } finally {
      setAutoRow(null);
    }
  };

  // Пачкой — только видимые строки без перевода и без черновика.
  const autoCandidates = useMemo(() => {
    const result = {} as Record<TargetLocale, string[]>;
    for (const locale of ["en", "uz"] as const) {
      result[locale] = entries
        .filter((entry) => entry.untranslated.includes(locale) && drafts[draftId(entry.key, locale)] === undefined)
        .map((entry) => entry.key);
    }
    return result;
  }, [entries, drafts]);

  const autoBatch = async (locale: TargetLocale) => {
    const keys = autoCandidates[locale];
    if (!keys.length) return;
    let done = 0;
    let translated = 0;
    let rejected = 0;
    setAutoProgress({ done, total: keys.length });
    try {
      for (let index = 0; index < keys.length; index += AUTO_TRANSLATE_BATCH) {
        const chunk = keys.slice(index, index + AUTO_TRANSLATE_BATCH);
        const result = await requestAuto(locale, chunk);
        if (!result) break;
        applyAuto(locale, result.translations);
        translated += Object.keys(result.translations).length;
        rejected += result.rejected.length;
        done += chunk.length;
        setAutoProgress({ done, total: keys.length });
      }
    } finally {
      setAutoProgress(null);
    }
    if (translated) toast.success(t("toasts.autoDone", { count: String(translated) }));
    if (rejected) toast.error(t("toasts.autoRejected", { count: String(rejected) }));
  };

  const groups = useMemo(() => {
    const needle = otherQuery.trim().toLowerCase();
    return (["journals", "interface", "other"] as const).map((group) => ({
      group,
      items: categories.filter((item) => item.group === group && (group !== "other" || !needle || (item.namespace ?? "").toLowerCase().includes(needle))),
    }));
  }, [categories, otherQuery]);

  const categoryTitle = (item: CategoryStats) =>
    item.group === "other" ? item.namespace ?? item.id : t(`categories.${item.id as "journal-hygiene" | "navigation" | "common"}`);

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]" data-testid="translation-editor">
      <aside className="space-y-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
        <CategoryButton
          active={category === ALL}
          title={t("categories.all")}
          onClick={() => setCategory(ALL)}
          testId="translation-category-all"
        />
        {groups.map(({ group, items }) => (
          <div key={group} className="space-y-1.5">
            <div className="px-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t(`groups.${group}`)}</div>
            {group === "other" ? (
              <Input
                value={otherQuery}
                onChange={(event) => setOtherQuery(event.target.value)}
                placeholder={t("otherFilter")}
                className="h-9 rounded-xl border-[#ececf4] bg-white text-[13px]"
              />
            ) : null}
            {items.map((item) => (
              <CategoryButton
                key={item.id}
                active={category === item.id}
                title={categoryTitle(item)}
                mono={item.group === "other"}
                onClick={() => setCategory(item.id)}
                testId={`translation-category-${item.id}`}
                meta={
                  <>
                    <span>{t("categoryTotal", { total: item.total })}</span>
                    {item.modified ? <span className="text-[#3848c7]">{t("badges.modified", { count: String(item.modified) })}</span> : null}
                    {item.untranslated ? <span className="text-[#b25f00]">{t("badges.untranslated", { count: String(item.untranslated) })}</span> : null}
                  </>
                }
              />
            ))}
          </div>
        ))}
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="space-y-3 rounded-3xl border border-[#ececf4] bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("searchPlaceholder")}
                className="h-10 rounded-xl border-[#ececf4] pl-9"
                data-testid="translation-search"
              />
            </div>
            <div className="flex rounded-xl bg-[#f4f5fb] p-1">
              {(["all", "modified", "untranslated"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setFilter(item)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                    filter === item ? "bg-white text-[#0b1024] shadow-sm" : "text-[#6f7282] hover:text-[#0b1024]",
                  )}
                >
                  {t(`filters.${item}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(["en", "uz"] as const).map((locale) => (
              <Button
                key={locale}
                variant="outline"
                size="sm"
                disabled={!autoCandidates[locale].length || autoProgress !== null}
                onClick={() => void autoBatch(locale)}
                data-testid={`translation-auto-batch-${locale}`}
              >
                <Sparkles className="size-4" />
                {t("actions.autoBatch", { language: LOCALE_NAMES[locale], count: String(autoCandidates[locale].length) })}
              </Button>
            ))}
            {autoProgress ? (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-[#6f7282]">
                <Loader2 className="size-4 animate-spin" />
                {t("autoBusy", { done: String(autoProgress.done), total: String(autoProgress.total) })}
              </span>
            ) : null}
          </div>
          <p className="text-[12px] text-[#6f7282]">{t("sourceNote")}</p>
        </div>

        {entries.length === 0 && !loading ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-white p-10 text-center text-[14px] text-[#6f7282]">{t("empty")}</div>
        ) : null}

        <div className="space-y-3">
          {entries.map((entry) => (
            <article key={entry.key} className="rounded-3xl border border-[#ececf4] bg-white p-4" data-testid="translation-row" data-key={entry.key}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <code className="break-all text-[12px] text-[#3c4053]">{entry.key}</code>
                {entry.placeholders.length ? (
                  <span className="text-[12px] text-[#9b9fb3]">{t("placeholders", { list: entry.placeholders.map((name) => `{${name}}`).join(", ") })}</span>
                ) : null}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {LOCALES.map((locale) => {
                  const id = draftId(entry.key, locale);
                  const draft = drafts[id];
                  const value = draft ?? entry.values[locale];
                  const overridden = entry.overridden.includes(locale);
                  const untranslated = draft === undefined && entry.untranslated.includes(locale);
                  const busy = saving.has(id) || autoRow === id;
                  return (
                    <div key={locale} className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                        <span className="font-semibold text-[#0b1024]">{LOCALE_NAMES[locale]}</span>
                        {draft !== undefined ? <StateBadge tone="draft">{t("rowState.draft")}</StateBadge> : null}
                        {overridden ? <StateBadge tone="modified">{t("rowState.modified")}</StateBadge> : null}
                        {untranslated ? <StateBadge tone="untranslated">{t("rowState.untranslated")}</StateBadge> : null}
                      </div>
                      <Textarea
                        value={value}
                        rows={Math.min(8, Math.max(2, Math.ceil(value.length / 48)))}
                        onChange={(event) => setDraft(entry.key, locale, event.target.value === entry.values[locale] ? null : event.target.value)}
                        className={cn(
                          "min-h-0 rounded-xl border-[#ececf4] text-[13.5px] leading-snug md:text-[13.5px]",
                          draft !== undefined && "border-[#5566f6]/50 bg-[#f5f6ff]",
                        )}
                        lang={locale}
                        data-testid={`translation-input-${locale}`}
                      />
                      {overridden ? (
                        <p className="line-clamp-2 text-[12px] text-[#9b9fb3]" title={entry.base[locale]}>{t("original", { text: entry.base[locale] })}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-1">
                        {draft !== undefined ? (
                          <Button size="xs" disabled={busy} onClick={() => void saveOne(entry.key, locale)} data-testid={`translation-save-${locale}`}>
                            {saving.has(id) ? <Loader2 className="animate-spin" /> : <Save />}
                            {t("actions.save")}
                          </Button>
                        ) : null}
                        {locale !== "ru" ? (
                          <Button size="xs" variant="outline" disabled={busy || autoProgress !== null} onClick={() => void autoOne(entry.key, locale)}>
                            {autoRow === id ? <Loader2 className="animate-spin" /> : <Languages />}
                            {t("actions.auto")}
                          </Button>
                        ) : null}
                        {overridden && draft === undefined ? (
                          <Button size="xs" variant="ghost" disabled={busy} onClick={() => void resetOne(entry.key, locale)} data-testid={`translation-reset-${locale}`}>
                            <RotateCcw />
                            {t("actions.reset")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-[#6f7282]">
          <span>{loading ? t("loading") : t("shown", { shown: String(entries.length), total: String(total) })}</span>
          {entries.length < total ? (
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(entries.length)}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("actions.loadMore")}
            </Button>
          ) : null}
        </div>

        {/* Несохранённые правки живут и в других категориях — кнопка всегда под рукой. */}
        {draftIds.length ? (
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-[#5566f6]/30 bg-white/95 p-3 shadow-[0_8px_24px_rgba(11,16,36,0.12)] backdrop-blur">
            <Button variant="ghost" size="sm" disabled={saving.size > 0} onClick={() => setDrafts({})}>
              <X className="size-4" />
              {t("actions.discard")}
            </Button>
            <Button size="sm" disabled={saving.size > 0} onClick={() => void saveAll()} data-testid="translation-save-all">
              {saving.size > 0 ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t("actions.saveAll", { count: String(draftIds.length) })}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function CategoryButton({ active, title, meta, mono, onClick, testId }: { active: boolean; title: string; meta?: React.ReactNode; mono?: boolean; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-current={active ? "true" : undefined}
      className={cn(
        "w-full rounded-2xl border px-3 py-2.5 text-left transition-colors",
        active ? "border-[#5566f6]/40 bg-[#f5f6ff]" : "border-[#ececf4] bg-white hover:bg-[#fafbff]",
      )}
    >
      <div className={cn("truncate text-[14px] font-medium text-[#0b1024]", mono && "font-mono text-[13px]")}>{title}</div>
      {meta ? <div className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] text-[#6f7282]">{meta}</div> : null}
    </button>
  );
}

function StateBadge({ tone, children }: { tone: "draft" | "modified" | "untranslated"; children: React.ReactNode }) {
  const tones = {
    draft: "bg-[#eef0ff] text-[#3848c7]",
    modified: "bg-[#ecfdf5] text-[#116b2a]",
    untranslated: "bg-[#fff8eb] text-[#b25f00]",
  };
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", tones[tone])}>{children}</span>;
}
