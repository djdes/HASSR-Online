"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { cn } from "@/lib/utils";
import { indexFromScrollTop, nearestEnabledIndex, wheelSteps } from "@/lib/wheel-date";

/**
 * Барабан выбора (как у iOS): колонка на нативной прокрутке с
 * `scroll-snap`, выбранная строка — в подсвеченной полосе по центру.
 *
 * ПОЧЕМУ так, а не свой drag: нативная прокрутка даёт инерцию и
 * «докрутку» на телефоне бесплатно и одинаково в браузере и Mini App.
 * Колесо мыши перехватываем сами (не пассивный слушатель) — один щелчок
 * колеса ровно на одну строку, тачпад копит сдвиг (`wheelSteps`).
 *
 * Доступность: колонка — `role="spinbutton"` с `aria-valuetext`
 * («25, пятница»); ↑/↓, PageUp/PageDown (±7), Home/End и набор цифр.
 * `data-vaul-no-drag` — в листе снизу (vaul) вертикальный жест крутит
 * барабан, а не тянет лист.
 */
export type WheelOption<T extends string | number> = {
  value: T;
  label: string;
  /** Серая подпись справа (день недели). */
  hint?: string;
  tone?: "weekend";
  disabled?: boolean;
  /** Точка-метка: день уже что-то значит (в плане). */
  marked?: boolean;
  /** Пояснение вместо подписи — почему строку выбрать нельзя. */
  note?: string;
};

type WheelColumnProps<T extends string | number> = {
  options: ReadonlyArray<WheelOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  valueText?: (option: WheelOption<T>) => string;
  /** Высота строки; по умолчанию 40, на сенсорном экране — 44. */
  itemHeight?: number;
  /** Видимых строк — нечётное число. */
  visible?: number;
  className?: string;
};

const TYPEAHEAD_RESET_MS = 800;
const COMMIT_FALLBACK_MS = 120;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Лёгкий «щелчок» в Telegram Mini App, если он доступен. */
function hapticSelection() {
  if (typeof window === "undefined") return;
  const telegram = (
    window as unknown as {
      Telegram?: { WebApp?: { HapticFeedback?: { selectionChanged?: () => void } } };
    }
  ).Telegram;
  try {
    telegram?.WebApp?.HapticFeedback?.selectionChanged?.();
  } catch {
    /* вне Telegram — ничего */
  }
}

