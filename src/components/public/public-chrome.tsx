import Link from "@/components/i18n/localized-link";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { getTranslations } from "next-intl/server";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { SiteSearch } from "@/components/public/site-search";
import { LazyPublicWidgets } from "@/components/public/lazy-public-widgets";
import { COMPANY_EMAIL, COMPANY_PHONES } from "@/lib/company-contacts";
import { contactTelegramUrl } from "@/lib/contact-us";
import { AppStoresTeaser } from "@/components/public/app-stores-teaser";
import { BrandLogo } from "@/components/brand/logo";
import { BrandWithTagline } from "@/components/brand/brand-with-tagline";
import { NICHES } from "@/content/niches";
import { popularJournalLinks } from "@/content/seo-redirects";
import { FEATURES_ORDER } from "@/content/features";
import { ArrowRight, CircleUserRound, LogIn } from "lucide-react";
import { JOURNALS_TOTAL } from "@/lib/journal-catalog";
import { readPublicSessionBadge } from "@/lib/public-session-badge";
import { getWebHomeHref } from "@/lib/role-access";
import { isMobileAppRequest } from "@/lib/mobile-app-payments";
import { PublicThemeBootstrap, PublicThemeScope } from "@/components/theme/site-theme";

/**
 * Top nav shared across the marketing landing, the blog, and the journal
 * catalogue. Keeps the WeSetup lockup the same across every public entry
 * point; кнопки справа адаптируются под состояние сессии:
 *
 *   anonymous → «Войти» (outline) + «Начать» (filled)
 *   authenticated → «Открыть кабинет» (filled) + аватар-кружок с
 *     инициалами как сильный визуальный сигнал «ты залогинен»
 *
 * Лендинг остаётся доступным авторизованным пользователям (хочется —
 * показать ссылку клиенту, поделиться витриной), но сразу видно, что
 * сессия жива и до кабинета один клик.
 */
export async function PublicHeader({
  activeSection,
}: {
  activeSection?: "blog" | "journals-info" | "home" | "knowledge-base";
}) {
  const locale = await getSiteLocale();
  const t = await getTranslations({ locale, namespace: "publicChrome" });
  const badge = await readPublicSessionBadge().catch(() => null);
  // В приложении WeSetup нет оплаты и ссылок к ней (правила магазинов) —
  // «Тарифы» не показываем.
  const inApp = await isMobileAppRequest();
  const link = (section: string, label: string, href: string) => (
    <Link
      href={href}
      className={
        "hidden text-[14px] font-medium transition-colors hover:text-[#0b1024] sm:inline" +
        (activeSection === section
          ? " text-[#0b1024]"
          : " text-[#6f7282]")
      }
    >
      {label}
    </Link>
  );

  return (
    <header
      className="public-header sticky top-0 z-40 border-b border-[#ececf4] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80"
      // В приложении страница под вырезом экрана (viewport-fit=cover): шапка
      // уходит под строку состояния, кнопки — ниже неё. На сайте отступ 0.
      style={{ paddingTop: "var(--safe-area-inset-top, env(safe-area-inset-top, 0px))" }}
    >
      {/* Ночная тема публичных страниц — см. usePublicAutoTheme. Шапка
          стоит первой на каждой странице, поэтому скрипт успевает до отрисовки. */}
      <PublicThemeBootstrap />
      <PublicThemeScope />
      {/* Телефон (правки 18.11.2026): одна строка — знак с подписью, поиск,
          «Тарифы», вход. Язык на телефоне — в подвале. */}
      <nav className="mx-auto flex max-w-[1200px] items-center justify-between gap-2 px-4 py-2.5 sm:px-6 sm:py-5">
        <Link href="/" className="shrink-0 text-[#0b1024]" aria-label={t("homeAria")}>
          <BrandWithTagline tagline={t("tagline")} />
        </Link>
        <div className="flex items-center gap-1 sm:gap-5">
          {/* Уже 390 px поиск прячем: иначе «Тарифы» и вход не влезают (правки 21.11.2026). */}
          <span className="hidden min-[390px]:contents">
            <SiteSearch />
          </span>
          <LanguageSwitch className="hidden lg:inline-flex" />
          {link("journals-info", t("journals"), "/journals-info")}
          {link("blog", t("blog"), "/blog")}
          {link("knowledge-base", t("knowledgeBase"), "/baza-znaniy")}
          {badge ? (
            <PublicHeaderAuthed
              userName={badge.name ?? t("userFallback")}
              role={badge.role}
              isRoot={badge.isRoot}
              dashboardLabel={t("dashboard")}
              dashboardShortLabel={t("dashboardShort")}
              profileLabel={t("profile")}
            />
          ) : (
            <PublicHeaderAnon showPricing={!inApp} pricingLabel={t("pricing")} loginLabel={t("login")} />
          )}
        </div>
      </nav>
    </header>
  );
}

