"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Общая карточка ошибки для `error.tsx` журнальных маршрутов.
 *
 * Next.js рендерит `error.tsx` вместо упавшего сегмента. Голый
 * дефолтный экран выглядит чужеродно, поэтому показываем карточку в
 * дизайн-системе: что случилось, кнопка «Попробовать снова» (`reset()`)
 * и путь назад.
 */
export function JournalRouteError({
  error,
  reset,
  title,
  description,
  backHref,
  backLabel,
  variant = "journal",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  variant?: "journal" | "journals" | "documents" | "document";
}) {
  const t = useTranslations("errorSurface");
  useEffect(() => {
    console.error("[journals] route error", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-[560px] py-10">
      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
        <div className="flex items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#fff4f2] text-[#a13a32]">
            <TriangleAlert className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]">
              {title ?? t(`${variant}Title`)}
            </h1>
            <p className="mt-2 text-[13px] leading-[1.55] text-[#3c4053]">
              {description ?? t(`${variant}Description`)}
            </p>
            {error.digest ? (
              <p className="mt-2 text-[12px] text-[#9b9fb3]">
                {t("code", { code: error.digest })}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
          >
            <RefreshCw className="size-4" />
            {t("retry")}
          </button>
          {backHref ? (
            <Link
              href={backHref}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#3c4053] transition-colors hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
            >
              <ArrowLeft className="size-4 text-[#5566f6]" />
              {backLabel ?? t(backHref === "/dashboard" ? "home" : "backToJournals")}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
