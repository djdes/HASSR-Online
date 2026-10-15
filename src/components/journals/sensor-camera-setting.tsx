"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { saveJournalControls, useJournalControls } from "@/components/journals/journal-controls-provider";
import type { SensorJournalCode } from "@/lib/journal-controls";

export function SensorCameraSetting({ code }: { code: SensorJournalCode }) {
  const { controls, loaded, apply } = useJournalControls();
  const [saving, setSaving] = useState(false);
  if (controls.specialMode) return null;
  return <div className="flex items-start justify-between gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
    <div><p className="text-[14px] font-medium text-[#0b1024]">Считывание показаний камерой</p><p className="mt-1 text-[13px] text-[#6f7282]">По умолчанию отключено. Включить для этого журнала, в том числе в форме по QR-коду.</p></div>
    <Switch aria-label="Считывание показаний камерой" checked={controls.sensorCamera[code] === true} disabled={!loaded || saving} onCheckedChange={async (enabled) => {
      setSaving(true);
      try { apply(await saveJournalControls({ camera: { code, enabled } })); toast.success("Настройка камеры сохранена"); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить"); }
      finally { setSaving(false); }
    }} />
  </div>;
}
