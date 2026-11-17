"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TrialFeedbackAnswer } from "@/lib/trial-feedback";

type Copy = {
  answers: Record<TrialFeedbackAnswer, string>;
  hints: Record<TrialFeedbackAnswer, string>;
  commentLabel: string;
  commentPlaceholder: string;
  submit: string;
  sending: string;
  thanksTitle: string;
  thanksBody: string;
  chooseAnswer: string;
  failed: string;
};

const ORDER: TrialFeedbackAnswer[] = ["good", "later", "help"];

/** Ответ на вопрос о пробном: вариант (из кнопки письма), комментарий, «Отправить». */
export function TrialFeedbackForm({
  token,
  preset,
  commentMax,
  copy,
}: {
  token: string;
  preset: TrialFeedbackAnswer | null;
  commentMax: number;
  copy: Copy;
}) {
  const [answer, setAnswer] = useState<TrialFeedbackAnswer | null>(preset);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"form" | "sending" | "done">("form");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!answer) {
      setError(copy.chooseAnswer);
      return;
    }
    setError(null);
    setState("sending");
    try {
      const res = await fetch("/api/public/trial-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token, answer, comment }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("done");
    } catch {
      setError(copy.failed);
      setState("form");
    }
  }

  if (state === "done") {
    return (
      <div className="mt-5 rounded-2xl bg-[#ecfdf5] p-4" role="status" data-testid="trial-feedback-done">
        <div className="flex items-center gap-2 text-[16px] font-semibold text-[#116b2a]">
          <CheckCircle2 className="size-5" />
          {copy.thanksTitle}
        </div>
        <p className="mt-1 text-[14px] leading-[1.55] text-[#3c4053]">{copy.thanksBody}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
      <div role="radiogroup" className="space-y-2">
        {ORDER.map((value) => (
          <label
            key={value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors duration-150",
              answer === value ? "border-[#5566f6] bg-[#f5f6ff]" : "border-[#dcdfed] hover:bg-[#fafbff]",
            )}
          >
            <input
              type="radio"
              name="answer"
              value={value}
              checked={answer === value}
              onChange={() => setAnswer(value)}
              className="mt-1 size-4 accent-[#5566f6]"
              data-testid={`trial-feedback-${value}`}
            />
            <span>
              <span className="block text-[15px] font-medium text-[#0b1024]">{copy.answers[value]}</span>
              <span className="block text-[13px] leading-[1.5] text-[#6f7282]">{copy.hints[value]}</span>
            </span>
          </label>
        ))}
      </div>
      <label className="block">
        <span className="text-[14px] font-medium text-[#0b1024]">{copy.commentLabel}</span>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={commentMax}
          rows={4}
          placeholder={copy.commentPlaceholder}
          className="mt-1.5 w-full rounded-2xl border border-[#dcdfed] px-4 py-3 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          data-testid="trial-feedback-comment"
        />
      </label>
      {error ? (
        <p role="alert" className="rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={state === "sending"}
        data-testid="trial-feedback-submit"
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-60"
      >
        {state === "sending" ? <Loader2 className="size-4 animate-spin" /> : null}
        {state === "sending" ? copy.sending : copy.submit}
      </button>
    </form>
  );
}
