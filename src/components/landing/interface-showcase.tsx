"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  LayoutDashboard,
  Lock,
  QrCode,
  ShieldCheck,
  Table2,
  Users,
  type LucideIcon,
} from "lucide-react";

import { usePrefersReducedMotion } from "@/lib/use-media-query";

/**
 * «Как выглядит кабинет» — слайдер настоящих снимков экрана на главной.
 *
 * Десктоп — снимок 1440×900 в рамке окна браузера, телефон — мобильный
 * снимок в рамке телефона: десктопный экран, ужатый до 360 px, не
 * читается. Над рамкой — вкладки экранов, заливка активной вкладки —
 * таймер автопрокрутки (CSS-анимация: ставится на паузу под курсором, в
 * фокусе, при перетаскивании и вне экрана, а при reduced-motion её нет).
 * Листать — вкладками, стрелками, клавишами ← → и свайпом.
 *
 * Картинки грузятся лениво и только для текущего экрана и соседей:
 * шесть снимков сразу — лишние полмегабайта на телефоне.
 */

export type ShowcaseIcon = "dashboard" | "journals" | "grid" | "qr" | "inspection" | "staff" | "checklists";

export type ShowcaseSlide = {
  id: string;
  icon: ShowcaseIcon;
  tab: string;
  title: string;
  text: string;
  /** Адрес в строке браузера, без протокола. */
  address: string;
  desktop: { src: string; width: number; height: number };
  mobile: { src: string; width: number; height: number };
};

export type ShowcaseLabels = {
  region: string;
  tabs: string;
  previous: string;
  next: string;
  /** «2 из 6» — по строке на каждый экран, уже из каталога. */
  positions: string[];
};

const ICONS: Record<ShowcaseIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  journals: BookOpenCheck,
  grid: Table2,
  qr: QrCode,
  inspection: ShieldCheck,
  staff: Users,
  checklists: ClipboardCheck,
};

const AUTOPLAY_MS = 6000;
const SWIPE_PX = 48;

