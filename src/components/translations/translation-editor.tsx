"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, ChevronRight, History, Languages, Layers, Link2, Loader2, RotateCcw, Save, Sparkles, Undo2, X } from "lucide-react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { Textarea } from "@/components/ui/textarea";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/i18n/locales";
import type { CategoryStats, TranslationEntry } from "@/lib/translations/editor.server";
import { AUTO_TRANSLATE_BATCH } from "@/lib/translations/auto-translate";
import { highlightSegments, MAX_SEARCH_LENGTH, normalizeSearchText, pageWindow, searchTokens, TRANSLATION_PAGE_SIZE } from "@/lib/translations/search";
import {
  ALL_SECTIONS,
  parseTranslationView,
  TRANSLATION_FILTERS,
  translationViewSearch,
  type TranslationFilter,
  type TranslationHistoryItem,
  type TranslationView,
} from "@/lib/translations/view";
import { cn } from "@/lib/utils";

/**
 * Редактор переводов. Сверху — поиск по всему каталогу (ключ и тексты
 * ru/en/uz). Ниже — строки выбранного раздела или результаты поиска,
 * страницами по 100. Строка списка — кнопка: окно строки показывает все
 * три языка и даёт их править (на телефоне — лист снизу). Правки копятся
 * черновиками (в том числе черновики автоперевода) и уходят на сервер по
 * «Сохранить» в окне строки или «Сохранить всё».
 *
 * Разделы: на компьютере — колонка слева, на телефоне — лист по кнопке
 * «Раздел»: колонка над строками уводила их на десятки экранов вниз, и
 * нажатие на раздел выглядело так, будто ничего не произошло.
 *
 * Вид живёт в адресе (`?q=&section=&filter=&page=&key=`): ссылкой можно
 * поделиться, «Назад» возвращает прежний раздел и страницу и закрывает
 * окно строки (на телефоне — жестом «назад»).
 */

type Filter = TranslationFilter;
type TargetLocale = Exclude<Locale, "ru">;
type AutoResult = { translations: Record<string, string>; rejected: string[]; skipped?: string[] };

const ALL = ALL_SECTIONS;
/** Лимит автоперевода на сервере — 6 запросов в минуту: токен возвращается за 10 с. */
const AUTO_RETRY_SECONDS = 12;
const AUTO_MAX_WAITS = 6;
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

/** Высота поля под текст: перевод видно целиком без прокрутки поля. */
function textareaRows(value: string): number {
  const lines = value.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 42)), 0);
  return Math.min(10, Math.max(2, lines));
}

