import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { ArrowRight, MessageCircle, Rocket, Send } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { loadNavModel } from "@/lib/app-nav.server";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getVisibleOrgBranding } from "@/lib/partners/branding";
import {
  HOME_FAVORITES_MAX,
  HOME_PHONE,
  canSeeHomePage,
  favoriteCandidates,
  homeContacts,
  type HomeContact,
} from "@/lib/home-page";
import type { NavTone } from "@/lib/nav-tones";
import { TAGLINE_VIEW_WIDTH, taglineLayout } from "@/lib/wordmark-tagline";
import { BrandLogo, WORDMARK_INK, WORDMARK_RATIO } from "@/components/brand/logo";
import { HomeFavorites } from "@/components/home/home-favorites";
import { NavIconChip, ToneChip } from "@/components/layout/nav-icons";

export const dynamic = "force-dynamic";

/** Каналы связи — каждый своим цветом (2026-10-29), как пункты меню. */
const CONTACT_TONES: Record<HomeContact["id"], NavTone> = {
  support: "sky",
  sales: "amber",
  consulting: "violet",
};

/**
 * Главная кабинета руководителя (эскиз 2026-10-28, лист 1): крупный знак
 * «сетап» и «Ваш электронный ХАССП», справа контакты (поддержка, отдел
 * продаж, консалтинг, телефон), внизу «Начальная настройка» и три слота
 * «Избранного». Сюда руководитель попадает после входа и регистрации, сюда
 * же ведёт логотип в меню. Остальным — прежняя домашняя.
 *
 * Знак — градиентом, как на визитке, а подпись под ним — ровно по его
 * ширине (владелец, 2026-10-29: «симметрично, как в визитке»).
 */
