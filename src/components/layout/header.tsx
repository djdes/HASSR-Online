"use client";

import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { PartnerHint } from "@/components/partner/partner-hint";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import type { PartnerHintRates } from "@/lib/partners/partner-hint";
import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CalendarRange,
  ChevronDown,
  CircleArrowUp,
  ClipboardList,
  Coins,
  CreditCard,
  FileText,
  GitBranch,
  GraduationCap,
  Handshake,
  LogOut,
  Menu,
  Package,
  Palette,
  Settings,
  ShieldCheck,
  TrendingDown,
  UserRound,
  Users,
  Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { headerNavSections } from "@/lib/app-sections";
import { isManagementRole } from "@/lib/user-roles";
import { getWebHomeHref, hasFullWorkspaceAccess } from "@/lib/role-access";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ProfileSheet } from "@/components/layout/profile-sheet";
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
import { UndoRedoButtons } from "@/components/journals/undo-redo-buttons";
import { useHeaderUndo } from "@/components/journals/journal-undo-slot";
import { OfflineIndicator } from "@/components/layout/offline-indicator";
import { LiveConnectionIndicator } from "@/components/live/live-connection-indicator";
import { planLabel } from "@/lib/plan-limits";
import { orgDisplayName } from "@/lib/org-display-name";
import {
  LocationSwitcherList,
  LocationSwitcherPill,
} from "@/components/layout/location-switcher";
import type { BuildingOption } from "@/lib/building-scope";
import {
  OrganizationSwitcher,
  type CreateDialogKind,
} from "@/components/layout/organization-switcher";
import { CreateOrganizationDialog } from "@/components/layout/create-organization-dialog";
import { CreateDemoDialog } from "@/components/layout/create-demo-dialog";
import type { AccessibleOrganization } from "@/lib/organization-access";

// Иконки разделов: сам перечень живёт в `lib/app-sections.ts` (один
// список на сайт и мини-приложение), а компоненты lucide подставляются
// здесь — в клиенте. Через границу RSC функции не передаются, поэтому
// в общем модуле лежат имена иконок, а не они сами.
const NAV_ICONS: Record<string, typeof ClipboardList> = {
  ClipboardList,
  Package,
  CalendarRange,
  GitBranch,
  TrendingDown,
  GraduationCap,
  AlertTriangle,
  FileText,
  Coins,
  Lightbulb,
};

// Items inside the dropdown under the org-pill. «Сотрудники» вынесен
// отдельной pill-кнопкой в шапке (см. разметку ниже), т.к. это самый
// частый destination для управляющего.
const secondaryNavItems = headerNavSections().map((item) => ({
  label: item.label,
  href: item.href,
  icon: NAV_ICONS[item.icon] ?? ClipboardList,
}));

const STAFF_NAV_ITEM = {
  label: "Сотрудники",
  href: "/settings/users",
  icon: Users,
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * "Волкова Анна Дмитриевна" → "Волкова А. Д."
 * Preserves single-word names, trims extra whitespace.
 */
function shortenPersonName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const [last, ...rest] = parts;
  const initials = rest
    .slice(0, 2)
    .map((p) => `${p[0].toLocaleUpperCase("ru-RU")}.`)
    .join(" ");
  return initials ? `${last} ${initials}` : last;
}

type HeaderProps = {
  userName: string;
  userEmail: string;
  organizationName: string;
  organizationLogoUrl?: string | null;
  userRole: string;
  positionTitle: string;
  isRoot: boolean;
  /** `Organization.subscriptionPlan`: free | paid | paused | cancelled (`trial` — legacy alias free). */
  subscriptionPlan: string;
  /**
   * Баллы организации. `null` — у пользователя нет прав на деньги
   * организации: пункт меню он видит, сумму — нет.
   */
  balanceRub?: number | null;
  /** Организации аккаунта — для переключателя в меню профиля. */
  organizations: AccessibleOrganization[];
  activeOrganizationId: string;
  /** Точки организации, доступные пользователю; меньше двух — переключателя нет. */
  buildings?: BuildingOption[];
  activeBuildingId?: string | null;
  /** Заводить новые точки может только владелец аккаунта. */
  canCreateOrganization: boolean;
  organizationSphere: string;
  /** Активных сотрудников в организации — считается на сервере. */
  activeUsers: number;
  /** Сколько мест входит в бесплатный тариф (FREE_MAX_USERS). */
  freeUserLimit: number;
  /** Тестовый режим биллинга — тариф меняется, деньги не списываются. */
  billingTestMode: boolean;
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
};

