"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { saveJournalControls, useJournalControls } from "@/components/journals/journal-controls-provider";
import type { SensorJournalCode } from "@/lib/journal-controls";

export function SensorCameraSetting({ code }: { code: SensorJournalCode }) {
  const t = useTranslations("journalUi.sensorCamera");
  const { controls, loaded, apply } = useJournalControls();
  const [saving, setSaving] = useState(false);
  return <div className="flex items-start justify-between gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
    <div><p className="text-[14px] font-medium text-[#0b1024]">{t("title")}</p><p className="mt-1 text-[13px] text-[#6f7282]">{t("hint")}</p></div>
    <Switch aria-label={t("title")} checked={controls.sensorCamera[code] === true} disabled={!loaded || saving} onCheckedChange={async (enabled) => {
      setSaving(true);
      try { apply(await saveJournalControls({ camera: { code, enabled } })); toast.success(t("saved")); }
      catch (error) { toast.error(error instanceof Error ? error.message : t("saveFailed")); }
      finally { setSaving(false); }
    }} />
  </div>;
}
