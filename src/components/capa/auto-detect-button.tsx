"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { capaErrorKey } from "./capa-presentation";
import { useRouter } from "next/navigation";
import { Loader2, Radar } from "lucide-react";
import { toast } from "sonner";

type Summary = {
  created: number;
  skippedExisting: number;
  candidates: number;
};

/**
 * «Проверить отклонения» — run the 3-day temperature CAPA detector on
 * demand. Normally the Tuya cron runs it after every collect cycle,
 * but a manager might want to trigger a sweep after manually editing
 * fridge temp limits or after importing a batch of readings.
 */
export function CapaAutoDetectButton() {
  const t = useTranslations("capaManagement");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/capa/auto-detect", {
        method: "POST",
      });
      const data = (await response.json().catch(() => null)) as
        | Summary
        | { error: string; code?: string }
        | null;
      if (!response.ok) {
        toast.error(
          t(`errors.${capaErrorKey(data && "error" in data ? data.error : undefined, response.status, data && "code" in data ? data.code : undefined, "detectFailed")}`)
        );
        return;
      }
      const summary = data as Summary;
      if (summary.candidates === 0) {
        toast.success(t("detect.none"));
      } else if (summary.created === 0) {
        toast.info(
          t("detect.existing", { candidates: summary.candidates })
        );
      } else {
        toast.success(
          summary.skippedExisting
            ? t("detect.createdWithSkipped", { created: summary.created, skipped: summary.skippedExisting })
            : t("detect.created", { created: summary.created })
        );
      }
      router.refresh();
    } catch {
      toast.error(t("errors.detectFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      title={t("detect.tooltip")}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border-0 bg-[#5566f6]/[0.04] px-4 text-[14px] font-semibold text-[#5566f6] transition-colors hover:bg-[#5566f6]/[0.09] disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Radar className="size-4" />
      )}
      {t("detect.button")}
    </button>
  );
}
