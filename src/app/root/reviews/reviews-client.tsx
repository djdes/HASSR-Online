"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Star, X } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import {
  REVIEW_KINDS,
  formatPoints,
  reviewRewardFor,
  type ReviewKind,
} from "@/lib/balance/constants";
import { formatReviewDate, reviewKindLabel, reviewSphere, localizedReviewSocialText, type RootReviewView, type ReviewCopy } from "./review-presentation";

/**
 * Модерация отзывов. Одобрение — деньги, поэтому оно идёт через
 * `ConfirmDialog` с явной суммой и селектором тарифа: понизить можно, а
 * «случайно выплатить 1990 ₽» — нет.
 */
type Tab = "pending" | "approved" | "rejected";

const TAB_KEYS = {
  pending: "tabPending",
  approved: "tabApproved",
  rejected: "tabRejected",
} as const;

export function ReviewsClient({
  pending,
  approved,
  rejected,
  fromSurveyIds = [],
}: {
  pending: RootReviewView[];
  approved: RootReviewView[];
  rejected: RootReviewView[];
  /** Отзывы, оставленные из опроса «Посоветуете WeSetup коллегам?». */
  fromSurveyIds?: string[];
}) {
  const t = useTranslations("rootReviews");
  const currentT = useRef(t);
  useEffect(() => { currentT.current = t; }, [t]);
  const getCurrentCopy = () => currentT.current;
  const [tab, setTab] = useState<Tab>("pending");
  const fromSurvey = useMemo(() => new Set(fromSurveyIds), [fromSurveyIds]);
  const rows = tab === "pending" ? pending : tab === "approved" ? approved : rejected;
  const counts = {
    pending: pending.length,
    approved: approved.length,
    rejected: rejected.length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TAB_KEYS) as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex h-10 items-center gap-2 rounded-2xl px-4 text-[14px] font-medium transition-colors ${
              tab === key
                ? "bg-[#5566f6] text-white"
                : "border border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            }`}
          >
            {t(TAB_KEYS[key])}
            <span className="tabular-nums opacity-70">{counts[key]}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">
            {tab === "pending" ? t("emptyPendingTitle") : t("emptyTitle")}
          </div>
          <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] text-[#6f7282]">
            {tab === "pending"
              ? t("emptyPendingBody")
              : t("emptyBody")}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {rows.map((review) => (
            <ReviewCard key={review.id} review={review} fromSurvey={fromSurvey.has(review.id)} getCurrentCopy={getCurrentCopy} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ review, fromSurvey, getCurrentCopy }: { review: RootReviewView; fromSurvey: boolean; getCurrentCopy: () => ReviewCopy }) {
  const t = useTranslations("rootReviews");
  const locale = useLocale();
  const router = useRouter();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [kind, setKind] = useState<ReviewKind>(review.kind);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [onLanding, setOnLanding] = useState(review.showOnLanding);

  async function approve() {
    setBusy(true);
    try {
      const response = await fetch(`/api/root/reviews/${review.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        rewardRub?: number;
        alreadyModerated?: boolean;
      };
      if (!response.ok) {
        toast.error(getCurrentCopy()("approveFailed"));
        return;
      }
      toast.success(
        body.alreadyModerated
          ? getCurrentCopy()("alreadyModerated")
          : getCurrentCopy()("approvedToast", { amount: formatPoints(body.rewardRub ?? 0) }),
      );
      router.refresh();
    } catch {
      toast.error(getCurrentCopy()("networkError"));
    } finally {
      setBusy(false);
      setApproveOpen(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      const response = await fetch(`/api/root/reviews/${review.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(getCurrentCopy()("rejectFailed"));
        return;
      }
      toast.success(getCurrentCopy()("rejectedToast"));
      setReason("");
      router.refresh();
    } catch {
      toast.error(getCurrentCopy()("networkError"));
    } finally {
      setBusy(false);
      setRejectOpen(false);
    }
  }

  async function toggleLanding(next: boolean) {
    setOnLanding(next);
    try {
      const response = await fetch(`/api/root/reviews/${review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showOnLanding: next }),
      });
      if (!response.ok) throw new Error();
      toast.success(getCurrentCopy()(next ? "landingShown" : "landingHidden"));
    } catch {
      setOnLanding(!next);
      toast.error(getCurrentCopy()("visibilityFailed"));
    }
  }

  async function copySocial() {
    try {
      await navigator.clipboard.writeText(localizedReviewSocialText(review, t));
      toast.success(getCurrentCopy()("copied"));
    } catch {
      toast.error(getCurrentCopy()("copyFailed"));
    }
  }

  return (
    <article className="rounded-2xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] font-semibold text-[#0b1024]">
            {review.anonymous ? t("anonymousAuthor") : review.authorName}
          </div>
          <div className="mt-0.5 text-[13.5px] text-[#6f7282]">
            {/* У анонимного на сайте — только сфера; организацию модератор
                видит, чтобы понимать, кому начисляет. */}
            {review.anonymous
              ? t("anonymousDetails", { hasSphere: review.organizationSphere ? "yes" : "no", sphere: reviewSphere(review, t) })
              : review.place}{" "}
            · {review.organizationName} ·{" "}
            {formatReviewDate(review.createdAt, locale)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {review.anonymous ? (
            <span
              className="rounded-full bg-[#fff8eb] px-2.5 py-1 text-[12px] font-medium text-[#a16d32]"
              title={t("anonymousTip")}
              data-testid="review-anonymous-badge"
            >
              {t("anonymousBadge")}
            </span>
          ) : null}
          {fromSurvey ? (
            <span
              className="rounded-full bg-[#eef1ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7]"
              title={t("surveyTip")}
              data-testid="review-from-survey"
            >
              {t("surveyBadge")}
            </span>
          ) : null}
          <span className="rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] text-[#3848c7]">
            {reviewKindLabel(review.kind, t)}
          </span>
          {review.status === "approved" ? (
            <span className="rounded-full bg-[#ecfdf5] px-2.5 py-1 text-[12px] text-[#116b2a]">
              {t("credited", { amount: formatPoints(review.rewardRub) })}
            </span>
          ) : (
            <span className="rounded-full bg-[#fff8eb] px-2.5 py-1 text-[12px] text-[#a16d32]">
              {t.rich("suggested", { amount: formatPoints(review.suggestedRewardRub), reward: (chunks) => <span data-testid="review-suggested-reward">{chunks}</span> })}
            </span>
          )}
        </div>
      </div>

      {review.rating ? (
        <div className="mt-3 flex gap-0.5">
          {[1, 2, 3, 4, 5].map((value) => (
            <Star
              key={value}
              className={`size-4 ${
                value <= (review.rating ?? 0)
                  ? "fill-[#f5b301] text-[#f5b301]"
                  : "text-[#dcdfed]"
              }`}
            />
          ))}
        </div>
      ) : null}

      <blockquote className="mt-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[14px] leading-[1.6] text-[#3c4053]">
        «{review.text}»
      </blockquote>

      {review.mediaUrl ? (
        <div className="mt-3">
          {review.kind === "video" ? (
            <video
              controls
              preload="metadata"
              src={review.mediaUrl}
              className="max-h-[320px] w-full rounded-2xl bg-black"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={review.mediaUrl}
              alt={t("mediaAlt")}
              className="max-h-[320px] rounded-2xl object-contain"
            />
          )}
        </div>
      ) : null}

      {review.status === "rejected" && review.rejectReason ? (
        <p className="mt-3 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]">
          {t("rejectionReason", { reason: review.rejectReason })}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {review.status === "pending" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setApproveOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {t("approve")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejectOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#a13a32] transition-colors hover:bg-[#fff4f2] disabled:opacity-60"
            >
              <X className="size-4" />
              {t("reject")}
            </button>
          </>
        ) : null}

        <button
          type="button"
          onClick={copySocial}
          className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          <Copy className="size-4 text-[#5566f6]" />
          {t("copy")}
        </button>

        {review.status === "approved" ? (
          <label className="ml-auto inline-flex items-center gap-2 text-[13.5px] text-[#3c4053]">
            {t("onLanding")}
            <Switch checked={onLanding} onCheckedChange={toggleLanding} />
          </label>
        ) : null}
      </div>

      <ConfirmDialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        onConfirm={approve}
        title={t("approveTitle", { amount: formatPoints(reviewRewardFor(kind, review.anonymous)) })}
        description={t("approveDescription", { organization: review.organizationName })}
        bullets={[
          ...(review.anonymous
            ? [
                {
                  label: t("anonymousBullet"),
                  tone: "info" as const,
                },
              ]
            : []),
          { label: t("landingBullet") },
          { label: t("duplicateBullet"), tone: "info" },
        ]}
        confirmLabel={t("approve")}
      >
        <div className="space-y-2">
          <div className="text-[13px] font-medium text-[#0b1024]">
            {t("rewardType")}
          </div>
          <div className="flex flex-wrap gap-2">
            {REVIEW_KINDS.map((option) => (
              <button
                key={option}
                type="button"
                disabled={option !== "text" && !review.mediaUrl}
                onClick={() => setKind(option)}
                className={`inline-flex h-9 items-center gap-2 rounded-2xl px-3 text-[13px] font-medium transition-colors ${
                  kind === option
                    ? "bg-[#5566f6] text-white"
                    : "border border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#f5f6ff]"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {reviewKindLabel(option, t)}
                <span className="tabular-nums opacity-80">
                  {formatPoints(reviewRewardFor(option, review.anonymous))}
                </span>
              </button>
            ))}
          </div>
          <p className="text-[12px] text-[#6f7282]">
            {t("downgradeHelp")}
          </p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        onConfirm={reject}
        title={t("rejectTitle")}
        description={t("rejectDescription")}
        confirmLabel={t("reject")}
        variant="danger"
        confirmDisabled={reason.trim().length < 3}
      >
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value.slice(0, 500))}
          rows={3}
          placeholder={t("rejectPlaceholder")}
          className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />
      </ConfirmDialog>
    </article>
  );
}
