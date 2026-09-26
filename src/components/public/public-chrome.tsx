import Link from "next/link";
import { PublicSupportWidget } from "@/components/public/public-support-widget";
import { AppStoresTeaser } from "@/components/public/app-stores-teaser";
import { BrandLogo } from "@/components/brand/logo";
import { NICHES } from "@/content/niches";
import { SEO_LANDINGS } from "@/content/seo-landings";
import { FEATURES_INFO, FEATURES_ORDER } from "@/content/features";
import { ArrowRight, LogIn } from "lucide-react";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
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
  activeSection?: "blog" | "journals-info" | "home";
}) {
  const session = await getServerSession(authOptions).catch(() => null);
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
    <div
      className="public-header sticky top-0 z-40 border-b border-[#ececf4] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80"
      // В приложении страница под вырезом экрана (viewport-fit=cover): шапка
      // уходит под строку состояния, кнопки — ниже неё. На сайте отступ 0.
      style={{ paddingTop: "var(--safe-area-inset-top, env(safe-area-inset-top, 0px))" }}
    >
      {/* Ночная тема публичных страниц — см. usePublicAutoTheme. Шапка
          стоит первой на каждой странице, поэтому скрипт успевает до отрисовки. */}
      <PublicThemeBootstrap />
      <PublicThemeScope />
      <nav className="mx-auto flex max-w-[1200px] items-center justify-between px-4 py-2.5 sm:px-6 sm:py-5">
        <Link href="/" className="text-[#0b1024]" aria-label="WeSetup — на главную">
          <BrandLogo height={30} className="sm:[--logo-h:26px]" title="" />
        </Link>
        <div className="flex items-center gap-3 sm:gap-5">
          {link("journals-info", "Журналы", "/journals-info")}
          {link("blog", "Блог", "/blog")}
          {session ? (
            <PublicHeaderAuthed
              userName={session.user.name ?? "Пользователь"}
              role={session.user.role ?? ""}
              isRoot={session.user.isRoot === true}
            />
          ) : (
            <PublicHeaderAnon showPricing={!inApp} />
          )}
        </div>
      </nav>
    </div>
  );
}

function PublicHeaderAnon({ showPricing }: { showPricing: boolean }) {
  return (
    <>
      {showPricing ? (
        <Link
          href="/pricing"
          className="text-[14px] font-medium text-[#6f7282] transition-colors hover:text-[#0b1024]"
        >
          Тарифы
        </Link>
      ) : null}
      <Link
        href="/login"
        className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:px-4"
      >
        Войти
        <LogIn className="size-4 text-[#5566f6]" />
      </Link>
    </>
  );
}

