"use client";

import { useState } from "react";
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
        | { error: string }
        | null;
      if (!response.ok) {
        toast.error(
          (data && "error" in data && data.error) || "Не удалось запустить"
        );
        return;
      }
      const summary = data as Summary;
      if (summary.candidates === 0) {
        toast.success("Отклонений 3 дня подряд не найдено.");
      } else if (summary.created === 0) {
        toast.info(
          `Найдено кандидатов: ${summary.candidates}, но по всем уже есть открытые нарушения.`
        );
      } else {
        toast.success(
          `Создано нарушений: ${summary.created}${
            summary.skippedExisting
              ? ` · пропущено уже открытых: ${summary.skippedExisting}`
              : ""
          }`
        );
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      title="Найти оборудование с температурой вне нормы три дня подряд и открыть нарушение."
      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border-0 bg-[#5566f6]/[0.04] px-4 text-[14px] font-semibold text-[#5566f6] transition-colors hover:bg-[#5566f6]/[0.09] disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Radar className="size-4" />
      )}
      Проверить отклонения
    </button>
  );
}
