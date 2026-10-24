"use client";

import { AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/** Баннер «организация будет удалена»: видят все в организации, отменить может руководитель. */
export function DeletionBanner({ dueAt, canCancel, variant = "site" }: { dueAt: string; canCancel: boolean; variant?: "site" | "mini" }) {
  const t = useTranslations("layoutUi.deletionBanner");
  const locale = useLocale();
  const dateLocale = locale === "en" ? "en-GB" : locale === "uz" ? "uz-UZ" : "ru-RU";
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const when = new Date(dueAt).toLocaleDateString(dateLocale, { day: "numeric", month: "long", year: "numeric" });
  async function cancel() {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/organization/deletion", { method: "DELETE" });
      if (!response.ok) throw new Error(t("cancelFailed"));
      toast.success(t("cancelled"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`${variant === "mini" ? "mb-4 rounded-2xl" : "mb-5 rounded-3xl"} flex flex-col gap-3 border border-[#ffd2cd] bg-[#fff4f2] px-4 py-3.5 sm:flex-row sm:items-center`} data-testid="deletion-banner" role="alert">
      <div className="flex min-w-0 flex-1 items-start gap-2.5 text-[#a13a32]">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span className="text-[13.5px] leading-snug">
          {t.rich("message", { when, b: (chunks) => <b>{chunks}</b> })}
          {" "}
          {canCancel ? t("canCancel") : t("cannotCancel")}
        </span>
      </div>
      {canCancel ? (
        <button type="button" onClick={() => void cancel()} disabled={busy} className="inline-flex h-10 shrink-0 items-center justify-center rounded-2xl bg-white px-4 text-[13.5px] font-medium text-[#a13a32] shadow-sm ring-1 ring-[#ffd2cd] transition-colors hover:bg-[#fff8f7] disabled:opacity-60" data-testid="deletion-cancel">
          {busy ? t("cancelling") : t("cancel")}
        </button>
      ) : null}
    </div>
  );
}
