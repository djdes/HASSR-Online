import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MessageSquareHeart } from "lucide-react";

import { COMPANY_PHONE, COMPANY_TELEGRAM } from "@/lib/company-contacts";
import { db } from "@/lib/db";
import { isTrialFeedbackAnswer, TRIAL_FEEDBACK_ANSWERS, TRIAL_FEEDBACK_COMMENT_MAX } from "@/lib/trial-feedback";
import { verifyTrialFeedbackToken } from "@/lib/trial-feedback-token";

import { TrialFeedbackForm } from "./trial-feedback-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Отзыв о пробном периоде",
  robots: { index: false, follow: false },
};

/**
 * `/trial-feedback?t=<токен>&a=<ответ>` — куда ведут кнопки письма «Удалось
 * оценить электронные журналы?» (спека trial-emails-rename-2026-11). Переход
 * ничего не записывает (почтовые сканеры открывают ссылки): ответ уходит
 * кнопкой «Отправить», комментарий — по желанию.
 */
export default async function TrialFeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = typeof params.t === "string" ? params.t : null;
  const preset = typeof params.a === "string" && isTrialFeedbackAnswer(params.a) ? params.a : null;
  const t = await getTranslations("trialFeedbackPage");
  const claims = verifyTrialFeedbackToken(token);
  const organization = claims
    ? await db.organization.findUnique({ where: { id: claims.organizationId }, select: { name: true } }).catch(() => null)
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fafbff] px-4 py-10">
      <section className="w-full max-w-[520px] rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_20px_60px_-30px_rgba(11,16,36,0.25)] sm:p-8">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <MessageSquareHeart className="size-6" />
        </div>
        {claims && organization && token ? (
          <>
            <h1 className="mt-5 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">{t("title")}</h1>
            <p className="mt-2 text-[15px] leading-[1.6] text-[#3c4053]">{t("lead", { organization: organization.name })}</p>
            <TrialFeedbackForm
              token={token}
              preset={preset}
              commentMax={TRIAL_FEEDBACK_COMMENT_MAX}
              copy={{
                answers: Object.fromEntries(TRIAL_FEEDBACK_ANSWERS.map((answer) => [answer, t(`answers.${answer}`)])) as Record<(typeof TRIAL_FEEDBACK_ANSWERS)[number], string>,
                hints: Object.fromEntries(TRIAL_FEEDBACK_ANSWERS.map((answer) => [answer, t(`hints.${answer}`)])) as Record<(typeof TRIAL_FEEDBACK_ANSWERS)[number], string>,
                commentLabel: t("commentLabel"),
                commentPlaceholder: t("commentPlaceholder"),
                submit: t("submit"),
                sending: t("sending"),
                thanksTitle: t("thanksTitle"),
                thanksBody: t("thanksBody"),
                chooseAnswer: t("chooseAnswer"),
                failed: t("failed"),
              }}
            />
          </>
        ) : (
          <>
            <h1 className="mt-5 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">{t("invalidTitle")}</h1>
            <p className="mt-3 text-[15px] leading-[1.6] text-[#3c4053]">{t("invalidBody")}</p>
          </>
        )}
        <p className="mt-6 border-t border-[#ececf4] pt-4 text-[13px] leading-[1.6] text-[#6f7282]">
          {t("support")}{" "}
          <a href={`tel:${COMPANY_PHONE.tel}`} className="whitespace-nowrap font-medium text-[#0b1024]">
            {COMPANY_PHONE.display}
          </a>{" "}
          ·{" "}
          <a href={COMPANY_TELEGRAM.url} className="font-medium text-[#3848c7]">
            {COMPANY_TELEGRAM.handle}
          </a>{" "}
          ·{" "}
          <Link href="/" className="font-medium text-[#3848c7]">
            wesetup.ru
          </Link>
        </p>
      </section>
    </main>
  );
}