function PublicHeaderAnon({ showPricing, pricingLabel, loginLabel }: { showPricing: boolean; pricingLabel: string; loginLabel: string }) {
  return (
    <>
      {showPricing ? (
        <Link
          href="/pricing"
          className="inline-flex h-10 items-center px-1 text-[15px] font-medium text-[#6f7282] transition-colors hover:text-[#0b1024] sm:h-auto sm:px-0 sm:text-[14px]"
        >
          {pricingLabel}</Link>
      ) : null}
      <Link
        href="/login"
        aria-label={loginLabel}
        className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-2xl border border-[#dcdfed] bg-white px-2.5 text-[15px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:gap-2 sm:px-4 sm:text-[14px]"
      >
        {/* Уже 375 px — только значок: подпись не влезает рядом с «Тарифами». */}
        <span className="hidden min-[375px]:inline">{loginLabel}</span><LogIn className="size-4 text-[#5566f6]" />
      </Link>
    </>
  );
}

function PublicHeaderAuthed({
  userName,
  role,
  isRoot,
  dashboardLabel,
  dashboardShortLabel,
  profileLabel,
}: {
  userName: string;
  role: string;
  isRoot: boolean;
  dashboardLabel: string;
  dashboardShortLabel: string;
  profileLabel: string;
}) {
  const homeHref = getWebHomeHref({ role, isRoot });
  const initials = getInitials(userName);
  return (
    <>
      <Link
        href={homeHref}
        aria-label={dashboardLabel}
        className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-2xl bg-[#5566f6] px-3 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] sm:gap-2 sm:px-4 sm:text-[14px]"
      >
        <CircleUserRound className="size-[18px] min-[375px]:hidden" aria-hidden="true" />
        <span className="hidden min-[375px]:inline sm:hidden">{dashboardShortLabel}</span>
        <span className="hidden sm:inline">{dashboardLabel}</span>
        <ArrowRight className="hidden size-4 sm:block" aria-hidden="true" />
      </Link>
      <Link
        href={homeHref}
        title={userName}
        aria-label={`${profileLabel} · ${userName}`}
        className="hidden size-10 items-center justify-center rounded-full border border-[#dcdfed] bg-[#f5f6ff] text-[12px] font-semibold text-[#3848c7] transition-colors hover:border-[#5566f6]/50 hover:bg-[#eef1ff] sm:inline-flex"
      >
        {initials}
      </Link>
    </>
  );
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Ряды сквозных ссылок под подвалом; страница может не показывать свой. */
type FooterRow = "niches" | "journals" | "features";

const FOOTER_LINK_CLASS =
  "inline-flex min-h-9 items-center py-1.5 leading-snug transition-colors duration-150 hover:text-[#0b1024] sm:min-h-8 sm:py-1";

/**
 * Подвал публичных страниц (правки 18.11.2026).
 *
 * «Разделы» были одним столбцом из 22 ссылок — на телефоне полтора экрана, на
 * ПК узкая колонка у правого края. Теперь четыре группы («Продукт»,
 * «Материалы», «Компания», «Документы») в сетке: на телефоне два столбца, на
 * ПК четыре. Дубли убраны: «Оферта» и «Конфиденциальность» стояли дважды под
 * разными названиями. Реквизиты — одной строкой внизу, рядом выбор языка
 * (на телефоне его в шапке нет).
 *
 * Перелинковка: ряды ссылок — `nav` со списком и ссылкой на раздел-хаб в
 * конце. `omitRows` убирает ряд, который страница уже показала в своём теле:
 * вторая ссылка на тот же адрес веса не добавляет, а первая — с подписью из
 * тела страницы — и так учтена.
 */
export async function PublicFooter({ omitRows = [] }: { omitRows?: ReadonlyArray<FooterRow> } = {}) {
  const locale = await getSiteLocale();
  const t = await getTranslations({ locale, namespace: "publicChrome" });
  const navT = await getTranslations({ locale, namespace: "publicNavigation" });
  const navigationLabel = (group: "niches" | "journals" | "features", id: string) => {
    const key = `${group}.${id}` as Exclude<Parameters<typeof navT>[0], "allLogsLink">;
    return navT(key);
  };
  // В приложении WeSetup: без «Тарифов» (оплаты в приложении нет) и без
  // анонса «Приложение скоро» — человек уже в нём.
  const inApp = await isMobileAppRequest();
  const groups: ReadonlyArray<{ title: string; links: ReadonlyArray<{ href: string; label: string; external?: boolean }> }> = [
    {
      title: t("groupProduct"),
      links: [
        { href: "/journals-info", label: t("journals") },
        ...(inApp ? [] : [{ href: "/pricing", label: t("pricing") }]),
        { href: "/avtozapolnenie", label: t("autofillOffer") },
        { href: "/uslugi", label: t("services") },
        { href: "/whats-new", label: t("whatsNew") },
        { href: "/developers", label: t("developers") },
      ],
    },
    {
      title: t("groupResources"),
      links: [
        { href: "/baza-znaniy", label: t("knowledgeBase") },
        { href: "/blog", label: t("blog") },
        { href: "/blanki", label: t("forms") },
        { href: "/prikazy", label: t("orders") },
        { href: "/sanpin-2-3-2-4-4282-26", label: t("sanpin4282") },
        { href: "/glossary", label: t("glossary") },
        { href: "/calc/journals", label: t("journalCalculator") },
        { href: "/calc/fines", label: t("fineCalculator") },
        { href: "/compare", label: t("comparisons") },
      ],
    },
    {
      title: t("groupCompany"),
      links: [
        { href: "/about", label: t("about") },
        { href: "/partners", label: t("partners") },
        { href: "https://t.me/wesetupbot", label: "Telegram", external: true },
        { href: "/login", label: t("login") },
        { href: "/register", label: t("register") },
      ],
    },
    {
      // Робокасса требует, чтобы все четыре документа были доступны с сайта,
      // а не только со страницы оплаты.
      title: t("groupDocuments"),
      links: [
        { href: "/oferta", label: t("contractOffer") },
        { href: "/privacy", label: t("privacyPolicy") },
        { href: "/terms", label: t("userAgreement") },
        { href: "/consent", label: t("personalDataConsent") },
        { href: "/security", label: t("securityAndData") },
      ],
    },
  ];
  const rows: ReadonlyArray<{ id: FooterRow; title: string; links: ReadonlyArray<{ href: string; label: string }>; hub?: { href: string; label: string } }> = [
    {
      id: "niches",
      title: t("nicheLinks"),
      links: Object.entries(NICHES).map(([id, n]) => ({ href: `/${n.slug}`, label: navigationLabel("niches", id) })),
    },
    {
      id: "journals",
      title: t("popularJournals"),
      links: popularJournalLinks().map(({ id, href }) => ({ href, label: navigationLabel("journals", id) })),
      hub: { href: "/journals-info", label: navT("allLogsLink", { journalCount: JOURNALS_TOTAL }) },
    },
    {
      id: "features",
      title: t("features"),
      links: FEATURES_ORDER.map((slug) => ({ href: `/features/${slug}`, label: navigationLabel("features", slug) })),
      hub: { href: "/features", label: t("allFeatures") },
    },
  ];
  const visibleRows = rows.filter((row) => !omitRows.includes(row.id));
  return (
    <footer className="public-footer border-t border-[#ececf4]">
      {/* Пузырь поддержки живёт в подвале, а не в корневом layout'е:
          так он есть на всех публичных страницах и нигде не пересекается
          с виджетом кабинета — там свой, с авторизацией. */}
      {/* «Задайте вопрос» — контакты и заявка на связь при прокрутке (правки 05.11.2026).
          Оба виджета грузятся, когда браузер свободен (seo-speed-pack-2026-11). */}
      <LazyPublicWidgets telegramUrl={contactTelegramUrl(process.env)} />
      <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.6fr)] lg:gap-12">
        <div className="text-[13px] leading-[1.6] text-[#6f7282]">
          <div className="text-[#0b1024]">
            <BrandLogo height={26} />
          </div>
          <p className="mt-3 max-w-[440px] text-[#9b9fb3]">
            {t("footerDescription")}</p>
          {/* Контакты как на визитке: основной номер, мобильный, почта. */}
          <div className="mt-3 flex flex-wrap gap-x-4 lg:flex-col" data-footer-phones>
            {COMPANY_PHONES.map((phone) => (
              <a
                key={phone.tel}
                href={`tel:${phone.tel}`}
                className={`${FOOTER_LINK_CLASS} whitespace-nowrap font-medium tabular-nums text-[#0b1024]`}
              >
                {phone.display}
              </a>
            ))}
            <a href={`mailto:${COMPANY_EMAIL}`} className={`${FOOTER_LINK_CLASS} break-all`}>
              {COMPANY_EMAIL}
            </a>
          </div>
          {inApp ? null : <AppStoresTeaser />}
        </div>

        <nav aria-label={t("sections")} className="grid grid-cols-2 gap-x-5 gap-y-7 text-[13px] text-[#6f7282] sm:grid-cols-4 sm:gap-x-6">
          {groups.map((group) => (
            <div key={group.title}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">{group.title}</div>
              <ul>
                {group.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a href={link.href} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK_CLASS}>
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href} className={FOOTER_LINK_CLASS}>
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      {/* Сквозная перелинковка посадочных страниц.
          Раньше 19 лендингов (12 отраслевых и 7 под частотные запросы)
          не имели ни одной ссылки из сквозного элемента и держались
          только на ссылках внутри отдельных страниц — из-за этого
          обходились редко и получали мало внутреннего веса. */}
      {visibleRows.length > 0 ? (
        <div className="border-t border-[#ececf4]">
          <div className="mx-auto max-w-[1200px] space-y-4 px-4 py-6 sm:px-6">
            {visibleRows.map((row) => (
              <FooterLinkRow key={row.id} title={row.title} links={row.links} hub={row.hub} />
            ))}
          </div>
        </div>
      ) : null}

      {/* Реквизиты — одной строкой; язык — здесь, в шапке на телефоне его нет. */}
      <div className="border-t border-[#ececf4]">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 pb-24 pt-5 text-[12px] sm:pb-5 leading-[1.6] text-[#9b9fb3] sm:flex-row sm:items-center sm:gap-6 sm:px-6 sm:pr-24">
          <p className="min-w-0 flex-1">
            <span className="font-medium text-[#6f7282]">ООО «БФС»</span>
            {" · "}
            {t("companyTaxIds", { inn: "5018215599", kpp: "501801001" })}
            {" · "}
            {t("companyRegistrationId", { ogrn: "1235000105306" })}
            {" · "}
            141065, Московская область, г. Королёв, ул. Ленина, д. 10/6
          </p>
          <LanguageSwitch align="start" side="top" className="self-start sm:self-auto" />
        </div>
      </div>
    </footer>
  );
}

/**
 * Ряд ссылок в подвале: подпись слева, ссылки в строку через мягкий
 * разделитель. Строкой, а не колонкой, потому что позиций много
 * (14 сфер), и колонка растянула бы подвал на два экрана. Последней идёт
 * ссылка на раздел-хаб (весь каталог журналов, все возможности) — полужирная.
 */
function FooterLinkRow({
  title,
  links,
  hub,
}: {
  title: string;
  links: ReadonlyArray<{ href: string; label: string }>;
  hub?: { href: string; label: string };
}) {
  return (
    <nav aria-label={title} className="flex flex-col gap-1.5 sm:flex-row sm:gap-4">
      <div className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3] sm:w-[168px] sm:pt-0.5">
        {title}
      </div>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-[#6f7282]">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="transition-colors duration-150 hover:text-[#5566f6]">
              {link.label}
            </Link>
          </li>
        ))}
        {hub ? (
          <li>
            <Link href={hub.href} className="font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6]">
              {hub.label} →
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
