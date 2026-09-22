import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Building2, Eye, Mail, MessageCircle, PencilLine, Phone, ShieldCheck } from "lucide-react";

import { BrandLogo } from "@/components/brand/logo";
import { PartnerAccessChooser } from "@/components/partner/partner-access-chooser";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { PARTNER_ACCESS_LEVEL_LABELS } from "@/lib/partners/access-guard";
import { PLATFORM_BADGE_TEXT, clientFacingBrand, getPartnerBrandBySlug, logoUrlFor } from "@/lib/partners/branding";
import { phoneHref, telegramHref } from "@/lib/partners/consultant-contact";
import { validateSlug } from "@/lib/partners/validation";
import { DEFAULT_OG_IMAGES } from "@/lib/meta-defaults";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const found = validateSlug(slug).ok ? await getPartnerBrandBySlug(slug) : null;
  const brand = found ? clientFacingBrand(found) : null;
  const title = brand ? `${brand.brandName} — вход и регистрация в WeSetup` : "Страница партнёра";
  return {
    title,
    description: brand
      ? `Электронные журналы СанПиН и ХАССП при сопровождении ${brand.brandName}. ${PLATFORM_BADGE_TEXT}.`
      : undefined,
    robots: { index: false, follow: false },
    openGraph: brand ? { title, siteName: "WeSetup", locale: "ru_RU", images: DEFAULT_OG_IMAGES } : undefined,
  };
}

/**
 * Брендированная страница партнёра `/p/<slug>`: логотип и приветствие
 * партнёра, выбор уровня доступа консультанта и кнопки «Зарегистрировать
 * компанию» / «Войти». Кнопки ведут через `/p/<slug>/start`, который
 * ставит cookie-метку — после регистрации организация привяжется к
 * партнёру сама. Подпись «Работает на платформе WeSetup» обязательна.
 */
export default async function PartnerLandingPage({ params }: Params) {
  const { slug } = await params;
  if (!validateSlug(slug).ok) notFound();
  const found = await getPartnerBrandBySlug(slug);
  if (!found) notFound();
  // Партнёр скрыл себя от клиентов — нейтральная страница WeSetup.
  const brand = clientFacingBrand(found);

  const session = await getServerSession(authOptions);
  const loggedInOrg = session?.user?.organizationId
    ? { id: session.user.organizationId, name: session.user.organizationName ?? "вашей организации" }
    : null;

  const accent = brand.accentColor ?? "#5566f6";
  const accentHover = brand.accentHover ?? "#4a5bf0";
  const logoUrl = brand.hasLogoLight ? logoUrlFor(brand, "light") : null;
  const contacts = [
    brand.supportPhone ? { icon: Phone, label: brand.supportPhone, href: phoneHref(brand.supportPhone) } : null,
    brand.supportTelegram
      ? { icon: MessageCircle, label: brand.supportTelegram, href: telegramHref(brand.supportTelegram) }
      : null,
    brand.supportEmail ? { icon: Mail, label: brand.supportEmail, href: `mailto:${brand.supportEmail}` } : null,
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));

  return (
    <div
      className="min-h-screen bg-[#f4f5fb] px-4 py-10 sm:py-16"
      style={{ ["--partner-accent" as string]: accent, ["--partner-accent-hover" as string]: accentHover } as React.CSSProperties}
    >
      <div className="mx-auto w-full max-w-[560px]">
        <div className="rounded-3xl border border-[#ececf4] bg-white p-7 shadow-[0_20px_60px_-30px_rgba(11,16,36,0.35)] sm:p-9">
          <div className="flex flex-col items-center text-center">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={brand.brandName} className="h-14 w-auto max-w-[240px] object-contain" />
            ) : (
              <div className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{brand.brandName}</div>
            )}
            <h1 className="mt-5 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024] sm:text-[28px]">
              {brand.loginGreeting || `Добро пожаловать в электронные журналы от ${brand.brandName}`}
            </h1>
            <p className="mt-3 max-w-[440px] text-[14px] leading-[1.6] text-[#3c4053]">
              Журналы СанПиН и ХАССП заполняются в WeSetup, а {brand.brandName} видит ваш кабинет как консультант:
              подсказывает, следит за просрочками и помогает при проверках.
            </p>
          </div>

          {loggedInOrg ? (
            <div className="mt-7 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
                  <Building2 className="size-5" />
                </span>
                <div className="min-w-0 text-[14px] leading-[1.55] text-[#3c4053]">
                  Вы вошли как <span className="font-medium text-[#0b1024]">{loggedInOrg.name}</span>. Подключить
                  консультанта можно прямо сейчас — уровень доступа выберете на следующем шаге.
                </div>
              </div>
              <Link
                href={`/settings/consultant?attach=${encodeURIComponent(brand.slug)}`}
                className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-medium text-white transition-colors"
                style={{ backgroundColor: "var(--partner-accent)" }}
              >
                Подключить {brand.brandName}
                <ArrowRight className="size-4" />
              </Link>
            </div>
          ) : (
            <PartnerAccessChooser slug={brand.slug} brandName={brand.brandName} />
          )}

          <div className="mt-7 grid gap-2 text-[13px] text-[#6f7282] sm:grid-cols-2">
            <div className="flex items-start gap-2 rounded-2xl bg-[#fafbff] px-3 py-2.5">
              <Eye className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
              <span>
                <span className="font-medium text-[#0b1024]">{PARTNER_ACCESS_LEVEL_LABELS.view}</span> — консультант
                видит журналы и отчёты, но не меняет их.
              </span>
            </div>
            <div className="flex items-start gap-2 rounded-2xl bg-[#fafbff] px-3 py-2.5">
              <PencilLine className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
              <span>
                <span className="font-medium text-[#0b1024]">{PARTNER_ACCESS_LEVEL_LABELS.edit}</span> — может
                вносить записи и настраивать журналы за вас.
              </span>
            </div>
          </div>
          <p className="mt-3 flex items-start gap-2 text-[12px] leading-[1.5] text-[#6f7282]">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[#116b2a]" />
            Уровень доступа можно поменять или отключить консультанта в любой момент в «Настройки → Консультант».
            Оплату, тариф и сотрудников консультант не меняет никогда.
          </p>

          {contacts.length > 0 ? (
            <div className="mt-6 border-t border-[#f0f1f7] pt-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Ваш консультант</div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[14px]">
                {contacts.map((c) => (
                  <a
                    key={c.label}
                    href={c.href}
                    className="inline-flex items-center gap-1.5 text-[#0b1024] transition-colors hover:text-[#3848c7]"
                  >
                    <c.icon className="size-4 text-[#5566f6]" />
                    {c.label}
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col items-center gap-2 text-[12px] text-[#6f7282]">
          <Link href="/" className="inline-flex items-center gap-2 text-[#3c4053] hover:text-[#0b1024]" aria-label="WeSetup">
            <span>{PLATFORM_BADGE_TEXT}</span>
            <BrandLogo height={16} title="" />
          </Link>
          {brand.hiddenFromClients ? null : (
            <span>
              Есть аккаунт, а консультанта нет? Введите код партнёра в «Настройки → Консультант».
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
