import type { Metadata } from "next";
import { createTranslator } from "use-intl/core";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { loadMessages } from "@/i18n/messages";
import { localizedHref, siteLanguageAlternates } from "@/i18n/site-locale";
import { ogImages, twitterImages } from "@/lib/og-image";
import Link from "@/components/i18n/localized-link";
import {
  ArrowRight,
  BadgePercent,
  Building2,
  Coins,
  Eye,
  FileText,
  Handshake,
  LayoutDashboard,
  Link2,
  Mail,
  Palette,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";
import { authOptions } from "@/lib/auth";
import { DEFAULT_OG_IMAGES, DEFAULT_TWITTER_CARD, DEFAULT_TWITTER_IMAGES } from "@/lib/meta-defaults";
import { PLATFORM_BADGE_TEXT } from "@/lib/partners/branding";
import { formatRubFixed } from "@/lib/partners/rewards";
import { getCurrentRewardRule } from "@/lib/partners/schema-extras";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getSiteLocale();
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "publicPartners" });
  const title = t("metadata.title");
  const description = t("metadata.description");
  const url = `https://wesetup.ru${localizedHref("/partners", locale)}`;
  const image = { title, subtitle: description, kind: "page" as const, locale };
  return {
    title,
    description,
    alternates: { canonical: url, languages: siteLanguageAlternates("/partners") },
    openGraph: { type: "website", locale: { ru: "ru_RU", en: "en_GB", uz: "uz_UZ" }[locale], siteName: "WeSetup", url, title, description, images: locale === "ru" ? [...DEFAULT_OG_IMAGES] : ogImages(image) },
    twitter: { card: DEFAULT_TWITTER_CARD, title, description, images: locale === "ru" ? [...DEFAULT_TWITTER_IMAGES] : twitterImages(image) },
  };
}

/**
 * Публичная страница партнёрской программы: для кого, что даёт, как
 * считается вознаграждение (цифры — из действующей версии правил) и
 * условия участия (#agreement — на неё ссылаются форма заявки и кабинет).
 * Кнопка «Стать партнёром» ведёт на форму в настройках организации:
 * заявку подаёт зарегистрированный пользователь, чтобы кабинет партнёра
 * сразу связался с его аккаунтом.
 */
