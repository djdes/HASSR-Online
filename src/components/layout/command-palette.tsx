"use client";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowRight,
  Boxes,
  ClipboardList,
  FileSpreadsheet,
  Loader2,
  Search,
  User,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { useAppNav } from "@/components/layout/app-nav-context";
import { navIcon } from "@/components/layout/nav-icons";

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
};

type Hit = {
  kind: "user" | "template" | "document" | "equipment";
  label: string;
  hint?: string;
  href: string;
};

type FlatItem =
  | (StaticItem & { source: "static" })
  | (Hit & { source: "live" });

const ACTION_ITEMS: StaticItem[] = [
  {
    kind: "action",
    label: "Закрыть день",
    hint: "Скопировать вчера → сегодня для всех ежедневных журналов",
    icon: ArrowDownToLine,
    keywords: ["закрыть", "копировать", "вчера", "сегодня", "close day"],
    action: async () => {
      try {
        const res = await fetch("/api/dashboard/close-day", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok)
          throw new Error(j?.error || "Не удалось закрыть день");
        const copied = j?.totalCopied ?? 0;
        if (copied > 0) {
          toast.success(`Скопировано ${copied} записей`);
        } else {
          toast.info("Нечего копировать или всё уже заполнено.");
        }
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Ошибка");
        return false;
      }
    },
  },
  {
    kind: "route",
    label: "Догнать пропуски",
    hint: "Сетка 14 дней × все журналы",
    icon: Wand2,
    href: "/dashboard/catch-up",
    keywords: ["догнать", "пропуски", "сетка", "catch up"],
  },
];

// Разделы для поиска — из меню кабинета (`lib/app-nav.ts`): ровно то,
// что человек откроет, со своими названиями организации. Раньше здесь
// был свой список на 17 адресов без проверки прав.
const KIND_ICON = {
  user: User,
  template: ClipboardList,
  document: FileSpreadsheet,
  equipment: Boxes,
} as const;

const KIND_LABEL = {
  user: "Сотрудники",
  template: "Журналы",
  document: "Документы",
  equipment: "Оборудование",
} as const;

function fuzzyMatch(item: StaticItem, q: string): boolean {
  const lq = q.toLowerCase();
  if (item.label.toLowerCase().includes(lq)) return true;
  if (item.href && item.href.toLowerCase().includes(lq)) return true;
  if (item.hint && item.hint.toLowerCase().includes(lq)) return true;
  if (item.keywords?.some((k) => k.toLowerCase().includes(lq))) return true;
  return false;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [actionRunning, setActionRunning] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);
  const nav = useAppNav();
  const routeItems = useMemo<StaticItem[]>(() => {
    const tabItems = nav.sections.flatMap((section) =>
      section.tabs.map((tab) => ({
        kind: "route" as const,
        label: section.tabs.length > 1 ? `${section.label} · ${tab.label}` : section.label,
        href: tab.href,
        icon: navIcon(section.icon),
        keywords: [section.label, tab.label],
      })),
    );
    // Карточки настроек («Отчёты», «Нарушения», «Аудит» и т.п.) — без дублей по адресу.
    const seen = new Set(tabItems.map((item) => item.href));
    const cardItems: StaticItem[] = [];
    for (const card of nav.search ?? []) {
      if (seen.has(card.href)) continue;
      seen.add(card.href);
      cardItems.push({
        kind: "route",
        label: card.sectionLabel ? `${card.sectionLabel} · ${card.label}` : card.label,
        href: card.href,
        icon: navIcon(card.icon),
        keywords: [card.label, card.sectionLabel],
      });
    }
    return [...tabItems, ...cardItems];
  }, [nav]);
  // «Закрыть день» и «Догнать пропуски» — у кого есть «Сегодня».
  const actionItems = useMemo(
    () => (nav.sections.some((section) => section.tabs.some((tab) => tab.href === "/dashboard")) ? ACTION_ITEMS : []),
    [nav]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setHits([]);
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
    const t = window.setTimeout(async () => {
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
    return () => window.clearTimeout(t);
  }, [query]);

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
        title: "Действия",
        items: filteredActions.map((a) => ({ ...a, source: "static" as const })),
      });
    }
    if (filteredRoutes.length > 0) {
      blocks.push({
        title: "Разделы",
        items: filteredRoutes.map((r) => ({ ...r, source: "static" as const })),
      });
    }
    for (const kind of ["user", "template", "document", "equipment"] as const) {
      const arr = liveByKind.get(kind);
      if (!arr || arr.length === 0) continue;
      blocks.push({
        title: KIND_LABEL[kind],
        items: arr.map((h) => ({ ...h, source: "live" as const })),
      });
    }
    return blocks;
  }, [query, hits, routeItems, actionItems]);

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
    }
  }

  if (!open) return null;

  let runningIdx = -1;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      onClick={() => setOpen(false)}
    >
      <BodyScrollLock />
      <div
        className="w-full max-w-xl rounded-2xl border border-[#ececf4] bg-white shadow-[0_30px_80px_-20px_rgba(11,16,36,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[#ececf4] px-4 py-3">
          {searching ? (
            <Loader2 className="size-4 animate-spin text-[#5566f6]" />
          ) : (
            <Search className="size-4 text-[#9b9fb3]" />
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
            placeholder="Найти журнал, сотрудника, оборудование или действие…"
            className="flex-1 bg-transparent text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:outline-none"
          />
          <kbd className="rounded-md border border-[#ececf4] bg-[#fafbff] px-1.5 py-0.5 text-[11px] text-[#6f7282]">
            Esc
          </kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {flatItems.length === 0 ? (
            <div className="rounded-xl px-3 py-6 text-center text-[13px] text-[#9b9fb3]">
              {query.trim().length < 2
                ? "Начните набирать — поиск по журналам, сотрудникам, оборудованию"
                : searching
                  ? "Ищу…"
                  : "Ничего не нашлось"}
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.title} className="mb-1 last:mb-0">
                <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
                  {section.title}
                </div>
                <ul>
                  {section.items.map((item) => {
                    runningIdx += 1;
                    const i = runningIdx;
                    const Icon =
                      item.source === "static"
                        ? item.icon
                        : KIND_ICON[item.kind];
                    const isActive = i === activeIdx;
                    const isRunning = actionRunning === i;
                    return (
                      <li
                        key={`${section.title}-${i}`}
                        onClick={() => pick(i)}
                        onMouseEnter={() => setActiveIdx(i)}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ${
                          isActive
                            ? "bg-[#f5f6ff]"
                            : "hover:bg-[#fafbff]"
                        }`}
                      >
                        <span
                          className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${
                            isActive
                              ? "bg-[#eef1ff] text-[#3848c7]"
                              : "bg-[#fafbff] text-[#6f7282]"
                          }`}
                        >
                          {isRunning ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Icon className="size-4" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div
                            className={`text-[14px] ${
                              isActive
                                ? "font-medium text-[#3848c7]"
                                : "text-[#0b1024]"
                            }`}
                          >
                            {item.label}
                          </div>
                          {item.hint ? (
                            <div className="mt-0.5 truncate text-[11px] text-[#9b9fb3]">
                              {item.hint}
                            </div>
                          ) : null}
                        </div>
                        <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-[#ececf4] bg-[#fafbff] px-4 py-2 text-[11px] text-[#9b9fb3]">
          <span>↑↓ навигация · Enter выбрать</span>
          <span>⌘K / Ctrl+K — открыть/закрыть</span>
        </div>
      </div>
    </div>
  );
}
