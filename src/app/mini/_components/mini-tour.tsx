"use client";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";
import { ArrowRight, BellRing, ListChecks, Sparkles, X } from "lucide-react";
import { haptic } from "./use-haptic";

const STORAGE_KEY = "wesetup.mini.tour.seen";

type TourStep = {
  icon: typeof ListChecks;
  title: string;
  description: string;
};

const STEPS: TourStep[] = [
  {
    icon: ListChecks,
    title: "Здесь — ваши задачи на сегодня",
    // Первое, что видит линейный сотрудник, — экран «Начать смену»,
    // а не карточки: без этой оговорки подсказка описывала то, чего
    // на экране ещё нет.
    description:
      "Сначала нажмите «Начать смену» — после этого появятся задачи на сегодня. Нажмите на карточку, и откроется простая форма с галочками и температурами.",
  },
  {
    icon: Sparkles,
    title: "«Заполнить как вчера»",
    description:
      "Если значения те же, что вчера, — нажмите «Заполнить как вчера». Приложение подставит вчерашние данные, останется только проверить.",
  },
  {
    icon: BellRing,
    title: "Уведомления приходят в Telegram",
    description:
      "За 30 минут до конца смены придёт напоминание, если что-то осталось незаполненным. Закрыли все задачи — напоминаний не будет.",
  },
];

/**
 * 3-экранный onboarding-тур для нового сотрудника, открывшего Mini App
 * впервые. После dismiss сохраняем флаг в localStorage — больше не
 * показываем. Можно сбросить через DevTools `localStorage.removeItem`.
 */
export function MiniTour() {
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Тур имеет смысл показывать только аутентифицированным сотрудникам.
  // Anonymous-визиты на /mini (нет initData, нет signIn) видят landing-
  // CTA «Откройте через Telegram» — карточки журналов не загружены, и
  // тур про «вот ваши задачи» был бы лишним шумом. Поэтому ждём, пока
  // NextAuth подтвердит сессию. localStorage доступен только на клиенте,
  // поэтому решение «открывать или нет» принимается в effect — это
  // намеренное «set state in effect», подавлено линтером.
  useEffect(() => {
    if (status !== "authenticated") return;
    if (typeof window === "undefined") return;
    try {
      const seen = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!seen) setOpen(true);
    } catch {
      /* localStorage blocked — skip */
    }
  }, [status]);

  function dismiss() {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  }

  function next() {
    if (step >= STEPS.length - 1) {
      haptic("success");
      dismiss();
      return;
    }
    haptic("light");
    setStep((s) => s + 1);
  }

  if (!open) return null;
  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  // Портал в <body>: внутри оболочки у тура свой контекст наложения, и нижнее
  // меню рисовалось поверх кнопки «Далее» — нажать её было нельзя.
  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 p-3"
      style={{ paddingBottom: "calc(var(--mini-safe-b, 0px) + 12px)" }}
      role="dialog"
      aria-modal="true"
    >
      <BodyScrollLock />
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0a0b0f] p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-[#5566f6]/15 text-[#a3b0ff]">
            <Icon className="size-6" />
          </span>
          {/* Tap-target ≥ 44×44 px (iOS HIG): p-3 на 16-px X = 44×44.
              Раньше p-1.5 давал ~32×32 — толстым пальцем мимо. */}
          <button
            type="button"
            onClick={dismiss}
            className="-m-3 rounded-full p-3 text-white/40 hover:bg-white/5 hover:text-white"
            aria-label="Закрыть"
          >
            <X className="size-4" />
          </button>
        </div>

        <h2 className="mt-4 text-[20px] font-semibold leading-tight text-white">
          {current.title}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-white/65">
          {current.description}
        </p>

        <div className="mt-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step
                    ? "w-8 bg-white"
                    : i < step
                      ? "w-3 bg-white/50"
                      : "w-3 bg-white/15"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={next}
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-white px-5 text-[14px] font-semibold text-[#0a0b0f] hover:bg-white/90"
          >
            {isLast ? "Поехали" : "Далее"}
            <ArrowRight className="size-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
