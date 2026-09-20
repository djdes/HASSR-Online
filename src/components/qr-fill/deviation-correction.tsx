"use client";

import { AlertTriangle } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";

/**
 * Обязательное «Что сделали» при замере вне нормы.
 *
 * Раньше при выходе за норму уходило только уведомление, а в журнале
 * оставалось голое число — для проверки СанПиН этого мало: нужна и
 * причина, и действие. Текст уходит в `corrections` записи журнала,
 * откуда его уже читают бланк и печать.
 *
 * Чипы — самые частые ответы в один тап; поле ниже остаётся для своего
 * текста и правит тот же самый ответ.
 */
export const QR_FILL_CORRECTION_PRESETS = [
  "Сообщил руководителю",
  "Вызвал мастера",
  "Переложил продукты",
  "Повторю замер через 30 минут",
] as const;

type Props = {
  /** Что именно вышло за норму — «Температура вне нормы». */
  title: string;
  /** Что будет, если сохранить как есть. */
  hint?: string;
  value: string;
  onChange: (next: string) => void;
};

export function DeviationCorrection({ title, hint, value, onChange }: Props) {
  return (
    <div className="rounded-2xl border border-[#ffe9b0] bg-[#fff8eb] p-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#7a4a00]" />
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-[#7a4a00]">{title}</div>
          <p className="mt-1 text-[13px] leading-relaxed text-[#7a4a00]">
            {hint ?? "Руководитель получит уведомление."} Напишите, что вы
            сделали — без этого замер не сохранится.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {QR_FILL_CORRECTION_PRESETS.map((preset) => {
          const active = value.trim() === preset;
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? "" : preset)}
              className={`rounded-full border px-3 py-2 text-[13px] font-medium transition-colors duration-150 ${
                active
                  ? "border-[#5566f6] bg-[#5566f6] text-white"
                  : "border-[#f2d78a] bg-white text-[#0b1024] hover:border-[#5566f6]/50 hover:bg-[#f5f6ff]"
              }`}
            >
              {preset}
            </button>
          );
        })}
      </div>

      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        maxLength={300}
        placeholder="Или напишите своими словами"
        className="mt-3 min-h-[72px] rounded-2xl border-[#f2d78a] bg-white px-4 py-3 text-[15px] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
      />
    </div>
  );
}
