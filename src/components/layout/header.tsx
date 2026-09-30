"use client";

import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { PartnerHint } from "@/components/partner/partner-hint";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import type { PartnerHintRates } from "@/lib/partners/partner-hint";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
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
  Handshake,
  Library,
  Loader2,
  LogOut,
  Menu,
  Palette,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { headerNavSections } from "@/lib/app-sections";
import { customSectionNameByHref } from "@/lib/custom-names";
import { useCustomNames } from "@/components/shared/custom-names-provider";
import { isManagementRole } from "@/lib/user-roles";
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
import { UndoRedoButtons } from "@/components/journals/undo-redo-buttons";
import { useHeaderUndo } from "@/components/journals/journal-undo-slot";
import { OfflineIndicator } from "@/components/layout/offline-indicator";
import { LiveConnectionIndicator } from "@/components/live/live-connection-indicator";
import { planLabel } from "@/lib/plan-limits";
import { useInsideMobileApp } from "@/lib/use-inside-mobile-app";
import { orgDisplayName } from "@/lib/org-display-name";
import {
  LocationSwitcherList,
} from "@/components/layout/location-switcher";
import type { BuildingOption } from "@/lib/building-scope";
import {
  OrganizationSwitcher,
  type CreateDialogKind,
} from "@/components/layout/organization-switcher";
import { CreateOrganizationDialog } from "@/components/layout/create-organization-dialog";
import { CreateDemoDialog } from "@/components/layout/create-demo-dialog";
import type { AccessibleOrganization } from "@/lib/organization-access";
import { signOutAndOpen } from "@/lib/sign-out";
import { splitCabinetMenu } from "@/lib/cabinet-menu";
import { useOpenMasterCabinet } from "@/components/master/use-open-master-cabinet";

