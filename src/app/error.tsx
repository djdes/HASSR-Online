"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { localizedHref } from "@/i18n/site-locale";

const DEPLOYMENT_DESYNC_PATTERNS = [
  "ChunkLoadError",
  "Failed to load chunk",
  "Failed to find Server Action",
  "older or newer deployment",
  "React Client Manifest",
  "client reference manifest",
  "Could not find the module",
];

function isDeploymentDesyncError(error: Error & { digest?: string }) {
  const text = `${error.name} ${error.message} ${error.digest ?? ""}`;
  return DEPLOYMENT_DESYNC_PATTERNS.some((pattern) => text.includes(pattern));
}

/**
 * Error boundary для всех роутов внутри приложения. Перехватывает
 * server/client ошибки в рендере и показывает локализованную карточку
 * вместо дефолтной Next-страницы (белый экран + стек ошибки).
 *
 * `reset` — callback Next.js, пробует перерендерить сегмент без
 * перезагрузки. «Домой» ведёт на /, потому что root layout на этом
 * уровне ещё жив, просто упал сегмент ниже.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("errorSurface");
  const shouldReload = isDeploymentDesyncError(error);
  const buildId = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
  const errorId = error.digest || error.message.slice(0, 120);
  const reloadStorageKey = `wesetup:error-reload:${buildId}:${errorId}`;
  const canAutoReload =
    shouldReload &&
    typeof window !== "undefined" &&
    (() => {
      try {
        return window.sessionStorage.getItem(reloadStorageKey) !== "1";
      } catch {
        return true;
      }
    })();

  useEffect(() => {
    if (typeof console !== "undefined") {
      console.error("[app-error]", error);
    }
  }, [error]);

  useEffect(() => {
    if (!canAutoReload || typeof window === "undefined") return;

    try {
      window.sessionStorage.setItem(reloadStorageKey, "1");
    } catch {
      // If sessionStorage is blocked, a single hard reload is still safer
      // than leaving the user on a stale deployment/chunk mismatch screen.
    }

    window.location.reload();
  }, [canAutoReload, reloadStorageKey]);

  if (canAutoReload) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fafbff] px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-[#ececf4] bg-white p-8 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#f5f6ff] text-[#5566f6]">
            <RotateCcw className="size-7 animate-spin" />
          </div>
          <h1 className="mt-6 text-[clamp(1.5rem,4vw+1rem,2.25rem)] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {t("updating")}
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-[#6f7282]">
            {t("updatingDescription")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafbff] px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-[#ececf4] bg-white p-8 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#fff4f2] text-[#a13a32]">
          <TriangleAlert className="size-7" />
        </div>
        <h1 className="mt-6 text-[clamp(1.5rem,4vw+1rem,2.25rem)] font-semibold tracking-[-0.02em] text-[#0b1024]">
          {t("errorTitle")}
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[#6f7282]">
          {t("errorDescription")}
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-[11px] text-[#9b9fb3]">
            {t("code", { code: error.digest })}
          </p>
        ) : null}
        <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href={localizedHref("/", locale)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            <ArrowLeft className="size-4" />
            {t("home")}
          </Link>
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
          >
            <RotateCcw className="size-4" />
            {t("retry")}
          </button>
        </div>
      </div>
    </div>
  );
}
