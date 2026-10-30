"use client";
import { PersonalLanguageSelect } from "@/components/i18n/personal-language-select";
import { useTranslations } from "next-intl";

import Link from "next/link";
import { Loader2 } from "lucide-react";

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
import { NavIconChip } from "@/components/layout/nav-icons";
import { cn } from "@/lib/utils";
import { CabinetPlanCardView } from "@/components/layout/cabinet-plan-card";
import type { CabinetPlanCard } from "@/lib/cabinet-plan";
import type { AccessibleOrganization } from "@/lib/organization-access";
import { useInsideMobileApp } from "@/lib/use-inside-mobile-app";

// Строка с плашкой 32px: отступы меньше общей строки листа, высота та же.
const CHIP_ROW = cn(SHEET_ROW_CLASS, "py-2 pl-2");
const CHIP = "size-8 rounded-[10px]";
const CHIP_ICON = "size-[18px]";

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
 * одному, найдёт то же самое и в другом. Слева у пункта — цветная плашка
 * его иконки, как в меню кабинета (`lib/nav-tones.ts`).
 */
export function ProfileSheet({
  open,
  onClose,
  userName,
  userEmail,
  cabinetPlan,
  ownCabinet,
  organizations,
  masterCabinets,
  activeOrganizationId,
  canCreateOrganization,
  onOpenCreate,
  partnerCabinet,
  balanceRub,
  canManagePlan,
  fullAccess,
  canEditBranding,
  canEditTranslations = false,
  isRoot,
  platformPanel = isRoot,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  userName: string;
  userEmail: string;
  /** «Мой кабинет»: тариф, организации и сотрудники, сумма в месяц. */
  cabinetPlan: CabinetPlanCard;
  ownCabinet: boolean;
  organizations: AccessibleOrganization[];
  /** Мастер-кабинеты справочников — строками в «Кабинете», открывают `/master`. */
  masterCabinets: AccessibleOrganization[];
  activeOrganizationId: string;
  canCreateOrganization: boolean;
  onOpenCreate: (kind: CreateDialogKind) => void;
  partnerCabinet: { brandName: string } | null;
  balanceRub: number | null;
  canManagePlan: boolean;
  fullAccess: boolean;
  /** Может открыть настройки организации (логотип и цвет) — `admin.full`. */
  canEditBranding: boolean;
  /** ROOT или переводчик — пункт «Переводы интерфейса». */
  canEditTranslations?: boolean;
  isRoot: boolean;
  /** Ссылка на панель платформы (владелец или сотрудник с разделами). */
  platformPanel?: boolean;
  onLogout: () => void;
}) {
  const t = useTranslations("navigation");
  const inApp = useInsideMobileApp();
  const openMaster = useOpenMasterCabinet();
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={userName}
      subtitle={userEmail}
      footer={
        <button
          type="button"
          onClick={() => {
            onClose();
            onLogout();
          }}
          data-nav-row
          className={cn(CHIP_ROW, "text-[#a13a32] hover:bg-[#fff4f2] active:bg-[#ffe9e5]")}
        >
          <NavIconChip name="LogOut" className={CHIP} iconClassName={CHIP_ICON} />
          {t("header.logout")}
        </button>
      }
    >
      {/* «Мой кабинет» сразу под именем и почтой: тариф, организации,
          сотрудники и сумма в месяц (владелец, 2026-10-01: «Моя организация»
          под «Организациями» путала). Нажатие — в свой кабинет. */}
      <CabinetPlanCardView card={cabinetPlan} ownCabinet={ownCabinet} variant="sheet" onNavigate={onClose} />

      <div onClick={onClose}>
        <OrganizationSwitcher
          organizations={organizations}
          activeId={activeOrganizationId}
          canCreate={canCreateOrganization}
          onOpenCreate={onOpenCreate}
          showSettings={fullAccess}
          onNavigate={onClose}
          label={t("profile.organizationSwitcher")}
        />
      </div>

      {/* «Другие кабинеты»: партнёрский кабинет и мастер-кабинеты
          справочников (у них своя оболочка `/master`). Владельцу аккаунта
          под ними всегда «Создать мастер-кабинет». */}
      {partnerCabinet || masterCabinets.length > 0 || canCreateOrganization ? (
        <>
          <div className={SHEET_GROUP_LABEL_CLASS}>{t("profile.otherCabinets")}</div>
          {partnerCabinet ? (
            <Link href="/partner" onClick={onClose} className={CHIP_ROW} data-nav-row>
              <NavIconChip name="Handshake" className={CHIP} iconClassName={CHIP_ICON} />
              <span className="min-w-0 flex-1 truncate">{t("header.partnerCabinet")}</span>
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
              className={CHIP_ROW}
              data-testid="profile-master-cabinet"
              data-nav-row
            >
              <NavIconChip name="Library" className={CHIP} iconClassName={CHIP_ICON} />
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
              className={cn(CHIP_ROW, "text-[#5566f6]")}
              data-testid="profile-create-master-cabinet"
              data-nav-row
            >
              <NavIconChip name="Plus" className={CHIP} iconClassName={CHIP_ICON} />
              <span className="min-w-0 flex-1">{t("profile.createMasterCabinet")}</span>
            </button>
          ) : null}
        </>
      ) : null}

      <div className={SHEET_GROUP_LABEL_CLASS}>{t("profile.accountGroup")}</div>
      <Link href="/settings/balance" onClick={onClose} className={CHIP_ROW} data-nav-row>
        <NavIconChip name="Coins" className={CHIP} iconClassName={CHIP_ICON} />
        <span className="min-w-0 flex-1">{t("profile.balanceBonuses")}</span>
        {balanceRub !== null ? (
          <span className="shrink-0 text-[13px] tabular-nums text-[#3848c7]">
            {balanceRub.toLocaleString("ru-RU")} ₽
          </span>
        ) : null}
      </Link>

      {/* Тариф меняют из карточки «Мой кабинет». В приложении WeSetup
          ссылки там нет (правила магазинов) — страница тарифа для
          просмотра остаётся отдельным пунктом. */}
      {canManagePlan && inApp ? (
        <Link href="/settings/subscription" onClick={onClose} className={CHIP_ROW} data-nav-row>
          <NavIconChip name="CreditCard" className={CHIP} iconClassName={CHIP_ICON} />
          <span className="min-w-0 flex-1">{t("profile.plan")}</span>
        </Link>
      ) : null}

      {canEditTranslations ? (
        <Link href={isRoot ? "/root/translations" : "/translations"} onClick={onClose} className={CHIP_ROW} data-nav-row>
          <NavIconChip name="Languages" className={CHIP} iconClassName={CHIP_ICON} />
          <span className="min-w-0 flex-1">{t("profile.translations")}</span>
        </Link>
      ) : null}

      {platformPanel ? (
        <Link href={isRoot ? "/root" : "/api/me/platform-panel"} prefetch={false} onClick={onClose} className={CHIP_ROW} data-nav-row>
          <NavIconChip name="ShieldCheck" className={CHIP} iconClassName={CHIP_ICON} />
          <span className="min-w-0 flex-1">{t("header.platformPanel")}</span>
        </Link>
      ) : null}

      {/* Тема — всем: это личная настройка, а не настройка организации.
          Лист при выборе не закрывается — видно, как перекрасился экран. */}
      <div className={SHEET_GROUP_LABEL_CLASS}>{t("profile.theme")}</div>
      <ThemeTiles className="px-2 pb-1 pt-1" />
      <div className="px-2 py-2"><PersonalLanguageSelect /></div>
      {canEditBranding ? (
        <Link
          href={BRANDING_SETTINGS_HREF}
          onClick={onClose}
          data-testid="theme-branding-link"
          data-nav-row
          className="mx-1 mt-1 inline-flex items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-medium text-[var(--app-indigo-deep)] transition-colors hover:bg-[var(--app-tint-indigo)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          <NavIconChip name="Palette" className="size-6 rounded-[7px]" iconClassName="size-3.5" />
          {t("profile.branding")}
        </Link>
      ) : null}
    </BottomSheet>
  );
}
