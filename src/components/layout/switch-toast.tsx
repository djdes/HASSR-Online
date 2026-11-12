"use client";

import { useTranslations } from "next-intl";
import { CircleCheck, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import type { RefreshAfter } from "@/components/layout/content-transition";

/**
 * Тост о смене — один вид и одна логика на весь сайт и мини-приложение
 * (владелец, 2026-11-11 и 2026-11-12): организация, торговая точка, автосмена
 * точки по разделу, демо, новая организация. Сверху (место — у `<Toaster>`:
 * в кабинете под шапкой по центру контента, в приложении под его шапкой),
 * живёт 3 секунды; справа сверху крестик с кольцом-отсчётом — под курсором
 * отсчёт стоит, как и таймер; под сообщением — компактная кнопка «Вернуться …»:
 * нажал не туда — одно нажатие назад. Цвета — токены `--app-*`: светлая,
 * тёмная и «Новая» темы без отдельных правил.
 */

/** 3 секунды (владелец): отсчёт — в кольце вокруг крестика (`globals.css`, `toast-countdown`). */
export const SWITCH_TOAST_MS = 3000;

/** Длинное название в кнопке возврата — с многоточием: кнопка остаётся в одну строку. */
export function shortSwitchName(name: string): string {
  return name.length > 26 ? `${name.slice(0, 25).trimEnd()}…` : name;
}

/** Кнопка возврата: подпись уже переведена («Вернуться в «…»»). */
export type SwitchToastBack = { label: string; onClick: () => void };

/** Карточка тоста; экспорт — для проверки разметки. */
export function SwitchToastCard({
  id,
  message,
  back,
}: {
  id: string | number;
  message: string;
  back?: SwitchToastBack | null;
}) {
  const t = useTranslations("navigation.shell.switchToast");
  return (
    <div
      data-switch-toast
      className="relative flex w-[min(360px,calc(100vw-32px))] flex-col gap-2 rounded-2xl border border-[var(--app-border,#ececf4)] bg-[var(--app-surface,#fff)] py-3 pr-12 pl-4 text-[14px] text-[var(--app-text,#0b1024)] shadow-[0_12px_32px_-12px_rgba(11,16,36,0.35)]"
    >
      <div className="flex items-start gap-2 leading-snug font-medium">
        <CircleCheck className="mt-px size-[18px] shrink-0 text-[#16a34a]" aria-hidden />
        <span className="min-w-0 [overflow-wrap:anywhere]">{message}</span>
      </div>
      {back ? (
        <button
          type="button"
          data-switch-toast-back
          title={back.label}
          onClick={() => {
            toast.dismiss(id);
            back.onClick();
          }}
          className="ml-[26px] inline-flex h-8 max-w-[calc(100%-26px)] items-center gap-1.5 self-start rounded-full border border-[var(--app-border-strong,#dcdfed)] px-3 text-[13px] font-medium text-[var(--app-indigo-deep,#3848c7)] transition-colors hover:bg-[var(--app-tint-indigo,#f5f6ff)] focus-visible:ring-4 focus-visible:ring-[var(--app-tint-indigo-2,#eef1ff)] focus-visible:outline-none"
        >
          <Undo2 className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{back.label}</span>
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => toast.dismiss(id)}
        aria-label={t("close")}
        title={t("close")}
        className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full text-[var(--app-text-muted,#6f7282)] hover:text-[var(--app-text,#0b1024)]"
      >
        <span className="absolute inset-0 flex items-center justify-center">
          <svg
            viewBox="0 0 20 20"
            className="size-8 -rotate-90"
            aria-hidden
            data-toast-countdown
            style={{ "--toast-life": `${SWITCH_TOAST_MS}ms` } as React.CSSProperties}
          >
            <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.18" />
            <circle data-ring cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" pathLength={100} />
          </svg>
        </span>
        <X className="relative size-3.5" aria-hidden />
      </button>
    </div>
  );
}

let lastToastId: string | number | null = null;

/**
 * Показать тост смены. `back` — кнопка возврата; без неё — только сообщение
 * с отсчётом. Прежний тост смены убираем: «вернуться» к тому, что было до
 * прошлой смены, уже не к месту.
 */
export function showSwitchToast(message: string, back?: SwitchToastBack | null) {
  if (lastToastId !== null) toast.dismiss(lastToastId);
  lastToastId = toast.custom((id) => <SwitchToastCard id={id} message={message} back={back} />, {
    duration: SWITCH_TOAST_MS,
  });
}

/** Одна сторона смены: куда переключаемся и как туда вернуться. */
export type SwitchSide = {
  /** Что меняем — крутилка у этого пункта, пока идёт переход. */
  tag: string;
  /** Запрос смены (и переход на другую страницу, если нужен); false — не вышло, ошибку показал сам. */
  go: () => Promise<boolean>;
  /** Текст тоста, когда пришли сюда («Организация: …», «Торговая точка: …»). */
  message: string;
  /** Подпись кнопки возврата сюда («Вернуться в «…»»). */
  returnLabel: string;
};

/**
 * Смена с тостом и возвратом — одна логика для всех переключателей: запрос и
 * новая страница — в общем переходе кабинета (скелет, крутилка у пункта),
 * тост — когда данные уже на экране; «Вернуться» — та же смена в обратную
 * сторону, и её тост снова предлагает вернуться. `from = null` — возвращаться
 * некуда, тост без кнопки.
 */
export function switchWithReturn(
  refreshAfter: RefreshAfter,
  to: SwitchSide,
  from: SwitchSide | null,
  show: (message: string, back?: SwitchToastBack | null) => void = showSwitchToast,
): void {
  refreshAfter(to.tag, to.go, () =>
    show(
      to.message,
      from ? { label: from.returnLabel, onClick: () => switchWithReturn(refreshAfter, from, to, show) } : null,
    ),
  );
}
