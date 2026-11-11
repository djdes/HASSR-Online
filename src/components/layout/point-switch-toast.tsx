"use client";

import { useTranslations } from "next-intl";
import { CircleCheck, X } from "lucide-react";
import { toast } from "sonner";

/**
 * Тост о смене точки — один вид на все случаи (владелец, 2026-11-11): и ручной
 * выбор в шапке, и автосмена по разделу. Короткий, крестик с кольцом-отсчётом, и —
 * когда есть куда — кнопкой «Вернуться на „…“»: нажал не туда — одно нажатие
 * назад. Место тоста — под шапкой по центру контента (`dashboard-toaster`),
 * чтобы он не закрывал сам переключатель.
 */

/** 3 секунды (владелец, 2026-11-11): отсчёт — в кольце вокруг крестика. */
export const POINT_TOAST_MS = 3000;

/** Длинное название точки в кнопке — с многоточием: кнопка остаётся в одну строку. */
export function shortPointName(name: string): string {
  return name.length > 26 ? `${name.slice(0, 25).trimEnd()}…` : name;
}

/** Кольцо, убывающее за время жизни подсказки (`globals.css`, `toast-countdown`). */
export function ToastCountdown({ ms }: { ms: number }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-[18px] -rotate-90"
      aria-hidden
      data-toast-countdown
      style={{ "--toast-life": `${ms}ms` } as React.CSSProperties}
    >
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2.2" opacity="0.18" />
      <circle data-ring cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" pathLength={100} />
    </svg>
  );
}

let lastToastId: string | number | null = null;

/**
 * Карточка тоста (владелец, 2026-11-11): сообщение, «Вернуться на …» и
 * крестик справа сверху; кольцо вокруг крестика убывает за время жизни
 * тоста (3 с), наведение ставит отсчёт на паузу (`globals.css`).
 */
function PointSwitchToastCard({
  id,
  message,
  back,
}: {
  id: string | number;
  message: string;
  back?: { label: string; onClick: () => void } | null;
}) {
  const t = useTranslations("navigation.shell.point");
  return (
    <div
      data-point-switch-toast
      className="relative flex w-[min(360px,calc(100vw-32px))] flex-col gap-2 rounded-2xl border border-[var(--app-border,#ececf4)] bg-[var(--app-surface,#fff)] py-3 pr-12 pl-4 text-[14px] text-[var(--app-text,#0b1024)] shadow-[0_12px_32px_-12px_rgba(11,16,36,0.35)]"
    >
      <div className="flex items-center gap-2 font-medium">
        <CircleCheck className="size-[18px] shrink-0 text-[#16a34a]" aria-hidden />
        <span className="min-w-0">{message}</span>
      </div>
      {back ? (
        <button
          type="button"
          onClick={() => {
            toast.dismiss(id);
            back.onClick();
          }}
          className="self-start rounded-lg px-1.5 py-1 text-[13.5px] font-medium text-[var(--app-indigo-deep,#3848c7)] underline-offset-2 hover:underline"
        >
          {back.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => toast.dismiss(id)}
        aria-label={t("close")}
        className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full text-[var(--app-text-muted,#6f7282)] hover:text-[var(--app-text,#0b1024)]"
      >
        <span className="absolute inset-0 flex items-center justify-center">
          <svg
            viewBox="0 0 20 20"
            className="size-8 -rotate-90"
            aria-hidden
            data-toast-countdown
            style={{ "--toast-life": `${POINT_TOAST_MS}ms` } as React.CSSProperties}
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

/**
 * Показать тост смены точки. `back` — кнопка возврата (подпись уже
 * переведена); без неё — просто короткое сообщение с отсчётом.
 */
export function showPointSwitchToast(message: string, back?: { label: string; onClick: () => void } | null) {
  // Прежний тост смены — убрать: «вернуться» к точке до прошлой смены уже не к месту.
  if (lastToastId !== null) toast.dismiss(lastToastId);
  lastToastId = toast.custom((id) => <PointSwitchToastCard id={id} message={message} back={back} />, {
    duration: POINT_TOAST_MS,
  });
}
