"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { pointSyncAction } from "@/lib/point-section-sync";
import { useContentTransition } from "@/components/layout/content-transition";

/**
 * Держит точку в шапке и открытый раздел согласованными (владелец,
 * 2026-11-10; правила — `lib/point-section-sync.ts`): открыли раздел всей
 * компании при выбранной торговой точке — выбор сам становится офисом
 * («Вся организация»); открыли страницу точки — в шапке эта точка. Ничего
 * не рисует. Переход — общий (`content-transition`): пока страница
 * собирается для нового выбора, контент — скелет; после — тост, что
 * произошло. На один адрес — одна попытка: ошибка запроса не зацикливает.
 */
export function PointSectionSync({
  viewedPointId,
  canViewOrganization,
  organizationTarget,
  points,
}: {
  /** Торговая точка, выбранная в шапке; null — офис или «Вся организация». */
  viewedPointId: string | null;
  canViewOrganization: boolean;
  /** Офис или «Вся организация» — куда переключать в разделах компании. */
  organizationTarget: { id: string; name: string } | null;
  /** Торговые точки переключателя. */
  points: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("navigation.shell.point");
  const pathname = usePathname();
  const { refreshAfter, isPending } = useContentTransition();
  const attempted = useRef<string | null>(null);

  const action = pointSyncAction({
    pathname,
    viewedPointId,
    canViewOrganization,
    organizationTargetId: organizationTarget?.id ?? null,
    pointIds: points.map((point) => point.id),
  });
  const targetId = action?.targetId ?? null;
  const kind = action?.kind ?? null;
  const targetName =
    kind === "organization" ? (organizationTarget?.name ?? "") : (points.find((point) => point.id === targetId)?.name ?? "");

  useEffect(() => {
    if (!targetId || !kind || isPending) return;
    const key = `${pathname}→${targetId}`;
    if (attempted.current === key) return;
    attempted.current = key;
    refreshAfter(
      targetId,
      async () => {
        try {
          const response = await fetch("/api/me/active-building", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ buildingId: targetId }),
          });
          const data = await response.json().catch(() => null);
          if (!response.ok) throw new Error(data?.error ?? t("failed"));
          return true;
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t("failed"));
          return false;
        }
      },
      () =>
        kind === "organization"
          ? toast.info(t("companySection", { name: targetName }))
          : toast.success(t("switched", { name: targetName })),
    );
  }, [targetId, kind, targetName, pathname, isPending, refreshAfter, t]);

  return null;
}