export default async function HomePage() {
  const session = await requireAuth();
  if (!canSeeHomePage(session.user)) {
    redirect(hasFullWorkspaceAccess(session.user) ? "/dashboard" : "/journals");
  }
  const [t, model, user, branding] = await Promise.all([
    getTranslations("homePage"),
    loadNavModel(session),
    db.user.findUnique({ where: { id: session.user.id }, select: { homeFavorites: true } }),
    getVisibleOrgBranding(getActiveOrgId(session)),
  ]);

  const candidates = favoriteCandidates(model.sections);
  const byHref = new Map(candidates.map((candidate) => [candidate.href, candidate]));
  // Страница, которая пропала из меню человека, из слота просто уходит.
  const pinned = (user?.homeFavorites ?? []).filter((href) => byHref.has(href)).slice(0, HOME_FAVORITES_MAX);
  // Кабинет партнёра (white-label): наши продажи и консалтинг не показываем,
  // телефон — партнёра.
  const contacts = homeContacts(process.env).filter((contact) => !branding || contact.id === "support");
  const phone = branding
    ? branding.supportPhone
      ? { display: branding.supportPhone, tel: branding.supportPhone.replace(/[^+\d]/g, "") }
      : null
    : HOME_PHONE;
  const tagline = t("tagline");
  const taglineFit = taglineLayout(tagline);

  return (
    <div className="space-y-5" data-home-page>
      <section className="relative overflow-hidden rounded-3xl border border-[#ececf4] bg-white px-6 py-14 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:py-20">
        {/* Три мягких пятна в цветах знака: индиго, бирюза, лаванда. */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-28 -left-20 size-[340px] rounded-full bg-[#5566f6] opacity-[0.09] blur-[90px]" />
          <div className="absolute -right-24 -bottom-32 size-[360px] rounded-full bg-[#13a08f] opacity-[0.08] blur-[100px]" />
          <div className="absolute -top-36 right-[18%] size-[300px] rounded-full bg-[#9a6cf0] opacity-[0.07] blur-[100px]" />
        </div>
        <div className="relative">
          {branding ? (
            // Кабинет партнёра (white-label): нашего знака нет, только его название.
            <>
              <div className="text-[34px] font-semibold tracking-[-0.02em] text-[#0b1024] md:text-[48px]">{branding.brandName}</div>
              <p className="mt-5 text-[19px] font-semibold tracking-[-0.01em] text-[#3c4053] md:text-[24px]">{tagline}</p>
            </>
          ) : (
            // Знак и подпись — одна колонка шириной со знак (`--logo-h` —
            // высота знака). Подпись SVG-текстом тянется ровно от первой до
            // последней буквы знака (`WORDMARK_INK`: справа у файла поле
            // шире, чем слева), а пара сдвинута на полразницы полей — буквы
            // стоят ровно по центру. Под буквами у файла пустая полоса —
            // подпись подтянута к ним, как на визитке.
            <div
              className="mx-auto flex flex-col [--logo-h:64px] md:[--logo-h:104px]"
              style={{
                width: `calc(var(--logo-h) * ${WORDMARK_RATIO})`,
                translate: `${((WORDMARK_INK.right - WORDMARK_INK.left) / 2) * 100}% 0`,
              }}
              data-home-wordmark
            >
              <BrandLogo height={64} title="сетап" gradient />
              <p
                style={{
                  color: "var(--app-wordmark-tagline)",
                  marginTop: "calc(var(--logo-h) * -0.09)",
                  marginLeft: `${WORDMARK_INK.left * 100}%`,
                  width: `${(1 - WORDMARK_INK.left - WORDMARK_INK.right) * 100}%`,
                }}
                data-home-tagline
              >
                <span className="sr-only">{tagline}</span>
                <svg
                  aria-hidden
                  viewBox={`0 0 ${TAGLINE_VIEW_WIDTH} ${taglineFit.height}`}
                  className="block w-full overflow-visible"
                >
                  <text
                    x={taglineFit.stretch ? 0 : TAGLINE_VIEW_WIDTH / 2}
                    y={taglineFit.baseline}
                    fontSize={taglineFit.fontSize}
                    fontWeight={600}
                    fill="currentColor"
                    textAnchor={taglineFit.stretch ? "start" : "middle"}
                    {...(taglineFit.stretch ? { textLength: TAGLINE_VIEW_WIDTH, lengthAdjust: "spacing" } : {})}
                  >
                    {tagline}
                  </text>
                </svg>
              </p>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        {/* Карточки появляются каскадом при открытии (`data-nav-rise`). */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-nav-rise>
          <Link
            href="/settings/onboarding"
            data-home-setup
            data-nav-row
            data-motion
            style={{ "--nav-i": 0 } as CSSProperties}
            className="group col-span-2 flex min-h-[148px] flex-col justify-between rounded-3xl bg-[#5566f6] bg-[linear-gradient(135deg,#5566f6,#7a5cff)] p-5 text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] hover:-translate-y-0.5 hover:bg-[#4a5bf0] hover:shadow-[0_18px_40px_-14px_rgba(85,102,246,0.75)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 md:col-span-1"
          >
            <span
              data-motion
              className="flex size-10 items-center justify-center rounded-2xl bg-white/15 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:-rotate-12"
            >
              <Rocket className="size-5" aria-hidden />
            </span>
            <span>
              <span className="flex items-center gap-1.5 text-[16px] font-semibold leading-tight">
                {t("setupTitle")}
                <ArrowRight data-motion className="size-4 group-hover:translate-x-0.5" aria-hidden />
              </span>
              <span className="mt-1 block text-[13px] leading-snug text-white/80">{t("setupBody")}</span>
            </span>
          </Link>
          <HomeFavorites
            pinned={pinned}
            candidates={candidates}
            strings={{
              title: t("favorites.title"),
              add: t("favorites.add"),
              addHint: t("favorites.addHint"),
              remove: t("favorites.remove"),
              pickDescription: t("favorites.pickDescription"),
              search: t("favorites.search"),
              nothing: t("favorites.nothing"),
              saved: t("favorites.saved"),
              failed: t("favorites.failed"),
            }}
          />
        </div>

        <aside
          className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
          data-home-contacts
        >
          <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{t("contactsTitle")}</div>
          <ul className="space-y-1">
            {contacts.map((contact) => {
              const body = (
                <>
                  <ToneChip
                    tone={CONTACT_TONES[contact.id]}
                    icon={contact.external ? Send : MessageCircle}
                    className="size-9 rounded-xl"
                    iconClassName="size-4"
                  />
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-medium text-[#0b1024]">{t(`contacts.${contact.id}`)}</span>
                    <span className="block text-[12.5px] text-[#6f7282]">
                      {contact.external ? t("via.telegram") : t(`via.${contact.id}`)}
                    </span>
                  </span>
                </>
              );
              const className =
                "flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";
              return (
                <li key={contact.id}>
                  {contact.external ? (
                    <a href={contact.href} target="_blank" rel="noopener noreferrer" className={className} data-home-contact={contact.id} data-nav-row>
                      {body}
                    </a>
                  ) : (
                    <Link href={contact.href} className={className} data-home-contact={contact.id} data-nav-row>
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          {phone ? (
          <a
            href={`tel:${phone.tel}`}
            className="mt-3 flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] py-2.5 pr-3 pl-2.5 transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            data-home-phone
            data-nav-row
          >
            <NavIconChip name="Phone" className="size-9 rounded-xl" iconClassName="size-4" />
            <span className="min-w-0">
              <span className="block text-[12px] text-[#6f7282]">{t("phone")}</span>
              <span className="block text-[17px] font-semibold tabular-nums tracking-[-0.01em] text-[#0b1024]">
                {phone.display}
              </span>
            </span>
          </a>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
