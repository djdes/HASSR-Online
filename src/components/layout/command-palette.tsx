"use client";
import { switchKeyboardLayout } from "@/lib/journal-search";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowDownToLine,
  Boxes,
  ChevronRight,
  ClipboardList,
  CornerDownLeft,
  DoorOpen,
  FileSpreadsheet,
  Loader2,
  Package,
  Search,
  Sparkles,
  User,
  Wand2,
  XCircle,
} from "lucide-react";
import { openSanpinChat } from "@/lib/sanpin-chat-bus";
import { toast } from "sonner";
import { useAppNav } from "@/components/layout/app-nav-context";
import { navIcon } from "@/components/layout/nav-icons";
import { navTone, type NavTone } from "@/lib/nav-tones";
import { useAutomationOn } from "@/components/journals/journal-controls-provider";

/**
 * J5+ — ⌘K / Ctrl+K command palette.
 *
 * Два режима:
 *   - query пуст: показывает быстрые действия + статичный список
 *     основных разделов dashboard.
 *   - query ≥ 2 символов: live-fetch /api/search?q=…, вставляет
 *     результаты в группах «Сотрудники / Журналы / Документы /
 *     Оборудование» прямо под статичными action-ами. Debounce 200ms.
 *
 * Quick actions (⚡) выполняются прямо внутри палитры — например,
 * «Закрыть день одним кликом» дёргает /api/dashboard/close-day и
 * показывает toast. После выполнения палитра закрывается.
 */

type StaticItem = {
  kind: "route" | "action";
  label: string;
  hint?: string;
  href?: string;
  /// Если задано — вместо router.push выполняется action (для quick
  /// actions типа «Закрыть день»). Возвращает Promise<boolean>; true =
  /// успех, palette закроется.
  action?: () => Promise<boolean>;
  keywords?: string[];
  icon: typeof Search;
  /** Цвет плашки — тон иконки пункта меню (`lib/nav-tones.ts`). */
  tone: NavTone;
};

type Hit = {
  kind: "user" | "template" | "document" | "equipment" | "area" | "product";
  label: string;
  hint?: string;
  href: string;
};

type FlatItem =
  | (StaticItem & { source: "static"; group?: string })
  | (Hit & { source: "live"; group?: string });

type FilterKey = "all" | "sections" | Hit["kind"];
const FILTER_KINDS = ["user", "template", "document", "equipment", "area", "product"] as const;

// Разделы для поиска — из меню кабинета (`lib/app-nav.ts`): ровно то,
// что человек откроет, со своими названиями организации. Раньше здесь
// был свой список на 17 адресов без проверки прав.
const KIND_ICON = {
  user: User,
  template: ClipboardList,
  document: FileSpreadsheet,
  equipment: Boxes,
  area: DoorOpen,
  product: Package,
} as const;


function matchesText(item: StaticItem, lq: string): boolean {
  if (item.label.toLowerCase().includes(lq)) return true;
  if (item.href && item.href.toLowerCase().includes(lq)) return true;
  if (item.hint && item.hint.toLowerCase().includes(lq)) return true;
  if (item.keywords?.some((k) => k.toLowerCase().includes(lq))) return true;
  return false;
}

/** Как набрано, а если не нашлось — в другой раскладке («ystcnbnm» → «настройки»…). */
function fuzzyMatch(item: StaticItem, q: string): boolean {
  const lq = q.toLowerCase();
  return matchesText(item, lq) || matchesText(item, switchKeyboardLayout(lq));
}

const OPEN_EVENT = "wesetup:open-command-palette";

