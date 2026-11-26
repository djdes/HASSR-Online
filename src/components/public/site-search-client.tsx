"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  BookA,
  BookOpenCheck,
  Compass,
  CornerDownLeft,
  FileDown,
  LifeBuoy,
  Loader2,
  Newspaper,
  ScrollText,
  Search,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { flattenSiteSearch, searchSite, type SiteSearchItem, type SiteSearchKind } from "@/lib/site-search";
import { ymGoal } from "@/lib/signup-source";
import { cn } from "@/lib/utils";

/**
 * Кнопка «Поиск» в шапке публичных страниц и окно поиска по всему сайту
 * (спека site-search-2026-11). Индекс скачивается при первом открытии
 * (`/api/public/search-index`), дальше поиск идёт в браузере на каждую
 * букву. Открывается кнопкой, Ctrl/⌘+K или «/».
 */

const KIND_ICON: Record<SiteSearchKind, LucideIcon> = {
  journal: BookOpenCheck,
  blank: FileDown,
  order: ScrollText,
  page: Compass,
  kb: LifeBuoy,
  blog: Newspaper,
  glossary: BookA,
  feature: Sparkles,
};

/** Что показать до ввода: частые запросы — по адресам из индекса. */
const POPULAR_PATHS = [
  "/journals-info/hygiene",
  "/journals-info/cleaning",
  "/journals-info/cold_equipment_control",
  "/journals-info/finished_product",
  "/blanki",
  "/prikazy",
  "/calc/journals",
  "/pricing",
];

type Status = "idle" | "loading" | "ready" | "error";

function pathOf(href: string): string {
  return href.replace(/^\/(en|uz|tg|hy|ky|de|fr)(?=\/|$)/, "") || "/";
}

