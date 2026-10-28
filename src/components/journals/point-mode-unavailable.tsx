"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Building2, Loader2, Store } from "lucide-react";
import { toast } from "sonner";
import { ORGANIZATION_VIEW_ID } from "@/lib/building-scope";

/**
 * Страница всей организации («Журналы точек», «Все журналы»), а в шапке
 * выбрана торговая точка (владелец, 2026-10-28): «пишем ошибку и кнопку
 * назад». Руководству на всю компанию — ещё «Выбрать всю организацию»:
 * после неё страница откроется на месте.
 */
export function PointModeUnavailable({
  pointName,
  canViewOrganization,
}: {
  pointName: string;
  canViewOrganization: boolean;
}) {
  const t = useTranslations("navigation.shell.pointMode");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  function goBack() {
    // Пришли по прямой ссылке — назад некуда: ведём в «Сегодня» точки.
    if (window.history.length > 1) router.back();
    else router.push("/dashboard");
  }

  async function chooseOrganization() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/me/active-building", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingId: ORGANIZATION_VIEW_ID }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? t("failed"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("failed"));
      setBusy(false);
    }
  }

  return (
    <div
      className="mx-auto max-w-[560px] rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center"
      data-point-mode-unavailable
    >
      <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
        <Store className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("title")}</h1>
      <p className="mx-auto mt-2 max-w-[440px] text-[14px] leading-[1.6] text-[#6f7282]">
        {t("body", { point: pointName })}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          data-point-mode-back
        >
          <ArrowLeft className="size-4 text-[#5566f6]" aria-hidden />
          {t("back")}
        </button>
        {canViewOrganization ? (
          <button
            type="button"
            onClick={() => void chooseOrganization()}
            disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-70"
            data-point-mode-organization
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Building2 className="size-4" aria-hidden />}
            {t("chooseOrganization")}
          </button>
        ) : null}
      </div>
      <p className="mx-auto mt-4 max-w-[440px] text-[12.5px] leading-[1.55] text-[#9b9fb3]">
        {canViewOrganization ? t("hintOrganization") : t("hintPoint")}
      </p>
    </div>
  );
}