/** Открыть поиск по кабинету (кнопка в шапке). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function CommandPalette() {
  const t = useTranslations("layoutUi.commandPalette");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [actionRunning, setActionRunning] = useState<number | null>(null);
  // Фильтр по виду результата: всё, разделы и действия, или один вид данных.
  const [filter, setFilter] = useState<FilterKey>("all");
  // Где стоит поле поиска в шапке: панель открывается прямо под ним.
  const [anchor, setAnchor] = useState<{ top: number; right: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);
  const nav = useAppNav();
  const routeItems = useMemo<StaticItem[]>(() => {
    // У раздела с меню вкладки раздела не рисуются — его страницы ищутся
    // по пунктам меню («Сотрудники · Доступ и права»), без дублей.
    const tabItems = nav.sections.flatMap((section) =>
      (section.menu ? [] : section.tabs).map((tab) => ({
        kind: "route" as const,
        label: section.tabs.length > 1 ? `${section.label} · ${tab.label}` : section.label,
        href: tab.href,
        icon: navIcon(section.icon),
        tone: navTone(section.icon),
        keywords: [section.label, tab.label],
      })),
    );
    // Меню раздела: пункты («Производственный контроль · Приказы») и вкладки
    // пунктов («Нормативные документы · СанПиН»).
    const itemItems = nav.sections.flatMap((section) =>
      (section.menu ?? []).flatMap((group) =>
        group.items.flatMap((item) => [
          {
            kind: "route" as const,
            label: `${section.label} · ${item.label}`,
            href: item.href,
            icon: navIcon(item.icon),
            tone: navTone(item.icon),
            keywords: [section.label, item.label, ...(item.tabs ?? []).map((tab) => tab.label)],
          },
          ...(item.tabs ?? []).map((tab) => ({
            kind: "route" as const,
            label: `${item.label} · ${tab.label}`,
            href: tab.href,
            icon: navIcon(item.icon),
            tone: navTone(item.icon),
            keywords: [section.label, item.label, tab.label],
          })),
        ]),
      ),
    );
    // Карточки настроек («Отчёты», «Нарушения», «Аудит» и т.п.) — без дублей по адресу.
    const seen = new Set([...tabItems, ...itemItems].map((item) => item.href));
    // Адрес пункта и его первой вкладки (и корня раздела) совпадает — одна строка.
    const sectionItems: StaticItem[] = [];
    const listed = new Set<string>();
    for (const entry of [...tabItems, ...itemItems]) {
      if (listed.has(entry.href)) continue;
      listed.add(entry.href);
      sectionItems.push(entry);
    }
    const cardItems: StaticItem[] = [];
    for (const card of nav.search ?? []) {
      if (seen.has(card.href)) continue;
      seen.add(card.href);
      cardItems.push({
        kind: "route",
        label: card.sectionLabel ? `${card.sectionLabel} · ${card.label}` : card.label,
        href: card.href,
        icon: navIcon(card.icon),
        tone: navTone(card.icon),
        keywords: [card.label, card.sectionLabel],
      });
    }
    return [...sectionItems, ...cardItems];
  }, [nav]);
  // «Закрыть день» и «Догнать пропуски» — у кого есть «Сегодня».
  // «Закрыть день» — это «Автозаполнить» на главной, «Догнать пропуски» —
  // своя галочка: обе по спецрежиму.
  const closeDayAllowed = useAutomationOn("closeDayAutofill");
  const catchUpAllowed = useAutomationOn("catchUp");
  const actionItems = useMemo<StaticItem[]>(() => {
    if (!nav.sections.some((section) => section.tabs.some((tab) => tab.href === "/dashboard"))) return [];
    return [
      ...(closeDayAllowed ? [{
        kind: "action",
        label: t("closeDayLabel"),
        hint: t("closeDayHint"),
        icon: ArrowDownToLine,
        tone: navTone("ArrowDownToLine"),
        keywords: t("closeDayKeywords").split(","),
        action: async () => {
          try {
            const res = await fetch("/api/dashboard/close-day", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            });
            const j = await res.json().catch(() => null);
            if (!res.ok)
              throw new Error(j?.error || t("closeDayFailed"));
            const copied = j?.totalCopied ?? 0;
            if (copied > 0) {
              toast.success(t("copiedCount", { count: copied }));
            } else {
              toast.info(t("nothingToCopy"));
            }
            return true;
          } catch (e) {
            toast.error(e instanceof Error ? e.message : t("error"));
            return false;
          }
        },
      } satisfies StaticItem] : []),
      ...(catchUpAllowed ? [{
        kind: "route",
        label: t("catchUpLabel"),
        hint: t("catchUpHint"),
        icon: Wand2,
        tone: navTone("Wand2"),
        href: "/dashboard/catch-up",
        keywords: t("catchUpKeywords").split(","),
      } satisfies StaticItem] : []),
    ];
  }, [nav, t, closeDayAllowed, catchUpAllowed]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    // Кнопка поиска в шапке открывает палитру событием (`openCommandPalette`).
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setHits([]);
      setFilter("all");
      const field = document.querySelector<HTMLElement>("[data-header-search]");
      const rect = field && field.offsetParent !== null ? field.getBoundingClientRect() : null;
      setAnchor(
        rect && window.innerWidth >= 640
          ? { top: rect.top, right: window.innerWidth - rect.right, width: rect.width }
          : null,
      );
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced live search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    const myReq = ++reqIdRef.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q)}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error("fetch_failed");
        const j = (await res.json()) as { hits: Hit[] };
        if (reqIdRef.current === myReq) {
          setHits(j.hits || []);
          setActiveIdx(0);
        }
      } catch {
        if (reqIdRef.current === myReq) setHits([]);
      } finally {
        if (reqIdRef.current === myReq) setSearching(false);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const kindLabel = useMemo(
    () => ({
      user: t("kindUser"),
      template: t("kindTemplate"),
      document: t("kindDocument"),
      equipment: t("kindEquipment"),
      area: t("kindArea"),
      product: t("kindProduct"),
    }),
    [t]
  );

  // Build flat list with section dividers — easier for keyboard nav.
  const sections = useMemo(() => {
    const q = query.trim();
    const filteredActions =
      q.length === 0
        ? actionItems
        : actionItems.filter((a) => fuzzyMatch(a, q));
    const filteredRoutes =
      q.length === 0
        ? routeItems.slice(0, 8)
        : routeItems.filter((r) => fuzzyMatch(r, q)).slice(0, 8);

    const liveByKind = new Map<Hit["kind"], Hit[]>();
    for (const h of hits) {
      const arr = liveByKind.get(h.kind) ?? [];
      arr.push(h);
      liveByKind.set(h.kind, arr);
    }

    const blocks: { title: string; items: FlatItem[] }[] = [];
    if (filteredActions.length > 0) {
      blocks.push({
        title: t("groupActions"),
        items: filteredActions.map((a) => ({ ...a, source: "static" as const })),
      });
    }
    if (filteredRoutes.length > 0) {
      blocks.push({
        title: t("groupSections"),
        items: filteredRoutes.map((r) => ({ ...r, source: "static" as const })),
      });
    }
    for (const kind of ["user", "template", "document", "equipment", "area", "product"] as const) {
      const arr = liveByKind.get(kind);
      if (!arr || arr.length === 0) continue;
      blocks.push({
        title: kindLabel[kind],
        items: arr.map((h) => ({ ...h, source: "live" as const })),
      });
    }
    return blocks
      .filter((block) => {
        if (filter === "all") return true;
        if (filter === "sections") return block.title === t("groupActions") || block.title === t("groupSections");
        return block.title === kindLabel[filter];
      })
      .map((block) => ({ ...block, items: block.items.map((item) => ({ ...item, group: block.title })) }));
  }, [query, hits, routeItems, actionItems, kindLabel, t, filter]);

  const flatItems = useMemo<FlatItem[]>(() => {
    return sections.flatMap((s) => s.items);
  }, [sections]);

  function pick(idx: number) {
    const item = flatItems[idx];
    if (!item) return;
    if (item.source === "static" && item.kind === "action" && item.action) {
      setActionRunning(idx);
      void item.action().then((ok) => {
        setActionRunning(null);
        if (ok) setOpen(false);
      });
      return;
    }
    if ("href" in item && item.href) {
      setOpen(false);
      router.push(item.href);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(flatItems.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(activeIdx);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
      e.preventDefault();
      askAssistant();
    }
  }

  function askAssistant() {
    const q = query.trim();
    if (q.length < 2) return;
    setOpen(false);
    openSanpinChat(q);
  }

  if (!open) return null;

  const q = query.trim();
  // Панель под полем в шапке (компьютер) или сверху во всю ширину (телефон).
  const panelStyle = anchor
    ? {
        top: anchor.top,
        right: anchor.right,
        width: Math.min(Math.max(anchor.width, 620), window.innerWidth - 32),
      }
    : undefined;
  let runningIdx = -1;
  return (
    <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)}>
      <BodyScrollLock />
      <div
        role="dialog"
        aria-label={t("field")}
        style={panelStyle}
        className={`absolute flex max-h-[min(78vh,760px)] flex-col ${
          anchor ? "" : "inset-x-3 top-3"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Поле — на месте поля в шапке, с рамкой фокуса. */}
        <div className="flex h-12 shrink-0 items-center gap-2.5 rounded-[12px] border-2 border-[#111114] bg-white px-3 shadow-[0_0_0_4px_rgba(17,17,20,0.08)]">
          {q.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label={t("clear")}
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-[#5f6170] hover:bg-[#f1f1f4] hover:text-[#111114]"
            >
              <XCircle className="size-[18px] stroke-[1.75]" aria-hidden />
            </button>
          ) : searching ? (
            <Loader2 className="size-[18px] shrink-0 animate-spin text-[#5f6170]" />
          ) : (
            <Search className="size-[18px] shrink-0 text-[#5f6170]" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("placeholder")}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-[#111114] placeholder:text-[#9a9ca8] focus:outline-none"
          />
          {q.length >= 2 && !searching ? (
            <span className="shrink-0 text-[14px] text-[#6a6c7a]">{t("results", { count: flatItems.length })}</span>
          ) : null}
        </div>

        {/* Результаты */}
        <div className="mt-2 flex min-h-0 flex-col overflow-hidden rounded-[16px] border border-[#e7e7ec] bg-white shadow-[0_24px_60px_-20px_rgba(17,17,20,0.35)]">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {flatItems.length === 0 ? (
              <div className="px-3 py-8 text-center text-[14px] text-[#6a6c7a]">
                {q.length < 2 ? t("startTyping") : searching ? t("searching") : t("nothingFound")}
              </div>
            ) : (
              <ul className="space-y-0.5">
                {flatItems.map((item) => {
                  runningIdx += 1;
                  const i = runningIdx;
                  const isRunning = actionRunning === i;
                  const icon = isRunning
                    ? Loader2
                    : item.source === "static"
                      ? item.icon
                      : KIND_ICON[item.kind];
                  const isActive = i === activeIdx;
                  return (
                    <li
                      key={`${item.group}-${i}`}
                      onClick={() => pick(i)}
                      onMouseEnter={() => setActiveIdx(i)}
                      data-active={isActive ? "" : undefined}
                      className={`flex cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2.5 ${
                        isActive ? "bg-[#f1f1f4]" : ""
                      }`}
                    >
                      {createElement(icon, {
                        className: `size-5 shrink-0 self-center stroke-[1.6] text-[#5f6170] ${isRunning ? "animate-spin" : ""}`,
                        "aria-hidden": true,
                      })}
                      <div className="min-w-0 flex-1">
                        {item.group ? (
                          <div className="flex items-center gap-1.5 truncate text-[12.5px] text-[#6a6c7a]">
                            {item.group}
                          </div>
                        ) : null}
                        <div className="truncate text-[16px] font-medium leading-snug text-[#111114]">{item.label}</div>
                        {item.hint ? (
                          <div className="truncate text-[13.5px] text-[#6a6c7a]">{item.hint}</div>
                        ) : null}
                      </div>
                      {isActive ? (
                        <span
                          aria-hidden
                          className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#111114] text-white"
                        >
                          <CornerDownLeft className="size-4" />
                        </span>
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-[#9a9ca8]" aria-hidden />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {q.length >= 2 ? (
            <button
              type="button"
              onClick={askAssistant}
              className="flex shrink-0 items-center gap-3 border-t border-[#e7e7ec] px-5 py-3 text-left text-[15px] text-[#111114] hover:bg-[#f4f4f6]"
            >
              <Sparkles className="size-5 shrink-0 stroke-[1.6] text-[#5f6170]" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t("askAssistant", { query: q })}</span>
              <span className="flex gap-1">
                <kbd className="rounded-md border border-[#dcdde3] px-1.5 py-0.5 font-mono text-[12px] text-[#5f6170]">Ctrl</kbd>
                <kbd className="rounded-md border border-[#dcdde3] px-1.5 py-0.5 font-mono text-[12px] text-[#5f6170]">I</kbd>
              </span>
              <ChevronRight className="size-4 shrink-0 text-[#9a9ca8]" aria-hidden />
            </button>
          ) : null}

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#e7e7ec] bg-[#fafafb] px-5 py-2.5 text-[14px] text-[#5f6170]">
            <label className="flex items-center gap-2">
              <span>{t("filter")}</span>
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value as FilterKey);
                  setActiveIdx(0);
                  inputRef.current?.focus();
                }}
                className="cursor-pointer rounded-md bg-transparent py-0.5 pr-1 font-medium text-[#111114] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111114]/15"
              >
                <option value="all">{t("filterAll")}</option>
                <option value="sections">{t("groupSections")}</option>
                {FILTER_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kindLabel[kind]}
                  </option>
                ))}
              </select>
            </label>
            <span className="flex items-center gap-2">
              <kbd className="rounded-md border border-[#dcdde3] bg-white px-1.5 py-0.5 text-[12px]">↑</kbd>
              <kbd className="rounded-md border border-[#dcdde3] bg-white px-1.5 py-0.5 text-[12px]">↓</kbd>
              <span>{t("navigate")}</span>
              <kbd className="ml-2 rounded-md border border-[#dcdde3] bg-white px-1.5 py-0.5 text-[12px]">Esc</kbd>
              <span>{t("close")}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
