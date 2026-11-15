"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { SBER_INTERVALS, sberIntervalLabel, type SberSchedule } from "@/lib/sber/schedule";
import { cn } from "@/lib/utils";

/**
 * Автосверка: выключатель и интервал. Сохраняется сразу по нажатию —
 * крон на сервере читает настройку при каждом своём запуске (раз в 5 минут).
 */
export function SberScheduleForm({ initial, nextLabel }: { initial: SberSchedule; nextLabel: string | null }) {
  const router = useRouter();
  const [schedule, setSchedule] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save(next: SberSchedule) {
    const prev = schedule;
    setSchedule(next);
    setSaving(true);
    try {
      const res = await fetch("/api/root/sber/schedule", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      if (!res.ok) throw new Error("save failed");
      toast.success(next.enabled ? `Автосверка: ${sberIntervalLabel(next.intervalMinutes)}` : "Автосверка выключена");
      router.refresh();
    } catch {
      setSchedule(prev);
      toast.error("Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[14px] font-medium text-[#0b1024]">Проверять выписку автоматически</div>
          <div className="mt-0.5 text-[12.5px] text-[#6f7282]">
            {schedule.enabled
              ? nextLabel
                ? `Следующая проверка — около ${nextLabel}`
                : "Проверка по расписанию"
              : "Выключено — оплаты по счетам отмечаются только кнопкой «Проверить выписку сейчас» или вручную в карточке клиента"}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={schedule.enabled}
          aria-label="Проверять выписку автоматически"
          disabled={saving}
          onClick={() => void save({ ...schedule, enabled: !schedule.enabled })}
          className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60", schedule.enabled ? "bg-[#5566f6]" : "bg-[#dcdfed]")}
        >
          <span className={cn("absolute top-0.5 size-6 rounded-full bg-white shadow transition-[left]", schedule.enabled ? "left-[22px]" : "left-0.5")} />
        </button>
      </div>
      <div className={cn(!schedule.enabled && "opacity-50")}>
        <div className="mb-2 text-[13px] text-[#6f7282]">Как часто</div>
        <div role="radiogroup" aria-label="Как часто проверять выписку" className="flex flex-wrap gap-2">
          {SBER_INTERVALS.map((minutes) => {
            const active = schedule.intervalMinutes === minutes;
            return (
              <button
                key={minutes}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={saving || !schedule.enabled}
                onClick={() => {
                  if (!active) void save({ ...schedule, intervalMinutes: minutes });
                }}
                className={cn(
                  "h-9 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors disabled:cursor-not-allowed",
                  active ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]" : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
                )}
              >
                {minutes < 60 ? `${minutes} мин` : `${minutes / 60} ч`}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[#6f7282]">
          Каждая проверка читает выписку за 3 последних дня, поэтому редкая сверка платежи не теряет — только позже подключает тариф после оплаты.
        </p>
      </div>
    </div>
  );
}
