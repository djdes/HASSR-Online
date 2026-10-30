"use client";

import type { ComponentType } from "react";
import { useTranslations } from "next-intl";
import { PageSkeleton } from "@/components/ui/skeleton";
import { routeSkeletonFor, type GenericSkeletonBody } from "@/components/ui/skeleton-routes";
import BonusesLoading from "@/app/(dashboard)/bonuses/loading";
import ControlBoardLoading from "@/app/(dashboard)/control-board/loading";
import DashboardLoading from "@/app/(dashboard)/dashboard/loading";
import JournalsLoading from "@/app/(dashboard)/journals/loading";
import JournalsProgressLoading from "@/app/(dashboard)/journals-progress/loading";
import ReportsLoading from "@/app/(dashboard)/reports/loading";
import SettingsLoading from "@/app/(dashboard)/settings/loading";
import TeamLoading from "@/app/(dashboard)/team/loading";
import VerificationsLoading from "@/app/(dashboard)/verifications/loading";

/**
 * Скелет страницы кабинета по адресу (2026-10-29) — один выбор на:
 *   • `(dashboard)/loading.tsx` — переход в раздел без своего `loading.tsx`;
 *   • ожидание после смены точки/организации (`SectionFrame`).
 *
 * У раздела со своим `loading.tsx` берём именно его: при переходе сначала
 * показывается этот общий скелет, потом свой — раз они одинаковые, экран не
 * прыгает. Свои скелеты сами смотрят на адрес (подстраницы и т.п.).
 */
const SECTION_SKELETONS: Record<string, ComponentType> = {
  bonuses: BonusesLoading,
  "control-board": ControlBoardLoading,
  dashboard: DashboardLoading,
  journals: JournalsLoading,
  "journals-progress": JournalsProgressLoading,
  reports: ReportsLoading,
  settings: SettingsLoading,
  team: TeamLoading,
  verifications: VerificationsLoading,
};

export function RouteSkeleton({ pathname, label }: { pathname: string; label?: string }) {
  const tLoading = useTranslations("loadingSurfaces");
  const choice = routeSkeletonFor(pathname, Object.keys(SECTION_SKELETONS));
  if (choice.kind === "section") {
    const Section = SECTION_SKELETONS[choice.section];
    return <Section />;
  }
  return <PageSkeleton label={label ?? tLoading("page")} body={choice.body satisfies GenericSkeletonBody} />;
}
