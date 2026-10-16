"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandLogo } from "@/components/brand/logo";
import { PartnerHint } from "@/components/partner/partner-hint";
import type { PartnerHintRates } from "@/lib/partners/partner-hint";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  Coins,
  CreditCard,
  Handshake,
  Library,
  Loader2,
  LogOut,
  Menu,
  Palette,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getWebHomeHref, hasFullWorkspaceAccess } from "@/lib/role-access";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ProfileSheet } from "@/components/layout/profile-sheet";
import {
  BRANDING_SETTINGS_HREF,
  ThemeTilesMenu,
} from "@/components/theme/theme-tiles";
import { useIsNarrowViewport } from "@/components/ui/spotlight-tour";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { PersonalLanguageSelect } from "@/components/i18n/personal-language-select";
import { UndoRedoButtons } from "@/components/journals/undo-redo-buttons";
import { useHeaderUndo } from "@/components/journals/journal-undo-slot";
import { OfflineIndicator } from "@/components/layout/offline-indicator";
import { LiveConnectionIndicator } from "@/components/live/live-connection-indicator";
import { CabinetPlanCardView } from "@/components/layout/cabinet-plan-card";
import type { CabinetPlanCard } from "@/lib/cabinet-plan";
import { useInsideMobileApp } from "@/lib/use-inside-mobile-app";
import { orgDisplayName } from "@/lib/org-display-name";
import type { BuildingOption } from "@/lib/building-scope";
import {
  OrganizationSwitcher,
  type CreateDialogKind,
} from "@/components/layout/organization-switcher";
import { CreateOrganizationDialog } from "@/components/layout/create-organization-dialog";
import { CreateDemoDialog } from "@/components/layout/create-demo-dialog";
import { CreateMasterCabinetDialog } from "@/components/master/create-master-cabinet-dialog";
import type { AccessibleOrganization } from "@/lib/organization-access";
import { signOutAndOpen } from "@/lib/sign-out";
import { splitCabinetMenu } from "@/lib/cabinet-menu";
import { useOpenMasterCabinet } from "@/components/master/use-open-master-cabinet";
import { useAppNav } from "@/components/layout/app-nav-context";
import { CurrentPointSwitcher } from "@/components/layout/current-point-switcher";
import { MobileNavSheet } from "@/components/layout/mobile-nav-sheet";
import { OrganizationMark } from "@/components/layout/app-sidebar";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

type HeaderProps = {
  userName: string;
  userEmail: string;
  organizationName: string;
  organizationLogoUrl?: string | null;
  userRole: string;
  isRoot: boolean;
  /**
   * Баллы организации. `null` — у пользователя нет прав на деньги
   * организации: пункт меню он видит, сумму — нет.
   */
  balanceRub?: number | null;
  /** Организации аккаунта — для переключателя в меню профиля. */
  organizations: AccessibleOrganization[];
  activeOrganizationId: string;
  /**
   * Текущая точка в центре шапки. `buildings` — точки для переключения
   * (меньше двух — переключателя нет), `name` — что показать без
   * переключателя: единственная точка или организация.
   */
  currentPoint: {
    name: string;
    buildings: BuildingOption[];
    activeBuildingId: string | null;
    manageHref: string | null;
  };
  /** Заводить новые точки может только владелец аккаунта. */
  canCreateOrganization: boolean;
  organizationSphere: string;
  /**
   * Карточка «Мой кабинет» наверху меню профиля: тариф, организации и
   * сотрудники, сумма в месяц, «Изменить тариф» (`buildCabinetPlanCard`).
   */
  cabinetPlan: CabinetPlanCard;
  /** Свой кабинет — не ROOT «под видом» и не консультант партнёра: пометка «сейчас». */
  ownCabinet: boolean;
  /**
   * Пользователь состоит в активном партнёре — в шапке появляется вход
   * в партнёрский кабинет и переключатель контекста «Моя организация /
   * Партнёрский кабинет» в меню профиля.
   */
  partnerCabinet?: { brandName: string } | null;
  /**
   * Ставки партнёрской программы для еле заметной иконки у логотипа.
   * `null` — не показывать (клиент партнёра, сам партнёр, white-label,
   * платформенная организация). См. `getPartnerHintRates`.
   */
  partnerHint?: PartnerHintRates | null;
  /** Кабинет под брендом партнёра — знак WeSetup справа не показываем. */
  whiteLabel?: boolean;
  /**
   * Может открыть настройки организации — там логотип и цвет
   * (`admin.full`, как у самой страницы). Тогда под карточками темы —
   * ссылка «Логотип и цвета».
   */
  canEditBranding?: boolean;
};

