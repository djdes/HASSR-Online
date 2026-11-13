"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, MousePointerClick, X } from "lucide-react";

import {
  LIVE_GUIDE_EVENT,
  LIVE_GUIDE_STORAGE_KEY,
  LIVE_GUIDES,
  fieldConditionMet,
  parseGuideState,
  stepForPath,
  type LiveGuideId,
  type LiveGuideState,
} from "@/lib/live-guide/register-guide";

/**
 * Живой гид поверх настоящих страниц (монтируется в корневом layout).
 * Страница остаётся рабочей: затемнение не ловит клики, человек сам
 * вводит и нажимает, а гид подсвечивает цель шага и переходит дальше,
 * когда условие выполнено. Состояние — в sessionStorage, поэтому гид
 * переживает переход /register → /home.
 */
function readState(): LiveGuideState | null {
  try {
    return parseGuideState(window.sessionStorage.getItem(LIVE_GUIDE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeState(state: LiveGuideState | null) {
  try {
    if (state) window.sessionStorage.setItem(LIVE_GUIDE_STORAGE_KEY, JSON.stringify(state));
    else window.sessionStorage.removeItem(LIVE_GUIDE_STORAGE_KEY);
  } catch {
    // Без хранилища гид живёт только на текущей странице.
  }
}

/** Запустить гид: сохранить состояние и открыть первую страницу. */
export function startLiveGuide(id: LiveGuideId, navigate: (href: string) => void) {
  const state: LiveGuideState = { id, step: 0, startedAt: Date.now() };
  writeState(state);
  window.dispatchEvent(new CustomEvent(LIVE_GUIDE_EVENT, { detail: state }));
  if (!window.location.pathname.startsWith("/register")) navigate("/register");
}

function findTarget(name: string | undefined): HTMLElement | null {
  if (!name) return null;
  for (const node of document.querySelectorAll<HTMLElement>(`[data-guide="${name}"]`)) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return node;
  }
  return null;
}

function fieldOf(target: HTMLElement): HTMLInputElement | HTMLSelectElement | null {
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return target;
  return target.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
}

type Box = { top: number; left: number; width: number; height: number };
const PAD = 6;

export function LiveGuideHost() {
  const pathname = usePathname() ?? "";
  const [state, setState] = useState<LiveGuideState | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [missing, setMissing] = useState(false);
  const [met, setMet] = useState(false);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [cardH, setCardH] = useState(180);
  // Высота карточки — для места над/под целью; следим, пока она на экране.
  const cardObserver = useRef<ResizeObserver | null>(null);
  const cardRef = useCallback((el: HTMLDivElement | null) => {
    cardObserver.current?.disconnect();
    cardObserver.current = null;
    if (!el) return;
    const observer = new ResizeObserver(() => setCardH(el.offsetHeight));
    observer.observe(el);
    cardObserver.current = observer;
  }, []);

  useEffect(() => {
    setState(readState());
    const onStart = (event: Event) => setState((event as CustomEvent<LiveGuideState>).detail);
    window.addEventListener(LIVE_GUIDE_EVENT, onStart);
    return () => window.removeEventListener(LIVE_GUIDE_EVENT, onStart);
  }, []);

  const steps = state ? LIVE_GUIDES[state.id] : null;
  const index = state && steps ? stepForPath(steps, state.step, pathname) : null;
  const step = steps && index !== null ? steps[index] : null;

  const update = useCallback((next: LiveGuideState | null) => {
    writeState(next);
    setState(next);
  }, []);
  const close = useCallback(() => update(null), [update]);
  const go = useCallback(
    (to: number) => {
      if (!state || !steps) return;
      if (to >= steps.length) return close();
      update({ ...state, step: Math.max(0, to) });
    },
    [state, steps, update, close],
  );

  // Человек прошёл часть сам — запоминаем шаг этой страницы.
  useEffect(() => {
    if (state && index !== null && index !== state.step) update({ ...state, step: index });
  }, [state, index, update]);

  // Новый шаг: сброс и прокрутка к цели.
  useEffect(() => {
    setMet(false);
    setMissing(false);
    setBox(null);
    if (!step?.target) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = findTarget(step.target);
      tries += 1;
      if (el) {
        window.clearInterval(timer);
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        const field = fieldOf(el);
        if (field && step.advance.kind !== "click" && step.advance.kind !== "checked") field.focus({ preventScroll: true });
      } else if (tries > 15) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [step]);

  // Позиция цели и условия шага — на каждом кадре: страница живая.
  useEffect(() => {
    if (!step || !state) return;
    let frame = 0;
    let lostSince = 0;
    let metSince = 0;
    const tick = () => {
      setViewport((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
      const el = findTarget(step.target);
      if (el) {
        lostSince = 0;
        const r = el.getBoundingClientRect();
        setBox((b) => (b && b.top === r.top && b.left === r.left && b.width === r.width && b.height === r.height ? b : { top: r.top, left: r.left, width: r.width, height: r.height }));
        setMissing(false);
        const field = fieldOf(el);
        const ok = field ? fieldConditionMet(step.advance, field.value, field instanceof HTMLInputElement && field.checked) : false;
        setMet(ok);
        if (ok) {
          metSince ||= Date.now();
          // Почту и название допечатывают — ждём паузу; галочку — сразу.
          if (Date.now() - metSince > (step.advance.kind === "checked" ? 500 : 1500)) {
            go(index! + 1);
            return;
          }
        } else metSince = 0;
      } else if (step.target) {
        lostSince ||= Date.now();
        setBox(null);
        if (step.advance.kind === "gone" && Date.now() - lostSince > 400) {
          go(index! + 1);
          return;
        }
        // Цели нет (окно анкеты закрыли «Позже») — к следующему шагу,
        // чья цель уже на странице.
        if (Date.now() - lostSince > 1500 && steps) {
          for (let i = index! + 1; i < steps.length; i += 1) {
            if (steps[i].path.test(pathname) && findTarget(steps[i].target)) {
              go(i);
              return;
            }
          }
          setMissing(true);
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [step, state, index, steps, pathname, go]);

  // Клик по цели — для шагов «нажмите сюда».
  useEffect(() => {
    if (!step || step.advance.kind !== "click") return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`[data-guide="${step.target}"]`)) go(index! + 1);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [step, index, go]);

  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, close]);

  if (!state || !steps || !step || index === null || pathname.startsWith("/mini")) return null;
  // Пока цель ищется — ничего не рисуем, чтобы карточка не прыгала.
  if (step.target && !box && !missing) return null;

  const hole = box ? { top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 } : null;
  const narrow = viewport.w < 640;
  const cardW = Math.min(360, viewport.w - 24);
  let cardStyle: React.CSSProperties;
  if (!hole) {
    cardStyle = { left: (viewport.w - cardW) / 2, top: Math.max(12, (viewport.h - cardH) / 2) };
  } else if (narrow) {
    const below = hole.top + hole.height / 2 < viewport.h / 2;
    cardStyle = below ? { left: 12, right: 12, bottom: 12 } : { left: 12, right: 12, top: 12 };
  } else {
    const spaceBelow = viewport.h - (hole.top + hole.height);
    const top = spaceBelow > cardH + 24 ? hole.top + hole.height + 14 : Math.max(12, hole.top - cardH - 14);
    const left = Math.min(Math.max(12, hole.left), viewport.w - cardW - 12);
    cardStyle = { top, left, width: cardW };
  }
  const shade = "rgba(11,16,36,0.5)";
  const manual = step.advance.kind === "next" || missing;
  const last = index === steps.length - 1;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[90]" style={{ fontFamily: "var(--font-manrope), Manrope, \"Segoe UI\", sans-serif" }} data-live-guide>
      {hole ? (
        <>
          {/* Вырез — одна скруглённая рамка с огромной тенью: затемняет всё вокруг, клики проходят. */}
          <div className="absolute rounded-2xl border-[3px] border-[#7cf5c0] transition-all duration-150" style={{ ...hole, boxShadow: `0 0 0 9999px ${shade}` }} />
          <div className="absolute animate-pulse rounded-[20px] ring-[6px] ring-[#7cf5c0]/35" style={{ top: hole.top - 4, left: hole.left - 4, width: hole.width + 8, height: hole.height + 8 }} />
          {step.hint && !met ? (
            <div
              className="absolute flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#7cf5c0] px-2.5 py-1 text-[12.5px] font-semibold text-[#0b1024] shadow-[0_8px_20px_-8px_rgba(0,0,0,0.5)]"
              style={{ top: Math.max(4, hole.top - 30), left: Math.min(Math.max(4, hole.left), viewport.w - 170) }}
            >
              <MousePointerClick className="size-3.5" />
              {step.hint}
            </div>
          ) : null}
        </>
      ) : (
        <div className="absolute inset-0" style={{ background: shade }} />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-live="polite"
        aria-label={step.title}
        className="pointer-events-auto absolute rounded-3xl border border-[#ececf4] bg-white p-5 text-[#0b1024] shadow-[0_24px_60px_-20px_rgba(11,16,36,0.55)]"
        style={cardStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5566f6]">
            Шаг {index + 1} из {steps.length}
          </div>
          <button type="button" onClick={close} aria-label="Закрыть подсказки" className="-m-1.5 rounded-xl p-1.5 text-[#9b9fb3] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[17px] font-semibold leading-snug tracking-[-0.01em]">
          {met ? <Check className="size-5 shrink-0 text-[#116b2a]" /> : null}
          {step.title}
        </div>
        <p className="mt-1.5 text-[14px] leading-[1.55] text-[#3c4053]">
          {missing ? "Не вижу этот элемент на странице — возможно, окно уже закрыто. Нажмите «Далее» или закройте подсказки." : step.text}
        </p>
        <div className="mt-4 flex items-center gap-2">
          {index > 0 && steps[index - 1].path.test(pathname) ? (
            <button type="button" onClick={() => go(index - 1)} className="inline-flex h-9 items-center gap-1 rounded-xl px-2.5 text-[13.5px] font-medium text-[#6f7282] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]">
              <ArrowLeft className="size-4" /> Назад
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {manual || last ? (
              <button type="button" onClick={() => go(index + 1)} className="inline-flex h-10 items-center gap-1.5 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0]">
                {last ? "Закончить" : "Далее"} {last ? null : <ArrowRight className="size-4" />}
              </button>
            ) : (
              <button type="button" onClick={() => go(index + 1)} className="inline-flex h-9 items-center rounded-xl px-2.5 text-[13px] text-[#9b9fb3] transition-colors hover:bg-[#f5f6ff] hover:text-[#3c4053]">
                Пропустить шаг
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Кнопка «Показать вживую» — запускает гид и открывает регистрацию. */
export function LiveGuideStartButton({ id = "register", className, children }: { id?: LiveGuideId; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <button type="button" data-live-guide-start={id} onClick={() => startLiveGuide(id, (href) => router.push(href))} className={className}>
      {children}
    </button>
  );
}
