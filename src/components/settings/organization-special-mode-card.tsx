"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { saveJournalControls, useJournalControls } from "@/components/journals/journal-controls-provider";

export function OrganizationSpecialModeCard() {
  const t = useTranslations("settingsManagement.organizationProfile");
  const { controls, loaded, refresh } = useJournalControls();
  const [saving, setSaving] = useState(false);
  return <section className="rounded-3xl border border-[#ececf4] bg-white p-6">
    <div className="flex items-start justify-between gap-4">
      <div><h2 className="text-[18px] font-semibold text-[#0b1024]">{t("specialMode.title")}</h2>
        <p className="mt-2 text-[14px] text-[#6f7282]">{t("specialMode.description")}</p></div>
      <Switch aria-label={t("specialMode.title")} checked={loaded && controls.specialMode} disabled={!loaded || saving} onCheckedChange={async (specialMode) => {
        setSaving(true);
        try { await saveJournalControls({ specialMode }); await refresh(); toast.success(t("form.saved")); }
        catch { toast.error(t("specialMode.saveError")); }
        finally { setSaving(false); }
      }} />
    </div>
  </section>;
}