function PublicHeaderAuthed({
  userName,
  role,
  isRoot,
}: {
  userName: string;
  role: string;
  isRoot: boolean;
}) {
  const homeHref = getWebHomeHref({ role, isRoot });
  const initials = getInitials(userName);
  return (
    <>
      <Link
        href={homeHref}
        className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-3.5 text-[13px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] sm:px-4 sm:text-[14px]"
      >
        Открыть кабинет
        <ArrowRight className="size-4" />
      </Link>
      <Link
        href={homeHref}
        title={userName}
        aria-label={`Профиль · ${userName}`}
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

export async function PublicFooter() {
  // В приложении WeSetup: без «Тарифов» (оплаты в приложении нет) и без
  // анонса «Приложение скоро» — человек уже в нём.
  const inApp = await isMobileAppRequest();
  return (
    <footer className="public-footer border-t border-[#ececf4]">
      {/* Пузырь поддержки живёт в подвале, а не в корневом layout'е:
          так он есть на всех публичных страницах и нигде не пересекается
          с виджетом кабинета — там свой, с авторизацией. */}
      <PublicSupportWidget />
      <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-10 sm:px-6 sm:py-12 md:gap-10 md:grid-cols-[1.4fr_auto_auto]">
        <div>
          <div className="text-[#0b1024]">
            <BrandLogo height={26} />
          </div>
          <p className="mt-3 max-w-[440px] text-[13px] text-[#9b9fb3]">
            Сервис электронных журналов СанПиН и ХАССП для общепита и пищевых
            производств. © 2026 WeSetup.
          </p>
        </div>

        <div className="min-w-[220px] text-[12px] leading-[1.6] text-[#6f7282]">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
            Реквизиты
          </div>
          <div className="font-medium text-[#0b1024]">ООО «БФС»</div>
          <div>ИНН 5018215599 · КПП 501801001</div>
          <div>ОГРН 1235000105306</div>
          <div>141065, Московская область, г. Королёв, ул. Ленина, д. 10/6</div>
          <div className="mt-2">
            <a
              href="tel:+79996341612"
              className="inline-flex min-h-[36px] items-center transition-colors hover:text-[#0b1024]"
            >
              +7 (999) 634-16-12
            </a>
          </div>
          <div>
            <a
              href="mailto:support@wesetup.ru"
              className="inline-flex min-h-[36px] items-center break-all transition-colors hover:text-[#0b1024]"
            >
              support@wesetup.ru
            </a>
          </div>
          <div className="mt-2 flex flex-col">
            <Link
              href="/oferta"
              className="inline-flex min-h-[32px] items-center transition-colors hover:text-[#0b1024]"
            >
              Договор-оферта
            </Link>
            <Link
              href="/privacy"
              className="inline-flex min-h-[32px] items-center transition-colors hover:text-[#0b1024]"
            >
              Политика конфиденциальности
            </Link>
            {/* Робокасса требует, чтобы все четыре документа были
                доступны с сайта, а не только со страницы оплаты. */}
            <Link
              href="/terms"
              className="inline-flex min-h-[32px] items-center transition-colors hover:text-[#0b1024]"
            >
              Пользовательское соглашение
            </Link>
            <Link
              href="/consent"
              className="inline-flex min-h-[32px] items-center transition-colors hover:text-[#0b1024]"
            >
              Согласие на обработку персональных данных
            </Link>
          </div>

          {inApp ? null : <AppStoresTeaser />}
        </div>

        <div className="flex flex-col flex-wrap text-[13px] text-[#6f7282] md:items-end">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3] md:text-right">
            Разделы
          </div>
          <Link href="/blog" className="py-2.5 transition-colors hover:text-[#0b1024]">Блог</Link>
          <Link href="/glossary" className="py-2.5 transition-colors hover:text-[#0b1024]">Глоссарий</Link>
          <Link href="/compare" className="py-2.5 transition-colors hover:text-[#0b1024]">Сравнения</Link>
          <Link href="/calc/journals" className="py-2.5 transition-colors hover:text-[#0b1024]">Какие журналы нужны</Link>
          <Link href="/calc/fines" className="py-2.5 transition-colors hover:text-[#0b1024]">Калькулятор штрафов</Link>
          <Link href="/whats-new" className="py-2.5 transition-colors hover:text-[#0b1024]">Что нового</Link>
          <Link href="/developers" className="py-2.5 transition-colors hover:text-[#0b1024]">Разработчикам</Link>
          <Link href="/journals-info" className="py-2.5 transition-colors hover:text-[#0b1024]">Журналы</Link>
          <Link href="/blanki" className="py-2.5 transition-colors hover:text-[#0b1024]">Бланки</Link>
          <Link href="/prikazy" className="py-2.5 transition-colors hover:text-[#0b1024]">Приказы</Link>
          <Link href="/uslugi" className="py-2.5 transition-colors hover:text-[#0b1024]">Услуги</Link>
          {inApp ? null : (
            <Link href="/pricing" className="py-2.5 transition-colors hover:text-[#0b1024]">Тарифы</Link>
          )}
          <Link href="/login" className="py-2.5 transition-colors hover:text-[#0b1024]">Войти</Link>
          <Link href="/register" className="py-2.5 transition-colors hover:text-[#0b1024]">Регистрация</Link>
          <Link href="/partners" className="py-2.5 transition-colors hover:text-[#0b1024]">Партнёрам</Link>
          <Link href="/oferta" className="py-2.5 transition-colors hover:text-[#0b1024]">Оферта</Link>
          <Link href="/privacy" className="py-2.5 transition-colors hover:text-[#0b1024]">Конфиденциальность</Link>
          <a
            href="https://t.me/wesetupbot"
            target="_blank"
            rel="noopener noreferrer"
            className="py-2.5 transition-colors hover:text-[#0b1024]"
          >
            Telegram
          </a>
        </div>
      </div>

      {/* Сквозная перелинковка посадочных страниц.
          Раньше 19 лендингов (12 отраслевых и 7 под частотные запросы)
          не имели ни одной ссылки из сквозного элемента и держались
          только на ссылках внутри отдельных страниц — из-за этого
          обходились редко и получали мало внутреннего веса. */}
      <div className="border-t border-[#ececf4]">
        <div className="mx-auto max-w-[1200px] space-y-4 px-4 py-7 sm:px-6">
          <FooterLinkRow
            title="По типу заведения"
            links={Object.values(NICHES).map((n) => ({
              href: `/${n.slug}`,
              label: n.navLabel,
            }))}
          />
          <FooterLinkRow
            title="Частые журналы"
            links={Object.values(SEO_LANDINGS).map((s) => ({
              href: `/${s.slug}`,
              label: s.navLabel,
            }))}
          />
          <FooterLinkRow
            title="Возможности"
            links={FEATURES_ORDER.map((slug) => ({
              href: `/features/${slug}`,
              label: FEATURES_INFO[slug].title,
            }))}
          />
        </div>
      </div>
    </footer>
  );
}

/**
 * Ряд ссылок в подвале: подпись слева, ссылки в строку через мягкий
 * разделитель. Строкой, а не колонкой, потому что позиций много
 * (12 отраслей), и колонка растянула бы подвал на два экрана.
 */
function FooterLinkRow({
  title,
  links,
}: {
  title: string;
  links: ReadonlyArray<{ href: string; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-4">
      <div className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3] sm:w-[168px] sm:pt-0.5">
        {title}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-[#6f7282]">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="transition-colors duration-150 hover:text-[#5566f6]"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
