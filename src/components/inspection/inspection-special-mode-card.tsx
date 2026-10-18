"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

import { saveJournalControls, useJournalControls } from "@/components/journals/journal-controls-provider";
import { Switch } from "@/components/ui/switch";

/**
 * «СпецРежим» (скан 83): существующий «Специальный режим» организации —
 * здесь, где он нужен, с пояснением, что именно выключается. Переключает
 * руководитель (`admin.full`, как в API); остальные видят состояние.
 */
export function InspectionSpecialModeCard({ canManage, step }: { canManage: boolean; step?: number }) {
  const t = useTranslations("inspectionDay.special");
  const { controls, loaded, refresh } = useJournalControls();
  const [saving, setSaving] = useState(false);
  const on = loaded && controls.specialMode;

  async function toggle(specialMode: boolean) {
    setSaving(true);
    try {
      await saveJournalControls({ specialMode });
      await refresh();
      toast.success(t("saved"));
    } catch {
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      id="special-mode"
      className="scroll-mt-24 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
      data-inspection-special-mode={loaded ? (on ? "on" : "off") : "loading"}
      data-inspection-step={step}
    >
      <div className="flex items-start gap-3">
        {step ? (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#5566f6] text-[15px] font-semibold text-white tabular-nums">
            {step}
          </span>
        ) : (
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-2xl transition-colors duration-200 ${
              on ? "bg-[#5566f6] text-white" : "bg-[#eef1ff] text-[#5566f6]"
            }`}
          >
            <ShieldCheck className="size-5" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("title")}</h2>
            {loaded ? (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${
                  on ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#f5f6ff] text-[#3848c7]"
                }`}
              >
                {on ? t("on") : t("off")}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[14px] text-[#6f7282]">{t("lead")}</p>
        </div>
        <Switch
          aria-label={t("title")}
          checked={on}
          disabled={!canManage || !loaded || saving}
          onCheckedChange={(value) => void toggle(value)}
          className="mt-2"
        />
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-3">
        {(["effect1", "effect2", "effect3"] as const).map((key) => (
          <li key={key} className="rounded-2xl bg-[#fafbff] px-3.5 py-2.5 text-[13.5px] leading-[1.5] text-[#3c4053]">
            {t(key)}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-[#6f7282]">{canManage ? t("keeps") : t("askManager")}</p>
    </section>
  );
}
