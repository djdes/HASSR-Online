"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, Mail, MessageSquareHeart } from "lucide-react";
import { toast } from "sonner";

import type { ReviewCandidate } from "@/lib/review-requests";

/**
 * «Кого попросить об отзыве»: активные заведения без отзыва. Кнопка шлёт
 * главному руководителю письмо со ссылкой на форму отзыва (сервер решает,
 * можно ли: повтор раньше 30 дней — отказ). Отправленные помечаются сразу.
 */
export function ReviewRequestCandidates({ candidates }: { candidates: ReviewCandidate[] }) {
  const t = useTranslations("rootReviews.candidates");
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({});

  async function request(candidate: ReviewCandidate) {
    setBusy(candidate.organizationId);
    try {
      const response = await fetch("/api/root/reviews/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: candidate.organizationId }),
      });
      const data = (await response.json().catch(() => null)) as { email?: string; error?: string } | null;
      if (!response.ok || !data?.email) {
        toast.error(data?.error ?? t("failed"));
        return;
      }
      setSent((current) => ({ ...current, [candidate.organizationId]: data.email! }));
      toast.success(t("sentToast", { email: data.email }));
    } catch {
      toast.error(t("networkError"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6" data-testid="review-request-candidates">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <MessageSquareHeart className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("title")}</h2>
          <p className="mt-1 max-w-[760px] text-[13.5px] leading-relaxed text-[#6f7282]">{t("description")}</p>
        </div>
      </div>

      {candidates.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-[#fafbff] p-4 text-[14px] text-[#6f7282]">{t("empty")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-[#ececf4]">
          {candidates.map((candidate) => {
            const sentTo = sent[candidate.organizationId];
            return (
              <li key={candidate.organizationId} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-[#0b1024]">{candidate.name}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-[#6f7282]">
                    <span>{t("records", { count: candidate.records30 })}</span>
                    {candidate.lastNps ? (
                      <span className={candidate.promoter ? "font-medium text-[#116b2a]" : undefined}>
                        {t("nps", { score: String(candidate.lastNps.score), scale: String(candidate.lastNps.scale) })}
                      </span>
                    ) : null}
                    <span className="truncate">
                      {candidate.manager.name} · {candidate.manager.email}
                    </span>
                  </p>
                </div>
                {sentTo ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-[13.5px] font-medium text-[#116b2a]">
                    <CheckCircle2 className="size-4" aria-hidden />
                    {t("sent")}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void request(candidate)}
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
                    data-testid="review-request-button"
                  >
                    {busy === candidate.organizationId ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Mail className="size-4" aria-hidden />}
                    {t("request")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
