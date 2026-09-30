"use client";

import Link from "next/link";
import {
  Building2,
  CircleArrowUp,
  Coins,
  CreditCard,
  Handshake,
  Library,
  Loader2,
  LogOut,
  Palette,
  Plus,
  Settings,
  ShieldCheck,
} from "lucide-react";

import {
  BottomSheet,
  SHEET_GROUP_LABEL_CLASS,
  SHEET_ROW_CLASS,
} from "@/components/ui/bottom-sheet";
import {
  OrganizationSwitcher,
  type CreateDialogKind,
} from "@/components/layout/organization-switcher";
import {
  BRANDING_SETTINGS_HREF,
  ThemeTiles,
} from "@/components/theme/theme-tiles";
import { useOpenMasterCabinet } from "@/components/master/use-open-master-cabinet";
import type { AccessibleOrganization } from "@/lib/organization-access";
import { useInsideMobileApp } from "@/lib/use-inside-mobile-app";

/**
 * Меню профиля на телефоне — лист снизу, как в мобильных приложениях.
 *
 * Раньше это было то же выпадающее меню, что и на компьютере: узкое
 * «облако» у правого края, мелкие пункты и подменю «Тема» вторым
 * уровнем, который на 360px уезжал за экран. Теперь пункты — крупными
 * строками, а тема — тремя карточками прямо в листе (как блок
 * Appearance в приложении Claude): нажал — тема сменилась сразу.
 *
 * Пункты те же, что в меню на компьютере, поэтому человек, привыкший к
 * одному, найдёт то же самое и в другом.
 */
