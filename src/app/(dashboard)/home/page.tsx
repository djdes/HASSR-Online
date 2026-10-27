import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight, MessageCircle, Phone, Rocket, Send } from "lucide-react";
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
} from "@/lib/home-page";
import { BrandLogo } from "@/components/brand/logo";
import { HomeFavorites } from "@/components/home/home-favorites";

export const dynamic = "force-dynamic";

/**
 * Главная кабинета руководителя (эскиз 2026-10-28, лист 1): крупный знак
 * «сетап» и «Ваш электронный ХАССП», справа контакты (поддержка, отдел
 * продаж, консалтинг, телефон), внизу «Начальная настройка» и три слота
 * «Избранного». Сюда руководитель попадает после входа и регистрации, сюда
 * же ведёт логотип в меню. Остальным — прежняя домашняя.
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

  return (
    <div className="space-y-5" data-home-page>
      <section className="relative overflow-hidden rounded-3xl border border-[#ececf4] bg-white px-6 py-14 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:py-20">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-28 -left-20 size-[340px] rounded-full bg-[#5566f6] opacity-[0.08] blur-[90px]" />
          <div className="absolute -right-24 -bottom-32 size-[360px] rounded-full bg-[#7a5cff] opacity-[0.08] blur-[100px]" />
        </div>
        <div className="relative">
          {branding ? (
            // Кабинет партнёра (white-label): нашего знака нет, только его название.
            <div className="text-[34px] font-semibold tracking-[-0.02em] text-[#0b1024] md:text-[48px]">{branding.brandName}</div>
          ) : (
            <div className="flex justify-center text-[#0b1024]">
              <BrandLogo height={64} title="сетап" className="md:[--logo-h:104px]" />
            </div>
          )}
          <p className="mt-5 text-[19px] font-semibold tracking-[-0.01em] text-[#3c4053] md:text-[24px]">{t("tagline")}</p>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Link
            href="/settings/onboarding"
            data-home-setup
            className="group col-span-2 flex min-h-[148px] flex-col justify-between rounded-3xl bg-[#5566f6] p-5 text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 md:col-span-1"
          >
            <span className="flex size-10 items-center justify-center rounded-2xl bg-white/15">
              <Rocket className="size-5" aria-hidden />
            </span>
            <span>
              <span className="flex items-center gap-1.5 text-[16px] font-semibold leading-tight">
                {t("setupTitle")}
                <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
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
              const Icon = contact.external ? Send : MessageCircle;
              const body = (
                <>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
                    <Icon className="size-4" aria-hidden />
                  </span>
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
                    <a href={contact.href} target="_blank" rel="noopener noreferrer" className={className} data-home-contact={contact.id}>
                      {body}
                    </a>
                  ) : (
                    <Link href={contact.href} className={className} data-home-contact={contact.id}>
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
            className="mt-3 flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3 py-3 transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            data-home-phone
          >
            <Phone className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
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
