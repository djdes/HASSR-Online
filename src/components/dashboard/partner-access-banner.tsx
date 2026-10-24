"use client";

import { useState } from "react";
import { Eye, Handshake, PencilLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

type Props = {
  organizationName: string;
  brandName: string;
  level: "view" | "edit";
};

/**
 * Полоса «Вы в кабинете клиента как партнёр». Держится на каждой
 * странице (sticky), пока в сессии есть partnerAccess-claim — партнёр
 * не должен перепутать чужой кабинет со своим. «Выйти» снимает claim
 * (POST /api/partner/exit) и возвращает в партнёрский кабинет.
 */
export function PartnerAccessBanner({ organizationName, brandName, level }: Props) {
  const t = useTranslations("dashboardUi.partnerAccessBanner");
  const [busy, setBusy] = useState(false);

  async function exit() {
    setBusy(true);
    try {
      const res = await fetch("/api/partner/exit", { method: "POST" });
      if (!res.ok) throw new Error(t("exitClientFailed"));
      window.location.href = "/partner";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("exitFailed"));
      setBusy(false);
    }
  }

  const LevelIcon = level === "edit" ? PencilLine : Eye;

  return (
    <div className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 border-b border-[#5566f6]/40 bg-[#eef1ff] px-4 py-2.5 text-[13px] text-[#3848c7] sm:gap-4 sm:px-6 sm:text-[14px]">
      <div className="flex min-w-0 flex-1 items-center gap-2 font-medium">
        <Handshake className="size-4 shrink-0" />
        <span className="truncate">
          {t("clientCabinet")} <span className="font-semibold">{organizationName}</span> ·{" "}
          {t("youArePartner", { brand: brandName })}
        </span>
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[12px] font-semibold"
          title={
            level === "edit"
              ? t("editTitle")
              : t("viewTitle")
          }
        >
          <LevelIcon className="size-3.5" />
          {level === "edit" ? t("editLevel") : t("viewLevel")}
        </span>
      </div>
      <button
        type="button"
        onClick={exit}
        disabled={busy}
        className="inline-flex h-9 shrink-0 items-center rounded-xl bg-[#5566f6] px-4 font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
      >
        {busy ? "..." : t("toPartnerCabinet")}
      </button>
    </div>
  );
}