export function ProfileSheet({
  open,
  onClose,
  userName,
  userEmail,
  planLine,
  organizations,
  masterCabinets,
  activeOrganizationId,
  canCreateOrganization,
  onOpenCreate,
  partnerCabinet,
  balanceRub,
  canManagePlan,
  onFreePlan,
  fullAccess,
  canEditBranding,
  isRoot,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  userName: string;
  userEmail: string;
  planLine: string;
  organizations: AccessibleOrganization[];
  /** Мастер-кабинеты справочников — строками в «Кабинете», открывают `/master`. */
  masterCabinets: AccessibleOrganization[];
  activeOrganizationId: string;
  canCreateOrganization: boolean;
  onOpenCreate: (kind: CreateDialogKind) => void;
  partnerCabinet: { brandName: string } | null;
  balanceRub: number | null;
  canManagePlan: boolean;
  onFreePlan: boolean;
  fullAccess: boolean;
  /** Может открыть настройки организации (логотип и цвет) — `admin.full`. */
  canEditBranding: boolean;
  isRoot: boolean;
  onLogout: () => void;
}) {
  const inApp = useInsideMobileApp();
  const openMaster = useOpenMasterCabinet();
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={userName}
      subtitle={`${userEmail} · ${planLine}`}
      footer={
        <button
          type="button"
          onClick={() => {
            onClose();
            onLogout();
          }}
          className={`${SHEET_ROW_CLASS} text-[#a13a32] hover:bg-[#fff4f2] active:bg-[#ffe9e5]`}
        >
          <LogOut className="size-5 shrink-0" />
          Выйти
        </button>
      }
    >
      <div onClick={onClose}>
        <OrganizationSwitcher
          organizations={organizations}
          activeId={activeOrganizationId}
          canCreate={canCreateOrganization}
          onOpenCreate={onOpenCreate}
          showSettings={fullAccess}
          onNavigate={onClose}
        />
      </div>

      {/* «Кабинет»: где человек сейчас и куда ещё можно перейти —
          партнёрский кабинет, мастер-кабинеты справочников (они здесь, а не
          в «Организациях»: у них своя оболочка `/master`). Владельцу
          аккаунта под кабинетами всегда «Создать мастер-кабинет». */}
      {partnerCabinet || masterCabinets.length > 0 || canCreateOrganization ? (
        <>
          <div className={SHEET_GROUP_LABEL_CLASS}>Кабинет</div>
          <Link href="/dashboard" onClick={onClose} className={`${SHEET_ROW_CLASS} bg-[#f5f6ff]`}>
            <Building2 className="size-5 shrink-0 text-[#5566f6]" />
            <span className="min-w-0 flex-1 truncate">Моя организация</span>
            <span className="shrink-0 text-[12px] text-[#3848c7]">сейчас</span>
          </Link>
          {partnerCabinet ? (
            <Link href="/partner" onClick={onClose} className={SHEET_ROW_CLASS}>
              <Handshake className="size-5 shrink-0 text-[#5566f6]" />
              <span className="min-w-0 flex-1 truncate">Партнёрский кабинет</span>
              <span className="max-w-[110px] shrink-0 truncate text-[12px] text-[#6f7282]">
                {partnerCabinet.brandName}
              </span>
            </Link>
          ) : null}
          {masterCabinets.map((cabinet) => (
            <button
              key={cabinet.id}
              type="button"
              onClick={() => void openMaster.open(cabinet)}
              className={SHEET_ROW_CLASS}
              data-testid="profile-master-cabinet"
            >
              <Library className="size-5 shrink-0 text-[#5566f6]" />
              <span className="min-w-0 flex-1 truncate">{cabinet.name}</span>
              {openMaster.openingId === cabinet.id ? (
                <Loader2 className="size-5 shrink-0 animate-spin text-[#5566f6]" />
              ) : null}
            </button>
          ))}
          {canCreateOrganization ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenCreate("master-cabinet");
              }}
              className={`${SHEET_ROW_CLASS} text-[#5566f6]`}
              data-testid="profile-create-master-cabinet"
            >
              <Plus className="size-5 shrink-0" />
              <span className="min-w-0 flex-1">Создать мастер-кабинет</span>
            </button>
          ) : null}
        </>
      ) : null}

      <div className={SHEET_GROUP_LABEL_CLASS}>Аккаунт</div>
      <Link href="/settings/balance" onClick={onClose} className={SHEET_ROW_CLASS}>
        <Coins className="size-5 shrink-0 text-[#5566f6]" />
        <span className="min-w-0 flex-1">Баланс и бонусы</span>
        {balanceRub !== null ? (
          <span className="shrink-0 text-[13px] tabular-nums text-[#3848c7]">
            {balanceRub.toLocaleString("ru-RU")} ₽
          </span>
        ) : null}
      </Link>

      {canManagePlan ? (
        <Link href="/settings/subscription" onClick={onClose} className={SHEET_ROW_CLASS}>
          {onFreePlan && !inApp ? (
            <>
              <CircleArrowUp className="size-5 shrink-0 text-[#5566f6]" />
              <span className="min-w-0 flex-1 text-[#5566f6]">Улучшить тариф</span>
            </>
          ) : (
            <>
              <CreditCard className="size-5 shrink-0 text-[#5566f6]" />
              {/* В приложении не зовём к оплате (правила магазинов). */}
              <span className="min-w-0 flex-1">{inApp ? "Тариф" : "Тарифы и оплата"}</span>
            </>
          )}
        </Link>
      ) : null}

      {fullAccess ? (
        <Link href="/settings" onClick={onClose} className={SHEET_ROW_CLASS}>
          <Settings className="size-5 shrink-0 text-[#6f7282]" />
          <span className="min-w-0 flex-1">Настройки</span>
        </Link>
      ) : null}

      {isRoot ? (
        <Link href="/root" onClick={onClose} className={SHEET_ROW_CLASS}>
          <ShieldCheck className="size-5 shrink-0 text-[#5566f6]" />
          <span className="min-w-0 flex-1">Панель платформы</span>
        </Link>
      ) : null}

      {/* Тема — всем: это личная настройка, а не настройка организации.
          Лист при выборе не закрывается — видно, как перекрасился экран. */}
      <div className={SHEET_GROUP_LABEL_CLASS}>Тема</div>
      <ThemeTiles className="px-2 pb-1 pt-1" />
      {canEditBranding ? (
        <Link
          href={BRANDING_SETTINGS_HREF}
          onClick={onClose}
          data-testid="theme-branding-link"
          className="mx-1 mt-1 inline-flex items-center gap-1.5 rounded-xl px-2 py-2 text-[13px] font-medium text-[var(--app-indigo-deep)] transition-colors hover:bg-[var(--app-tint-indigo)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          <Palette className="size-4 shrink-0" aria-hidden />
          Логотип и цвета
        </Link>
      ) : null}
    </BottomSheet>
  );
}
