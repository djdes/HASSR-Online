"use client";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, X } from "lucide-react";

type BonusStatus = "pending" | "approved" | "rejected" | string;

export type BonusFeedItem = {
  id: string;
  status: BonusStatus;
  amountKopecks: number;
  photoUrl: string | null;
  photoTakenAt: string | null;
  claimedAt: string;
  rejectedAt: string | null;
  rejectedReason: string | null;
  user: { id: string; name: string };
  template: { code: string; name: string };
};

/**
 * Manager-feed премий (Phase 3, шаг 3.5).
 *
 * Отображает все BonusEntry за период, даёт inline-reject через
 * `POST /api/bonus-entries/[id]/reject` с обязательной причиной.
 * Фото открывается в новой вкладке (на dashboard, не mini-app, поэтому
 * `target="_blank"` приемлем).
 */
export function BonusFeedTable({ items }: { items: BonusFeedItem[] }) {
  const t = useTranslations("bonusesUi.bonusFeedTable");
  const locale = useLocale();
  const router = useRouter();
  const [activeReject, setActiveReject] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openReject(id: string) {
    setActiveReject(id);
    setReason("");
    setError(null);
  }

  function closeReject() {
    setActiveReject(null);
    setReason("");
    setError(null);
  }

  async function submitReject() {
    if (!activeReject) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError(t("reasonTooShort"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch(
        `/api/bonus-entries/${encodeURIComponent(activeReject)}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: trimmed }),
        }
      );
      const data = (await resp.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!resp.ok) {
        setError(data.error ?? `HTTP ${resp.status}`);
        return;
      }
      closeReject();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13.5px]">
            <thead className="border-b border-[#ececf4] bg-[#fafbff]">
              <tr className="text-[12px] uppercase tracking-[0.08em] text-[#6f7282]">
                <th className="px-5 py-3 font-medium">{t("colTime")}</th>
                <th className="px-5 py-3 font-medium">{t("colEmployee")}</th>
                <th className="px-5 py-3 font-medium">{t("colJournal")}</th>
                <th className="px-5 py-3 font-medium">{t("colAmount")}</th>
                <th className="px-5 py-3 font-medium">{t("colPhoto")}</th>
                <th className="px-5 py-3 font-medium">{t("colStatus")}</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-[#ececf4] last:border-b-0 hover:bg-[#fafbff]/60"
                >
                  <td className="px-5 py-4 align-middle text-[#0b1024]">
                    {formatDateTime(item.claimedAt, locale)}
                  </td>
                  <td className="px-5 py-4 align-middle text-[#0b1024]">
                    {item.user.name}
                  </td>
                  <td className="px-5 py-4 align-middle">
                    <div className="text-[#0b1024]">{item.template.name}</div>
                    <div className="font-mono text-[11.5px] text-[#9b9fb3]">
                      {item.template.code}
                    </div>
                  </td>
                  <td className="px-5 py-4 align-middle font-semibold tabular-nums text-[#116b2a]">
                    +{formatRubles(item.amountKopecks, locale)} ₽
                  </td>
                  <td className="px-5 py-4 align-middle">
                    {item.photoUrl ? (
                      <a
                        href={item.photoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                        title={t("openPhoto")}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.photoUrl}
                          alt={t("proofAlt")}
                          className="size-12 rounded-xl object-cover ring-1 ring-[#ececf4] transition hover:ring-[#5566f6]/40"
                        />
                      </a>
                    ) : (
                      <span className="rounded-full bg-[#fff4f2] px-2.5 py-1 text-[12px] text-[#a13a32]">
                        {t("noPhoto")}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 align-middle">
                    <BonusStatusPill
                      status={item.status}
                      reason={item.rejectedReason}
                    />
                  </td>
                  <td className="px-5 py-4 align-middle text-right">
                    {item.status !== "rejected" ? (
                      <button
                        type="button"
                        onClick={() => openReject(item.id)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#ececf4] bg-white px-3 text-[12.5px] font-medium text-[#a13a32] transition-colors hover:border-[#a13a32]/30 hover:bg-[#fff4f2]"
                      >
                        <X className="size-3.5" strokeWidth={2.4} />
                        {t("revoke")}
                      </button>
                    ) : (
                      <span className="text-[12px] text-[#9b9fb3]">
                        {t("revoked")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {activeReject ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0b1024]/35 px-4 py-6 sm:items-center">
          <BodyScrollLock />
          <div className="w-full max-w-md rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_30px_80px_-30px_rgba(11,16,36,0.45)]">
            <div className="text-[18px] font-semibold text-[#0b1024]">
              {t("revokeTitle")}
            </div>
            <p className="mt-1.5 text-[13px] text-[#6f7282]">
              {t("revokeHint")}
            </p>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t("reasonPlaceholder")}
              className="mt-4 w-full rounded-2xl border border-[#dcdfed] bg-white px-3 py-2.5 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              autoFocus
            />
            {error ? (
              <div className="mt-3 rounded-xl bg-[#fff4f2] px-3 py-2 text-[12.5px] text-[#a13a32]">
                {error}
              </div>
            ) : null}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeReject}
                disabled={submitting}
                className="inline-flex h-10 items-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] hover:bg-[#fafbff] disabled:opacity-50"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={submitReject}
                disabled={submitting}
                className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#a13a32] px-4 text-[13.5px] font-semibold text-white shadow-[0_8px_24px_-12px_rgba(161,58,50,0.55)] hover:bg-[#8c322b] disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("revoking")}
                  </>
                ) : (
                  t("revoke")
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function BonusStatusPill({
  status,
  reason,
}: {
  status: BonusStatus;
  reason: string | null;
}) {
  const t = useTranslations("bonusesUi.bonusFeedTable");
  if (status === "approved") {
    return (
      <span className="rounded-full bg-[#ecfdf5] px-2.5 py-1 text-[12px] font-medium text-[#116b2a]">
        {t("statusApproved")}
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span
        className="rounded-full bg-[#fff4f2] px-2.5 py-1 text-[12px] font-medium text-[#a13a32]"
        title={reason ?? undefined}
      >
        {t("revoked")}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-[#fff7ed] px-2.5 py-1 text-[12px] font-medium text-[#9a3412]">
      {t("statusPending")}
    </span>
  );
}

const DATE_LOCALES: Record<string, string> = { ru: "ru-RU", en: "en-GB", uz: "uz-UZ" };

function formatRubles(kopecks: number, locale: string): string {
  if (!Number.isFinite(kopecks)) return "0";
  const rubles = kopecks / 100;
  return rubles.toLocaleString(DATE_LOCALES[locale] ?? "ru-RU", {
    minimumFractionDigits: rubles % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const date = d.toLocaleDateString(DATE_LOCALES[locale] ?? "ru-RU", {
      day: "2-digit",
      month: "short",
    });
    const time = d.toLocaleTimeString(DATE_LOCALES[locale] ?? "ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${date}, ${time}`;
  } catch {
    return "—";
  }
}