export function Header({
  userName,
  userEmail,
  organizationName: rawOrganizationName,
  organizationLogoUrl,
  userRole,
  positionTitle,
  isRoot,
  subscriptionPlan,
  balanceRub = null,
  organizations,
  activeOrganizationId,
  buildings = [],
  activeBuildingId = null,
  canCreateOrganization,
  organizationSphere,
  activeUsers,
  freeUserLimit,
  billingTestMode,
  partnerCabinet = null,
  partnerHint = null,
}: HeaderProps) {
  const pathname = usePathname();
  const headerUndo = useHeaderUndo();
  const fullAccess = hasFullWorkspaceAccess({ role: userRole, isRoot });
  // На телефоне меню профиля — лист снизу (как в приложениях), на
  // компьютере остаётся выпадающее меню.
  const narrowViewport = useIsNarrowViewport();
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  // Заведующая (head_chef / technologist) — даём отдельную ссылку
  // на /verifications вместо «Журналы». Сотрудник так и не узнает что
  // система внутри хранит «журналы».
  const isHeadChef =
    !isRoot &&
    !fullAccess &&
    (userRole === "head_chef" || userRole === "technologist");
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

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  // First slot: company name for managers/root, "Фамилия И.О. · должность"
  // for regular employees. Falls back to "Дашборд" if we somehow lack both.
  const showsOrg = isRoot || isManagementRole(userRole);
  const employeeLabelShort = (() => {
    const name = shortenPersonName(userName);
    const title = positionTitle.trim();
    if (name && title) return `${name} · ${title}`;
    return name || title || "Дашборд";
  })();
  // Почта в названии организации (следствие мгновенной регистрации)
  // не должна попадать в шапку — показываем нейтральную заглушку.
  const organizationName = orgDisplayName(rawOrganizationName, "");
  const homeLabel = showsOrg
    ? organizationName || "Дашборд"
    : employeeLabelShort;
  const homeTooltip = showsOrg
    ? organizationName
    : [userName.trim(), positionTitle.trim()].filter(Boolean).join(" · ");
  const HomeIcon = showsOrg ? Building2 : UserRound;
  const homeHref = getWebHomeHref({ role: userRole, isRoot });
  // Строка тарифа в меню профиля. На бесплатном показываем занятые
  // места (человек должен заранее видеть, что 6-й сотрудник переведёт
  // на платный), на платном — просто численность.
  const onFreePlan = subscriptionPlan === "trial" || subscriptionPlan === "free";
  // Мест считаем по всем организациям аккаунта — иначе владелец сети
  // видел бы «2/5» в каждой точке и не понимал, откуда взялся платный.
  const multiOrg = organizations.length > 1;
  const headcountSuffix = multiOrg
    ? " сотрудников по всем организациям"
    : " сотрудников";
  const planLine = [
    planLabel(subscriptionPlan),
    onFreePlan
      ? `${activeUsers}/${freeUserLimit}${headcountSuffix}`
      : `${activeUsers}${headcountSuffix}`,
    !onFreePlan && billingTestMode ? "тестовый режим" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Раздел тарифов виден каждому, кто вправе менять тариф организации.
  // Раньше пункт показывался только на бесплатном плане — и владелец
  // платной организации не мог найти ни историю платежей, ни
  // автопродление: попасть на страницу можно было лишь через хаб
  // настроек, о котором ещё нужно догадаться.
  const canManagePlan = fullAccess;

  const visibleSecondaryNavItems = fullAccess ? secondaryNavItems : [];
  // Пилюля в шапке показывает название активной точки — значит именно
  // на неё логично навести, чтобы уйти в соседнюю. Дублирует меню
  // профиля намеренно: там это «настройка аккаунта», здесь — навигация.
  const showOrgSwitchInNav = showsOrg && multiOrg;
  const navPanelVisible =
    visibleSecondaryNavItems.length > 0 || showOrgSwitchInNav;
  const navItems = [
    { label: homeLabel, href: homeHref, icon: HomeIcon, tooltip: homeTooltip },
    ...visibleSecondaryNavItems.map((i) => ({ ...i, tooltip: i.label })),
    // «Сотрудники» добавлен отдельно — он вытащен из secondaryNavItems
    // в pill на десктопе, но в мобильном Sheet-меню должен
    // присутствовать рядом с остальными разделами.
    ...(fullAccess
      ? [{ ...STAFF_NAV_ITEM, tooltip: STAFF_NAV_ITEM.label }]
      : []),
  ];

  return (
    <header className="sticky top-0 z-30 border-b bg-white">
      {/* Высота шапки — 72px, как на эталоне (замер: headerBar h=73px). */}
      {/* Горизонтальная геометрия шапки ДОЛЖНА совпадать с контейнером
          контента ((dashboard)/layout.tsx): max-w-[1800px] + px-4 md:px-8
          внутри этой же коробки. Любое расхождение сразу читается как
          «шапка одной ширины, страница другой». */}
      <div className="mx-auto flex h-[72px] w-full max-w-[1800px] items-center gap-2 px-4 md:gap-4 md:px-8">
        <Link
          href={homeHref}
          className="shrink-0 flex items-center gap-2"
          aria-label={`${organizationName || "WeSetup"} — на дашборд`}
        >
          {organizationLogoUrl ? (
            <>
              {/* alt="" — декоративная картинка; имя орги уже даёт span
                  ниже (он виден всегда: на mobile — слева вместо md:inline,
                  на desktop — справа от лого). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={organizationLogoUrl}
                alt=""
                className="h-7 w-auto max-w-[140px] object-contain"
                referrerPolicy="no-referrer"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <span className="text-[14px] font-semibold text-[#0b1024]">
                {organizationName || "WeSetup"}
              </span>
            </>
          ) : (
            // Цвет знака — currentColor. В тёмной теме кабинета
            // `text-[#0b1024]` перекрашивается слоем app-theme.css,
            // отдельный dark:-вариант не нужен и был бы опасен: он
            // сработал бы по системной теме на светлом кабинете.
            <span className="text-[#0b1024]">
              <BrandLogo height={22} title="" />
            </span>
          )}
        </Link>
        {partnerHint ? <PartnerHint rates={partnerHint} className="-ml-1" /> : null}

        {/*
          Desktop: only the home pill is visible. Secondary nav lives in a
          hover/focus-within dropdown that anchors to the pill. Click on the
          pill goes to /dashboard (native <Link> navigation), hover/keyboard
          focus reveals the rest. The wrapper covers trigger + panel as a
          single box so the pointer doesn't fall through the gap.
        */}
        <div className="hidden min-w-0 flex-1 items-center md:flex">
          <div className="group/nav relative">
            <Link
              href={homeHref}
              title={homeTooltip}
              className={cn(
                "relative z-10 flex min-w-0 max-w-[280px] items-center gap-2 h-10 rounded-lg px-3 text-[14px] font-semibold transition-colors duration-200",
                pathname === homeHref
                  ? "bg-[#5566f6]/[0.09] text-[#5566f6]"
                  : "bg-[#5566f6]/[0.04] text-[#5566f6] hover:bg-[#5566f6]/[0.09] group-hover/nav:bg-[#5566f6]/[0.09] group-focus-within/nav:bg-[#5566f6]/[0.09]"
              )}
            >
              <HomeIcon className="size-5 shrink-0" />
              <span className="truncate">{homeLabel}</span>
              {navPanelVisible ? (
                <ChevronDown
                  className="size-4 shrink-0 opacity-60 transition-transform duration-150 group-hover/nav:rotate-180 group-focus-within/nav:rotate-180"
                  aria-hidden
                />
              ) : null}
            </Link>

            {navPanelVisible ? (
              <div
                role="menu"
                className="pointer-events-none invisible absolute left-0 top-full z-20 w-[260px] translate-y-[-4px] rounded-xl border bg-white p-1.5 opacity-0 shadow-[0_10px_32px_-12px_rgba(11,16,36,0.18)] transition-[opacity,transform] duration-150 group-hover/nav:pointer-events-auto group-hover/nav:visible group-hover/nav:translate-y-0 group-hover/nav:opacity-100 group-focus-within/nav:pointer-events-auto group-focus-within/nav:visible group-focus-within/nav:translate-y-0 group-focus-within/nav:opacity-100"
              >
                {showOrgSwitchInNav ? (
                  <>
                    <OrganizationSwitcher
                      organizations={organizations}
                      activeId={activeOrganizationId}
                      canCreate={false}
                      label="Сменить организацию"
                    />
                    {visibleSecondaryNavItems.length > 0 ? (
                      <div className="my-1.5 h-px bg-[#ececf4]" />
                    ) : null}
                  </>
                ) : null}
                {visibleSecondaryNavItems.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-[#5566f6]/[0.09] text-[#5566f6]"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
                      )}
                    >
                      <item.icon className="size-4 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* Точки: пилюля активной точки со списком — рядом с организацией,
              потому что журналы и «сегодня» показываются именно для неё. */}
          {buildings.length >= 2 ? (
            <LocationSwitcherPill
              buildings={buildings}
              activeBuildingId={activeBuildingId}
              manageHref={fullAccess ? "/settings/buildings" : null}
            />
          ) : null}

          {/* «Сотрудники» — вытащено из дропдауна в постоянную pill-кнопку
              справа от org-pill. Это самое частое destination управляющего
              (добавить новичка, отметить больничный, выдать TG-приглашение),
              клик вместо «наведи → пункт в списке» экономит менеджеру секунды. */}
          {fullAccess ? (
            <Link
              href={STAFF_NAV_ITEM.href}
              title={STAFF_NAV_ITEM.label}
              className={cn(
                "ml-1 hidden items-center gap-2 h-10 rounded-lg px-3 text-[14px] font-semibold transition-colors duration-200 lg:flex",
                pathname === STAFF_NAV_ITEM.href ||
                  pathname.startsWith(STAFF_NAV_ITEM.href + "/")
                  ? "bg-[#5566f6]/[0.09] text-[#5566f6]"
                  : "bg-[#5566f6]/[0.04] text-[#5566f6] hover:bg-[#5566f6]/[0.09]"
              )}
            >
              <STAFF_NAV_ITEM.icon className="size-5 shrink-0" />
              <span className="truncate">{STAFF_NAV_ITEM.label}</span>
            </Link>
          ) : null}

          {/* Отмена и повтор открытого журнала. Стоят здесь, а не в
              заголовке документа: журнал длинный, и когда человек
              промахнулся мимо ячейки где-то внизу таблицы, кнопки должны
              быть под рукой, а не в двух экранах прокрутки вверх.
              Состояние приезжает из клиента документа через контекст. */}
          {headerUndo ? (
            <UndoRedoButtons
              undo={headerUndo}
              className="ml-1 flex items-center gap-1.5"
            />
          ) : null}

          {isHeadChef ? (
            <>
              <Link
                href="/control-board"
                title="Панель контроля"
                className={cn(
                  "ml-1 hidden items-center gap-2 h-10 rounded-lg px-3 text-[14px] font-semibold transition-colors duration-200 lg:flex",
                  pathname === "/control-board"
                    ? "bg-[#5566f6]/[0.09] text-[#5566f6]"
                    : "bg-[#5566f6]/[0.04] text-[#5566f6] hover:bg-[#5566f6]/[0.09]"
                )}
              >
                <ShieldCheck className="size-5 shrink-0" />
                <span className="truncate">Доска</span>
              </Link>
              <Link
                href="/journals-progress"
                title="Прогресс журналов сегодня"
                className={cn(
                  "ml-1 hidden items-center gap-2 h-10 rounded-lg px-3 text-[14px] font-semibold transition-colors duration-200 lg:flex",
                  pathname === "/journals-progress"
                    ? "bg-[#5566f6]/[0.09] text-[#5566f6]"
                    : "bg-[#5566f6]/[0.04] text-[#5566f6] hover:bg-[#5566f6]/[0.09]"
                )}
              >
                <ClipboardList className="size-5 shrink-0" />
                <span className="truncate">Прогресс</span>
              </Link>
              <Link
                href="/team"
                title="Моя команда"
                className={cn(
                  "ml-1 hidden items-center gap-2 h-10 rounded-lg px-3 text-[14px] font-semibold transition-colors duration-200 lg:flex",
                  pathname === "/team"
                    ? "bg-[#5566f6]/[0.09] text-[#5566f6]"
                    : "bg-[#5566f6]/[0.04] text-[#5566f6] hover:bg-[#5566f6]/[0.09]"
                )}
              >
                <Users className="size-5 shrink-0" />
                <span className="truncate">Команда</span>
              </Link>
              <Link
                href="/verifications"
                title="Проверка задач"
                className={cn(
                  "ml-1 hidden items-center gap-2 h-10 rounded-lg px-3 text-[14px] font-semibold transition-colors duration-200 lg:flex",
                  pathname === "/verifications"
                    ? "bg-[#5566f6]/[0.09] text-[#5566f6]"
                    : "bg-[#5566f6]/[0.04] text-[#5566f6] hover:bg-[#5566f6]/[0.09]"
                )}
              >
                <ClipboardList className="size-5 shrink-0" />
                <span className="truncate">Проверка</span>
              </Link>
            </>
          ) : null}

          <div className="flex-1" />
        </div>

        <div className="flex-1 md:hidden" />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileNavOpen(true)}
          className="size-10 shrink-0 rounded-lg bg-[#5566f6]/[0.04] text-[#5566f6] transition-colors duration-200 md:hidden hover:bg-[#5566f6]/[0.09] hover:text-[#5566f6]"
        >
          <Menu className="size-5" />
          <span className="sr-only">Меню</span>
        </Button>
          {/* Меню разделов — тот же лист снизу, что у профиля, окон и
              меню действий: одна механика на весь телефон. Раньше это
              была шторка shadcn с самодельным перетаскиванием
              (`navSwipe`) — она закрывалась рывком и без анимации.
              Движение теперь общее, из `BottomSheet` (vaul). */}
          <BottomSheet
            open={mobileNavOpen}
            onClose={() => setMobileNavOpen(false)}
            title="Меню"
            footer={
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-[14px] font-medium text-[#a13a32] transition-colors hover:bg-[#fff4f2]"
              >
                <LogOut className="size-5 shrink-0" />
                Выйти
              </button>
            }
          >
            <nav
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a")) {
                  setMobileNavOpen(false);
                }
              }}
              className="flex flex-col gap-1"
            >
              {buildings.length >= 2 ? (
                <>
                  <LocationSwitcherList
                    buildings={buildings}
                    activeBuildingId={activeBuildingId}
                  />
                  <div className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">
                    Разделы
                  </div>
                </>
              ) : null}
              {navItems.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(item.href + "/");

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-3 text-[14px] font-medium transition-colors",
                      isActive
                        ? "bg-[#f5f6ff] text-[#5566f6]"
                        : "text-[#3c4053] hover:bg-[#fafbff]"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "size-5 shrink-0",
                        isActive ? "text-[#5566f6]" : "text-[#6f7282]"
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
              {fullAccess ? (
                <Link
                  href="/settings"
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-3 text-[14px] font-medium transition-colors",
                    pathname === "/settings" || pathname.startsWith("/settings/")
                      ? "bg-[#f5f6ff] text-[#5566f6]"
                      : "text-[#3c4053] hover:bg-[#fafbff]"
                  )}
                >
                  <Settings
                    className={cn(
                      "size-5 shrink-0",
                      pathname === "/settings" ||
                        pathname.startsWith("/settings/")
                        ? "text-[#5566f6]"
                        : "text-[#6f7282]"
                    )}
                  />
                  Настройки
                </Link>
              ) : null}
            </nav>
          </BottomSheet>

        {/* Right cluster: settings shortcut + logout + avatar.
            Обратная связь отсюда убрана: вход в поддержку был в двух
            местах сразу — здесь и пузырём внизу, — и человек не понимал,
            чем они отличаются. Остался пузырь: там же и онлайн-чат. */}
        <div className="flex items-center gap-2">
          <OfflineIndicator />
          <LiveConnectionIndicator />
          <NotificationsBell />

          {partnerCabinet ? (
            <Link
              href="/partner"
              aria-label="Партнёрский кабинет"
              title={`Партнёрский кабинет · ${partnerCabinet.brandName}`}
              className="hidden h-10 shrink-0 items-center gap-2 rounded-lg border-0 bg-[#5566f6]/[0.04] px-3 text-[14px] font-semibold text-[#5566f6] transition-colors duration-200 md:inline-flex hover:bg-[#5566f6]/[0.09]"
            >
              <Handshake className="size-5" />
              Партнёрский кабинет
            </Link>
          ) : null}

          {isRoot ? (
            <Link
              href="/root"
              aria-label="Панель платформы"
              title="Панель платформы"
              className={cn(
                "hidden h-10 shrink-0 items-center gap-2 rounded-lg border-0 bg-[#5566f6]/[0.04] px-3 text-[14px] font-semibold text-[#5566f6] transition-colors duration-200 md:inline-flex hover:bg-[#5566f6]/[0.09]",
                pathname.startsWith("/root") && "bg-[#5566f6]/[0.09]"
              )}
            >
              <ShieldCheck className="size-5" />
              Панель платформы
            </Link>
          ) : null}

          {fullAccess ? (
            <Link
              href="/settings"
              aria-label="Настройки"
              title="Настройки"
              className={cn(
                "hidden size-10 shrink-0 items-center justify-center rounded-lg bg-[#5566f6]/[0.04] text-[#5566f6] transition-colors duration-200 md:inline-flex hover:bg-[#5566f6]/[0.09]",
                (pathname === "/settings" || pathname.startsWith("/settings/")) &&
                  "bg-[#5566f6]/[0.09]"
              )}
            >
              <Settings className="size-5" />
            </Link>
          ) : null}

          <button
            type="button"
            onClick={handleLogout}
            aria-label="Выйти"
            title="Выйти"
            className="hidden size-10 shrink-0 items-center justify-center rounded-lg bg-[#5566f6]/[0.04] text-[#5566f6] transition-colors duration-200 md:inline-flex hover:bg-[#fff4f2] hover:text-[#d2453d]"
          >
            <LogOut className="size-5" />
          </button>

          {narrowViewport ? (
            <Button
              variant="ghost"
              type="button"
              onClick={() => setProfileSheetOpen(true)}
              className="relative size-10 shrink-0 rounded-full p-0"
              aria-label="Профиль"
            >
              <Avatar size="lg">
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
                className="relative size-10 shrink-0 rounded-full p-0"
                aria-label="Профиль"
              >
                {/* Аватар остаётся кругом (это аватар), но размер
                    согласован с остальными контролами шапки — size-10. */}
                <Avatar size="lg">
                  <AvatarFallback className="bg-[#5566f6]/[0.09] text-[13px] font-semibold text-[#5566f6]">
                    {getInitials(userName)}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 p-0">
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
                  <p className="truncate text-[12px] leading-tight text-[#6f7282]">
                    {planLine}
                  </p>
                </div>
              </DropdownMenuLabel>

              <DropdownMenuSeparator className="my-0" />

              <div className="p-1">
                <OrganizationSwitcher
                  organizations={organizations}
                  activeId={activeOrganizationId}
                  canCreate={canCreateOrganization}
                  onOpenCreate={openCreateDialog}
                />
                {organizations.length > 1 || canCreateOrganization ? (
                  <DropdownMenuSeparator className="my-1" />
                ) : null}
                {partnerCabinet ? (
                  <>
                    {/* Контекст: «Моя организация» — текущий кабинет,
                        «Партнёрский кабинет» — /partner. Активный пункт
                        подсвечен, чтобы было видно, где человек сейчас. */}
                    <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                      Контекст
                    </div>
                    <DropdownMenuItem asChild className="bg-[#f5f6ff] focus:bg-[#eef1ff]">
                      <Link href="/dashboard">
                        <Building2 className="mr-2 size-4 text-[#5566f6]" />
                        <span className="flex-1 truncate">Моя организация</span>
                        <span className="text-[11px] text-[#3848c7]">сейчас</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="focus:bg-[#f5f6ff]">
                      <Link href="/partner">
                        <Handshake className="mr-2 size-4 text-[#5566f6]" />
                        <span className="flex-1 truncate">Партнёрский кабинет</span>
                        <span className="max-w-[120px] truncate text-[11px] text-[#6f7282]">
                          {partnerCabinet.brandName}
                        </span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-1" />
                  </>
                ) : null}
                {/* Баланс и бонусы — над «Тарифами и оплатой»: баллы
                    тратятся именно там, и порядок повторяет сценарий. */}
                <DropdownMenuItem asChild className="focus:bg-[#f5f6ff]">
                  <Link href="/settings/balance">
                    <Coins className="mr-2 size-4 text-[#5566f6]" />
                    <span className="flex-1">Баланс и бонусы</span>
                    {balanceRub !== null ? (
                      <span className="text-[11px] tabular-nums text-[#3848c7]">
                        {balanceRub.toLocaleString("ru-RU")} ₽
                      </span>
                    ) : null}
                  </Link>
                </DropdownMenuItem>
                {canManagePlan ? (
                  <DropdownMenuItem
                    asChild
                    className={
                      onFreePlan
                        ? "text-[#5566f6] focus:bg-[#f5f6ff] focus:text-[#5566f6]"
                        : "focus:bg-[#f5f6ff]"
                    }
                  >
                    <Link href="/settings/subscription">
                      {onFreePlan ? (
                        <>
                          <CircleArrowUp className="mr-2 size-4 text-[#5566f6]" />
                          Улучшить тариф
                        </>
                      ) : (
                        <>
                          <CreditCard className="mr-2 size-4 text-[#5566f6]" />
                          Тарифы и оплата
                        </>
                      )}
                    </Link>
                  </DropdownMenuItem>
                ) : null}

                {fullAccess ? (
                  <DropdownMenuItem asChild>
                    <Link href="/settings/appearance">
                      <Palette className="mr-2 size-4" />
                      Внешний вид
                    </Link>
                  </DropdownMenuItem>
                ) : null}

                {fullAccess ? (
                  <DropdownMenuItem asChild>
                    <Link href="/settings">
                      <Settings className="mr-2 size-4" />
                      Настройки
                    </Link>
                  </DropdownMenuItem>
                ) : null}

                {isRoot ? (
                  <DropdownMenuItem asChild className="md:hidden">
                    <Link href="/root">
                      <ShieldCheck className="mr-2 size-4" />
                      Панель платформы
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
                  Выйти
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          )}
        </div>
      </div>

      <ProfileSheet
        open={profileSheetOpen}
        onClose={() => setProfileSheetOpen(false)}
        userName={userName}
        userEmail={userEmail}
        planLine={planLine}
        organizations={organizations}
        activeOrganizationId={activeOrganizationId}
        canCreateOrganization={canCreateOrganization}
        onOpenCreate={openCreateDialog}
        partnerCabinet={partnerCabinet}
        balanceRub={balanceRub}
        canManagePlan={canManagePlan}
        onFreePlan={onFreePlan}
        fullAccess={fullAccess}
        isRoot={isRoot}
        onLogout={handleLogout}
      />

      {createDialog === "demo" ? (
        <CreateDemoDialog
          currentSphere={organizationSphere}
          onClose={() => setCreateDialog(null)}
        />
      ) : null}
      {createDialog === "organization" ? (
        <CreateOrganizationDialog
          currentSphere={organizationSphere}
          currentName={
            organizations.find((item) => item.id === activeOrganizationId)?.name ?? ""
          }
          onClose={() => setCreateDialog(null)}
          organizationsCount={organizations.length}
        />
      ) : null}
      {/* Точки на телефоне: отдельная строка под шапкой. В верхней строке
          места нет — логотип, меню, уведомления и аватар не оставляют
          названию точки и 100px, а точка должна читаться целиком. */}
      {buildings.length >= 2 ? (
        <div className="border-t border-[#ececf4] md:hidden">
          <div className="mx-auto flex h-10 w-full max-w-[1800px] items-center px-4">
            <LocationSwitcherPill
              buildings={buildings}
              activeBuildingId={activeBuildingId}
              compact
              manageHref={fullAccess ? "/settings/buildings" : null}
            />
          </div>
        </div>
      ) : null}
    </header>
  );
}
