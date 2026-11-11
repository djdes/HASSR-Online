"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { isCompanyWidePath, pointReturnTarget, pointSyncAction } from "@/lib/point-section-sync";
import { useContentTransition } from "@/components/layout/content-transition";
import { showPointSwitchToast, shortPointName } from "@/components/layout/point-switch-toast";

/** Точка, с которой человека увела автосмена на офис, — до конца вкладки. */
const RETURN_KEY = "wesetup.point-return";

function readReturnPoint(): string | null {
  try {
    return window.sessionStorage.getItem(RETURN_KEY);
  } catch {
    return null;
  }
}

function writeReturnPoint(pointId: string | null) {
  try {
    if (pointId) window.sessionStorage.setItem(RETURN_KEY, pointId);
    else window.sessionStorage.removeItem(RETURN_KEY);
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
 * Держит точку в шапке и открытый раздел согласованными (владелец,
 * 2026-11-10; правила — `lib/point-section-sync.ts`):
 *   • раздел всей компании при выбранной торговой точке — выбор сам
 *     становится офисом («Вся организация»); в тосте — «Вернуться на
 *     „точку“»: нажал не туда — одно нажатие назад;
 *   • страница точки — в шапке эта точка;
 *   • «назад» (стрелка страницы или браузера) из раздела компании
 *     возвращает и точку, с которой пришли (2026-11-11).
 * Ничего не рисует. Переход — общий (`content-transition`): пока страница
 * собирается для нового выбора, контент — скелет. На один адрес — одна
 * попытка: ошибка запроса не зацикливает.
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
  const router = useRouter();
  const pathname = usePathname();
  // Фильтр мест на вкладках сотрудников, цехов и оборудования ведёт и шапку.
  const placeParam = useSearchParams()?.get("place") ?? null;
  const { refreshAfter, isPending } = useContentTransition();
  const attempted = useRef<string | null>(null);
  // Переход по истории: событие приходит раньше, чем меняется адрес.
  const viaHistory = useRef(false);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    const onPop = () => {
      viaHistory.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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
  const nameOf = (id: string | null) =>
    id === organizationTarget?.id ? organizationTarget.name : (points.find((point) => point.id === id)?.name ?? "");

  useEffect(() => {
    if (isPending) return;
    const cameByHistory = viaHistory.current;
    const pathChanged = lastPath.current !== pathname;
    if (pathChanged) {
      lastPath.current = pathname;
      viaHistory.current = false;
      // Одна попытка — на один заход на страницу, а не навсегда.
      attempted.current = null;
    }
    const ids = pointsKey ? pointsKey.split(",") : [];

    if (action) {
      const key = `${pathname}?${placeParam ?? ""}→${action.targetId}`;
      if (attempted.current === key) return;
      attempted.current = key;
      const fromPointId = viewedPointId;
      const targetName = nameOf(action.targetId);
      refreshAfter(
        action.targetId,
        () => postActiveBuilding(action.targetId, t("failed")),
        () => {
          if (action.kind !== "organization") {
            forgetReturnPoint();
            // Страница точки сама держит точку в шапке — возвращать некуда.
            // Фильтр мест — вернуть прежний выбор фильтра (и с ним шапку).
            const fromId = fromPointId ?? organizationTarget?.id ?? null;
            const fromName = nameOf(fromId);
            showPointSwitchToast(
              t("switched", { name: targetName }),
              action.kind === "place" && fromId && fromName
                ? {
                    label: t("returnTo", { name: shortPointName(fromName) }),
                    // Прежний выбор фильтра — он и шапку вернёт.
                    onClick: () => router.push(`${pathname}?place=${encodeURIComponent(fromPointId ?? "all")}`, { scroll: false }),
                  }
                : null,
            );
            return;
          }
          // Запоминаем, откуда увели: «назад» и кнопка в тосте вернут точку.
          writeReturnPoint(fromPointId);
          const fromName = nameOf(fromPointId);
          showPointSwitchToast(
            t("companySection", { name: targetName }),
            fromPointId && fromName
              ? {
                  label: t("returnTo", { name: shortPointName(fromName) }),
                  onClick: () => {
                    forgetReturnPoint();
                    refreshAfter(
                      fromPointId,
                      async () => {
                        const ok = await postActiveBuilding(fromPointId, t("failed"));
                        if (!ok) return false;
                        // Туда, откуда пришли; по прямой ссылке — страница точки.
                        if (window.history.length > 1) router.back();
                        else router.push(`/settings/buildings/${fromPointId}`);
                        return true;
                      },
                      () => showPointSwitchToast(t("switched", { name: fromName })),
                    );
                  },
                }
              : null,
          );
        },
      );
      return;
    }

    if (!pathChanged) return;
    const returnPointId = readReturnPoint();
    if (!returnPointId) return;
    const restore = pointReturnTarget({ pathname, viewedPointId, returnPointId, viaHistory: cameByHistory, pointIds: ids });
    if (restore) {
      forgetReturnPoint();
      const name = nameOf(restore);
      refreshAfter(restore, () => postActiveBuilding(restore, t("failed")), () => showPointSwitchToast(t("switched", { name })));
      return;
    }
    // Ушли дальше по меню на страницу точки/журналов — работаем в офисе осознанно.
    if (!cameByHistory && !isCompanyWidePath(pathname)) forgetReturnPoint();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- names come from `points`, keyed by pointsKey
  }, [action?.kind, action?.targetId, pathname, placeParam, viewedPointId, pointsKey, isPending, refreshAfter, router, t]);

  return null;
}
