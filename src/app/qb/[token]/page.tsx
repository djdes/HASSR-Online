import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  FileCheck2,
  LogIn,
  QrCode,
  Smartphone,
} from "lucide-react";

import { BrandLogo } from "@/components/brand/logo";
import { JOURNAL_INFO } from "@/content/journal-info";
import { authOptions } from "@/lib/auth";
import {
  blankCabinetPath,
  blankLoginHref,
  blankRegisterHref,
  type BlankTarget,
} from "@/lib/blank-download";
import { openBlankQrToken, type BlankQrPayload } from "@/lib/blank-qr-token";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { FREE_TIER_SHORT } from "@/lib/plan-catalog";
import { getServerSession } from "@/lib/server-session";
import { paperJournalById } from "@/lib/sphere-journal-rules";

export const dynamic = "force-dynamic";

// Страница по личному токену: в поиск её не пускаем.
export const metadata: Metadata = {
  title: "Журнал с телефона",
  robots: { index: false, follow: false },
};

type Journal = {
  target: BlankTarget;
  title: string;
  tagline: string | null;
  /** Бумажный бланк: заполнять с телефона нечего — его ведут на бумаге. */
  paper: boolean;
  paperOnly: boolean;
};

function describe(target: BlankTarget | null): Journal | null {
  if (!target) return null;
  if (target.kind === "paper") {
    const journal = paperJournalById(target.paperId);
    return journal
      ? { target, title: journal.name, tagline: null, paper: true, paperOnly: Boolean(journal.paperOnly) }
      : null;
  }
  const item = ACTIVE_JOURNAL_CATALOG.find((journal) => journal.code === target.code);
  if (!item) return null;
  return {
    target,
    title: item.name,
    tagline: JOURNAL_INFO[target.code]?.tagline ?? null,
    paper: false,
    paperOnly: false,
  };
}

type Mode = "session" | "login" | "register";

/**
 * `/qb/<токен>` — куда ведёт QR в шапке шаблона журнала, скачанного с сайта.
 *
 * В токене (AES-GCM, см. lib/blank-qr-token.ts) — журнал и почта, которую
 * человек ввёл при скачивании:
 *   • аккаунт с этой почтой уже есть → «Войдите — и этот журнал откроется
 *     для заполнения», вход с подставленной почтой и возвратом на журнал;
 *   • аккаунта нет → коротко, что это за журнал и что в WeSetup его ведут с
 *     телефона, и регистрация с подставленной почтой и отметкой источника;
 *   • уже вошли → сразу «Открыть журнал»;
 *   • битый/чужой токен → та же заглушка без почты и без журнала.
 */