export function WheelColumn<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  valueText,
  itemHeight: itemHeightProp,
  visible = 5,
  className,
}: WheelColumnProps<T>) {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const itemHeight = itemHeightProp ?? (coarse ? 44 : 40);
  const rows = visible % 2 === 1 ? visible : visible + 1;
  const pad = itemHeight * Math.floor(rows / 2);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  // Последняя строка, к которой мы крутим: быстрые нажатия считаются от
  // неё, а не от `value`, которое догонит после onChange.
  const targetRef = useRef(selectedIndex);
  const programmaticRef = useRef<number | null>(null);
  const wheelAccRef = useRef(0);
  const commitTimerRef = useRef<number | null>(null);
  const typeaheadRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const mountedRef = useRef(false);
  const latest = useRef({ options, onChange, selectedIndex, itemHeight });
  useLayoutEffect(() => {
    latest.current = { options, onChange, selectedIndex, itemHeight };
  });

  const scrollToIndex = useCallback((index: number, smooth: boolean) => {
    const el = scrollerRef.current;
    if (!el) return;
    const top = index * latest.current.itemHeight;
    if (Math.abs(el.scrollTop - top) < 1) {
      programmaticRef.current = null;
      return;
    }
    programmaticRef.current = index;
    el.scrollTo({ top, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" });
  }, []);

  const select = useCallback(
    (index: number, direction: number) => {
      const { options: list, onChange: emit, selectedIndex: current } = latest.current;
      const target = nearestEnabledIndex(list, index, direction);
      if (target < 0) return;
      targetRef.current = target;
      if (target !== current) {
        emit(list[target].value);
        hapticSelection();
      }
      scrollToIndex(target, true);
    },
    [scrollToIndex],
  );

  // Внешняя смена значения (другая колонка подрезала день, «Сегодня») —
  // докручиваем колонку. Первый раз — без анимации; если начальное
  // значение выбрать нельзя (день уже отмечен, позже «сегодня»), сразу
  // встаём на ближайший доступный.
  useEffect(() => {
    targetRef.current = selectedIndex;
    scrollToIndex(selectedIndex, mountedRef.current);
    const firstRun = !mountedRef.current;
    mountedRef.current = true;
    if (firstRun && latest.current.options[selectedIndex]?.disabled) {
      select(selectedIndex, 0);
    }
  }, [selectedIndex, itemHeight, scrollToIndex, select]);

  const commitFromScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { options: list, itemHeight: height } = latest.current;
    const programmatic = programmaticRef.current;
    if (programmatic !== null) {
      // Идёт наша анимация — ждём, пока доедет.
      if (Math.abs(el.scrollTop - programmatic * height) > 2) return;
      programmaticRef.current = null;
      return;
    }
    select(indexFromScrollTop(el.scrollTop, height, list.length), 0);
  }, [select]);

  const onScroll = useCallback(() => {
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      commitFromScroll();
    }, COMMIT_FALLBACK_MS);
  }, [commitFromScroll]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScrollEnd = () => {
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      commitFromScroll();
    };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return; // масштаб страницы
      event.preventDefault();
      programmaticRef.current = null;
      const step = wheelSteps(
        wheelAccRef.current,
        event.deltaY,
        event.deltaMode,
        latest.current.itemHeight,
      );
      wheelAccRef.current = step.acc;
      if (step.steps !== 0) select(targetRef.current + step.steps, Math.sign(step.steps));
    };
    // Палец или мышь перехватили нашу анимацию — решает место остановки.
    const onUserGrab = () => {
      programmaticRef.current = null;
    };
    el.addEventListener("scrollend", onScrollEnd);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onUserGrab);
    el.addEventListener("touchstart", onUserGrab, { passive: true });
    return () => {
      el.removeEventListener("scrollend", onScrollEnd);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onUserGrab);
      el.removeEventListener("touchstart", onUserGrab);
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    };
  }, [commitFromScroll, select]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = options.length - 1;
    const from = targetRef.current;
    switch (event.key) {
      case "ArrowUp":
        select(from - 1, -1);
        break;
      case "ArrowDown":
        select(from + 1, 1);
        break;
      case "PageUp":
        select(Math.max(0, from - 7), -1);
        break;
      case "PageDown":
        select(Math.min(last, from + 7), 1);
        break;
      case "Home":
        select(0, 1);
        break;
      case "End":
        select(last, -1);
        break;
      default: {
        if (!/^\d$/.test(event.key)) return;
        const now = Date.now();
        const buffer =
          now - typeaheadRef.current.at < TYPEAHEAD_RESET_MS
            ? typeaheadRef.current.text + event.key
            : event.key;
        typeaheadRef.current = { text: buffer, at: now };
        const exact = options.findIndex((o) => !o.disabled && o.label === buffer);
        const prefix = options.findIndex((o) => !o.disabled && o.label.startsWith(buffer));
        const index = exact >= 0 ? exact : prefix;
        if (index >= 0) select(index, 0);
        break;
      }
    }
    event.preventDefault();
  }

  const current = options[selectedIndex];
  const numericValue = (option: WheelOption<T> | undefined, fallback: number) =>
    typeof option?.value === "number" ? option.value : fallback;

  return (
    <div className={cn("relative select-none", className)} style={{ height: itemHeight * rows }}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-1 rounded-xl bg-[#f5f6ff] ring-1 ring-[#ececf4]"
        style={{ top: pad, height: itemHeight }}
      />
      <div
        ref={scrollerRef}
        role="spinbutton"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuenow={numericValue(current, selectedIndex + 1)}
        aria-valuemin={numericValue(options[0], 1)}
        aria-valuemax={numericValue(options[options.length - 1], options.length)}
        aria-valuetext={current ? (valueText ? valueText(current) : current.label) : undefined}
        data-vaul-no-drag=""
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        className="relative h-full snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-xl outline-none [mask-image:linear-gradient(to_bottom,transparent,#000_30%,#000_70%,transparent)] [scrollbar-width:none] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 [&::-webkit-scrollbar]:hidden"
        style={{ paddingTop: pad, paddingBottom: pad }}
      >
        {options.map((option, index) => {
          const selected = index === selectedIndex;
          return (
            <div
              key={String(option.value)}
              aria-hidden
              onClick={() => select(index, 0)}
              className={cn(
                "flex snap-center items-center justify-center gap-1.5 px-2 text-[16px] tabular-nums transition-colors duration-150",
                option.disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                selected
                  ? "font-semibold text-[#3848c7]"
                  : option.tone === "weekend"
                    ? "text-[#a13a32]/75"
                    : "text-[#9b9fb3]",
              )}
              style={{ height: itemHeight }}
            >
              <span>{option.label}</span>
              {option.note ? (
                <span className="text-[11px] font-normal text-[#6f7282]">{option.note}</span>
              ) : option.hint ? (
                <span
                  className={cn(
                    "text-[12px] font-normal",
                    option.tone === "weekend" ? "text-[#a13a32]" : selected ? "text-[#6f7282]" : "",
                  )}
                >
                  {option.hint}
                </span>
              ) : null}
              {option.marked ? (
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
