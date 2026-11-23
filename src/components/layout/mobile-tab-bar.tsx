"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ClipboardList, House, MessageCircle, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { activeMobileTab, journalsTabHref, mobileTabs, type MobileTabId } from "@/lib/mobile-tab-bar";
import { useAppNav } from "@/components/layout/app-nav-context";
import { FAB_DOCK_OPEN_EVENT, useFabDockUnread } from "@/components/layout/fab-dock";
import { openMobileSheet } from "@/components/layout/mobile-nav-sheet";

const ICONS: Record<MobileTabId, ComponentType<{ className?: string; strokeWidth?: number }>> = {
  home: House,
  journals: ClipboardList,
  contacts: MessageCircle,
  settings: Settings,
};

/** «Без анимации» в кабинете или в системе — меню не играет. */
function motionOff(): boolean {
  if (document.documentElement.hasAttribute("data-view-still")) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Поле ввода текста — пока в нём фокус, меню уезжает вниз. */
function isTextField(node: Element | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  if (node instanceof HTMLInputElement) return !/^(checkbox|radio|button|submit|reset|range|color|file|image|hidden)$/.test(node.type);
  return node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement;
}

/**
 * Экранная клавиатура открыта: видимая часть экрана заметно ниже окна
 * (клавиатура сжимает её, а не раскладку). Без `visualViewport` — верим фокусу.
 * Поле, получившее фокус само (автофокус без клавиатуры), меню не прячет.
 */
function keyboardOpen(): boolean {
  const viewport = window.visualViewport;
  return !viewport || window.innerHeight - viewport.height > 120;
}

function typingNow(): boolean {
  return isTextField(document.activeElement) && keyboardOpen();
}

function subscribeTyping(onChange: () => void): () => void {
  document.addEventListener("focusin", onChange);
  document.addEventListener("focusout", onChange);
  window.visualViewport?.addEventListener("resize", onChange);
  return () => {
    document.removeEventListener("focusin", onChange);
    document.removeEventListener("focusout", onChange);
    window.visualViewport?.removeEventListener("resize", onChange);
  };
}

function play(element: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions) {
  if (!element || typeof element.animate !== "function") return;
  try {
    element.animate(frames, options);
  } catch {
    /* движок не знает пружину — без анимации */
  }
}

/**
 * Нижнее меню кабинета на телефоне и планшете (<1024px; владелец,
 * 2026-11-23: «летающие с блюром, как в Telegram, с анимацией при
 * переключении»). Плавающая полупрозрачная полоса над краем экрана:
 * «Домой», «Журналы», «Контакты», «Настройки» (`lib/mobile-tab-bar.ts`).
 * Подложка выбранной вкладки переезжает к новой на пружине и в пути чуть
 * тянется, иконка новой — «подпрыгивает». Пока печатают (поле в фокусе и
 * открыта клавиатура), меню уезжает вниз: не висит над клавиатурой.
 *
 * «Контакты» открывают док «Контакты и помощь» (круглой кнопки на этих
 * экранах нет), «Настройки» — лист меню кабинета (у кого меню нет — лист
 * профиля). Место под меню держат `--app-tabbar-*` в `app-theme.css`.
 */
export function MobileTabBar({ homeHref }: { homeHref: string }) {
  const t = useTranslations("navigation.shell.tabBar");
  const pathname = usePathname() || "/";
  const { sections, showSidebar } = useAppNav();
  const unread = useFabDockUnread();
  const journalsHref = journalsTabHref(sections);
  const tabs = useMemo(() => mobileTabs({ homeHref, journalsHref }), [homeHref, journalsHref]);
  const current = activeMobileTab(tabs, pathname);
  // Нажали ссылку — подложка едет сразу, не дожидаясь новой страницы. Переход
  // не случился (передумали и нажали текущую, сбой сети) — через 10 с подложка
  // возвращается к текущей странице.
  const [pressed, setPressed] = useState<{ id: MobileTabId; from: string } | null>(null);
  useEffect(() => {
    if (!pressed) return;
    const timer = window.setTimeout(() => setPressed(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [pressed]);
  const active = pressed && pressed.from === pathname ? pressed.id : current;
  const index = Math.max(0, tabs.findIndex((tab) => tab.id === active));

  // Подложка переезжает переходом `transform` (app-theme.css); в пути она
  // чуть тянется, а иконка новой вкладки «подпрыгивает». На первом кадре
  // ничего не играет.
  const bar = useRef<HTMLDivElement>(null);
  const previous = useRef(active);
  useEffect(() => {
    if (previous.current === active) return;
    previous.current = active;
    if (motionOff()) return;
    const root = bar.current;
    play(root?.querySelector("[data-tabbar-pill]"), [{ scale: "1 1" }, { scale: "1.08 0.9", offset: 0.4 }, { scale: "1 1" }], {
      duration: 420,
      easing: "ease-out",
    });
    play(
      root?.querySelector(`[data-tabbar-tab="${active}"] [data-tabbar-icon]`),
      [{ scale: "1" }, { scale: "0.82", offset: 0.35 }, { scale: "1.12", offset: 0.7 }, { scale: "1" }],
      { duration: 450, easing: "ease-out" },
    );
  }, [active]);

  // Печатают в поле (фокус и открытая клавиатура) — меню уезжает вниз.
  const typing = useSyncExternalStore(subscribeTyping, typingNow, () => false);

  const labelOf = (id: MobileTabId) => t(id);

  return (
    <nav
      aria-label={t("aria")}
      data-mobile-tabbar
      data-liquid="off"
      data-typing={typing ? "" : undefined}
      className="fixed inset-x-3 z-30 lg:hidden print:hidden"
    >
      <div
        ref={bar}
        data-tabbar-glass
        className="relative mx-auto flex h-[var(--app-tabbar-h)] max-w-[480px] items-stretch rounded-[26px] bg-[var(--app-fab-bg)] p-1 shadow-[inset_0_0_0_1px_var(--app-fab-border),0_16px_40px_-18px_rgba(11,16,36,0.45)] backdrop-blur-2xl backdrop-saturate-[1.8]"
      >
        <span
          aria-hidden
          data-tabbar-pill
          className="absolute inset-y-1 left-1 rounded-[22px] bg-[#5566f6]/10"
          style={{ width: `calc((100% - 8px) / ${tabs.length})`, transform: `translateX(${index * 100}%)` }}
        />
        {tabs.map((tab) => {
          const Icon = ICONS[tab.id];
          const selected = tab.id === active;
          const badge = tab.id === "contacts" && unread > 0 ? (unread > 9 ? "9+" : String(unread)) : null;
          const body = (
            <>
              <span className="relative">
                <Icon data-tabbar-icon className="size-[22px]" strokeWidth={selected ? 2.2 : 1.9} />
                {badge ? (
                  <span className="absolute -top-1.5 -right-2.5 flex min-w-[17px] items-center justify-center rounded-full bg-[#ff6b5a] px-1 text-[10px] font-semibold leading-[17px] text-white">
                    {badge}
                  </span>
                ) : null}
              </span>
              <span className="max-w-full truncate">{labelOf(tab.id)}</span>
            </>
          );
          const className = cn(
            "relative z-[1] flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] text-[11px] leading-tight font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#5566f6]/20",
            selected ? "text-[#5566f6]" : "text-[#6f7282]",
          );
          if (tab.kind === "link") {
            return (
              <Link
                key={tab.id}
                href={tab.href}
                aria-current={selected ? "page" : undefined}
                data-tabbar-tab={tab.id}
                data-active={selected ? "" : undefined}
                onClick={(event) => {
                  // Новая вкладка или окно (Ctrl, Cmd, Shift, средняя кнопка) — здесь ничего не меняется.
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  setPressed(tab.id === current ? null : { id: tab.id, from: pathname });
                }}
                className={className}
              >
                {body}
              </Link>
            );
          }
          return (
            <button
              key={tab.id}
              type="button"
              data-tabbar-tab={tab.id}
              data-active={selected ? "" : undefined}
              aria-haspopup="dialog"
              aria-label={badge ? t("contactsUnread", { count: unread }) : undefined}
              onClick={() => {
                if (tab.id === "contacts") window.dispatchEvent(new Event(FAB_DOCK_OPEN_EVENT));
                else openMobileSheet(showSidebar ? "menu" : "profile");
              }}
              className={className}
            >
              {body}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