export default async function BlankQrPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let payload: BlankQrPayload | null = null;
  try {
    payload = openBlankQrToken(decodeURIComponent(token));
  } catch (error) {
    console.error("[qb] token open failed", error);
  }
  if (!payload) console.warn("[qb] bad token", { length: token.length });

  const journal = describe(payload?.target ?? null);
  const email = payload?.email ?? null;
  const [session, existing] = await Promise.all([
    getServerSession(authOptions).catch(() => null),
    email
      ? db.user.findUnique({ where: { email }, select: { id: true } }).catch((error) => {
          console.error("[qb] user lookup failed", error);
          return null;
        })
      : Promise.resolve(null),
  ]);
  const mode: Mode = session?.user ? "session" : existing ? "login" : "register";
  const target = journal?.target ?? null;

  const title =
    mode === "session"
      ? journal
        ? "Журнал уже в вашем кабинете"
        : "Журналы — в вашем кабинете"
      : mode === "login"
        ? "Войдите — и этот журнал откроется для заполнения"
        : journal?.paper
          ? "Этот журнал — из WeSetup"
          : journal
            ? "Заполняйте этот журнал с телефона"
            : "Журналы СанПиН и ХАССП — с телефона";

  const lead =
    mode === "session"
      ? journal
        ? `Вы вошли в WeSetup — «${journal.title}» открывается одним нажатием.`
        : "Вы вошли в WeSetup — журналы открываются из кабинета."
      : mode === "login"
        ? "У этой почты уже есть аккаунт WeSetup. После входа сразу откроется журнал с QR-кода."
        : journal?.paper
          ? `«${journal.title}» ведут на бумаге${journal.paperOnly ? " — так требует закон" : ""}. В WeSetup бумажные журналы печатаются с шапкой вашей организации, а журналы СанПиН и ХАССП заполняются с телефона по QR.`
          : journal
            ? "Вы отсканировали QR с шаблона. Зарегистрируйтесь — и журнал будет открываться для заполнения прямо с телефона: без бумаги и с напоминаниями."
            : "Этот QR напечатан на шаблоне журнала WeSetup. Зарегистрируйтесь — и журналы СанПиН и ХАССП будут заполняться с телефона по QR: без бумаги и с напоминаниями.";

  const primary =
    mode === "session"
      ? { href: target ? blankCabinetPath(target) : "/journals", label: "Открыть журнал", icon: ArrowRight }
      : mode === "login"
        ? { href: blankLoginHref({ email, target }), label: "Войти", icon: LogIn }
        : { href: blankRegisterHref({ email, target }), label: "Зарегистрироваться", icon: ArrowRight };

  const benefits = [
    { icon: Smartphone, text: "Сканируете QR — открывается форма журнала, запись за полминуты" },
    { icon: FileCheck2, text: "Журнал хранится в облаке, для проверки — PDF в один клик" },
    { icon: BellRing, text: "Напоминание, если смена забыла отметиться" },
  ];

  return (
    <main className="min-h-screen bg-[#fafbff] px-4 py-8 text-[#0b1024] sm:py-14">
      <div className="mx-auto w-full max-w-[560px]">
        <Link href="/" className="inline-block text-[#0b1024]" aria-label="WeSetup — на главную">
          <BrandLogo height={24} title="" />
        </Link>

        <div className="mt-6 overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.35)]">
          <section className="relative overflow-hidden bg-[#0b1024] px-6 py-8 text-white sm:px-8 sm:py-10">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -left-24 -top-24 size-[320px] rounded-full bg-[#5566f6] opacity-40 blur-[110px]" />
              <div className="absolute -bottom-32 -right-24 size-[340px] rounded-full bg-[#7a5cff] opacity-30 blur-[120px]" />
            </div>
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[12px] font-medium uppercase tracking-[0.16em] text-white/80">
                <QrCode className="size-3.5" />
                QR с шаблона WeSetup
              </div>
              <h1
                data-testid="qb-title"
                className="mt-4 text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[32px]"
              >
                {title}
              </h1>
              <p className="mt-3 text-[15px] leading-[1.6] text-white/75">{lead}</p>
            </div>
          </section>

          <div className="space-y-6 p-6 sm:p-8">
            {journal ? (
              <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
                <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                  {journal.paper ? "Бумажный журнал" : "Журнал"}
                </div>
                <div data-testid="qb-journal" className="mt-1 text-[16px] font-semibold leading-snug">
                  {journal.title}
                </div>
                {journal.tagline ? (
                  <p className="mt-1 text-[14px] leading-[1.55] text-[#3c4053]">{journal.tagline}</p>
                ) : null}
              </div>
            ) : null}

            {mode === "register" ? (
              <ul className="space-y-3">
                {benefits.map((item) => (
                  <li key={item.text} className="flex items-start gap-3 text-[14px] leading-[1.55] text-[#3c4053]">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
                      <item.icon className="size-4" />
                    </span>
                    <span className="pt-1.5">{item.text}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div>
              <Link
                href={primary.href}
                data-testid="qb-primary"
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25"
              >
                {primary.label}
                <primary.icon className="size-4" />
              </Link>
              <p className="mt-3 text-center text-[13px] leading-[1.5] text-[#6f7282]">
                {mode === "register"
                  ? `${FREE_TIER_SHORT}, без карты.${email ? " Почта, на которую скачивали шаблон, уже подставлена." : ""}`
                  : mode === "login"
                    ? "Почта уже подставлена — останется ввести пароль."
                    : null}
              </p>
            </div>

            {mode === "register" ? (
              <p className="border-t border-[#ececf4] pt-5 text-center text-[13px] text-[#6f7282]">
                Уже есть аккаунт?{" "}
                <Link
                  href={blankLoginHref({ target })}
                  className="font-medium text-[#3848c7] underline-offset-4 hover:underline"
                >
                  Войти
                </Link>
              </p>
            ) : mode === "login" ? (
              <p className="border-t border-[#ececf4] pt-5 text-center text-[13px] text-[#6f7282]">
                Это не ваш аккаунт?{" "}
                <Link
                  href={blankRegisterHref({ target })}
                  className="font-medium text-[#3848c7] underline-offset-4 hover:underline"
                >
                  Зарегистрироваться
                </Link>
              </p>
            ) : null}
          </div>
        </div>

        <p className="mt-6 text-center text-[12px] text-[#9b9fb3]">
          © WeSetup — электронные журналы ХАССП и СанПиН ·{" "}
          <Link href="/journals-info" className="underline-offset-4 hover:text-[#6f7282] hover:underline">
            все журналы
          </Link>
        </p>
      </div>
    </main>
  );
}
