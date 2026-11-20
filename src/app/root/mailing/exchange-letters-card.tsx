"use client";

import { useState } from "react";
import { CheckCircle2, Info, MailCheck, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import type { SampleLettersResult } from "@/lib/directory-exchange/sample-letters";

import { CARD, Notice, OUTLINE, SECTION_LABEL } from "./ui";

const SAMPLE_LETTERS_URL = "/api/root/directory-exchange/test-letters";

/**
 * Проверка писем обмена справочниками с другой компанией на проде (серия A,
 * Р3): образцы обоих писем — на почту того, кто нажал, и что ответил почтовый
 * сервер по каждому.
 */
export function ExchangeLettersCard() {
  const t = useTranslations("rootMailingShellAudience");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SampleLettersResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(SAMPLE_LETTERS_URL, { method: "POST", cache: "no-store" });
      const data = (await res.json().catch(() => null)) as (Partial<SampleLettersResult> & { code?: string }) | null;
      if (!res.ok || !data || data.ok !== true) {
        setResult(null);
        setError(data?.code === "no_email" ? t("exchangeLetters.noEmail") : t("exchangeLetters.failed"));
        return;
      }
      setResult(data as SampleLettersResult);
    } catch {
      setResult(null);
      setError(t("exchangeLetters.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={CARD} data-testid="exchange-letters-card">
      <div className={SECTION_LABEL}>{t("exchangeLetters.label")}</div>
      <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("exchangeLetters.title")}</h2>
      <p className="mt-1 max-w-[720px] text-[14px] leading-relaxed text-[#6f7282]">{t("exchangeLetters.description")}</p>
      <button
        type="button"
        className={`${OUTLINE} mt-4`}
        disabled={busy}
        onClick={() => void send()}
        data-testid="exchange-letters-send"
      >
        <MailCheck className="size-4 text-[#5566f6]" />
        {busy ? t("exchangeLetters.sending") : t("exchangeLetters.send")}
      </button>

      {error ? (
        <div className="mt-4">
          <Notice tone="danger" icon={<XCircle />} testId="exchange-letters-error">
            {error}
          </Notice>
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 space-y-3" data-testid="exchange-letters-result">
          <div className="text-[14px] text-[#0b1024] [overflow-wrap:anywhere]">
            {t("exchangeLetters.sentTo", { email: result.to })}
          </div>
          <ul className="space-y-2">
            {result.letters.map((letter) => (
              <li
                key={letter.kind}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#ececf4] px-4 py-3 text-[14px]"
                data-testid={`exchange-letters-${letter.kind}`}
              >
                <span className="font-medium text-[#0b1024]">
                  {letter.kind === "request" ? t("exchangeLetters.kinds.request") : t("exchangeLetters.kinds.decision")}
                </span>
                {!result.configured ? (
                  <span className="text-[13px] text-[#6f7282]">{t("exchangeLetters.logged")}</span>
                ) : letter.delivered ? (
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#116b2a]">
                    <CheckCircle2 className="size-4" />
                    {t("exchangeLetters.delivered")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#a13a32]">
                    <XCircle className="size-4" />
                    {t("exchangeLetters.notDelivered")}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!result.configured ? (
            <Notice tone="info" icon={<Info />} testId="exchange-letters-not-configured">
              {t("exchangeLetters.notConfigured")}
            </Notice>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
