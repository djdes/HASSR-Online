"use client";
import { useTranslations } from "next-intl";

import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Загрузка раздела `/settings/*` — запасной скелет для всех подстраниц
 * настроек (своих у них нет). Хаба с тёмным баннером больше нет
 * (меню кабинета 2026-10-16), поэтому скелет один: шапка + панель.
 */
export default function SettingsLoading() {
  const tLoading = useTranslations("loadingSurfaces");
  return <PageSkeleton label={tLoading("settings")} body="panel" />;
}