// Иконки разделов: сам перечень живёт в `lib/app-sections.ts` (один
// список на сайт и мини-приложение), а компоненты lucide подставляются
// здесь — в клиенте. Через границу RSC функции не передаются, поэтому
// в общем модуле лежат имена иконок, а не они сами.
const NAV_ICONS: Record<string, typeof ClipboardList> = {
  ClipboardList,
  CalendarRange,
  AlertTriangle,
  FileText,
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

const STAFF_NAV_ITEM_DEFAULT = {
  label: "Сотрудники",
  href: "/settings/users",
  icon: Users,
};

// Строка мобильного меню. Пунктов стало меньше (владелец убрал пять
// разделов), поэтому они крупнее: высота от 52px, шрифт 17px, иконка 24px.
const MOBILE_NAV_ROW_CLASS =
  "flex min-h-[52px] items-center gap-3.5 rounded-2xl px-3.5 py-3 text-[17px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

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
   * Название тарифа вместо `planLabel(subscriptionPlan)` — бесплатный
   * период («Подписка»), «Нужно выбрать тариф» после него.
   */
  planLabelOverride?: string | null;
  /** Хвост строки тарифа: «бесплатно по 10 октября», «до 3 ноября». */
  planNote?: string | null;
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
  /**
   * Может открыть настройки организации — там логотип и цвет
   * (`admin.full`, как у самой страницы). Тогда под карточками темы —
   * ссылка «Логотип и цвета».
   */
  canEditBranding?: boolean;
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
  planLabelOverride = null,
  planNote = null,
  partnerCabinet = null,
  partnerHint = null,
  canEditBranding = false,
}: HeaderProps) {
  const pathname = usePathname();
  const headerUndo = useHeaderUndo();
  // Свои названия разделов организации («Настройки → Названия»).
  const customNames = useCustomNames();
  const STAFF_NAV_ITEM = {
    ...STAFF_NAV_ITEM_DEFAULT,
    label:
      customSectionNameByHref(customNames, STAFF_NAV_ITEM_DEFAULT.href) ??
      STAFF_NAV_ITEM_DEFAULT.label,
  };
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
      toast.error("Не удалось выйти. Проверьте связь и попробуйте ещё раз.");
    });
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
  // места (человек должен заранее видеть, что следующий сотрудник
  // потребует подписку), на платном — просто численность.
  const onFreePlan = subscriptionPlan === "trial" || subscriptionPlan === "free";
  // Мест считаем по всем организациям аккаунта — иначе владелец сети
  // видел бы «2/5» в каждой точке и не понимал, откуда взялся платный.
  const multiOrg = regularOrganizations.length > 1;
  const headcountSuffix = multiOrg
    ? " сотрудников по всем организациям"
    : " сотрудников";
  const planLine = [
    planLabelOverride ?? planLabel(subscriptionPlan),
    // Сверх бесплатного лимита (до перехода на оплату так бывает) дробь
    // «3/1» только путает — показываем просто численность.
    onFreePlan && activeUsers <= freeUserLimit
      ? `${activeUsers}/${freeUserLimit}${headcountSuffix}`
      : `${activeUsers}${headcountSuffix}`,
    planNote,
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
  // В приложении WeSetup не зовём к оплате (правила магазинов): пункт
  // ведёт на страницу тарифа только для просмотра — «Тариф».
  const inApp = useInsideMobileApp();
  const upsellPlan = onFreePlan && !inApp;

  const visibleSecondaryNavItems = fullAccess
    ? secondaryNavItems.map((item) => ({
        ...item,
        label: customSectionNameByHref(customNames, item.href) ?? item.label,
      }))
    : [];
  // Пилюля в шапке показывает название активной точки — значит именно
  // на неё логично навести, чтобы уйти в соседнюю. Дублирует меню
  // профиля намеренно: там это «настройка аккаунта», здесь — навигация.
  const showOrgSwitchInNav = showsOrg && multiOrg;
  const navPanelVisible =
    visibleSecondaryNavItems.length > 0 || showOrgSwitchInNav;
  // Мобильное меню: строка организации (с шестерёнкой настроек) и под
  // ней разделы. «Сотрудники» — над «Журналами»: это самый частый пункт
  // управляющего (решение владельца 2026-09-25). «Настройки» отдельной
  // строкой больше нет — вместо неё шестерёнка в строке организации.
  const homeNavItem = { label: homeLabel, href: homeHref, icon: HomeIcon, tooltip: homeTooltip };
  const sectionNavItems = [
    ...(fullAccess
      ? [{ ...STAFF_NAV_ITEM, tooltip: STAFF_NAV_ITEM.label }]
      : []),
    ...visibleSecondaryNavItems.map((i) => ({ ...i, tooltip: i.label })),
  ];
  // Десктопное выпадающее меню под пилюлей организации — тот же порядок.
  // Пилюля «Сотрудники» справа видна только с lg, поэтому на 768–1023px
  // без этого пункта в меню раздел было не найти.
  const desktopMenuItems = fullAccess
    ? [STAFF_NAV_ITEM, ...visibleSecondaryNavItems]
    : visibleSecondaryNavItems;
  const settingsActive =
    pathname === "/settings" || pathname.startsWith("/settings/");

  return (
    <header className="sticky top-0 z-30 border-b bg-white">
      {/* Высота шапки — 72px, как на эталоне (замер: headerBar h=73px).
          На телефоне (< 640px) — 56px вместе с рамкой: экран узкий и
          короткий, каждый пиксель шапки отнят у страницы. Кнопки-иконки
          там 44×44 — палец попадает, шапка остаётся тонкой. */}
      {/* Горизонтальная геометрия шапки ДОЛЖНА совпадать с контейнером
          контента ((dashboard)/layout.tsx): max-w-[1800px] + px-4 md:px-8
          внутри этой же коробки. Любое расхождение сразу читается как
          «шапка одной ширины, страница другой». */}
      <div className="mx-auto flex h-[55px] w-full max-w-[1800px] items-center gap-2 px-4 sm:h-[72px] md:gap-4 md:px-8">
        <Link
          href={homeHref}
          className="shrink-0 flex items-center gap-2 max-sm:min-h-11"
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
                className="h-6 w-auto max-w-[140px] object-contain sm:h-7"
                referrerPolicy="no-referrer"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <span className="text-[13px] font-semibold text-[#0b1024] sm:text-[14px]">
                {organizationName || "WeSetup"}
              </span>
            </>
          ) : (
            // Цвет знака — currentColor. В тёмной теме кабинета
            // `text-[#0b1024]` перекрашивается слоем app-theme.css,
            // отдельный dark:-вариант не нужен и был бы опасен: он
            // сработал бы по системной теме на светлом кабинете.
            // На телефоне знак ниже (18px) — под тонкую шапку.
            <span className="text-[#0b1024] max-sm:[--logo-h:18px]">
              <BrandLogo height={22} title="" />
            </span>
          )}
        </Link>
        {/* На телефоне зона нажатия 44×44 — значок тот же, еле заметный. */}
        {partnerHint ? <PartnerHint rates={partnerHint} className="-ml-1 max-sm:size-11" /> : null}

        {/*
          Desktop: only the home pill is visible. Secondary nav lives in a
          hover/focus-within dropdown that anchors to the pill. Click on the
          pill goes to /dashboard (native <Link> navigation), hover/keyboard
          focus reveals the rest. The wrapper covers trigger + panel as a
          single box so the pointer doesn't fall through the gap.
        */}
        <div className="hidden min-w-0 flex-1 items-center md:flex">
          {/* min-w-0: без него блок не сжимается, и на 768–1200px левая
              группа наезжала на правую (колокольчик, «Панель платформы»). */}
          <div className="group/nav relative min-w-0">
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
                      showSettings={fullAccess}
                      label="Сменить организацию"
                    />
                    {visibleSecondaryNavItems.length > 0 ? (
                      <div className="my-1.5 h-px bg-[#ececf4]" />
                    ) : null}
                  </>
                ) : null}
                {desktopMenuItems.map((item) => {
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
                          : // Токены дизайн-системы вместо shadcn-серых: в тёмной
                            // теме `text-muted-foreground` перекрашивался слоем
                            // app-theme.css и при наведении оставался серым.
                            "text-[#3c4053] hover:bg-[#f5f6ff] hover:text-[#0b1024] focus-visible:bg-[#f5f6ff] focus-visible:text-[#0b1024] focus-visible:outline-none"
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

          {/* Шестерёнка настроек — сразу у названия организации, как и в
              мобильном меню: настройки относятся к организации, а не к
              выходу и аватару справа. */}
          {fullAccess ? (
            <Link
              href="/settings"
              aria-label="Настройки"
              title="Настройки"
              data-nav-settings=""
              className={cn(
                "ml-1 inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#5566f6]/[0.04] text-[#5566f6] transition-colors duration-200 hover:bg-[#5566f6]/[0.09] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                settingsActive && "bg-[#5566f6]/[0.09]"
              )}
            >
              <Settings className="size-5" />
            </Link>
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
                "ml-1 hidden min-w-0 items-center gap-2 h-10 rounded-lg px-3 text-[14px] font-semibold transition-colors duration-200 lg:flex",
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
                  "ml-1 hidden min-w-0 items-center gap-2 h-10 rounded-lg px-3 text-[14px] font-semibold transition-colors duration-200 lg:flex",
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
                  "ml-1 hidden min-w-0 items-center gap-2 h-10 rounded-lg px-3 text-[14px] font-semibold transition-colors duration-200 lg:flex",
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
                  "ml-1 hidden min-w-0 items-center gap-2 h-10 rounded-lg px-3 text-[14px] font-semibold transition-colors duration-200 lg:flex",
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
                  "ml-1 hidden min-w-0 items-center gap-2 h-10 rounded-lg px-3 text-[14px] font-semibold transition-colors duration-200 lg:flex",
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
          className="size-11 shrink-0 rounded-lg bg-[#5566f6]/[0.04] text-[#5566f6] transition-colors duration-200 sm:size-10 md:hidden hover:bg-[#5566f6]/[0.09] hover:text-[#5566f6]"
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
                className="flex min-h-[52px] w-full items-center gap-3.5 rounded-2xl px-3.5 py-3 text-[17px] font-medium text-[#a13a32] transition-colors hover:bg-[#fff4f2]"
              >
                <LogOut className="size-6 shrink-0" />
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
              {/* Строка организации: ссылка на главную и шестерёнка
                  настроек справа — отдельной строки «Настройки» в списке
                  больше нет. */}
              <div className="flex items-center gap-2">
                <Link
                  href={homeNavItem.href}
                  className={cn(
                    MOBILE_NAV_ROW_CLASS,
                    "min-w-0 flex-1",
                    pathname === homeNavItem.href
                      ? "bg-[#f5f6ff] text-[#5566f6]"
                      : "text-[#0b1024] hover:bg-[#fafbff]"
                  )}
                >
                  <homeNavItem.icon
                    className={cn(
                      "size-6 shrink-0",
                      pathname === homeNavItem.href ? "text-[#5566f6]" : "text-[#6f7282]"
                    )}
                  />
                  <span className="truncate font-semibold">{homeNavItem.label}</span>
                </Link>
                {fullAccess ? (
                  <Link
                    href="/settings"
                    aria-label="Настройки"
                    title="Настройки"
                    data-nav-settings=""
                    className={cn(
                      "flex size-[52px] shrink-0 items-center justify-center rounded-2xl border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                      settingsActive
                        ? "border-[#5566f6]/30 bg-[#f5f6ff] text-[#5566f6]"
                        : "border-[#ececf4] bg-white text-[#5566f6] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                    )}
                  >
                    <Settings className="size-6" />
                  </Link>
                ) : null}
              </div>
              {sectionNavItems.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(item.href + "/");

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      MOBILE_NAV_ROW_CLASS,
                      isActive
                        ? "bg-[#f5f6ff] text-[#5566f6]"
                        : "text-[#3c4053] hover:bg-[#fafbff]"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "size-6 shrink-0",
                        isActive ? "text-[#5566f6]" : "text-[#6f7282]"
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </BottomSheet>

        {/* Right cluster: logout + avatar (настройки — у названия организации).
            Обратная связь отсюда убрана: вход в поддержку был в двух
            местах сразу — здесь и пузырём внизу, — и человек не понимал,
            чем они отличаются. Остался пузырь: там же и онлайн-чат. */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-1.5 md:gap-2">
          <OfflineIndicator />
          <LiveConnectionIndicator />
          <NotificationsBell triggerClassName="max-sm:size-11" />

          {partnerCabinet ? (
            <Link
              href="/partner"
              aria-label="Партнёрский кабинет"
              title={`Партнёрский кабинет · ${partnerCabinet.brandName}`}
              className="hidden h-10 shrink-0 items-center justify-center gap-2 rounded-lg border-0 bg-[#5566f6]/[0.04] px-2.5 text-[14px] font-semibold text-[#5566f6] transition-colors duration-200 md:inline-flex xl:px-3 hover:bg-[#5566f6]/[0.09]"
            >
              <Handshake className="size-5 shrink-0" />
              {/* До xl — только иконка: рядом ещё «Панель платформы»,
                  настройки, выход и аватар, и две длинные подписи не
                  помещались. */}
              <span className="hidden xl:inline">Партнёрский кабинет</span>
            </Link>
          ) : null}

          {isRoot ? (
            <Link
              href="/root"
              aria-label="Панель платформы"
              title="Панель платформы"
              className={cn(
                "hidden h-10 shrink-0 items-center justify-center gap-2 rounded-lg border-0 bg-[#5566f6]/[0.04] px-2.5 text-[14px] font-semibold text-[#5566f6] transition-colors duration-200 md:inline-flex xl:px-3 hover:bg-[#5566f6]/[0.09]",
                pathname.startsWith("/root") && "bg-[#5566f6]/[0.09]"
              )}
            >
              <ShieldCheck className="size-5 shrink-0" />
              <span className="hidden xl:inline">Панель платформы</span>
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
              className="relative size-11 shrink-0 rounded-full p-0 sm:size-10"
              aria-label="Профиль"
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
                aria-label="Профиль"
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
                  showSettings={fullAccess}
                  onNavigate={() => setProfileMenuOpen(false)}
                />
                {regularOrganizations.length > 1 || canCreateOrganization ? (
                  <DropdownMenuSeparator className="my-1" />
                ) : null}
                {partnerCabinet || masterCabinets.length > 0 ? (
                  <>
                    {/* «Кабинет» (как в листе на телефоне): «Моя организация» —
                        текущий кабинет, «Партнёрский кабинет» — /partner,
                        мастер-кабинеты справочников — /master. Активный
                        пункт подсвечен, чтобы было видно, где человек сейчас. */}
                    <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                      Кабинет
                    </div>
                    <DropdownMenuItem asChild className="bg-[#f5f6ff] focus:bg-[#eef1ff]">
                      <Link href="/dashboard">
                        <Building2 className="mr-2 size-4 text-[#5566f6]" />
                        <span className="flex-1 truncate">Моя организация</span>
                        <span className="text-[11px] text-[#3848c7]">сейчас</span>
                      </Link>
                    </DropdownMenuItem>
                    {partnerCabinet ? (
                      <DropdownMenuItem asChild className="focus:bg-[#f5f6ff]">
                        <Link href="/partner">
                          <Handshake className="mr-2 size-4 text-[#5566f6]" />
                          <span className="flex-1 truncate">Партнёрский кабинет</span>
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
                        title="Мастер-кабинет справочников: меню и сырьё для пищеблоков"
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
                      upsellPlan
                        ? "text-[#5566f6] focus:bg-[#f5f6ff] focus:text-[#5566f6]"
                        : "focus:bg-[#f5f6ff]"
                    }
                  >
                    <Link href="/settings/subscription">
                      {upsellPlan ? (
                        <>
                          <CircleArrowUp className="mr-2 size-4 text-[#5566f6]" />
                          Улучшить тариф
                        </>
                      ) : (
                        <>
                          <CreditCard className="mr-2 size-4 text-[#5566f6]" />
                          {inApp ? "Тариф" : "Тарифы и оплата"}
                        </>
                      )}
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

              {/* Тема — три карточки, как блок Appearance в приложении
                  Claude, всем (личная настройка). Меню при выборе не
                  закрывается: видно, как перекрасился кабинет. */}
              <div className="px-2 pb-2 pt-1.5" data-testid="profile-theme">
                <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                  Тема
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
                        Логотип и цвета
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
        organizations={regularOrganizations}
        masterCabinets={masterCabinets}
        activeOrganizationId={activeOrganizationId}
        canCreateOrganization={canCreateOrganization}
        onOpenCreate={openCreateDialog}
        partnerCabinet={partnerCabinet}
        balanceRub={balanceRub}
        canManagePlan={canManagePlan}
        onFreePlan={onFreePlan}
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
