"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * D8 — psychological progress-bar для долгих операций (AI report,
 * heavy export'ов). Двигается «само» с замедлением — юзер не думает
 * «зависло». На 95% останавливается, чтобы фактический результат
 * пришёл позже и кончился ровно на 100%.
 *
 * Использование:
 *   const [busy, setBusy] = useState(false);
 *   ...
 *   {busy ? <GlowLoader label="Анализирую данные..." /> : null}
 */
export function GlowLoader({
  label,
  /** Через сколько секунд бар должен остановиться у 95% (синхронизировать
   *  с реальным временем операции). Default — 20s. */
  targetSeconds = 20,
}: {
  label?: string;
  targetSeconds?: number;
}) {
  const t = useTranslations("sharedUi.glowLoader");
  const [pct, setPct] = useState(2);

  useEffect(() => {
    let frame = 0;
    const start = Date.now();
    const id = window.setInterval(() => {
      frame += 1;
      const elapsed = (Date.now() - start) / 1000;
      // Asymptotic — приближается к 95% но никогда не достигает.
      const next = 95 * (1 - Math.exp(-elapsed / (targetSeconds / 3)));
      setPct(Math.max(2, Math.round(next)));
      if (next > 94.5) window.clearInterval(id);
    }, 200);
    return () => window.clearInterval(id);
  }, [targetSeconds]);

  return (
    <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-[#3c4053]">{label ?? t("loading")}</span>
        <span className="text-[12px] font-semibold tabular-nums text-[#3848c7]">
          {pct}%
        </span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#ececf4]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#5566f6] via-[#7a5cff] to-[#5566f6] transition-all duration-300"
          style={{
            width: `${pct}%`,
            backgroundSize: "200% 100%",
            animation: "glow-shift 2s linear infinite",
          }}
        />
      </div>
      <style>{`
        @keyframes glow-shift {
          0% { background-position: 0% 0%; }
          100% { background-position: 200% 0%; }
        }
      `}</style>
    </div>
  );
}
