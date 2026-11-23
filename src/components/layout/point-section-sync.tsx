"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { autoPointTarget, pointSyncAction } from "@/lib/point-section-sync";
import { useContentTransition } from "@/components/layout/content-transition";

/**
 * Объект, с которого человека увела автосмена на уровень организации («Выберите
 * объект»). В localStorage, а не в sessionStorage (12.11.2026): автосмена пишет
 * cookie на весь браузер, и новая вкладка тоже должна вернуть объект.
 */
const RETURN_KEY = "wesetup.point-return";

function readReturnPoint(): string | null {
  try {
    return window.localStorage.getItem(RETURN_KEY);
  } catch {
    return null;
  }
}

function writeReturnPoint(pointId: string | null) {
  try {
    if (pointId) window.localStorage.setItem(RETURN_KEY, pointId);
    else window.localStorage.removeItem(RETURN_KEY);
  } catch {
    /* хранилище недоступно — «назад» просто не вернёт точку */
  }
}

/** Ручной выбор в переключателе отменяет «вернуть точку по „назад“». */
export function forgetReturnPoint() {
  writeReturnPoint(null);
}

async function postActiveBuilding(buildingId: string, failed: string): Promise<boolean> {
  try {
    const response = await fetch("/api/me/active-building", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buildingId }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error ?? failed);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : failed);
    return false;
  }
}

/**
 * Держит объект в шапке и открытый раздел согласованными (владелец,
 * 2026-11-10 и 2026-11-23; правила — `lib/point-section-sync.ts`):
 *   • раздел всей компании (офис, «Моя компания», подписки…) — в шапке
 *     «Выберите объект»; объект, с которого ушли, запоминается;
 *   • страница объекта — в шапке этот объект;
 *   • страница, где есть объект (журналы, «Сегодня», сотрудники…), при
 *     «Выберите объект» — запомненный объект, иначе единственный
 *     (`autoPointTarget`).
 * Всё — без оповещений (2026-11-23): ни тоста, ни «Вернуться на …». Ничего не
 * рисует. Переход — общий (`content-transition`): пока страница собирается для
 * нового выбора, контент — скелет. На один адрес — одна попытка: ошибка
 * запроса не зацикливает.
 */
export function PointSectionSync({
  viewedPointId,
  canViewOrganization,
  organizationTarget,
  points,
}: {
  /** Объект, выбранный в шапке; null — «Выберите объект» (офис или вся организация). */
  viewedPointId: string | null;
  canViewOrganization: boolean;
  /** Офис или «Вся организация» — куда переключать в разделах компании. */
  organizationTarget: { id: string; name: string } | null;
  /** Объекты переключателя (без офиса). */
  points: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("navigation.shell.point");
  const pathname = usePathname();
  // Фильтр мест на вкладках сотрудников, цехов и оборудования ведёт и шапку.
  const placeParam = useSearchParams()?.get("place") ?? null;
  const { refreshAfter, isPending } = useContentTransition();
  const attempted = useRef<string | null>(null);
  const lastPath = useRef<string | null>(null);

  const pointIds = points.map((point) => point.id);
  const action = pointSyncAction({
    pathname,
    viewedPointId,
    canViewOrganization,
    organizationTargetId: organizationTarget?.id ?? null,
    pointIds,
    placeParam,
  });
  const pointsKey = pointIds.join(",");
  const actionKind = action?.kind ?? null;
  const actionTarget = action?.targetId ?? null;

  useEffect(() => {
    if (isPending) return;
    const pathChanged = lastPath.current !== pathname;
    if (pathChanged) {
      lastPath.current = pathname;
      // Одна попытка — на один заход на страницу, а не навсегда.
      attempted.current = null;
    }
    const ids = pointsKey ? pointsKey.split(",") : [];

    if (actionKind && actionTarget) {
      const key = `${pathname}?${placeParam ?? ""}→${actionTarget}`;
      if (attempted.current === key) return;
      attempted.current = key;
      const fromPointId = viewedPointId;
      refreshAfter(actionTarget, async () => {
        const ok = await postActiveBuilding(actionTarget, t("failed"));
        if (!ok) return false;
        // Раздел компании — запоминаем объект, с которого ушли: на странице с
        // объектом он включится сам. Объект выбран — запоминать нечего.
        if (actionKind === "organization") writeReturnPoint(fromPointId);
        else forgetReturnPoint();
        return true;
      });
      return;
    }

    if (!pathChanged) return;
    const returnPointId = readReturnPoint();
    const target = autoPointTarget({ pathname, viewedPointId, returnPointId, pointIds: ids });
    if (target) {
      const key = `${pathname}→auto:${target}`;
      if (attempted.current === key) return;
      attempted.current = key;
      refreshAfter(target, async () => {
        const ok = await postActiveBuilding(target, t("failed"));
        if (ok) forgetReturnPoint();
        return ok;
      });
      return;
    }
    // Объект выбран вручную или стал недоступным — возвращать нечего.
    if (returnPointId && (viewedPointId !== null || !ids.includes(returnPointId))) forgetReturnPoint();
  }, [actionKind, actionTarget, pathname, placeParam, viewedPointId, pointsKey, isPending, refreshAfter, t]);

  return null;
}