export function InterfaceShowcase({ slides, labels }: { slides: ShowcaseSlide[]; labels: ShowcaseLabels }) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [drag, setDrag] = useState<{ startX: number; startY: number; dx: number; horizontal: boolean | null } | null>(null);
  const reduced = usePrefersReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const count = slides.length;

  const go = useCallback((target: number) => setIndex(((target % count) + count) % count), [count]);

  // Автопрокрутка идёт, только пока блок на экране и вкладка браузера видна.
  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.35 });
    observer.observe(node);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") setVisible(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Активная вкладка подъезжает в видимую зону строки (только её скролл),
  // а если фокус был на вкладках — переходит на новую (стрелки ← →).
  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>("[aria-selected='true']");
    if (!active) return;
    if (strip.contains(document.activeElement) && document.activeElement !== active) active.focus({ preventScroll: true });
    if (strip.scrollWidth <= strip.clientWidth + 4) return;
    const left = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: reduced ? "auto" : "smooth" });
  }, [index, reduced]);

  const autoplay = !reduced;
  const paused = !visible || hovered || focused || drag !== null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(index - 1);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    setDrag({ startX: event.clientX, startY: event.clientY, dx: 0, horizontal: null });
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    let horizontal = drag.horizontal;
    if (horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      horizontal = Math.abs(dx) > Math.abs(dy);
      if (horizontal) event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (horizontal === false) {
      setDrag(null);
      return;
    }
    setDrag({ ...drag, dx: horizontal ? dx : 0, horizontal });
  };
  const endDrag = () => {
    if (!drag) return;
    if (drag.horizontal && Math.abs(drag.dx) > SWIPE_PX) go(index + (drag.dx < 0 ? 1 : -1));
    setDrag(null);
  };

  const active = slides[index];
  const offset = drag?.horizontal ? drag.dx : 0;
  const position = labels.positions[index] ?? "";

  return (
    <div
      ref={rootRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={labels.region}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      className="relative overflow-hidden rounded-3xl border border-[#ececf4] bg-[#fafbff] p-3 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-5 md:p-6"
    >
      {/* Мягкое индиговое свечение за рамкой — та же подача, что в hero. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-10 size-[340px] rounded-full bg-[#5566f6] opacity-[0.10] blur-[110px]" />
        <div className="absolute -right-24 bottom-0 size-[360px] rounded-full bg-[#7a5cff] opacity-[0.09] blur-[120px]" />
      </div>

      {/* Вкладки экранов: заливка активной — таймер автопрокрутки. */}
      <div
        ref={tabsRef}
        role="tablist"
        aria-label={labels.tabs}
        className="showcase-tabs relative -mx-1 flex gap-2 overflow-x-auto px-1 py-1"
      >
        {slides.map((slide, slideIndex) => {
          const Icon = ICONS[slide.icon];
          const current = slideIndex === index;
          return (
            <button
              key={slide.id}
              type="button"
              role="tab"
              id={`showcase-tab-${slide.id}`}
              aria-selected={current}
              aria-controls="showcase-panel"
              tabIndex={current ? 0 : -1}
              onClick={() => go(slideIndex)}
              className={`relative isolate inline-flex h-10 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-full border px-3.5 text-[14px] font-medium transition-[color,background-color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
                current
                  ? "border-[#5566f6]/30 bg-[#eef1ff] text-[#3848c7]"
                  : "border-[#ececf4] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024]"
              }`}
            >
              {current && autoplay ? (
                <span
                  key={`fill-${index}`}
                  aria-hidden="true"
                  className="showcase-fill absolute inset-y-0 left-0 -z-10 bg-[#dfe3ff]"
                  style={{ animationDuration: `${AUTOPLAY_MS}ms`, animationPlayState: paused ? "paused" : "running" }}
                  onAnimationEnd={() => go(index + 1)}
                />
              ) : null}
              <Icon className={`size-4 ${current ? "text-[#5566f6]" : "text-[#6f7282]"}`} />
              {slide.tab}
            </button>
          );
        })}
      </div>

      {/* Сцена: лента слайдов, свайп тянет её за пальцем. */}
      <div
        id="showcase-panel"
        role="tabpanel"
        aria-labelledby={`showcase-tab-${active.id}`}
        className="relative mt-4 select-none sm:mt-5"
        style={{ touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="overflow-hidden rounded-2xl md:rounded-[20px]">
          <div
            className="flex"
            style={{
              transform: `translateX(calc(${-index * 100}% + ${offset}px))`,
              transition: drag ? "none" : reduced ? "none" : "transform 520ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {slides.map((slide, slideIndex) => {
              const near = Math.abs(slideIndex - index) <= 1 || Math.abs(slideIndex - index) === count - 1;
              return (
                <div
                  key={slide.id}
                  aria-hidden={slideIndex !== index}
                  className="w-full shrink-0 px-0.5"
                  style={{ opacity: slideIndex === index ? 1 : 0.35, transition: reduced ? "none" : "opacity 400ms ease" }}
                >
                  {/* Десктоп: окно браузера. Цвета окна — inline: ночная тема
                      перекрашивает bg-white и серые классы, а окно со светлым
                      снимком внутри должно остаться светлым окном. */}
                  <div
                    className="hidden overflow-hidden rounded-[18px] md:block"
                    style={{ background: "#ffffff", boxShadow: "0 0 0 1px #dcdfed, 0 30px 70px -34px rgba(11,16,36,0.5)" }}
                  >
                    <div className="flex h-10 items-center gap-3 px-4" style={{ background: "#f4f5f9", borderBottom: "1px solid #e6e8f1" }}>
                      <span className="flex gap-1.5" aria-hidden="true">
                        <span className="size-3 rounded-full" style={{ background: "#ff5f57" }} />
                        <span className="size-3 rounded-full" style={{ background: "#febc2e" }} />
                        <span className="size-3 rounded-full" style={{ background: "#28c840" }} />
                      </span>
                      <span
                        className="mx-auto inline-flex h-7 min-w-0 max-w-[60%] items-center gap-1.5 rounded-lg px-3 text-[12.5px]"
                        style={{ background: "#ffffff", color: "#6f7282", boxShadow: "0 0 0 1px #e6e8f1" }}
                      >
                        <Lock className="size-3 shrink-0" style={{ color: "#116b2a" }} />
                        <span className="truncate">{slide.address}</span>
                      </span>
                      <span className="w-[52px]" aria-hidden="true" />
                    </div>
                    <div className="relative aspect-[16/10]" style={{ background: "#f4f5fa" }}>
                      {near ? (
                        <Image
                          src={slide.desktop.src}
                          alt={slide.title}
                          width={slide.desktop.width}
                          height={slide.desktop.height}
                          sizes="(min-width: 1200px) 1100px, 92vw"
                          draggable={false}
                          className="h-full w-full object-cover object-top"
                        />
                      ) : null}
                    </div>
                  </div>
                  {/* Телефон: мобильный снимок в рамке телефона. */}
                  <div className="mx-auto w-[min(100%,272px)] md:hidden">
                    <div className="rounded-[2.4rem] bg-[linear-gradient(150deg,#727892_0%,#262934_16%,#0d0f15_46%,#2c303c_74%,#808699_100%)] p-[3px] shadow-[0_30px_60px_-30px_rgba(11,16,36,0.6)]">
                      <div className="rounded-[2.25rem] bg-[#040507] p-[7px]">
                        <div className="relative aspect-[390/800] overflow-hidden rounded-[1.8rem]" style={{ background: "#f4f5fa" }}>
                          <span aria-hidden="true" className="absolute left-1/2 top-2 z-10 h-[18px] w-[78px] -translate-x-1/2 rounded-full bg-black" />
                          {near ? (
                            <Image
                              src={slide.mobile.src}
                              alt={slide.title}
                              width={slide.mobile.width}
                              height={slide.mobile.height}
                              sizes="272px"
                              draggable={false}
                              className="h-full w-full object-cover object-top"
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Подпись экрана и навигация. */}
      <div className="relative mt-4 flex items-start gap-4 sm:mt-5 sm:items-center">
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-semibold leading-snug tracking-[-0.01em] text-[#0b1024] sm:text-[18px]">{active.title}</h3>
          <p className="mt-1 text-[15px] leading-[1.55] text-[#3c4053]">{active.text}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-[13px] tabular-nums text-[#6f7282] sm:inline">{position}</span>
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label={labels.previous}
            className="flex size-11 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 sm:size-10"
          >
            <ChevronLeft className="size-4 text-[#5566f6]" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label={labels.next}
            className="flex size-11 items-center justify-center rounded-2xl bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 sm:size-10"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      {/* Смену экрана объявляем, только когда листает сам человек:
          автопрокрутка в эфир скринридера не идёт. */}
      <span className="sr-only" aria-live={paused ? "polite" : "off"}>
        {position}: {active.title}
      </span>
    </div>
  );
}
