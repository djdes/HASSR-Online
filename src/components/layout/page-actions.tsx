"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Ряд действий в шапке страницы («QR» и «Добавить»).
 *
 * На телефоне (<640px) — одна строка во всю ширину, кнопки делят её поровну
 * (владелец, 2026-11-23: «QR и Добавление в одну строку»): несколько кнопок
 * QR сворачиваются в одну (`QrActions`). На компьютере — как раньше, справа от
 * заголовка, с переносом.
 *
 * `dock` — ключевые разделы (объекты, цеха, оборудование): на телефоне и
 * планшете (<1024px), когда ряд ушёл за верх экрана, те же действия
 * появляются снизу во всю ширину, над нижним меню, и едут со страницей;
 * вернулся ряд — полоса уходит. Полоса — вторая копия действий (у окна
 * «Добавить» своё состояние), она в дереве только пока видна.
 */
export function PageActions({
  children,
  dock = false,
  className,
}: {
  children: ReactNode;
  dock?: boolean;
  className?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  return (
    <>
      <div
        ref={row}
        data-page-actions
        className={cn(
          "flex min-w-0 items-center gap-2 max-sm:w-full max-sm:[&>*]:h-12 max-sm:[&>*]:min-w-0 max-sm:[&>*]:flex-1 max-sm:[&>*]:justify-center max-sm:[&>*]:gap-1.5 max-sm:[&>*]:px-2.5 sm:flex-wrap sm:justify-end",
          className,
        )}
      >
        {children}
      </div>
      {dock ? <PageActionsDock anchor={row}>{children}</PageActionsDock> : null}
    </>
  );
}

/** Сколько длится выезд и уход полосы (`app-theme.css`, «Полоса действий страницы»). */
const DOCK_MS = 320;

function PageActionsDock({ anchor, children }: { anchor: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const t = useTranslations("navigation.shell.pageActions");
  // Ряд шапки ушёл за верх экрана — полоса нужна.
  const [past, setPast] = useState(false);
  // Полоса в дереве: появляется сразу, уходит после своей анимации; `entered` —
  // кадр после появления, с него играет выезд.
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);
  if (past && !mounted) setMounted(true);

  useEffect(() => {
    const target = anchor.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    // От ширины экрана не зависит: на компьютере полосу прячет CSS (`lg:hidden`).
    // Иначе поворот планшета (820 → 1180px) снимал бы её вместе с открытым из
    // неё окном «Добавить» и набранным текстом.
    const observer = new IntersectionObserver(([entry]) => {
      // Ушёл вверх, а не ещё не доехал снизу (короткая страница, якорь ниже экрана).
      const above = entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0) + 1;
      // Нет ни одной кнопки (просмотр, нечего печатать) — полосы нет.
      setPast(!entry.isIntersecting && above && target.childElementCount > 0);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [anchor]);

  useEffect(() => {
    if (!mounted) return;
    if (past) {
      // Кадр в дереве без `data-open`, потом выезд — иначе переход не играет.
      let frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setEntered(true));
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const timer = window.setTimeout(() => {
      setMounted(false);
      setEntered(false);
    }, DOCK_MS);
    return () => window.clearTimeout(timer);
  }, [past, mounted]);

  if (!mounted || typeof document === "undefined") return null;
  const shown = past && entered;
  // Портал в body: у полотна страницы бывает `transform`, и `fixed` внутри
  // считался бы от него (см. `modal-tokens.ts`).
  return createPortal(
    <div
      role="region"
      aria-label={t("dockAria")}
      data-page-dock
      data-open={shown ? "" : undefined}
      className="fixed inset-x-3 z-30 lg:hidden print:hidden"
    >
      <div className="flex items-center gap-2 rounded-[22px] bg-[var(--app-fab-bg)] p-1.5 shadow-[inset_0_0_0_1px_var(--app-fab-border),0_12px_32px_-14px_rgba(11,16,36,0.38)] backdrop-blur-xl backdrop-saturate-150 [&>*]:h-11 [&>*]:min-w-0 [&>*]:flex-1 [&>*]:justify-center max-sm:[&>*]:gap-1.5 max-sm:[&>*]:px-2.5">
        {children}
      </div>
    </div>,
    document.body,
  );
}
