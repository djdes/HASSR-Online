"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

type Props = {
  /** Сколько журналов всего активных у орги (включая exempt и обычные). */
  totalEnabled: number;
  /** Exempt-журналы (own adapter — pipeline-tree им не нужен). */
  exemptCount: number;
  /** Сколько журналов уже имеют pipeline-tree с ≥1 узлом. */
  configured: number;
};

/**
 * Health-card для этапа 4 «Журналы»: если есть журналы без pipeline-tree
 * (но НЕ exempt) — рисует жёлтую карточку и кнопку «Создать pipeline для
 * всех» которая вызывает /api/settings/journal-pipelines/seed-all
 * (тот же endpoint что seed-all-button на /settings/journal-pipelines).
 */
export function OnboardingPipelineHealthCard({
  totalEnabled,
  exemptCount,
  configured,
}: Props) {
  const t = useTranslations("settingsUi.onboardingPipelineHealthCard");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (totalEnabled === 0) return null;

  const target = Math.max(0, totalEnabled - exemptCount);
  const missing = Math.max(0, target - configured);
  const allGood = missing === 0;

  async function seedAll() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings/journal-pipelines/seed-all", {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? t("createFailed"));
        return;
      }
      const created = data?.summary?.created?.length ?? 0;
      const skippedExisting = data?.summary?.skippedExisting?.length ?? 0;
      const skippedNoFields = data?.summary?.skippedNoFields?.length ?? 0;
      toast.success(
        t("created", { created })
          + (skippedExisting ? t("alreadyExisted", { count: skippedExisting }) : "")
          + (skippedNoFields ? t("needsManual", { count: skippedNoFields }) : "")
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  if (allGood) {
    return (
      <div className="rounded-2xl border border-[#c8f0d5] bg-[#ecfdf5] p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-[#d9f4e1] text-[#136b2a]">
            <CheckCircle2 className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-[#0b1024]">
              {t("allTitle", { count: target })}
            </div>
            <div className="mt-0.5 text-[12px] text-[#136b2a]">
              {exemptCount > 0
                ? t("exemptNote", { count: exemptCount })
                : t("wizardNote")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#ffe9b0] bg-[#fff8eb] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-white text-[#a13a32]">
            <AlertTriangle className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-[#0b1024]">
              {t("partialTitle", { configured, target })}
            </div>
            <p className="mt-1 text-[12px] text-[#a13a32]">
              {t("missingNote", { count: missing })}
            </p>
            <p className="mt-2 text-[11px] text-[#6f7282]">
              {t("hint")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={seedAll}
          disabled={busy}
          className="inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-2xl bg-[#5566f6] px-4 text-[13px] font-semibold text-white shadow-[0_8px_22px_-10px_rgba(85,102,246,0.6)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {busy ? t("creating") : t("createAll")}
        </button>
      </div>
    </div>
  );
}
