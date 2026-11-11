"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { isCompanyWidePath, pointReturnTarget, pointSyncAction } from "@/lib/point-section-sync";
import { useContentTransition } from "@/components/layout/content-transition";

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
  });
  const pointsKey = pointIds.join(",");
  const nameOf = (id: string | null) => points.find((point) => point.id === id)?.name ?? "";

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
      const key = `${pathname}→${action.targetId}`;
      if (attempted.current === key) return;
      attempted.current = key;
      const fromPointId = viewedPointId;
      const targetName = action.kind === "organization" ? (organizationTarget?.name ?? "") : nameOf(action.targetId);
      refreshAfter(
        action.targetId,
        () => postActiveBuilding(action.targetId, t("failed")),
        () => {
          if (action.kind === "point") {
            forgetReturnPoint();
            toast.success(t("switched", { name: targetName }));
            return;
          }
          // Запоминаем, откуда увели: «назад» и кнопка в тосте вернут точку.
          writeReturnPoint(fromPointId);
          const fromName = nameOf(fromPointId);
          toast.info(t("companySection", { name: targetName }), {
            duration: 8000,
            action:
              fromPointId && fromName
                ? {
                    label: t("returnTo", { name: fromName }),
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
                        () => toast.success(t("switched", { name: fromName })),
                      );
                    },
                  }
                : undefined,
          });
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
      refreshAfter(restore, () => postActiveBuilding(restore, t("failed")), () => toast.success(t("switched", { name })));
      return;
    }
    // Ушли дальше по меню на страницу точки/журналов — работаем в офисе осознанно.
    if (!cameByHistory && !isCompanyWidePath(pathname)) forgetReturnPoint();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- names come from `points`, keyed by pointsKey
  }, [action?.kind, action?.targetId, pathname, viewedPointId, pointsKey, isPending, refreshAfter, router, t]);

  return null;
}
