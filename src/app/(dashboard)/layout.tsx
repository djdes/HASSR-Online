import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isImpersonating, requireAuth, getActiveOrgId, signInHrefFor } from "@/lib/auth-helpers";
import { KioskSessionGuard } from "@/components/layout/kiosk-session-guard";
import { loadBuildingContext } from "@/lib/active-building";
import { AuthSessionProvider } from "@/components/layout/session-provider";
import { Header } from "@/components/layout/header";
import { ImpersonationBanner } from "@/components/dashboard/impersonation-banner";
import { CompleteProfileNudge } from "@/components/dashboard/complete-profile-nudge";
import { WelcomeOrgBanner } from "@/components/organizations/welcome-org-banner";
import { DemoOrgBanner } from "@/components/organizations/demo-org-banner";
import { DashboardFooter } from "@/components/dashboard/dashboard-footer";
import { LegalUpdateModal } from "@/components/legal/legal-update-modal";
import { LEGAL_VERSION } from "@/lib/legal-consent";
import { FabDockProvider } from "@/components/layout/fab-dock";
import { Toaster } from "@/components/ui/sonner";
import {
  SiteThemeBootstrap,
  SiteThemeProvider,
} from "@/components/theme/site-theme";
import { SanpinChatWidget } from "@/components/ai/sanpin-chat-widget";
import { SupportWidget } from "@/components/support/support-widget";
import { CommandPalette } from "@/components/layout/command-palette";
import { UrgentJournalHotkey } from "@/components/layout/urgent-journal-hotkey";
import { WhatsNewModal } from "@/components/dashboard/whats-new-modal";
import { AnnouncementBanner } from "@/components/layout/announcement-banner";
import { DeletionBanner } from "@/components/layout/deletion-banner";
import { NpsBanner } from "@/components/layout/nps-banner";
import { NPS_HIDDEN } from "@/lib/nps";
import { npsVisibilityFor } from "@/lib/nps-data";
import { deletionDueAt } from "@/lib/org-deletion";
import { currentAnnouncement } from "@/lib/platform-status";
import { WHATS_NEW_NOTES, notesWithoutPartnerProgram, whatsNewVersion } from "@/lib/whats-new-notes";
import { THEME_COOKIE, pickInitialTheme } from "@/lib/theme-cookie";
import { WHATS_NEW_COOKIE, whatsNewMode } from "@/lib/whats-new-seen";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { hasCapability } from "@/lib/permission-presets";
import { getBalance } from "@/lib/balance/ledger";
import { db } from "@/lib/db";
import { DEFAULT_ORG_NAME } from "@/lib/org-profile";
import { listAccessibleOrganizations } from "@/lib/organization-access";
import { BILLING_TEST_MODE } from "@/lib/plan-limits";
import { loadBillingView } from "@/lib/billing-view.server";
import { buildCabinetPlanCard } from "@/lib/cabinet-plan";
import { readActiveLifetimeDiscount } from "@/lib/promo/checkout";
import { isMobileAppRequest } from "@/lib/mobile-app-payments";
import { BillingAnnouncement } from "@/components/billing/billing-announcement";
import { BillingTransitionGate } from "@/components/billing/billing-transition-gate";
import { BillingStaffNotice } from "@/components/billing/billing-staff-notice";
import { PageNav, PageNavProvider } from "@/components/layout/page-nav";
import { LayoutLocationTabs } from "@/components/layout/location-tabs";
import { JournalUndoProvider } from "@/components/journals/journal-undo-slot";
import { PartnerAccessBanner } from "@/components/dashboard/partner-access-banner";
import {
  getPartnerBrandById,
  getVisibleOrgBranding,
  isPartnerHiddenForOrg,
} from "@/lib/partners/branding";
import { toConsultantContact } from "@/lib/partners/consultant-contact";
import { getPartnerMembership } from "@/lib/partners/service";
import { getPartnerHintRates } from "@/lib/partners/partner-hint";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import {
  MINI_SHELL_COOKIE,
  isMiniShellValue,
  miniShellSignInHref,
} from "@/lib/mini-shell-cookie";
import { PARTNER_HEADER_PATH } from "@/lib/partners/request-context";
import { MiniAppShell } from "@/app/mini/_components/mini-app-shell";
import { loadMiniShellData } from "@/app/mini/_components/mini-shell-data";
import { CustomNamesProvider } from "@/components/shared/custom-names-provider";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import "@/app/app-theme.css";
// Оболочка мини-приложения показывает эти же страницы в телефоне, и её
// стили должны быть загружены вместе с ними. Все правила файла
// заскоуплены на `.mini-root` / `.mini-scope`, поэтому обычный вид
// кабинета они не трогают.
import "@/app/mini/mini-theme.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Все (dashboard) routes — приватные. Дублирует robots.txt, но также
// влияет на кэшированную HTML-копию у юзера (если кто-то поделится
// скриншотом dev-tools или пробросит deep-link через WhatsApp web preview).
export const metadata = {
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Режим оболочки мини-приложения: человек пришёл из Telegram или из
  // установленного на телефон приложения. Страница остаётся ТОЙ ЖЕ —
  // со всеми своими проверками прав, — меняется только хром вокруг неё
  // (П-3: мини-приложение это сайт в Telegram). Куку ставит и снимает
  // клиент мини-приложения, см. `lib/mini-shell-cookie.ts`.
  const cookieStore = await cookies();
  if (isMiniShellValue(cookieStore.get(MINI_SHELL_COOKIE)?.value)) {
    return <MiniShellDashboard>{children}</MiniShellDashboard>;
  }

  const session = await requireAuth();

  const activeOrgId =
    isImpersonating(session) && session.user.actingAsOrganizationId
      ? session.user.actingAsOrganizationId
      : getActiveOrgId(session);

  const partnerAccess = session.user.partnerAccess ?? null;

  const [
    impersonatedOrg,
    profile,
    brandedOrg,
    organizations,
    ownedAccount,
    partnerBranding,
    partnerMembership,
    partnerAccessBrand,
  ] = await Promise.all([
    isImpersonating(session) && session.user.actingAsOrganizationId
      ? db.organization.findUnique({
          where: { id: session.user.actingAsOrganizationId },
          select: { name: true },
        })
      : Promise.resolve(null),
    db.user.findUnique({
      where: { id: session.user.id },
      select: {
        positionTitle: true,
        themePreference: true,
        showWhatsNew: true,
        // Признаки незавершённой анкеты после мгновенной регистрации:
        // имя равно почте и/или не заполнен телефон.
        email: true,
        name: true,
        phone: true,
        legalVersion: true,
      },
    }),
    // H1 — white-label: читаем brandColor для override основного
    // indigo и logoUrl для замены WESETUP-лейбла в шапке.
    db.organization.findUnique({
      where: { id: activeOrgId },
      select: {
        brandColor: true,
        logoUrl: true,
        name: true,
        // E2: тариф и численность едут в меню профиля пропсами —
        // клиентского fetch'а за этим ради одной строки не заводим.
        subscriptionPlan: true,
        type: true,
        accountId: true,
        account: { select: { subscriptionPlan: true } },
        // Анкета «Завершите регистрацию» перезаписывает организацию
        // целиком, поэтому стартовать она должна от уже известного —
        // иначе владелец готового кабинета сотрёт настроенное.
        ownershipKind: true,
        locationsCount: true,
        inn: true,
        address: true,
        // Демо-организация: баннер «данные тестовые» + счётчики для
        // диалога удаления.
        isDemo: true,
        demoExpiresAt: true,
        _count: {
          select: {
            users: { where: { isActive: true } },
            journalDocuments: true,
          },
        },
      },
    }),
      listAccessibleOrganizations(session.user.id),
      db.account.findUnique({
        where: { ownerUserId: session.user.id },
        select: { id: true },
      }),
      // White-label партнёра: бренд, акцент и контакты консультанта для
      // кабинета клиента. null — если партнёра нет или клиент выбрал
      // стандартный интерфейс WeSetup.
      getVisibleOrgBranding(activeOrgId),
      // Переключатель контекста «Моя организация / Партнёрский кабинет»
      // нужен только участнику партнёра в своей организации; внутри
      // кабинета клиента (partnerAccess) он и так видит баннер партнёра.
      partnerAccess ? Promise.resolve(null) : getPartnerMembership(session.user.id),
      // Имя партнёра для баннера «вы здесь как партнёр» — независимо от
      // того, скрыл клиент брендинг или нет.
      partnerAccess ? getPartnerBrandById(partnerAccess.partnerId) : Promise.resolve(null),
    ]);

  // «Что нового»: показывать ли — решаем здесь, до первой отрисовки, по
  // куке устройства (lib/whats-new-seen.ts). Версия — по ПОЛНОМУ тексту
  // заметок: одна на все организации, иначе смена организации «обновляла»
  // заметки и окно появлялось снова.
  const whatsNewCurrent = whatsNewVersion(WHATS_NEW_NOTES);
  const whatsNewState = whatsNewMode({
    enabled: hasFullWorkspaceAccess(session.user) && profile?.showWhatsNew !== false,
    version: whatsNewCurrent,
    seenCookie: cookieStore.get(WHATS_NEW_COOKIE)?.value,
  });
  if (whatsNewState === "show") {
    console.info(`[whats-new] окно в разметке сразу открыто user=${session.user.id} version=${whatsNewCurrent}`);
  }
  // Консультант скрыл себя — в «Что нового» нет заметок о партнёрской программе.
  const whatsNewNotes =
    whatsNewState === "hide"
      ? []
      : (await isPartnerHiddenForOrg(activeOrgId))
        ? notesWithoutPartnerProgram(WHATS_NEW_NOTES)
        : WHATS_NEW_NOTES;

  // Точки: список для переключателя в шапке и активная точка запроса.
  // Тот же контекст (кэш на запрос) читают страницы журналов.
  const buildingContext = await loadBuildingContext(session);

  // Тариф живёт на аккаунте: у сети из трёх кафе один договор. Пока
  // организация не привязана к аккаунту — тариф самой организации.
  const accountPlan =
    brandedOrg?.account?.subscriptionPlan ??
    brandedOrg?.subscriptionPlan ??
    "free";

  // Бесплатный период и переход на оплату (2026-10): анонс, окно решения
  // руководителю, плашка сотруднику, строка тарифа в шапке. Сбой расчёта
  // не должен ронять кабинет — тогда просто без них.
  const inMobileApp = await isMobileAppRequest();
  const billing = await loadBillingView({
    organizationId: activeOrgId,
    user: session.user,
    impersonating: isImpersonating(session),
    partnerAccess: Boolean(partnerAccess),
    inMobileApp,
  }).catch((error) => {
    console.error("[billing] layout view failed", error);
    return null;
  });

  // Карточка «Мой кабинет» в меню профиля: тариф, организации и сотрудники
  // (как считает тариф — `loadBillingUnit`), сумма в месяц с акцией и
  // скидкой навсегда. Цену и ссылку видит тот, кто может менять тариф, и
  // не в приложении WeSetup (правила сторов).
  const canManagePlan = hasFullWorkspaceAccess(session.user);
  const showPlanDetails = canManagePlan && !inMobileApp;
  const lifetimeDiscount =
    showPlanDetails && billing?.unit.accountId
      ? await readActiveLifetimeDiscount(billing.unit.accountId).catch((error) => {
          console.error("[billing] cabinet card lifetime discount failed", error);
          return null;
        })
      : null;
  const cabinetPlan = buildCabinetPlanCard({
    state: billing?.state ?? null,
    settings: billing?.settings ?? null,
    plan: billing?.header.plan ?? accountPlan,
    // Без расчёта тарифа — только название и ссылка.
    exempt: billing ? billing.unit.exempt : true,
    organizationsCount: billing?.unit.scopeOrgIds.length ?? 0,
    employees: billing?.unit.activeUsers ?? 0,
    tariffRub: billing?.nowPrice.baseRub ?? 0,
    promotion: billing?.nowPrice.promotion ?? null,
    personal: lifetimeDiscount,
    canManagePlan,
    inMobileApp,
    testMode: billing ? billing.testModeActive : BILLING_TEST_MODE,
  });

  // Баллы в шапке видит только тот, кто может ими распорядиться:
  // сумма — это деньги организации. Остальным пункт меню всё равно
  // показываем: отзыв пишет и повар, просто без цифры.
  const balanceRub = hasCapability(session.user, "admin.full")
    ? await getBalance(activeOrgId).catch(() => null)
    : null;

  const announcement = await currentAnnouncement();
  const [nps, deletionState, customNames] = await Promise.all([
    npsVisibilityFor(session).catch(() => NPS_HIDDEN),
    db.organization.findUnique({ where: { id: activeOrgId }, select: { deletionRequestedAt: true } }).catch(() => null),
    // Свои названия разделов и журналов — один раз на запрос, дальше их
    // берут меню, крошки и страницы через CustomNamesProvider.
    getOrgCustomNames(activeOrgId),
  ]);
  const deletionDue = deletionState?.deletionRequestedAt ? deletionDueAt(deletionState.deletionRequestedAt).toISOString() : null;
  const impersonatedName = impersonatedOrg?.name ?? null;
  // Тема первого кадра — та, что сейчас на этом устройстве (кука), иначе
  // тема профиля. Так же и при router.refresh(): сервер не «возвращает»
  // тему профиля поверх выбора устройства.
  const initialTheme = pickInitialTheme(
    cookieStore.get(THEME_COOKIE)?.value,
    profile?.themePreference,
  );

  // Анкета считается незаполненной, если нет телефона или организация
  // всё ещё называется заглушкой из мгновенной регистрации. На имя
  // больше не смотрим: оно стало необязательным, и сервер подставляет
  // туда название организации — старая проверка `name === email`
  // никогда бы не сработала.
  //
  // ROOT и платформенная организация исключены: это служебный аккаунт
  // владельца, у него нет и не должно быть анкеты заведения. Демо —
  // тоже: `/api/profile/complete` пишет в активную организацию и
  // переименовал бы песочницу вместо своей.
  //
  // Партнёр в кабинете клиента — тоже: `isImpersonating` ловит только
  // ROOT, поэтому консультанта без своего телефона анкета встречала бы
  // в чужом кабинете и её отправка перезаписала бы название, сферу, ИНН
  // и адрес организации клиента. Анкету заведения заполняет клиент.
  const platformOrgId = (process.env.PLATFORM_ORG_ID ?? "platform").trim();
  const needsProfileCompletion =
    hasFullWorkspaceAccess(session.user) &&
    !isImpersonating(session) &&
    !session.user.partnerAccess &&
    session.user.isRoot !== true &&
    activeOrgId !== platformOrgId &&
    !brandedOrg?.isDemo &&
    Boolean(profile) &&
    (!profile?.phone || brandedOrg?.name === DEFAULT_ORG_NAME);

  // Validate hex color (#RRGGBB) — иначе CSS injection-vector.
  const brandColor =
    brandedOrg?.brandColor && /^#[0-9a-fA-F]{6}$/.test(brandedOrg.brandColor)
      ? brandedOrg.brandColor
      : null;

  // Партнёрский брендинг. Собственные настройки организации (цвет,
  // логотип) старше партнёрских: если клиент задал свой цвет — акцент
  // партнёра не трогаем. Акцент уже проверен на формат и контраст при
  // сохранении (`checkAccent`), но hex-формат перепроверяем перед
  // вставкой в <style>.
  const consultant = toConsultantContact(partnerBranding);

  // Иконка «партнёрская программа» у логотипа. Считается после брендинга:
  // под чужим (white-label) логотипом звать под свой бренд неуместно.
  const headerLogoUrl = brandedOrg?.logoUrl ?? consultant?.logoUrl ?? null;
  const partnerHint = await getPartnerHintRates({
    organizationId: activeOrgId,
    userId: session.user.id,
    hasWhiteLabelLogo: Boolean(headerLogoUrl),
  });
  const partnerAccent =
    !brandColor &&
    consultant?.accentColor &&
    /^#[0-9a-fA-F]{6}$/.test(consultant.accentColor) &&
    consultant.accentHover &&
    /^#[0-9a-fA-F]{6}$/.test(consultant.accentHover)
      ? { color: consultant.accentColor, hover: consultant.accentHover }
      : null;
  const partnerCabinet =
    partnerMembership && partnerMembership.partner.status === "active"
      ? { brandName: partnerMembership.partner.brandName }
      : null;

  return (
    <AuthSessionProvider session={session}>
      <CustomNamesProvider names={customNames}>
      <KioskSessionGuard />
      <SiteThemeProvider initialTheme={initialTheme}>
        {/* H1 — white-label brand color через CSS-vars. Подменяет
            основной indigo (#5566f6) если org указала свой цвет. */}
        {brandColor ? (
          <style
            dangerouslySetInnerHTML={{
              __html: `.app-shell { --brand-color: ${brandColor}; }`,
            }}
          />
        ) : null}
        {/* Акцент партнёра: переменные подхватывают правила
            `.app-shell[data-partner-accent]` в app-theme.css — кнопки и
            активные элементы перекрашиваются без правки компонентов. */}
        {partnerAccent ? (
          <style
            dangerouslySetInnerHTML={{
              __html: `.app-shell { --brand-accent: ${partnerAccent.color}; --brand-accent-hover: ${partnerAccent.hover}; }`,
            }}
          />
        ) : null}
        <div
          className="app-shell flex min-h-screen flex-col bg-gray-50"
          data-app-theme={initialTheme}
          data-partner-accent={partnerAccent ? "" : undefined}
          suppressHydrationWarning
        >
          {/* Первым ребёнком: скрипт видит уже открытую оболочку и красит её
              в тему устройства до первого кадра. */}
          <SiteThemeBootstrap />
          {/* Док плавающих кнопок: AI-помощник, поддержка и «Как
              заполнять» регистрируются в нём вместо собственных круглых
              кнопок. На телефоне их было три, и они закрывали правый
              нижний угол страницы. */}
          <FabDockProvider>
          {impersonatedName ? (
            <ImpersonationBanner organizationName={impersonatedName} />
          ) : null}
          {partnerAccess ? (
            <PartnerAccessBanner
              organizationName={brandedOrg?.name ?? "Организация"}
              brandName={partnerAccessBrand?.brandName ?? "партнёр"}
              level={partnerAccess.level}
            />
          ) : null}
          {needsProfileCompletion ? (
            // Suspense — компонент читает `?welcome=1` через useSearchParams.
            <Suspense fallback={null}>
              <CompleteProfileNudge
                email={profile?.email ?? ""}
                initial={{
                  // Заглушку мгновенной регистрации за название не выдаём.
                  organizationName:
                    brandedOrg?.name && brandedOrg.name !== DEFAULT_ORG_NAME
                      ? brandedOrg.name
                      : null,
                  sphere: brandedOrg?.type ?? null,
                  ownershipKind: brandedOrg?.ownershipKind ?? null,
                  locationsCount: brandedOrg?.locationsCount ?? null,
                  inn: brandedOrg?.inn ?? null,
                  address: brandedOrg?.address ?? null,
                  // Мгновенная регистрация кладёт в имя почту — это
                  // маркер незаполненной анкеты, а не имя человека.
                  personName:
                    profile?.name && profile.name !== profile.email ? profile.name : null,
                }}
              />
            </Suspense>
          ) : null}
          {/* Провайдер обнимает и шапку, и страницу: кнопки отмены
              рендерятся наверху, а их состояние живёт в клиенте открытого
              документа — иначе они друг друга не видят. */}
          <JournalUndoProvider>
          <Header
            userName={session.user.name ?? "Пользователь"}
            userEmail={session.user.email ?? ""}
            organizationName={impersonatedName ?? session.user.organizationName ?? ""}
            organizationLogoUrl={headerLogoUrl}
            userRole={session.user.role ?? ""}
            positionTitle={profile?.positionTitle ?? ""}
            isRoot={session.user.isRoot === true}
            balanceRub={balanceRub}
            cabinetPlan={cabinetPlan}
            ownCabinet={!isImpersonating(session) && !partnerAccess}
            organizations={organizations}
            activeOrganizationId={activeOrgId}
            buildings={buildingContext.canSwitch ? buildingContext.buildings : []}
            activeBuildingId={buildingContext.activeBuildingId}
            canCreateOrganization={Boolean(ownedAccount)}
            organizationSphere={brandedOrg?.type ?? "restaurant"}
            partnerCabinet={partnerCabinet}
            partnerHint={partnerHint}
            canEditBranding={hasCapability(session.user, "admin.full")}
          />
          {/* Быстрый старт только что созданной точки. Живёт в layout'е,
              а не на странице дашборда: баннер сам решает показываться
              по `?welcome-org=1`, и дашборд о нём знать не обязан. */}
          <Suspense fallback={null}>
            <WelcomeOrgBanner
              organizationId={activeOrgId}
              organizationName={brandedOrg?.name ?? "Организация"}
            />
          </Suspense>
          {/* Песочница: постоянная полоса «данные тестовые» с выходом
              в свою организацию и удалением. Только владельцу аккаунта —
              у него и кнопки, и домашняя организация, куда возвращаться. */}
          {brandedOrg?.isDemo && ownedAccount && !isImpersonating(session) ? (
            <Suspense fallback={null}>
              <DemoOrgBanner
                organizationName={brandedOrg.name}
                demoExpiresAt={brandedOrg.demoExpiresAt?.toISOString() ?? null}
                homeOrganizationId={session.user.organizationId}
                staffCount={brandedOrg._count.users}
                documentsCount={brandedOrg._count.journalDocuments}
              />
            </Suspense>
          ) : null}
          {/* Контент во всю ширину экрана (R1: владельцу было «узко»
              на 1296px). Ограничение max-w-[1800px] оставлено только ради
              сверхшироких мониторов, где строка таблицы иначе теряет глаз.
              Вертикальный ритм: 24px сверху, как на эталоне.

              ВАЖНО: горизонтальные паддинги живут ВНУТРИ коробки 1800px
              (px-4 md:px-8), ровно как в <Header>. Раньше padding был на
              <main> (снаружи коробки), из-за чего левая граница контента
              оказывалась на 24px левее левой границы шапки. Единственное
              место, где задаётся горизонтальная геометрия страницы. */}
          <main className="flex-1 py-4 md:py-6">
            <div className="mx-auto w-full max-w-[1800px] px-4 md:px-8">
              {/* Провайдер оборачивает и навигацию, и контент: страницы
                  уточняют крошки через <PageCrumbs>, а рисует их PageNav. */}
              <PageNavProvider>
                {/* Точки: строка вкладок над крошками — на всех страницах,
                    кроме дашборда (там вкладки со счётчиками рисует сама
                    страница). Не липкая: уезжает вместе со страницей. */}
                <LayoutLocationTabs
                  buildings={buildingContext.canSwitch ? buildingContext.buildings : []}
                  activeBuildingId={buildingContext.activeBuildingId}
                  manageHref={
                    hasFullWorkspaceAccess(session.user) ? "/settings/buildings" : null
                  }
                />
                <PageNav
                  organizationName={
                    impersonatedName ?? session.user.organizationName ?? ""
                  }
                />
                {/* Объявление ROOT (плановые работы, инцидент) — над контентом,
                    закрывается и запоминается по id. */}
                <AnnouncementBanner announcement={announcement} />
                {/* Анонс бесплатного периода — наверху главной у всех
                    ролей (дашборд руководителя, журналы сотрудника),
                    закрывается на день. */}
                {billing?.announcement ? (
                  <BillingAnnouncement
                    lead={billing.announcement.lead}
                    tail={billing.announcement.tail}
                    tailParts={billing.announcement.tailParts}
                    href={billing.announcement.href}
                    dayKey={billing.announcement.dayKey}
                    onlyOnPaths={["/dashboard", "/control-board", "/journals"]}
                  />
                ) : null}
                {billing?.staffNotice ? <BillingStaffNotice /> : null}
                {deletionDue ? <DeletionBanner dueAt={deletionDue} canCancel={hasCapability(session.user, "admin.full")} /> : null}
                {/* Всегда в дереве: начатый ответ переживает router.refresh(),
                    когда после оценки ask становится false. `?nps=1` —
                    показать руководителю сразу (canPreview); Suspense —
                    блок читает адрес через useSearchParams. */}
                <Suspense fallback={null}>
                  <NpsBanner ask={nps.ask} canPreview={nps.eligible} />
                </Suspense>
                {children}
              </PageNavProvider>
            </div>
          </main>
          </JournalUndoProvider>
          {/* Футер дашборда — виден на каждой странице (требование
              владельца: «наш футер на каждой странице»). `mt-auto`
              прижимает его к низу на коротких экранах. */}
          <DashboardFooter partnerBrandName={consultant?.brandName ?? null} />
          {/* AI помощник — доступен ВСЕМ авторизованным (решение
              владельца 2026-09-02): отвечает по текущей странице и данным
              организации, действия предлагает карточкой с подтверждением.
              Права на действия режутся на сервере (ACL, «своя строка /
              сегодня»), поэтому виджет безопасен и для рядовых ролей. */}
          <SanpinChatWidget />
          {/* Поддержка — доступна management+ из любого экрана. */}
          {hasFullWorkspaceAccess(session.user) ? (
            <SupportWidget
              consultant={consultant}
              hideChat={Boolean(partnerAccess)}
            />
          ) : null}
          {/* «Что нового» — короткий список изменений при первом заходе
              после обновления. Только для руководства: рядовому
              сотруднику это шум.

              Окно выключали в августе, потому что оно было привязано к
              SHA сборки: SHA менялся, текст оставался прежним, и люди
              при каждом входе видели одно и то же как новость. Теперь
              показ зависит от самого текста (`whatsNewVersion`) — не
              изменили заметки, окно не появится. Плюс человек может
              выключить его совсем в «Настройки → Внешний вид». */}
          {/* Новая редакция документов — руководитель принимает один раз.
              Не при входе ROOT «как организация» и не из кабинета партнёра. */}
          {hasFullWorkspaceAccess(session.user) &&
          !isImpersonating(session) &&
          !partnerAccess &&
          profile &&
          profile.legalVersion !== LEGAL_VERSION ? (
            <LegalUpdateModal />
          ) : null}
          {/* Бесплатный период подписки закончился — руководителю с
              правом на тариф окно на любой странице, пока не решит.
              На странице тарифа вместо окна карточка (там же оплата). */}
          {billing?.gate ? (
            <BillingTransitionGate
              copy={billing.gate.copy}
              payHref={billing.gate.payHref}
              blocking={billing.gate.blocking}
              hideOnPaths={["/settings/subscription"]}
            />
          ) : null}
          {whatsNewState !== "hide" ? (
            <WhatsNewModal
              buildSha={whatsNewCurrent}
              notes={whatsNewNotes}
              mode={whatsNewState}
            />
          ) : null}
          {/* ⌘K — палитра-навигатор. Один глобальный listener на keydown,
              ноль cost когда не открыт. Доступна всем кто видит dashboard. */}
          <CommandPalette />
          {/* P2.A.1 — Ctrl+Shift+N → срочный журнал → /journals/[code]/new */}
          <UrgentJournalHotkey />
          </FabDockProvider>
        </div>
        <Toaster />
      </SiteThemeProvider>
      </CustomNamesProvider>
    </AuthSessionProvider>
  );
}