export function TranslationEditor({ initialCategories, initialView }: { initialCategories: CategoryStats[]; initialView: TranslationView }) {
  const t = useTranslations("translationEditor");
  const defaultSection = initialCategories[0]?.id ?? ALL;
  const knownSections = useMemo(() => new Set(initialCategories.map((item) => item.id)), [initialCategories]);
  const [categories, setCategories] = useState(initialCategories);
  const [category, setCategory] = useState<string>(initialView.section);
  const [query, setQuery] = useState(initialView.q);
  // Запрос, по которому ищем: поле ввода с паузой 300 мс.
  const [search, setSearch] = useState(initialView.q);
  const [filter, setFilter] = useState<Filter>(initialView.filter);
  const [page, setPage] = useState(initialView.page);
  const [entries, setEntries] = useState<TranslationEntry[]>([]);
  const [total, setTotal] = useState(0);
  // Смещение загруженной страницы: пока грузится новая, счётчик не врёт.
  const [shownOffset, setShownOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());
  // Сколько строк всего раздела (поиска) ждут автоперевода — с сервера.
  const [candidates, setCandidates] = useState<Record<TargetLocale, number>>({ en: 0, uz: 0 });
  const [autoProgress, setAutoProgress] = useState<{ done: number; total: number; waitSeconds: number | null } | null>(null);
  const autoStop = useRef(false);
  const [autoRow, setAutoRow] = useState<string | null>(null);
  // Открытая строка — снимок, а не ключ: окно не закрывается само, если
  // пока оно открыто, пришла другая страница или другие результаты поиска.
  const [opened, setOpened] = useState<TranslationEntry | null>(null);
  // Строка, которую откроем, когда она найдётся: ссылка с `?key=` или «Назад».
  const [pendingKey, setPendingKey] = useState<string | null>(initialView.key);
  // Переход из окна строки на соседнюю страницу: какую строку открыть после загрузки.
  const openAfterLoad = useRef<"first" | "last" | null>(null);
  // Раздел, страница и открытая строка — новая запись истории; поиск и фильтр — замена текущей.
  const historyMode = useRef<"push" | "replace">("replace");
  // Окно открыто кликом (своя запись истории) — закрываем его через «Назад».
  const openedByPush = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  // Ключ открытой строки «сейчас»: после await в обработчиках замыкание уже устарело.
  const openKeyRef = useRef<string | null>(null);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const request = useRef(0);
  const listTop = useRef<HTMLDivElement>(null);

  const searching = search.length > 0;
  const tokens = useMemo(() => searchTokens(search), [search]);
  const pages = Math.max(1, Math.ceil(total / TRANSLATION_PAGE_SIZE));
  const catalogTotal = useMemo(() => categories.reduce((sum, item) => sum + item.total, 0), [categories]);
  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);

  const errorText = useCallback(
    (body: { error?: string; expected?: string[] } | null) => {
      const code = body?.error;
      if (code === "argument_mismatch") return t("errors.argument_mismatch", { expected: (body?.expected ?? []).map((name) => `{${name}}`).join(", ") || "—" });
      if (code && (KNOWN_ERRORS as readonly string[]).includes(code)) return t(`errors.${code as Exclude<KnownError, "argument_mismatch">}`);
      return t("errors.generic");
    },
    [t],
  );

  const categoryTitle = useCallback(
    (item: CategoryStats) =>
      item.group === "other" ? item.namespace ?? item.id : item.title ?? t(`categories.${item.id as "journal-hygiene" | "navigation" | "common"}`),
    [t],
  );

  useEffect(() => {
    // Длиннее лимита API не ищем: вставленный длинный текст ищется по началу.
    const next = query.trim().slice(0, MAX_SEARCH_LENGTH);
    if (next === search) return;
    const timer = setTimeout(() => {
      setSearch(next);
      setPage(0);
    }, next ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query, search]);

  /** Раздел или поиск с фильтром — для страницы строк и для ключей автоперевода. */
  const scopeParams = useCallback(() => {
    const params = new URLSearchParams({ filter });
    // Поиск — по всему каталогу, раздел не учитывается.
    if (search) params.set("q", search);
    else if (category !== ALL) params.set("category", category);
    return params;
  }, [category, filter, search]);

  // Страница целиком заменяет предыдущую: на экране не больше 100 строк.
  useEffect(() => {
    const id = ++request.current;
    setLoading(true);
    const params = scopeParams();
    params.set("offset", String(page * TRANSLATION_PAGE_SIZE));
    params.set("limit", String(TRANSLATION_PAGE_SIZE));
    void (async () => {
      try {
        const response = await fetch(`/api/translations?${params}`, { cache: "no-store" });
        const body = await response.json().catch(() => null);
        if (id !== request.current) return;
        if (!response.ok) {
          // Старые строки под новым запросом вводили бы в заблуждение.
          setEntries([]);
          setTotal(0);
          setShownOffset(0);
          toast.error(errorText(body));
          return;
        }
        // Строк стало меньше (сохранили с фильтром) — на последнюю живую страницу.
        if (!body.entries.length && body.total > 0 && page > 0) {
          setPage(Math.ceil(body.total / TRANSLATION_PAGE_SIZE) - 1);
          return;
        }
        setTotal(body.total);
        setShownOffset(body.offset);
        setEntries(body.entries);
        setCandidates(body.candidates ?? { en: 0, uz: 0 });
        const next = openAfterLoad.current;
        if (next && body.entries.length) {
          openAfterLoad.current = null;
          setOpened(next === "first" ? body.entries[0] : body.entries[body.entries.length - 1]);
        }
      } catch {
        if (id === request.current) toast.error(t("errors.generic"));
      } finally {
        if (id === request.current) setLoading(false);
      }
    })();
  }, [scopeParams, page, errorText, t]);

  // Строка по ссылке: ищем на загруженной странице, иначе спрашиваем сервер.
  useEffect(() => {
    if (!pendingKey || loading) return;
    const found = entries.find((entry) => entry.key === pendingKey);
    if (found) {
      setOpened(found);
      setPendingKey(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/translations?key=${encodeURIComponent(pendingKey)}`, { cache: "no-store" }).catch(() => null);
      const body = await response?.json().catch(() => null);
      if (cancelled) return;
      if (response?.ok && body?.entry) setOpened(body.entry);
      else toast.error(errorText(body));
      setPendingKey(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingKey, loading, entries, errorText]);

  // Вид → адрес. Совпадает — ничего не пишем (так же после «Назад»).
  const viewKey = opened?.key ?? pendingKey;
  useEffect(() => {
    const next = translationViewSearch({ q: search, section: category, filter, page, key: viewKey }, defaultSection);
    const mode = historyMode.current;
    historyMode.current = "replace";
    if (next === window.location.search) return;
    // Next.js подхватывает pushState/replaceState без запроса к серверу.
    const url = `${window.location.pathname}${next}${window.location.hash}`;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, [search, category, filter, page, viewKey, defaultSection]);

  // Адрес → вид: «Назад» и «Вперёд» в браузере.
  useEffect(() => {
    const onPopState = () => {
      const view = parseTranslationView(new URLSearchParams(window.location.search), { known: knownSections, fallback: defaultSection });
      historyMode.current = "replace";
      openedByPush.current = false;
      openAfterLoad.current = null;
      setCategory(view.section);
      setFilter(view.filter);
      setPage(view.page);
      setQuery(view.q);
      setSearch(view.q);
      setSectionsOpen(false);
      setPendingKey(view.key);
      if (!view.key) setOpened(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [knownSections, defaultSection]);

  /**
   * К началу списка, если он ушёл за экран (после пагинации внизу или
   * выбора раздела). Без плавности: плавная прокрутка через 100 строк не
   * успевала доехать, пока подменялась страница.
   */
  const scrollToList = useCallback(() => {
    requestAnimationFrame(() => {
      const node = listTop.current;
      if (!node) return;
      const top = node.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight - 160) node.scrollIntoView({ block: "start" });
    });
  }, []);

  const goToPage = (next: number) => {
    const target = Math.min(Math.max(0, next), pages - 1);
    // Новая запись истории — только если вид меняется: иначе «push» достался бы
    // следующему вводу в поиске.
    if (target !== page) historyMode.current = "push";
    setPage(target);
    setOpened(null);
    scrollToList();
  };

  const selectCategory = (id: string) => {
    if (id !== category || search || page !== 0) historyMode.current = "push";
    setCategory(id);
    setQuery("");
    setSearch("");
    setPage(0);
    setOpened(null);
    setSectionsOpen(false);
    scrollToList();
  };

  const selectFilter = (next: Filter) => {
    setFilter(next);
    setPage(0);
    setOpened(null);
  };

  const openRow = (entry: TranslationEntry) => {
    historyMode.current = "push";
    openedByPush.current = true;
    setOpened(entry);
  };

  // Открыто кликом — «Назад» снимает свою запись истории (и закрывает окно
  // через popstate); открыто по ссылке — просто убираем строку из адреса.
  const closeRow = () => {
    openAfterLoad.current = null;
    if (openedByPush.current) {
      openedByPush.current = false;
      window.history.back();
      return;
    }
    setPendingKey(null);
    setOpened(null);
  };

  const copyRowLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t("toasts.linkCopied"));
    } catch {
      toast.error(t("errors.generic"));
    }
  };

  const refreshCategories = useCallback(async () => {
    const response = await fetch("/api/translations/categories", { cache: "no-store" });
    if (response.ok) setCategories((await response.json()).categories);
  }, []);

  const applyEntry = useCallback((entry: TranslationEntry) => {
    setEntries((previous) => previous.map((item) => (item.key === entry.key ? entry : item)));
    setOpened((previous) => (previous?.key === entry.key ? entry : previous));
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
      } catch {
        toast.error(`${key} (${locale}): ${t("errors.generic")}`);
        return false;
      } finally {
        setSaving((previous) => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        });
      }
    },
    [applyEntry, errorText, t],
  );

  /** Все черновики одной строки (ru/en/uz) — «Сохранить» в окне строки. Нечего сохранять — тоже успех. */
  const saveRow = async (key: string): Promise<boolean> => {
    const locales = LOCALES.filter((locale) => drafts[draftId(key, locale)] !== undefined);
    if (!locales.length) return true;
    let saved = 0;
    for (const locale of locales) if (await persist(key, locale, drafts[draftId(key, locale)])) saved++;
    if (saved === locales.length) toast.success(t("toasts.saved"));
    setHistoryVersion((version) => version + 1);
    void refreshCategories();
    return saved === locales.length;
  };

  const resetOne = async (key: string, locale: Locale) => {
    if (await persist(key, locale, null)) {
      toast.success(t("toasts.reset"));
      setHistoryVersion((version) => version + 1);
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

  /** `"rate_limited"` — сервер просит подождать (пачка ждёт и продолжает сама). */
  const requestAuto = useCallback(
    async (locale: TargetLocale, keys: string[], overwriteManual = false): Promise<AutoResult | "rate_limited" | null> => {
      try {
        const response = await fetch("/api/translations/auto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale, keys, ...(overwriteManual ? { overwriteManual: true } : {}) }),
        });
        const body = await response.json().catch(() => null);
        if (response.status === 429) return "rate_limited";
        if (!response.ok) {
          toast.error(errorText(body));
          return null;
        }
        return body;
      } catch {
        toast.error(t("errors.ai_failed"));
        return null;
      }
    },
    [errorText, t],
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
      // Явный запрос по одной строке: человек сам просит перевести заново.
      const result = await requestAuto(locale, [key], true);
      if (result === "rate_limited") {
        toast.error(t("errors.rate_limited"));
        return;
      }
      if (!result) return;
      applyAuto(locale, result.translations);
      if (result.rejected.length) toast.error(t("toasts.autoRejected", { count: String(result.rejected.length) }));
    } finally {
      setAutoRow(null);
    }
  };

  /**
   * Автоперевод всего раздела (или результатов поиска), а не только этой
   * страницы: ключи берём у сервера, переводим пачками по 30. На лимит
   * сервера ждём и продолжаем; «Остановить» — после текущей пачки.
   * Результат — черновики, строки с ручной правкой не трогаем.
   */
  const autoBatch = async (locale: TargetLocale) => {
    autoStop.current = false;
    setAutoProgress({ done: 0, total: 0, waitSeconds: null });
    let keys: string[];
    try {
      const params = scopeParams();
      params.set("candidates", locale);
      const response = await fetch(`/api/translations?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(errorText(body));
        setAutoProgress(null);
        return;
      }
      keys = (body.keys as string[]).filter((key) => drafts[draftId(key, locale)] === undefined);
    } catch {
      toast.error(t("errors.generic"));
      setAutoProgress(null);
      return;
    }
    let done = 0;
    let translated = 0;
    let rejected = 0;
    let skipped = 0;
    const progress = (waitSeconds: number | null = null) => setAutoProgress({ done, total: keys.length, waitSeconds });
    progress();
    try {
      for (let index = 0; index < keys.length && !autoStop.current; index += AUTO_TRANSLATE_BATCH) {
        const chunk = keys.slice(index, index + AUTO_TRANSLATE_BATCH);
        let result = await requestAuto(locale, chunk);
        for (let wait = 0; result === "rate_limited" && wait < AUTO_MAX_WAITS && !autoStop.current; wait++) {
          for (let left = AUTO_RETRY_SECONDS; left > 0 && !autoStop.current; left--) {
            progress(left);
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          progress();
          if (!autoStop.current) result = await requestAuto(locale, chunk);
        }
        // Остановили во время ожидания лимита — пачка не переведена; остановили во
        // время запроса — пачку, за которую уже заплатили ожиданием, оставляем.
        if (result === "rate_limited") {
          if (!autoStop.current) toast.error(t("errors.rate_limited"));
          break;
        }
        if (!result) break;
        applyAuto(locale, result.translations);
        translated += Object.keys(result.translations).length;
        rejected += result.rejected.length;
        skipped += result.skipped?.length ?? 0;
        done += chunk.length;
        progress();
      }
    } finally {
      setAutoProgress(null);
    }
    if (translated) toast.success(t("toasts.autoDone", { count: String(translated) }));
    if (rejected) toast.error(t("toasts.autoRejected", { count: String(rejected) }));
    if (skipped) toast.info(t("toasts.autoSkipped", { count: String(skipped) }));
    if (autoStop.current) toast.info(t("toasts.autoStopped", { done: String(done), total: String(keys.length) }));
  };

  const openIndex = opened ? entries.findIndex((entry) => entry.key === opened.key) : -1;
  const openEntry = openIndex >= 0 ? entries[openIndex] : opened;
  useEffect(() => {
    openKeyRef.current = opened?.key ?? null;
  }, [opened]);

  /** Соседняя строка; на краю страницы — первая (последняя) строка соседней страницы. */
  const moveRow = (step: 1 | -1) => {
    const target = openIndex >= 0 ? entries[openIndex + step] : undefined;
    if (target) {
      setOpened(target);
      return;
    }
    const nextPage = page + step;
    if (openIndex < 0 || nextPage < 0 || nextPage >= pages) return;
    // Окно остаётся открытым; «Назад» после этого — к списку, а не к прежней странице.
    openedByPush.current = false;
    openAfterLoad.current = step > 0 ? "first" : "last";
    setPage(nextPage);
  };

  // Пока сохранялось, окно могли закрыть или перейти к другой строке — тогда не двигаемся.
  const saveAndNext = async (key: string) => {
    if ((await saveRow(key)) && openKeyRef.current === key) moveRow(1);
  };
  const activeCategory = categoryById.get(category);
  const currentTitle = category === ALL || !activeCategory ? t("categories.all") : categoryTitle(activeCategory);
  const from = shownOffset + 1;

  const categoryList = (prefix: string) => (
    <CategoryList
      categories={categories}
      active={searching ? null : category}
      onSelect={selectCategory}
      title={categoryTitle}
      testIdPrefix={prefix}
    />
  );

  return (
    <div className="space-y-4" data-testid="translation-editor">
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={t("searchPlaceholder")}
        ariaLabel={t("searchPlaceholder")}
        found={searching && !loading ? total : undefined}
        total={catalogTotal}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          {categoryList("translation-category-")}
        </aside>

        <section className="min-w-0 space-y-4">
          {/* Телефон: раздел выбирается в листе снизу. */}
          {!searching ? (
            <button
              type="button"
              onClick={() => setSectionsOpen(true)}
              className="flex w-full items-center gap-3 rounded-2xl border border-[#ececf4] bg-white px-4 py-3 text-left transition-colors hover:bg-[#fafbff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 lg:hidden"
              data-testid="translation-section-picker"
            >
              <Layers className="size-5 shrink-0 text-[#5566f6]" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-[#6f7282]">{t("section")}</span>
                <span className="block truncate text-[15px] font-semibold text-[#0b1024]">{currentTitle}</span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-[#9b9fb3]" />
            </button>
          ) : null}

          <div className="space-y-3 sm:rounded-3xl sm:border sm:border-[#ececf4] sm:bg-white sm:p-4">
            {/* Телефон: четыре фильтра — сеткой 2×2, чтобы подписи не обрезались. */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#eef0f7] p-1 sm:inline-flex sm:bg-[#f4f5fb]" role="radiogroup" aria-label={t("filters.all")}>
              {TRANSLATION_FILTERS.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={filter === item}
                  onClick={() => selectFilter(item)}
                  data-testid={`translation-filter-${item}`}
                  className={cn(
                    "min-w-0 truncate rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors sm:px-3",
                    filter === item ? "bg-white text-[#0b1024] shadow-sm" : "text-[#6f7282] hover:text-[#0b1024]",
                  )}
                >
                  {t(`filters.${item}`)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Телефон: короткие кнопки «EN · 7» под подписью, чтобы строки были в первом экране. */}
              <span className="inline-flex items-center gap-1.5 text-[13px] text-[#6f7282] sm:hidden">
                <Sparkles className="size-4 text-[#5566f6]" />
                {t("actions.auto")}
              </span>
              {(["en", "uz"] as const).map((locale) => {
                const label = t("actions.autoBatch", { language: LOCALE_NAMES[locale], count: String(candidates[locale]) });
                return (
                  <Button
                    key={locale}
                    variant="outline"
                    size="sm"
                    disabled={!candidates[locale] || autoProgress !== null}
                    onClick={() => void autoBatch(locale)}
                    aria-label={label}
                    title={t("autoScope")}
                    data-testid={`translation-auto-batch-${locale}`}
                  >
                    <Sparkles className="size-4 max-sm:hidden" />
                    <span className="sm:hidden">{`${locale.toUpperCase()} · ${candidates[locale]}`}</span>
                    <span className="max-sm:hidden">{label}</span>
                  </Button>
                );
              })}
            </div>
            {autoProgress ? (
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#6f7282]" data-testid="translation-auto-progress">
                <Loader2 className="size-4 shrink-0 animate-spin" />
                <span className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-[#eef0f7]" aria-hidden>
                  <span className="block h-full rounded-full bg-[#5566f6] transition-[width]" style={{ width: `${autoProgress.total ? Math.round((autoProgress.done / autoProgress.total) * 100) : 0}%` }} />
                </span>
                <span role="status">
                  {autoProgress.waitSeconds !== null
                    ? t("autoWaiting", { seconds: String(autoProgress.waitSeconds) })
                    : t("autoBusy", { done: String(autoProgress.done), total: String(autoProgress.total) })}
                </span>
                <Button size="sm" variant="ghost" onClick={() => (autoStop.current = true)} data-testid="translation-auto-stop">
                  <X className="size-4" />
                  {t("actions.stop")}
                </Button>
              </div>
            ) : null}
            <p className="hidden text-[12px] text-[#6f7282] sm:block">{t("sourceNote")} {t("autoScope")}</p>
          </div>

          <div ref={listTop} className="scroll-mt-28 space-y-1">
            <div className="flex min-h-5 items-center gap-2 text-[13px] text-[#6f7282]">
              <span data-testid="translation-range">
                {total ? t("range", { from, to: from + entries.length - 1, total }) : loading ? t("loading") : null}
              </span>
              {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            </div>
            {searching ? <p className="hidden text-[12px] text-[#9b9fb3] sm:block">{t("searchScope")}</p> : null}
          </div>

          {entries.length === 0 && !loading ? (
            <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-white p-10 text-center text-[14px] text-[#6f7282]">{t("empty")}</div>
          ) : null}

          <div className={cn("space-y-2 transition-opacity", loading && entries.length > 0 && "opacity-60")}>
            {entries.map((entry) => (
              <EntryRow
                key={entry.key}
                entry={entry}
                drafts={drafts}
                tokens={tokens}
                categoryLabel={searching || category === ALL ? (categoryById.get(entry.category) ? categoryTitle(categoryById.get(entry.category)!) : null) : null}
                onOpen={() => openRow(entry)}
              />
            ))}
          </div>

          <Pagination page={page} pages={pages} disabled={loading} onChange={goToPage} />

          {/* Несохранённые правки живут и в других разделах — кнопка всегда под рукой. */}
          {draftIds.length ? (
            <div className="sticky bottom-[var(--safe-b)] z-10 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-[#5566f6]/30 bg-white/95 p-3 shadow-[0_8px_24px_rgba(11,16,36,0.12)] backdrop-blur">
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

      <BottomSheet open={sectionsOpen} onClose={() => setSectionsOpen(false)} title={t("sections")} subtitle={currentTitle}>
        <div className="px-1 pb-3">{categoryList("translation-sheet-category-")}</div>
      </BottomSheet>

      <Dialog open={openEntry !== null} onOpenChange={(open) => { if (!open) closeRow(); }}>
        {openEntry ? (
          <DialogContent
            className="flex flex-col gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-[720px]"
            data-testid="translation-row-editor"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                // Как у кнопки: пока строка сохраняется, второй раз не отправляем.
                if (LOCALES.some((locale) => saving.has(draftId(openEntry.key, locale)))) return;
                void saveAndNext(openEntry.key);
              } else if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault();
                moveRow(event.key === "ArrowDown" ? 1 : -1);
              }
            }}
          >
            <DialogHeader className="shrink-0 gap-1 border-b border-[#ececf4] px-5 pb-3 pt-5 pr-16 text-left sm:px-6">
              <DialogTitle className="text-[17px] font-semibold leading-snug text-[#0b1024]">
                {categoryById.get(openEntry.category) ? categoryTitle(categoryById.get(openEntry.category)!) : t("categories.all")}
              </DialogTitle>
              <DialogDescription className="space-y-0.5 text-[12px] text-[#6f7282]">
                <code className="block font-mono text-[12px] text-[#3c4053] [overflow-wrap:anywhere]">{withKeyBreaks(openEntry.key)}</code>
                {openEntry.placeholders.length ? (
                  <span className="block">{t("placeholders", { list: openEntry.placeholders.map((name) => `{${name}}`).join(", ") })}</span>
                ) : null}
              </DialogDescription>
              <Button size="sm" variant="ghost" className="-ml-2 w-fit text-[#5566f6]" onClick={() => void copyRowLink()} data-testid="translation-copy-link">
                <Link2 />
                {t("actions.copyLink")}
              </Button>
            </DialogHeader>

            <div key={openEntry.key} className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
              {LOCALES.map((locale) => {
                const id = draftId(openEntry.key, locale);
                const draft = drafts[id];
                const value = draft ?? openEntry.values[locale];
                const overridden = openEntry.overridden.includes(locale);
                const untranslated = draft === undefined && openEntry.untranslated.includes(locale);
                const busy = saving.has(id) || autoRow === id;
                return (
                  <div key={locale} className="min-w-0 space-y-1.5" data-testid={`translation-field-${locale}`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-[#0b1024]">{LOCALE_NAMES[locale]}</span>
                      {draft !== undefined ? <StateBadge tone="draft">{t("rowState.draft")}</StateBadge> : null}
                      {overridden ? <StateBadge tone="modified">{t("rowState.modified")}</StateBadge> : null}
                      {openEntry.stale.includes(locale) ? <StateBadge tone="stale">{t("rowState.stale")}</StateBadge> : null}
                      {untranslated ? <StateBadge tone="untranslated">{t("rowState.untranslated")}</StateBadge> : null}
                    </div>
                    <Textarea
                      value={value}
                      rows={textareaRows(value)}
                      onChange={(event) => setDraft(openEntry.key, locale, event.target.value === openEntry.values[locale] ? null : event.target.value)}
                      className={cn(
                        "min-h-0 rounded-xl border-[#dcdfed] text-[14px] leading-snug md:text-[14px]",
                        draft !== undefined && "border-[#5566f6]/50 bg-[#f5f6ff]",
                      )}
                      lang={locale}
                      aria-label={LOCALE_NAMES[locale]}
                      data-testid={`translation-input-${locale}`}
                    />
                    {locale === "ru" ? <p className="text-[12px] text-[#9b9fb3]">{t("sourceNote")}</p> : null}
                    {openEntry.stale.includes(locale) ? <p className="text-[12px] text-[#a13a32]">{t("staleHint")}</p> : null}
                    {overridden ? (
                      <p className="text-[12px] text-[#9b9fb3] [overflow-wrap:anywhere]">{t("original", { text: openEntry.base[locale] })}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-1.5">
                      {draft !== undefined ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(openEntry.key, locale, null)} data-testid={`translation-undo-${locale}`}>
                          <Undo2 />
                          {t("actions.undo")}
                        </Button>
                      ) : null}
                      {locale !== "ru" ? (
                        <Button size="sm" variant="outline" disabled={busy || autoProgress !== null} onClick={() => void autoOne(openEntry.key, locale)}>
                          {autoRow === id ? <Loader2 className="animate-spin" /> : <Languages />}
                          {t("actions.auto")}
                        </Button>
                      ) : null}
                      {overridden && draft === undefined ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void resetOne(openEntry.key, locale)} data-testid={`translation-reset-${locale}`}>
                          {saving.has(id) ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                          {t("actions.reset")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              <HistoryPanel
                entryKey={openEntry.key}
                version={historyVersion}
                onRestore={(locale, text) => {
                  setDraft(openEntry.key, locale, text === openEntry.values[locale] ? null : text);
                  toast.info(t("history.restored", { language: LOCALE_NAMES[locale] }));
                }}
              />
            </div>

            <RowEditorFooter
              position={openIndex >= 0 ? shownOffset + openIndex + 1 : null}
              total={total}
              canPrev={openIndex >= 0 && (openIndex > 0 || page > 0)}
              canNext={openIndex >= 0 && (openIndex < entries.length - 1 || page < pages - 1)}
              onMove={moveRow}
              canSave={LOCALES.some((locale) => drafts[draftId(openEntry.key, locale)] !== undefined)}
              saving={LOCALES.some((locale) => saving.has(draftId(openEntry.key, locale)))}
              onSave={() => void saveRow(openEntry.key)}
              onSaveNext={() => void saveAndNext(openEntry.key)}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

/** Ключ переносится по точкам, а не посреди слова («items.toda|y»). */
function withKeyBreaks(text: string) {
  const parts = text.split(".");
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 ? (
        <>
          .<wbr />
        </>
      ) : null}
    </Fragment>
  ));
}

function Highlight({ text, tokens, keyBreaks }: { text: string; tokens: readonly string[]; keyBreaks?: boolean }) {
  const render = (value: string) => (keyBreaks ? withKeyBreaks(value) : value);
  return (
    <>
      {highlightSegments(text, tokens).map((segment, index) =>
        segment.match ? (
          <mark key={index} className="rounded-[3px] bg-[#fff1b8] text-inherit">{render(segment.text)}</mark>
        ) : (
          <Fragment key={index}>{render(segment.text)}</Fragment>
        ),
      )}
    </>
  );
}

/** Строка списка: ключ, состояния и тексты трёх языков. Нажатие открывает окно строки. */
function EntryRow({
  entry,
  drafts,
  tokens,
  categoryLabel,
  onOpen,
}: {
  entry: TranslationEntry;
  drafts: Record<string, string>;
  tokens: readonly string[];
  categoryLabel: string | null;
  onOpen: () => void;
}) {
  const t = useTranslations("translationEditor");
  const draftLocales = LOCALES.filter((locale) => drafts[draftId(entry.key, locale)] !== undefined);
  const untranslated = entry.untranslated.filter((locale) => !draftLocales.includes(locale));
  const codes = (list: readonly Locale[]) => list.map((locale) => locale.toUpperCase()).join(", ");
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="translation-row"
      data-key={entry.key}
      className="block w-full min-w-0 rounded-2xl border border-[#ececf4] bg-white p-3 text-left transition-colors hover:border-[#5566f6]/40 hover:bg-[#fafbff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 sm:p-4"
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <code className="min-w-0 font-mono text-[12px] text-[#6f7282] [overflow-wrap:anywhere]">
          <Highlight text={entry.key} tokens={tokens} keyBreaks />
        </code>
        {categoryLabel ? (
          <span className="max-w-full truncate rounded-full bg-[#f4f5fb] px-2 py-0.5 text-[11px] font-medium text-[#3c4053]">{categoryLabel}</span>
        ) : null}
        {draftLocales.length ? <StateBadge tone="draft">{`${t("rowState.draft")} · ${codes(draftLocales)}`}</StateBadge> : null}
        {entry.overridden.length ? <StateBadge tone="modified">{`${t("rowState.modified")} · ${codes(entry.overridden)}`}</StateBadge> : null}
        {entry.stale.length ? <StateBadge tone="stale">{`${t("rowState.stale")} · ${codes(entry.stale)}`}</StateBadge> : null}
        {untranslated.length ? <StateBadge tone="untranslated">{`${t("rowState.untranslated")} · ${codes(untranslated)}`}</StateBadge> : null}
      </span>
      <span className="mt-2 grid gap-1.5 md:grid-cols-3 md:gap-4">
        {LOCALES.map((locale) => {
          const draft = drafts[draftId(entry.key, locale)];
          const value = draft ?? entry.values[locale];
          return (
            <span key={locale} className="flex min-w-0 items-baseline gap-2 md:flex-col md:gap-0.5">
              <span
                className={cn(
                  "w-6 shrink-0 text-[11px] font-semibold uppercase tracking-wide",
                  draft !== undefined ? "text-[#3848c7]" : untranslated.includes(locale) ? "text-[#b25f00]" : "text-[#9b9fb3]",
                )}
              >
                {locale}
              </span>
              <span className={cn("line-clamp-2 min-w-0 flex-1 text-[13.5px] leading-snug text-[#0b1024] [overflow-wrap:anywhere] md:line-clamp-3", draft !== undefined && "text-[#3848c7]")} lang={locale}>
                {value ? <Highlight text={value} tokens={tokens} /> : <span className="text-[#9b9fb3]">{t("emptyValue")}</span>}
              </span>
            </span>
          );
        })}
      </span>
    </button>
  );
}

function RowEditorFooter({
  position,
  total,
  canPrev,
  canNext,
  onMove,
  canSave,
  saving,
  onSave,
  onSaveNext,
}: {
  /** Номер строки среди всех строк раздела; `null` — строки уже нет на странице (сменился поиск). */
  position: number | null;
  total: number;
  canPrev: boolean;
  canNext: boolean;
  onMove: (step: -1 | 1) => void;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  onSaveNext: () => void;
}) {
  const t = useTranslations("translationEditor");
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[#ececf4] bg-[#fafbff] px-4 pb-[var(--safe-b)] pt-3 sm:px-6 sm:pb-3">
      {position !== null ? (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" disabled={!canPrev} onClick={() => onMove(-1)} aria-label={t("rowEditor.previous")} data-testid="translation-row-prev">
            <ChevronLeft />
          </Button>
          <span className="min-w-0 text-[13px] tabular-nums text-[#6f7282]" data-testid="translation-row-position">
            {t("rowEditor.position", { index: String(position), count: String(total) })}
          </span>
          <Button variant="outline" size="icon-sm" disabled={!canNext} onClick={() => onMove(1)} aria-label={t("rowEditor.next")} data-testid="translation-row-next">
            <ChevronRight />
          </Button>
        </div>
      ) : null}
      {/* Телефон: кнопки — отдельной строкой во всю ширину. */}
      <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
        <Button variant="outline" disabled={!canSave || saving} onClick={onSave} className="flex-1 sm:flex-none" data-testid="translation-save">
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          {t("actions.save")}
        </Button>
        <Button disabled={saving || (!canSave && !canNext)} onClick={onSaveNext} className="flex-1 sm:flex-none" data-testid="translation-save-next">
          {canSave ? t("actions.saveNext") : t("actions.next")}
          <ChevronRight />
        </Button>
      </div>
      <span className="hidden w-full text-right text-[12px] text-[#9b9fb3] lg:block">{t("rowEditor.shortcut")}</span>
    </div>
  );
}

/**
 * История правок строки по всем языкам (AuditLog): кто, когда, было → стало.
 * «Вернуть» ставит выбранный текст черновиком — сохраняет человек.
 */
function HistoryPanel({ entryKey, version, onRestore }: { entryKey: string; version: number; onRestore: (locale: Locale, text: string) => void }) {
  const t = useTranslations("translationEditor");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TranslationHistoryItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  // История рисуется только в браузере (после запроса) — время в поясе того, кто смотрит.
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/translations/history?key=${encodeURIComponent(entryKey)}`, { cache: "no-store" }).catch(() => null);
      const body = await response?.json().catch(() => null);
      if (cancelled) return;
      setFailed(!response?.ok);
      setItems(response?.ok ? body.items : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, entryKey, version]);

  return (
    <div className="border-t border-[#ececf4] pt-3" data-testid="translation-history">
      <Button size="sm" variant="ghost" className="-ml-2" onClick={() => setOpen((value) => !value)} aria-expanded={open} data-testid="translation-history-toggle">
        <History />
        {open ? t("history.hide") : t("history.show")}
        <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
      </Button>
      {open ? (
        items === null ? (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-[#6f7282]">
            <Loader2 className="size-4 animate-spin" />
            {t("loading")}
          </p>
        ) : failed ? (
          <p className="mt-2 text-[13px] text-[#a13a32]">{t("history.error")}</p>
        ) : items.length === 0 ? (
          <p className="mt-2 text-[13px] text-[#9b9fb3]">{t("history.empty")}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {items.map((item) => (
              <li key={item.id} className="min-w-0 rounded-2xl border border-[#ececf4] bg-white p-3" data-testid="translation-history-item">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[#6f7282]">
                  <span className="font-semibold uppercase text-[#3c4053]">{item.locale}</span>
                  <span>{item.userName ?? t("history.unknownUser")}</span>
                  <span>{format.dateTime(new Date(item.createdAt), { dateStyle: "short", timeStyle: "short", timeZone })}</span>
                  {item.action === "reset" ? <span className="text-[#b25f00]">{t("history.reset")}</span> : null}
                </div>
                <p className="mt-1 text-[13.5px] text-[#0b1024] [overflow-wrap:anywhere]">
                  <span className="text-[#9b9fb3]">{t("history.after")}: </span>
                  {item.after}
                </p>
                <p className="mt-0.5 text-[12px] text-[#6f7282] [overflow-wrap:anywhere]">
                  <span className="text-[#9b9fb3]">{t("history.before")}: </span>
                  {item.before}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" onClick={() => onRestore(item.locale, item.after)} data-testid="translation-history-restore">
                    <RotateCcw />
                    {t("history.restore")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onRestore(item.locale, item.before)} data-testid="translation-history-restore-before">
                    <Undo2 />
                    {t("history.restoreBefore")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function Pagination({ page, pages, disabled, onChange }: { page: number; pages: number; disabled: boolean; onChange: (page: number) => void }) {
  const t = useTranslations("translationEditor");
  if (pages <= 1) return null;
  return (
    <nav aria-label={t("pagination.label")} className="flex items-center justify-between gap-2 sm:justify-center" data-testid="translation-pagination">
      <Button variant="outline" size="sm" disabled={disabled || page === 0} onClick={() => onChange(page - 1)} data-testid="translation-page-prev">
        <ChevronLeft className="size-4" />
        {t("pagination.previous")}
      </Button>
      <span className="text-[13.5px] font-medium tabular-nums text-[#3c4053] sm:hidden" data-testid="translation-page-compact">
        {t("pagination.compact", { page: String(page + 1), pages: String(pages) })}
      </span>
      <span className="hidden items-center gap-1 sm:flex">
        {pageWindow(page + 1, pages).map((item, index) =>
          item === "gap" ? (
            <span key={`gap-${index}`} className="px-1 text-[#9b9fb3]">…</span>
          ) : (
            <button
              key={item}
              type="button"
              disabled={disabled}
              aria-current={item === page + 1 ? "page" : undefined}
              aria-label={t("pagination.page", { page: String(item) })}
              onClick={() => onChange(item - 1)}
              data-testid={`translation-page-${item}`}
              className={cn(
                "h-9 min-w-9 rounded-lg px-2 text-[13.5px] font-semibold tabular-nums transition-colors disabled:opacity-60",
                item === page + 1 ? "bg-[#5566f6] text-white" : "text-[#3c4053] hover:bg-[#f5f6ff]",
              )}
            >
              {item}
            </button>
          ),
        )}
      </span>
      <Button variant="outline" size="sm" disabled={disabled || page >= pages - 1} onClick={() => onChange(page + 1)} data-testid="translation-page-next">
        {t("pagination.next")}
        <ChevronRight className="size-4" />
      </Button>
    </nav>
  );
}

/** Список разделов с поиском по названию — колонка на компьютере и лист на телефоне. */
function CategoryList({
  categories,
  active,
  onSelect,
  title,
  testIdPrefix,
}: {
  categories: CategoryStats[];
  active: string | null;
  onSelect: (id: string) => void;
  title: (item: CategoryStats) => string;
  testIdPrefix: string;
}) {
  const t = useTranslations("translationEditor");
  const [needle, setNeedle] = useState("");
  const groups = useMemo(() => {
    const normalized = normalizeSearchText(needle).trim();
    return (["journals", "interface", "other"] as const)
      .map((group) => ({
        group,
        items: categories.filter((item) => item.group === group && (!normalized || normalizeSearchText(title(item)).includes(normalized))),
      }))
      .filter(({ items }) => items.length > 0);
  }, [categories, needle, title]);
  return (
    <div className="space-y-4">
      <Input
        type="search"
        value={needle}
        onChange={(event) => setNeedle(event.target.value)}
        placeholder={t("sectionFilter")}
        aria-label={t("sectionFilter")}
        className="h-10 rounded-xl border-[#ececf4] bg-white text-[13px]"
        data-testid={`${testIdPrefix}filter`}
      />
      {!needle.trim() ? (
        <CategoryButton active={active === ALL} title={t("categories.all")} onClick={() => onSelect(ALL)} testId={`${testIdPrefix}all`} />
      ) : null}
      {groups.map(({ group, items }) => (
        <div key={group} className="space-y-1.5">
          <div className="px-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t(`groups.${group}`)}</div>
          {items.map((item) => (
            <CategoryButton
              key={item.id}
              active={active === item.id}
              title={title(item)}
              mono={item.group === "other"}
              onClick={() => onSelect(item.id)}
              testId={`${testIdPrefix}${item.id}`}
              meta={
                <>
                  <span>{t("categoryTotal", { total: item.total })}</span>
                  {item.modified ? <span className="text-[#3848c7]">{t("badges.modified", { count: String(item.modified) })}</span> : null}
                  {item.stale ? <span className="text-[#a13a32]">{t("badges.stale", { count: String(item.stale) })}</span> : null}
                  {item.untranslated ? <span className="text-[#b25f00]">{t("badges.untranslated", { count: String(item.untranslated) })}</span> : null}
                </>
              }
            />
          ))}
        </div>
      ))}
      {!groups.length ? <p className="px-1 text-[13px] text-[#9b9fb3]">{t("sectionEmpty")}</p> : null}
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
        "w-full min-w-0 rounded-2xl border px-3 py-2.5 text-left transition-colors",
        active ? "border-[#5566f6]/40 bg-[#f5f6ff]" : "border-[#ececf4] bg-white hover:bg-[#fafbff]",
      )}
    >
      <div className={cn("truncate text-[14px] font-medium text-[#0b1024]", mono && "font-mono text-[13px]")}>{title}</div>
      {meta ? <div className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] text-[#6f7282]">{meta}</div> : null}
    </button>
  );
}

function StateBadge({ tone, children }: { tone: "draft" | "modified" | "stale" | "untranslated"; children: React.ReactNode }) {
  const tones = {
    draft: "bg-[#eef0ff] text-[#3848c7]",
    modified: "bg-[#ecfdf5] text-[#116b2a]",
    stale: "bg-[#fff4f2] text-[#a13a32]",
    untranslated: "bg-[#fff8eb] text-[#b25f00]",
  };
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", tones[tone])}>{children}</span>;
}