export default async function PartnersPage() {
  const [rule, session] = await Promise.all([getCurrentRewardRule(), getServerSession(authOptions)]);
  const locale = await getSiteLocale();
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "publicPartners" });
  const applyHref = session?.user ? "/settings/partner" : "/register?next=%2Fsettings%2Fpartner";

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <PublicHeader />
      <main className="mx-auto max-w-[1000px] space-y-10 px-4 py-12 sm:px-6">
        <section className="relative overflow-hidden rounded-3xl border border-[#ececf4] bg-[#0b1024] text-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.55)]">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 -top-24 size-[420px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
            <div className="absolute -bottom-40 -right-32 size-[460px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
          </div>
          <div className="relative z-10 p-8 md:p-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12px] uppercase tracking-[0.18em] text-white/70"><Handshake className="size-3.5" />{t("hero.eyebrow")}</div>
            <h1 className="mt-5 max-w-[720px] text-[clamp(2rem,2.4vw+1.4rem,3rem)] font-semibold leading-[1.08] tracking-[-0.03em]">{t("hero.title")}</h1>
            <p className="mt-4 max-w-[600px] text-[16px] leading-[1.6] text-white/75">{t("hero.body", { subscriptionPercent: String(rule.subscriptionPercent), hardwarePercent: String(rule.hardwarePercent) })}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={applyHref}
                className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
              >{t("hero.apply")}<ArrowRight className="size-4" /></Link>
              <a
                href="#agreement"
                className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/20 bg-white/5 px-6 text-[15px] font-medium text-white transition-colors hover:bg-white/10"
              >{t("hero.conditions")}</a>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-[26px] font-semibold tracking-[-0.02em]">{t("audience.title")}</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Feature icon={ShieldCheck} title={t("audience.consultants.title")}>{t("audience.consultants.body")}</Feature>
            <Feature icon={Wrench} title={t("audience.integrators.title")}>{t("audience.integrators.body")}</Feature>
            <Feature icon={Building2} title={t("audience.chains.title")}>{t("audience.chains.body")}</Feature>
          </div>
        </section>

        <section className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6 md:p-8">
          <h2 className="text-[26px] font-semibold tracking-[-0.02em]">{t("benefits.title")}</h2>
          <div className="mt-5 grid gap-x-8 gap-y-5 md:grid-cols-2">
            <Point icon={LayoutDashboard} title={t("benefits.workspace.title")}>{t("benefits.workspace.body")}</Point>
            <Point icon={Palette} title={t("benefits.branding.title")}>{t("benefits.branding.body", { platformBadge: PLATFORM_BADGE_TEXT })}</Point>
            <Point icon={Link2} title={t("benefits.pageCode.title")}>{t("benefits.pageCode.body")}</Point>
            <Point icon={Eye} title={t("benefits.clientAccess.title")}>{t("benefits.clientAccess.body")}</Point>
            <Point icon={Mail} title={t("benefits.invitations.title")}>{t("benefits.invitations.body")}</Point>
            <Point icon={Coins} title={t("benefits.rewards.title")}>{t("benefits.rewards.body")}</Point>
          </div>
        </section>

        <section>
          <h2 className="text-[26px] font-semibold tracking-[-0.02em]">{t("rewards.title")}</h2>
          <p className="mt-2 max-w-[640px] text-[15px] leading-[1.6] text-[#3c4053]">{t("rewards.ruleVersion", { version: String(rule.version) })}</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Reward value={`${rule.subscriptionPercent}%`} label={t("rewards.subscription.label")}>{t("rewards.subscription.body", { subscriptionMonths: String(rule.subscriptionMonths) })}</Reward>
            <Reward value={`${rule.hardwarePercent}%`} label={t("rewards.hardware.label")}>{t("rewards.hardware.body")}</Reward>
            <Reward value={formatRubFixed(rule.bonusAmountRub)} label={t("rewards.bonus.label")}>{t("rewards.bonus.body", { bonusAfterPayments: String(rule.bonusAfterPayments) })}</Reward>
          </div>
          <ul className="mt-5 grid gap-2 text-[14px] leading-[1.6] text-[#3c4053] sm:grid-cols-2">
            <li className="flex gap-2"><BadgePercent className="mt-1 size-4 shrink-0 text-[#5566f6]" />{t("rewards.note1", { subscriptionRewardRub: String(formatRubFixed((1990 * rule.subscriptionPercent) / 100)) })}</li>
            <li className="flex gap-2"><BadgePercent className="mt-1 size-4 shrink-0 text-[#5566f6]" />{t("rewards.note2", { hardwareRewardRub: String(formatRubFixed((17750 * rule.hardwarePercent) / 100)) })}</li>
            <li className="flex gap-2"><FileText className="mt-1 size-4 shrink-0 text-[#5566f6]" />{t("rewards.note3")}</li>
            <li className="flex gap-2"><FileText className="mt-1 size-4 shrink-0 text-[#5566f6]" />{t("rewards.note4", { minPayoutRub: String(formatRubFixed(rule.minPayoutRub)) })}</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[26px] font-semibold tracking-[-0.02em]">{t("steps.title")}</h2>
          <ol className="mt-5 grid gap-4 md:grid-cols-3">
            <Step n={1} title={t("steps.application.title")}>{t("steps.application.body")}</Step>
            <Step n={2} title={t("steps.review.title")}>{t("steps.review.body")}</Step>
            <Step n={3} title={t("steps.launch.title")}>{t("steps.launch.body")}</Step>
          </ol>
          <div className="mt-6">
            <Link
              href={applyHref}
              className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
            >{t("steps.apply")}<ArrowRight className="size-4" /></Link>
          </div>
        </section>

        <section id="agreement" className="scroll-mt-24 rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-8">
          <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{t("agreement.eyebrow")}</div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em]">{t("agreement.title")}</h2>
          <p className="mt-2 text-[14px] leading-[1.6] text-[#3c4053]">{t.rich("agreement.summary", { agreementLink: (chunks) => <Link href="/partner-agreement" className="text-[#3848c7] underline-offset-2 hover:underline">{chunks}</Link> })}</p>
          <ol className="mt-5 space-y-3 text-[14px] leading-[1.6] text-[#3c4053]">
            <Clause n="1">{t("agreement.clause1")}</Clause>
            <Clause n="2">{t("agreement.clause2")}</Clause>
            <Clause n="3">{t("agreement.clause3")}</Clause>
            <Clause n="4">{t("agreement.clause4", { subscriptionPercent: String(rule.subscriptionPercent), subscriptionMonths: String(rule.subscriptionMonths), hardwarePercent: String(rule.hardwarePercent), bonusAmountRub: String(formatRubFixed(rule.bonusAmountRub)), bonusAfterPayments: String(rule.bonusAfterPayments) })}</Clause>
            <Clause n="5">{t("agreement.clause5", { minPayoutRub: String(formatRubFixed(rule.minPayoutRub)) })}</Clause>
            <Clause n="6">{t("agreement.clause6", { platformBadge: PLATFORM_BADGE_TEXT })}</Clause>
            <Clause n="7">{t("agreement.clause7")}</Clause>
            <Clause n="8">{t("agreement.clause8")}</Clause>
          </ol>
          <p className="mt-4 text-[13px] text-[#6f7282]">{t.rich("agreement.contact", { programEmailLink: (chunks) => <a href="mailto:partners@wesetup.ru" className="text-[#3848c7]">{chunks}</a> })}</p>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

function Feature({ icon: Icon, title, children }: { icon: typeof Handshake; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <span className="flex size-10 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
        <Icon className="size-5" />
      </span>
      <h3 className="mt-3 text-[16px] font-semibold tracking-[-0.01em]">{title}</h3>
      <p className="mt-1.5 text-[14px] leading-[1.6] text-[#3c4053]">{children}</p>
    </div>
  );
}

function Point({ icon: Icon, title, children }: { icon: typeof Handshake; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-white text-[#5566f6] shadow-[0_0_0_1px_rgba(236,236,244,1)]">
        <Icon className="size-4" />
      </span>
      <div>
        <div className="text-[15px] font-semibold">{title}</div>
        <p className="mt-1 text-[14px] leading-[1.6] text-[#3c4053]">{children}</p>
      </div>
    </div>
  );
}

function Reward({ value, label, children }: { value: string; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="text-[32px] font-semibold tabular-nums tracking-[-0.02em] text-[#5566f6]">{value}</div>
      <div className="mt-1 text-[15px] font-medium">{label}</div>
      <p className="mt-1 text-[13px] leading-[1.5] text-[#6f7282]">{children}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <span className="flex size-9 items-center justify-center rounded-full bg-[#5566f6] text-[14px] font-semibold text-white">{n}</span>
      <h3 className="mt-3 text-[16px] font-semibold">{title}</h3>
      <p className="mt-1.5 text-[14px] leading-[1.6] text-[#3c4053]">{children}</p>
    </li>
  );
}

function Clause({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="w-6 shrink-0 font-semibold tabular-nums text-[#3848c7]">{n}.</span>
      <span>{children}</span>
    </li>
  );
}