/**
 * Та же страница кабинета, но в оболочке мини-приложения.
 *
 * Здесь НЕТ ни одной проверки прав — и это главное свойство решения:
 * страница и её серверные guard'ы остаются прежними, поэтому у каждого
 * человека в телефоне ровно те же возможности, что на сайте (П-3, П-4).
 * Меняется только хром: шапка приложения, нижнее меню, кнопка «назад»
 * Telegram, тема.
 *
 * Сайтовый хром не рисуем вовсе: ни Header (он не помещается в телефон
 * и дублировал бы нижнее меню), ни хлебные крошки, ни футер, ни ⌘K, ни
 * «Что нового». Провайдеры, без которых страницы кабинета не работают,
 * остаются: сессия, тема сайта, док плавающих кнопок, крошки (их
 * публикуют страницы) и отмена правок журнала (её слот живёт в шапке
 * приложения).
 */
async function MiniShellDashboard({ children }: { children: React.ReactNode }) {
  // requireAuth() увёл бы на `/login` — в приложении вход происходит сам
  // (по Telegram initData), и форма с паролем там выглядит поломкой.
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user) {
    // Куда человек шёл, знает только прокси — он кладёт путь в заголовок.
    // Без этого ссылка из бота на журнал после входа теряла цель и
    // высаживала человека на домашнем экране.
    const requestPath = (await headers()).get(PARTNER_HEADER_PATH);
    // Общий планшет: без сессии — к списку сотрудников и ПИН, а не ко входу.
    const kioskHref = await signInHrefFor();
    redirect(kioskHref === "/mini/kiosk" ? kioskHref : miniShellSignInHref(requestPath));
  }

  const activeOrgId =
    isImpersonating(session) && session.user.actingAsOrganizationId
      ? session.user.actingAsOrganizationId
      : getActiveOrgId(session);
  const partnerAccess = session.user.partnerAccess ?? null;

  const [shell, impersonatedOrg, orgRow, ownedAccount, partnerAccessBrand, customNames] =
    await Promise.all([
      loadMiniShellData(session),
      isImpersonating(session) && session.user.actingAsOrganizationId
        ? db.organization
            .findUnique({
              where: { id: session.user.actingAsOrganizationId },
              select: { name: true },
            })
            .catch(() => null)
        : Promise.resolve(null),
      db.organization
        .findUnique({
          where: { id: activeOrgId },
          select: {
            name: true,
            isDemo: true,
            demoExpiresAt: true,
            _count: {
              select: {
                users: { where: { isActive: true } },
                journalDocuments: true,
              },
            },
          },
        })
        .catch(() => null),
      db.account
        .findUnique({
          where: { ownerUserId: session.user.id },
          select: { id: true },
        })
        .catch(() => null),
      partnerAccess
        ? getPartnerBrandById(partnerAccess.partnerId).catch(() => null)
        : Promise.resolve(null),
      // Свои названия — те же, что на сайте (П-3).
      getOrgCustomNames(activeOrgId),
    ]);

  const impersonatedName = impersonatedOrg?.name ?? null;

  // Окно решения и плашка сотруднику — те же, что на сайте (П-3); анонс
  // периода в приложении живёт в профиле.
  const billing = await loadBillingView({
    organizationId: activeOrgId,
    user: session.user,
    impersonating: isImpersonating(session),
    partnerAccess: Boolean(partnerAccess),
    inMobileApp: await isMobileAppRequest(),
  }).catch((error) => {
    console.error("[billing] mini shell view failed", error);
    return null;
  });

  return (
    <AuthSessionProvider session={session}>
      <CustomNamesProvider names={customNames}>
      <KioskSessionGuard />
      {/* Тему в оболочке ведёт MiniThemeProvider (смена по времени и
          «как на устройстве» этого устройства → профиль → выбор на
          устройстве → Telegram → по умолчанию). Страницам внутри оболочки,
          которые читают `useSiteTheme` — например «Внешний вид», — он
          отвечает сам (мост `SiteThemeBridge`): там та же тема, что в
          профиле приложения, со всеми тремя карточками. SiteThemeProvider
          снаружи — в режиме `controlled`: он ничего не пересчитывает и не
          пишет в localStorage, только повторяет тему по событию. Раньше он
          считал источником правды свой ключ `wesetup-theme-mode` и
          возвращал страницы к светлой. Его pre-hydration скрипт не рисуем:
          `#mini-root` уже красит MiniThemeBootstrap, два скрипта дрались
          бы за атрибут. */}
      <SiteThemeProvider initialTheme={shell.initialTheme} controlled>
        <MiniAppShell {...shell}>
            <PageNavProvider>
              {/* Человек должен видеть, что он в чужом кабинете или в
                  песочнице, — в телефоне это важнее, чем на сайте:
                  адресной строки тут нет. */}
              {impersonatedName ? (
                <ImpersonationBanner organizationName={impersonatedName} />
              ) : null}
              {partnerAccess ? (
                <PartnerAccessBanner
                  organizationName={orgRow?.name ?? "Организация"}
                  brandName={partnerAccessBrand?.brandName ?? "партнёр"}
                  level={partnerAccess.level}
                />
              ) : null}
              {orgRow?.isDemo && ownedAccount && !isImpersonating(session) ? (
                <Suspense fallback={null}>
                  <DemoOrgBanner
                    organizationName={orgRow.name}
                    demoExpiresAt={orgRow.demoExpiresAt?.toISOString() ?? null}
                    homeOrganizationId={session.user.organizationId}
                    staffCount={orgRow._count.users}
                    documentsCount={orgRow._count.journalDocuments}
                  />
                </Suspense>
              ) : null}
              {billing?.staffNotice ? <BillingStaffNotice variant="mini" /> : null}
              {children}
              {billing?.gate ? (
                <BillingTransitionGate
                  copy={billing.gate.copy}
                  payHref={billing.gate.payHref}
                  blocking={billing.gate.blocking}
                  hideOnPaths={["/settings/subscription"]}
                />
              ) : null}
            </PageNavProvider>
        </MiniAppShell>
      </SiteThemeProvider>
      </CustomNamesProvider>
    </AuthSessionProvider>
  );
}
