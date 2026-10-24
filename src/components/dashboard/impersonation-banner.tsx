"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

type Props = {
  organizationName: string;
};

/**
 * Persistent red banner shown on every dashboard page while a root user is
 * "viewing as" a customer organisation. /api/root/impersonate DELETE сам
 * перевыпускает session-token без actingAsOrganizationId — клиенту нужен
 * только hard reload, чтобы layout перечитал свежий JWT.
 */
export function ImpersonationBanner({ organizationName }: Props) {
  const t = useTranslations("dashboardUi.impersonationBanner");
  const [busy, setBusy] = useState(false);

  async function stop() {
    setBusy(true);
    try {
      const res = await fetch("/api/root/impersonate", { method: "DELETE" });
      if (!res.ok) {
        throw new Error(t("stopFailed"));
      }
      toast.success(t("stopped"));
      window.location.href = "/root";
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("exitFailed")
      );
      setBusy(false);
    }
  }

  return (
    <div className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 border-b border-[#ff3b30] bg-[#fff4f2] px-4 py-3 text-[13px] text-[#d2453d] sm:gap-4 sm:px-6 sm:text-[14px]">
      <div className="min-w-0 flex-1 font-medium">
        {t("viewing")}{" "}
        <span className="font-semibold">{organizationName}</span>
      </div>
      <button
        type="button"
        onClick={stop}
        disabled={busy}
        className="inline-flex h-9 shrink-0 items-center rounded-xl bg-[#ff3b30] px-4 text-white hover:bg-[#e0342a] disabled:opacity-60"
      >
        {busy ? "..." : t("exit")}
      </button>
    </div>
  );
}
