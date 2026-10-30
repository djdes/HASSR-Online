"use client";

import { usePathname } from "next/navigation";
import { RouteSkeleton } from "@/components/layout/route-skeleton";

/**
 * Загрузка любой страницы кабинета (2026-10-29). Раньше у половины разделов
 * (мониторинг, ППК, чек-листы, проверка, база знаний, …) скелета не было:
 * переход стоял на старой странице без отклика. Теперь при входе в раздел —
 * скелет; у разделов со своим `loading.tsx` — их же скелет (`RouteSkeleton`),
 * поэтому переход «общий → свой» без прыжка.
 */
export default function DashboardGroupLoading() {
  return <RouteSkeleton pathname={usePathname() || "/"} />;
}
