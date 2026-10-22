import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { createTranslator } from "use-intl/core";
import { ArrowLeft, LogIn, Mail, ShieldCheck, Trash2, UserX } from "lucide-react";

import "@/app/mini/mini-theme.css";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { loadMessages } from "@/i18n/messages";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { localizedHref, siteLanguageAlternates } from "@/i18n/site-locale";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";

import { DeleteAccountButton, DeleteAccountThemeRoot } from "./delete-account-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getSiteLocale();
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "accountDeletion.metadata" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: `https://wesetup.ru${localizedHref("/delete-account", locale)}`,
      languages: siteLanguageAlternates("/delete-account"),
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1024",
};

const SUPPORT_EMAIL = "support@wesetup.ru";

export default async function DeleteAccountPage() {
  const locale = await getSiteLocale();
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "accountDeletion.page" });
  const flowT = createTranslator({ locale, messages, namespace: "accountDeletion.flow" });
  const session = await getServerSession(authOptions).catch(() => null);
  const userId = session?.user?.id ?? null;
  const profile = userId
    ? await db.user
        .findUnique({
          where: { id: userId },
          select: { name: true, themePreference: true },
        })
        .catch(() => null)
    : null;
  const theme = profile ? (profile.themePreference === "dark" ? "dark" : "light") : null;
  const backHref = userId ? "/mini/me" : localizedHref("/", locale);
  const loginHref = `/mini/login?next=${encodeURIComponent(localizedHref("/delete-account", locale))}`;

  return (
    <DomainMessagesBoundary namespaces={["accountDeletion"]}>
      <DeleteAccountThemeRoot theme={theme}>
        <main
          className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4"
          style={{
            paddingTop: "calc(16px + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))",
            paddingBottom: "calc(48px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))",
          }}
        >
          <Link href={backHref} className="mini-btn-ghost mini-press -ml-3.5 w-fit">
            <ArrowLeft className="size-5" />
            {userId ? t("backProfile") : t("backSite")}
          </Link>

          <section className="relative overflow-hidden rounded-3xl bg-[#0b1024] text-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.55)]">
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              <div className="absolute -left-20 -top-24 size-[260px] rounded-full bg-[#5566f6] opacity-40 blur-[90px]" />
              <div className="absolute -bottom-28 -right-20 size-[260px] rounded-full bg-[#7a5cff] opacity-30 blur-[100px]" />
            </div>
            <div className="relative z-10 p-6">
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/60">WeSetup</div>
              <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{t("title")}</h1>
              <p className="mt-2 text-[15px] leading-[1.55] text-white/75">{t("intro")}</p>
            </div>
          </section>

          <section className="mini-card p-5">
            <h2 className="text-[17px] font-semibold" style={{ color: "var(--mini-text)" }}>
              {t("whatHappens")}
            </h2>
            <ul className="mt-3 space-y-3 text-[15px] leading-[1.5]" style={{ color: "var(--mini-text-secondary)" }}>
              <li className="flex gap-3">
                <UserX className="mt-0.5 size-5 shrink-0" style={{ color: "var(--mini-danger)" }} aria-hidden />
                <span>{t("cannotSignIn")}</span>
              </li>
              <li className="flex gap-3">
                <Trash2 className="mt-0.5 size-5 shrink-0" style={{ color: "var(--mini-danger)" }} aria-hidden />
                <span>{t("personalDataRemoved")}</span>
              </li>
              <li className="flex gap-3">
                <ShieldCheck className="mt-0.5 size-5 shrink-0" style={{ color: "var(--mini-accent-ink)" }} aria-hidden />
                <span>{t("recordsRetained")}</span>
              </li>
            </ul>
            <p className="mt-4 text-[14px] leading-[1.5]" style={{ color: "var(--mini-text-muted)" }}>
              {t("ownerDelay")}
            </p>
          </section>

          <section className="mini-card flex flex-col gap-3 p-5" data-testid="delete-account-action">
            {userId ? (
              <>
                <p className="text-[15px] leading-[1.5]" style={{ color: "var(--mini-text-secondary)" }}>
                  {t.rich("signedInAs", {
                    name: profile?.name ?? session?.user?.name ?? "—",
                    userName: chunks => <b style={{ color: "var(--mini-text)" }}>{chunks}</b>,
                  })}
                  {" "}
                  {t.rich("signedInInstructions", {
                    confirmationWord: flowT("confirmationWord"),
                    word: chunks => <b>{chunks}</b>,
                  })}
                </p>
                <DeleteAccountButton />
              </>
            ) : (
              <>
                <h2 className="text-[17px] font-semibold" style={{ color: "var(--mini-text)" }}>
                  {t("guestTitle")}
                </h2>
                <p className="text-[15px] leading-[1.5]" style={{ color: "var(--mini-text-secondary)" }}>
                  {t("guestInstructions")}
                </p>
                <Link href={loginHref} className="mini-btn-primary mini-press w-full" data-testid="delete-account-login">
                  <LogIn className="size-5" />
                  {t("login")}
                </Link>
              </>
            )}
          </section>

          <section className="mini-card flex gap-3 p-5">
            <Mail className="mt-0.5 size-5 shrink-0" style={{ color: "var(--mini-accent-ink)" }} aria-hidden />
            <p className="text-[15px] leading-[1.5]" style={{ color: "var(--mini-text-secondary)" }}>
              {t.rich("supportContact", {
                email: SUPPORT_EMAIL,
                supportAddress: chunks => (
                  <a
                    href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t("supportMailSubject"))}`}
                    className="font-semibold underline underline-offset-2"
                    style={{ color: "var(--mini-accent-ink)" }}
                  >
                    {chunks}
                  </a>
                ),
              })}
            </p>
          </section>
        </main>
      </DeleteAccountThemeRoot>
    </DomainMessagesBoundary>
  );
}
