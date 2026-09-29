"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

/** Одна кнопка «Отписаться»: POST на тот же адрес, что и one-click из почты. */
export function UnsubscribeButton({ token, already }: { token: string; already: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">(already ? "done" : "idle");

  async function unsubscribe() {
    setState("busy");
    try {
      const res = await fetch(`/api/mailing/unsubscribe/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div
        data-testid="unsubscribe-done"
        className="mt-6 flex items-start gap-3 rounded-2xl border border-[#c8ecd6] bg-[#ecfdf5] px-4 py-3.5 text-[14px] leading-[1.55] text-[#116b2a]"
      >
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
        <span>Готово: вы отписаны от новостей и предложений — ни писем, ни рекламы в колокольчике, push и Telegram.</span>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        data-testid="unsubscribe-button"
        onClick={() => void unsubscribe()}
        disabled={state === "busy"}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-70"
      >
        {state === "busy" ? <Loader2 className="size-4 animate-spin" /> : null}
        Отписаться
      </button>
      {state === "error" ? (
        <p className="mt-3 text-[13px] text-[#a13a32]">
          Не получилось. Попробуйте ещё раз или напишите на support@wesetup.ru.
        </p>
      ) : null}
    </div>
  );
}
