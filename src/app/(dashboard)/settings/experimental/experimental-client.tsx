"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

type Props = {
  initialExperimentalUiV2: boolean;
};

export function ExperimentalClient({ initialExperimentalUiV2 }: Props) {
  const t = useTranslations("settingsUi.experimentalClient");
  const [v2, setV2] = useState(initialExperimentalUiV2);
  const [savingV2, setSavingV2] = useState(false);

  async function handleV2Toggle(next: boolean) {
    const prev = v2;
    setV2(next);
    setSavingV2(true);
    try {
      const response = await fetch("/api/settings/experimental", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experimentalUiV2: next }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? t("saveFailed"));
      }
      toast.success(
        next
          ? t("v2On")
          : t("v2Off")
      );
    } catch (error) {
      setV2(prev);
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setSavingV2(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#5566f6] to-[#7a5cff] text-white">
            <Sparkles className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
                  {t("v2Title")}
                  <span className="rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#136b2a]">
                    {t("recommended")}
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
                  {t("v2Body")}
                  <br />
                  <span className="text-[12px] text-[#9b9fb3]">
                    {t("v2Note")}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {savingV2 ? (
                  <Loader2 className="size-4 animate-spin text-[#9b9fb3]" />
                ) : null}
                <Switch
                  checked={v2}
                  onCheckedChange={(next) => {
                    if (savingV2) return;
                    void handleV2Toggle(next);
                  }}
                  disabled={savingV2}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