export function SiteSearchClient({ variant = "header" }: { variant?: "header" | "home" }) {
  const t = useTranslations("publicSearch");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SiteSearchItem[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (status === "loading" || status === "ready") return;
    setStatus("loading");
    try {
      const res = await fetch(`/api/public/search-index?locale=${encodeURIComponent(locale)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { items?: SiteSearchItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [locale, status]);

  const show = useCallback(
    (via: string) => {
      setOpen(true);
      setActive(0);
      void load();
      ymGoal("site_search_open", { via });
    },
    [load],
  );

  // Ctrl/⌘+K и «/» — как в привычных поисках; «/» не перехватываем в полях ввода.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));
      if ((event.key === "k" || event.key === "K" || event.key === "л" || event.key === "Л") && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        show("hotkey");
      } else if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        show("slash");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  const groups = useMemo(() => (query.trim() ? searchSite(items, query) : []), [items, query]);
  const popular = useMemo(() => {
    const byPath = new Map(items.map((item) => [pathOf(item.href), item]));
    return POPULAR_PATHS.map((path) => byPath.get(path)).filter((item): item is SiteSearchItem => Boolean(item));
  }, [items]);
  const flat = useMemo(() => (query.trim() ? flattenSiteSearch(groups) : popular), [groups, popular, query]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(item: SiteSearchItem) {
    ymGoal("site_search_go", { kind: item.kind });
    setOpen(false);
    setQuery("");
    router.push(item.href);
  }

  function onInputKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(flat.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && flat[active]) {
      event.preventDefault();
      go(flat[active]);
    }
  }

  let index = -1;
  const row = (item: SiteSearchItem) => {
    index += 1;
    const current = index;
    const Icon = KIND_ICON[item.kind];
    return (
      <a
        key={`${item.kind}:${item.href}`}
        href={item.href}
        data-index={current}
        data-testid="site-search-result"
        onMouseMove={() => setActive(current)}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          go(item);
        }}
        className={cn(
          "flex items-start gap-3 rounded-2xl px-3 py-2.5 transition-colors duration-100",
          active === current ? "bg-[#f5f6ff]" : "hover:bg-[#fafbff]",
        )}
      >
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl border border-[#ececf4] bg-white text-[#3848c7]">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-[#0b1024]">{item.title}</span>
          {item.description ? (
            <span className="line-clamp-2 block text-[13px] leading-[1.45] text-[#6f7282]">{item.description}</span>
          ) : null}
        </span>
        {active === current ? <CornerDownLeft aria-hidden="true" className="mt-2 hidden size-4 shrink-0 text-[#9b9fb3] sm:block" /> : null}
      </a>
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => show("button")}
        aria-label={t("open")}
        aria-keyshortcuts="Control+K"
        data-testid="site-search-open"
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white text-[14px] font-medium text-[#6f7282] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024]",
          variant === "home" ? "px-3" : "w-10 justify-center sm:w-auto sm:justify-start sm:px-3",
        )}
      >
        <Search aria-hidden="true" className="size-4 text-[#5566f6]" />
        <span className={variant === "home" ? "hidden sm:inline" : "hidden sm:inline"}>{t("button")}</span>
        <kbd className="hidden rounded-md border border-[#ececf4] bg-[#fafbff] px-1.5 py-0.5 text-[11px] font-medium text-[#9b9fb3] lg:inline">Ctrl K</kbd>
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <DialogContent
          className="flex max-h-[min(640px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden rounded-3xl border-[#ececf4] bg-white p-0 sm:max-w-[640px] sm:top-[12vh] sm:translate-y-0"
          data-testid="site-search-dialog"
          showCloseButton={false}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
          <DialogTitle className="sr-only">{t("title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("description")}</DialogDescription>
          <div className="flex items-center gap-2 border-b border-[#ececf4] p-3 max-sm:pt-5">
            <div className="relative min-w-0 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-[#9b9fb3]" />
            <input
              ref={input}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onInputKey}
              placeholder={t("placeholder")}
              aria-label={t("placeholder")}
              role="combobox"
              aria-expanded="true"
              aria-controls="site-search-results"
              data-testid="site-search-input"
              autoComplete="off"
              className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white pl-11 pr-11 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  input.current?.focus();
                }}
                aria-label={t("clear")}
                className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-xl text-[#9b9fb3] hover:bg-[#f4f4f6] hover:text-[#0b1024]"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setQuery("");
              }}
              className="h-12 shrink-0 rounded-2xl px-3 text-[14px] font-medium text-[#3848c7] hover:bg-[#f5f6ff]"
            >
              {t("close")}
            </button>
          </div>

          <div ref={list} id="site-search-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
            {status === "loading" || status === "idle" ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[14px] text-[#6f7282]">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                {t("loading")}
              </div>
            ) : status === "error" ? (
              <div className="py-10 text-center text-[14px] text-[#a13a32]">
                {t("error")}{" "}
                <button type="button" onClick={() => { setStatus("idle"); void load(); }} className="font-medium text-[#3848c7] underline underline-offset-2">
                  {t("retry")}
                </button>
              </div>
            ) : query.trim() ? (
              groups.length ? (
                groups.map((group) => (
                  <div key={group.kind} className="mb-1" data-testid={`site-search-group-${group.kind}`}>
                    <div className="px-3 pb-1 pt-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#9b9fb3]">
                      {t(`kinds.${group.kind}`)}
                    </div>
                    {group.items.map(row)}
                  </div>
                ))
              ) : (
                <div className="px-4 py-10 text-center" data-testid="site-search-empty">
                  <div className="text-[15px] font-medium text-[#0b1024]">{t("emptyTitle", { query: query.trim() })}</div>
                  <p className="mt-1 text-[13px] leading-[1.5] text-[#6f7282]">{t("emptyBody")}</p>
                </div>
              )
            ) : (
              <div>
                <div className="px-3 pb-1 pt-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#9b9fb3]">{t("popular")}</div>
                {popular.map(row)}
              </div>
            )}
          </div>

          <div className="hidden items-center gap-4 border-t border-[#ececf4] px-4 py-2.5 text-[12px] text-[#9b9fb3] sm:flex">
            <span>{t("hintNavigate")}</span>
            <span>{t("hintOpen")}</span>
            <span>{t("hintClose")}</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
