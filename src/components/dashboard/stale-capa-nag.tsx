"use client";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";
import { LinkPendingSpinner } from "@/components/ui/link-pending";

type Props = {
  count: number;
};

const SESSION_DISMISS_KEY = "wesetup.stale-capa-nag.dismissed";

/**
 * Soft-block модалка для админа на /dashboard. Появляется когда есть
 * CAPA-тикеты, открытые > 7 дней. Назначение — не дать менеджеру
 * «забыть» что тикеты висят, как это часто случается.
 *
 * Dismissable per-session (sessionStorage). После закрытия не
 * показывается до перезагрузки страницы / нового логина. На след
 * день при первом заходе появляется снова.
 *
 * При count === 0 не рендерится вообще.
 */
export function StaleCapaNag({ count }: Props) {
  const t = useTranslations("dashboardUi.staleCapaNag");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (count === 0) return;
    try {
      const dismissed = sessionStorage.getItem(SESSION_DISMISS_KEY);
      if (!dismissed) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, [count]);

  function dismiss() {
    setOpen(false);
    try {
      sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  if (!open || count === 0) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <BodyScrollLock />
      <div className="w-full max-w-md rounded-3xl border border-[#ffd2cd] bg-white p-6 shadow-[0_30px_80px_-20px_rgba(11,16,36,0.45)]">
        <div className="flex items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#fff4f2] text-[#a13a32]">
            <AlertTriangle className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
              {t("title", { count })}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#3c4053]">
              {t("body")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/capa"
                className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white hover:bg-[#4a5bf0]"
                onClick={dismiss}
              >
                {t("openCapa")}
                <LinkPendingSpinner />
              </Link>
              <button
                type="button"
                onClick={dismiss}
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#3a3f55] hover:bg-[#fafbff]"
              >
                {t("remindLater")}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg p-1.5 text-[#9b9fb3] hover:bg-[#fafbff] hover:text-[#0b1024]"
            aria-label={t("close")}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
