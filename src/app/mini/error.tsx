"use client";

import { useEffect } from "react";
import { RotateCcw, ShieldAlert } from "lucide-react";

import { haptic } from "@/app/mini/_components/use-haptic";
import { useTranslations } from "next-intl";

/**
 * Экран ошибки Mini App.
 *
 * Без него любая упавшая страница отдавала стандартный экран Next —
 * на телефоне это выглядит как поломка всего приложения. Здесь человек
 * видит, что делать, и может повторить, не перезапуская Telegram.
 *
 * Вид повторяет карточку ошибки с главной (`page.tsx`), чтобы ошибка
 * выглядела одинаково во всём кабинете.
 */
export default function MiniError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorSurface");
  useEffect(() => {
    // Отдельная вибрация: человек мог отвести взгляд, пока грузилось.
    haptic("error");
    console.error("[mini] экран упал:", error);
  }, [error]);

  return (
    <div
      className="mini-card flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
      role="alert"
    >
      <span
        className="mini-tile"
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: "var(--mini-danger-soft)",
          color: "var(--mini-danger)",
        }}
      >
        <ShieldAlert className="size-7" />
      </span>
      <div>
        <div className="text-[19px] font-semibold" style={{ color: "var(--mini-text)" }}>
          {t("miniTitle")}
        </div>
        <p
          className="mt-1.5 text-[16px] leading-relaxed"
          style={{ color: "var(--mini-text-muted)" }}
        >
          {t("miniDescription")}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          haptic("light");
          reset();
        }}
        className="mini-btn-primary mini-press w-full"
      >
        <RotateCcw className="size-5" />
        {t("retry")}
      </button>
    </div>
  );
}