/**
 * Шапка кабинета (схема владельца 2026-10-16): по центру — текущая
 * торговая точка, справа — знак WeSetup, колокольчик, выход и аватар.
 * Разделы — в сайдбаре слева (≥1024px) или в меню-листе (бургер).
 */
export function Header({
  userName,
  userEmail,
  organizationName: rawOrganizationName,
  organizationLogoUrl,
  userRole,
  isRoot,
  balanceRub = null,
  organizations,
  activeOrganizationId,
  currentPoint,
  canCreateOrganization,
  organizationSphere,
  cabinetPlan,
  ownCabinet,
  partnerCabinet = null,
  partnerHint = null,
  whiteLabel = false,
  canEditBranding = false,
}: HeaderProps) {
  const t = useTranslations("navigation");
  const pathname = usePathname();
  const headerUndo = useHeaderUndo();
  const nav = useAppNav();
  const fullAccess = hasFullWorkspaceAccess({ role: userRole, isRoot });
  // На телефоне меню профиля — лист снизу (как в приложениях), на
  // компьютере остаётся выпадающее меню.
  const narrowViewport = useIsNarrowViewport();
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Меню профиля управляемое: модалка создания организации/демо живёт
  // вне Radix-меню (внутри её обрезает transform), а меню при этом
  // нужно закрыть — иначе оно останется висеть под оверлеем.
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [createDialog, setCreateDialog] = useState<CreateDialogKind | null>(null);
  const openCreateDialog = (kind: CreateDialogKind) => {
    setProfileMenuOpen(false);
    setCreateDialog(kind);
  };
  // Мастер-кабинеты справочников — не в «Организациях», а в «Кабинете»
  // (`lib/cabinet-menu.ts`): у них своя оболочка `/master`.
  const { organizations: regularOrganizations, masterCabinets } =
    splitCabinetMenu(organizations);
  const openMaster = useOpenMasterCabinet();

  // Общий полный выход (`lib/sign-out.ts`): все куки сессии, next-auth,
  // соседние вкладки. Раньше ответ сервера не проверялся — при сбое
  // человек попадал на /login, оставаясь в аккаунте.
  const handleLogout = () => {
    signOutAndOpen("/login").catch(() => {
      toast.error(t("header.logoutFailed"));
    });
  };

  // Почта в названии организации (следствие мгновенной регистрации)
  // не должна попадать в шапку — показываем нейтральную заглушку.
  const organizationName = orgDisplayName(rawOrganizationName, "");
  const homeHref = getWebHomeHref({ role: userRole, isRoot });
  // Тариф меняют из карточки «Мой кабинет» (там же сумма и расшифровка).
  // В приложении WeSetup ссылки на оплату в карточке нет (правила
  // магазинов) — страница тарифа для просмотра остаётся пунктом «Тариф».
  const canManagePlan = fullAccess;
  const inApp = useInsideMobileApp();
  // Меню есть, когда разделов хотя бы два. Иначе (повар, уборщица) —
  // ни сайдбара, ни бургера: только логотип и шапка.
  const hasMenu = nav.showSidebar;

  return (
    <header className="sticky top-0 z-30 border-b bg-white print:hidden">
      {/* Высота шапки — 72px (на телефоне 56px с рамкой): от неё отсчитаны
          липкие панели журналов (`top-[72px]`). Горизонтальная геометрия
          ДОЛЖНА совпадать с контейнером контента ((dashboard)/layout.tsx):
          max-w-[1800px] + px-4 md:px-8. */}
      <div className="mx-auto grid h-[55px] w-full max-w-[1800px] grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)] items-center gap-2 px-4 sm:h-[72px] md:gap-4 md:px-8">
        <div className="flex min-w-0 items-center gap-2">
          {hasMenu ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileNavOpen(true)}
              className="size-11 shrink-0 rounded-lg bg-[#5566f6]/[0.04] text-[#5566f6] transition-colors duration-200 sm:size-10 lg:hidden hover:bg-[#5566f6]/[0.09] hover:text-[#5566f6]"
              data-nav-burger
            >
              <Menu className="size-5" />
              <span className="sr-only">{t("shell.menu")}</span>
            </Button>
          ) : null}
          {/* Без сайдбара логотип организации — здесь, слева. */}
          <Link
            href={homeHref}
            className={cn(
              "flex min-w-0 shrink items-center rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 max-sm:min-h-11",
              hasMenu && "hidden",
            )}
            aria-label={t("header.homeAria", { organization: organizationName || "WeSetup" })}
          >
            <OrganizationMark key={organizationLogoUrl ?? "none"} logoUrl={organizationLogoUrl ?? null} name={organizationName || "WeSetup"} compact />
          </Link>
          {/* На телефоне зона нажатия 44×44 — значок тот же, еле заметный. */}
          {partnerHint ? <PartnerHint rates={partnerHint} className="max-sm:size-11" /> : null}
          {/* Отмена и повтор открытого журнала. Стоят здесь, а не в
              заголовке документа: журнал длинный, и когда человек
              промахнулся мимо ячейки где-то внизу таблицы, кнопки должны
              быть под рукой. Состояние приезжает из клиента документа. */}
          {headerUndo ? (
            <UndoRedoButtons undo={headerUndo} className="ml-1 hidden items-center gap-1.5 md:flex" />
          ) : null}
        </div>

        <div className="flex min-w-0 justify-center">
          <CurrentPointSwitcher
            name={currentPoint.name}
            buildings={currentPoint.buildings}
            activeBuildingId={currentPoint.activeBuildingId}
            manageHref={currentPoint.manageHref}
          />
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-1.5 md:gap-2">
          {whiteLabel ? null : (
            <span className="mr-1 hidden text-[#0b1024] opacity-70 sm:inline-flex" data-brand-mark>
              <BrandLogo height={16} title={t("shell.brand")} />
            </span>
          )}
          <OfflineIndicator />
          <LiveConnectionIndicator />
          <NotificationsBell triggerClassName="max-sm:size-11" />

          {partnerCabinet ? (
            <Link
              href="/partner"
              aria-label={t("header.partnerCabinet")}
              title={t("header.partnerTitle", { brand: partnerCabinet.brandName })}
              className="hidden h-10 shrink-0 items-center justify-center rounded-lg bg-[#5566f6]/[0.04] px-2.5 text-[#5566f6] transition-colors duration-200 md:inline-flex hover:bg-[#5566f6]/[0.09]"
            >
              <Handshake className="size-5 shrink-0" />
            </Link>
          ) : null}

          {isRoot ? (
            <Link
              href="/root"
              aria-label={t("header.platformPanel")}
              title={t("header.platformPanel")}
              className={cn(
                "hidden h-10 shrink-0 items-center justify-center rounded-lg bg-[#5566f6]/[0.04] px-2.5 text-[#5566f6] transition-colors duration-200 md:inline-flex hover:bg-[#5566f6]/[0.09]",
                pathname.startsWith("/root") && "bg-[#5566f6]/[0.09]"
              )}
            >
              <ShieldCheck className="size-5 shrink-0" />
            </Link>
          ) : null}

          <button
            type="button"
            onClick={handleLogout}
            aria-label={t("header.logout")}
            title={t("header.logout")}
            className="hidden size-10 shrink-0 items-center justify-center rounded-lg bg-[#5566f6]/[0.04] text-[#5566f6] transition-colors duration-200 md:inline-flex hover:bg-[#fff4f2] hover:text-[#d2453d]"
          >
            <LogOut className="size-5" />
          </button>

          {narrowViewport ? (
            <Button
              variant="ghost"
              type="button"
              onClick={() => setProfileSheetOpen(true)}
              className="relative size-11 shrink-0 rounded-full p-0 sm:size-10"
              aria-label={t("header.profile")}
            >
              <Avatar size="lg" className="max-sm:data-[size=lg]:size-11">
                <AvatarFallback className="bg-[#5566f6]/[0.09] text-[13px] font-semibold text-[#5566f6]">
                  {getInitials(userName)}
                </AvatarFallback>
              </Avatar>
            </Button>
          ) : (
          <DropdownMenu open={profileMenuOpen} onOpenChange={setProfileMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="relative size-11 shrink-0 rounded-full p-0 sm:size-10"
                aria-label={t("header.profile")}
              >
                {/* Аватар остаётся кругом (это аватар), но размер
                    согласован с остальными контролами шапки — size-10
                    (на телефоне size-11, как все кнопки шапки). */}
                <Avatar size="lg" className="max-sm:data-[size=lg]:size-11">
                  <AvatarFallback className="bg-[#5566f6]/[0.09] text-[13px] font-semibold text-[#5566f6]">
                    {getInitials(userName)}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 p-0">
              <div className="px-3 py-2"><PersonalLanguageSelect /></div>
              {/* Шапка меню: кто вошёл + строка тарифа. Тариф здесь, а
                  не отдельной пилюлей в header'е: это редко нужная,
                  но важная справка — ровно формат меню аккаунта. */}
              <DropdownMenuLabel className="block px-3 py-3 font-normal normal-case tracking-normal">
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-[14px] font-semibold leading-tight text-[#0b1024]">
                    {userName}
                  </p>
                  <p className="truncate text-[12px] leading-tight text-[#6f7282]">
                    {userEmail}
                  </p>
                </div>
              </DropdownMenuLabel>

              <DropdownMenuSeparator className="my-0" />

              <div className="p-1">
                {/* «Мой кабинет» (как в листе на телефоне): тариф,
                    организации, сотрудники, сумма и «Изменить тариф».
                    Нажатие — в свой кабинет; прежний пункт «Моя
                    организация» заменён этой карточкой. */}
                <CabinetPlanCardView
                  card={cabinetPlan}
                  ownCabinet={ownCabinet}
                  variant="menu"
                  onNavigate={() => setProfileMenuOpen(false)}
                />
                {/* Другие юрлица аккаунта — здесь; точки одной компании —
                    в центре шапки. */}
                <OrganizationSwitcher
                  organizations={organizations}
                  activeId={activeOrganizationId}
                  canCreate={canCreateOrganization}
                  onOpenCreate={openCreateDialog}
                  showSettings={fullAccess}
                  onNavigate={() => setProfileMenuOpen(false)}
                  label={t("profile.organizationSwitcher")}
                />
                {regularOrganizations.length > 1 || canCreateOrganization ? (
                  <DropdownMenuSeparator className="my-1" />
                ) : null}
                {partnerCabinet || masterCabinets.length > 0 || canCreateOrganization ? (
                  <>
                    {/* «Другие кабинеты»: партнёрский — /partner,
                        мастер-кабинеты справочников — /master. Владельцу
                        аккаунта под ними всегда «Создать мастер-кабинет». */}
                    <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                      {t("profile.otherCabinets")}
                    </div>
                    {partnerCabinet ? (
                      <DropdownMenuItem asChild className="focus:bg-[#f5f6ff]">
                        <Link href="/partner">
                          <Handshake className="mr-2 size-4 text-[#5566f6]" />
                          <span className="flex-1 truncate">{t("header.partnerCabinet")}</span>
                          <span className="max-w-[120px] truncate text-[11px] text-[#6f7282]">
                            {partnerCabinet.brandName}
                          </span>
                        </Link>
                      </DropdownMenuItem>
                    ) : null}
                    {masterCabinets.map((cabinet) => (
                      <DropdownMenuItem
                        key={cabinet.id}
                        className="focus:bg-[#f5f6ff]"
                        title={t("header.masterCabinetTitle")}
                        data-testid="profile-master-cabinet"
                        onSelect={(event) => {
                          // Меню не закрываем: видно, что идёт переключение,
                          // дальше — полная загрузка /master.
                          event.preventDefault();
                          void openMaster.open(cabinet);
                        }}
                      >
                        <Library className="mr-2 size-4 text-[#5566f6]" />
                        <span className="flex-1 truncate">{cabinet.name}</span>
                        {openMaster.openingId === cabinet.id ? (
                          <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                    {canCreateOrganization ? (
                      <DropdownMenuItem
                        className="text-[#5566f6] focus:bg-[#f5f6ff] focus:text-[#5566f6]"
                        title={t("header.backOfficeTitle")}
                        data-testid="profile-create-master-cabinet"
                        onSelect={() => openCreateDialog("master-cabinet")}
                      >
                        <Plus className="mr-2 size-4" />
                        {t("profile.createMasterCabinet")}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator className="my-1" />
                  </>
                ) : null}
                {/* Баланс и бонусы — над «Тарифами и оплатой»: баллы
                    тратятся именно там, и порядок повторяет сценарий. */}
                <DropdownMenuItem asChild className="focus:bg-[#f5f6ff]">
                  <Link href="/settings/balance">
                    <Coins className="mr-2 size-4 text-[#5566f6]" />
                    <span className="flex-1">{t("profile.balanceBonuses")}</span>
                    {balanceRub !== null ? (
                      <span className="text-[11px] tabular-nums text-[#3848c7]">
                        {balanceRub.toLocaleString("ru-RU")} ₽
                      </span>
                    ) : null}
                  </Link>
                </DropdownMenuItem>
                {canManagePlan && inApp ? (
                  <DropdownMenuItem asChild className="focus:bg-[#f5f6ff]">
                    <Link href="/settings/subscription">
                      <CreditCard className="mr-2 size-4 text-[#5566f6]" />
                      {t("profile.plan")}
                    </Link>
                  </DropdownMenuItem>
                ) : null}

                {isRoot ? (
                  <DropdownMenuItem asChild className="md:hidden">
                    <Link href="/root">
                      <ShieldCheck className="mr-2 size-4" />
                      {t("header.platformPanel")}
                    </Link>
                  </DropdownMenuItem>
                ) : null}
              </div>

              <DropdownMenuSeparator className="my-0" />

              {/* Тема — три карточки, как блок Appearance в приложении
                  Claude, всем (личная настройка). Меню при выборе не
                  закрывается: видно, как перекрасился кабинет. */}
              <div className="px-2 pb-2 pt-1.5" data-testid="profile-theme">
                <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                  {t("profile.theme")}
                </div>
                <ThemeTilesMenu />
                {canEditBranding ? (
                  <DropdownMenuItem
                    asChild
                    className="mt-1 w-fit gap-1.5 px-2 py-1.5 text-[13px]"
                  >
                    <Link href={BRANDING_SETTINGS_HREF} data-testid="theme-branding-link">
                      <Palette className="size-3.5 text-[var(--app-indigo-deep)]" aria-hidden />
                      <span className="font-medium text-[var(--app-indigo-deep)]">
                        {t("profile.branding")}
                      </span>
                    </Link>
                  </DropdownMenuItem>
                ) : null}
              </div>

              <DropdownMenuSeparator className="my-0" />

              <div className="p-1">
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-[#a13a32] focus:bg-[#fff4f2] focus:text-[#a13a32]"
                >
                  <LogOut className="mr-2 size-4" />
                  {t("header.logout")}
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          )}
        </div>
      </div>

      {hasMenu ? (
        <MobileNavSheet
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          buildings={currentPoint.buildings}
          activeBuildingId={currentPoint.activeBuildingId}
          onLogout={handleLogout}
        />
      ) : null}

      <ProfileSheet
        open={profileSheetOpen}
        onClose={() => setProfileSheetOpen(false)}
        userName={userName}
        userEmail={userEmail}
        cabinetPlan={cabinetPlan}
        ownCabinet={ownCabinet}
        organizations={regularOrganizations}
        masterCabinets={masterCabinets}
        activeOrganizationId={activeOrganizationId}
        canCreateOrganization={canCreateOrganization}
        onOpenCreate={openCreateDialog}
        partnerCabinet={partnerCabinet}
        balanceRub={balanceRub}
        canManagePlan={canManagePlan}
        fullAccess={fullAccess}
        canEditBranding={canEditBranding}
        isRoot={isRoot}
        onLogout={handleLogout}
      />

      {createDialog === "demo" ? (
        <CreateDemoDialog
          currentSphere={organizationSphere}
          onClose={() => setCreateDialog(null)}
        />
      ) : null}
      {createDialog === "master-cabinet" ? (
        <CreateMasterCabinetDialog onClose={() => setCreateDialog(null)} />
      ) : null}
      {createDialog === "organization" ? (
        <CreateOrganizationDialog
          currentSphere={organizationSphere}
          currentName={
            organizations.find((item) => item.id === activeOrganizationId)?.name ?? ""
          }
          onClose={() => setCreateDialog(null)}
          organizationsCount={regularOrganizations.length}
        />
      ) : null}
    </header>
  );
}
