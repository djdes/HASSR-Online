"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { pointReturnTarget, pointSyncAction } from "@/lib/point-section-sync";
import { useContentTransition } from "@/components/layout/content-transition";
import { shortSwitchName, showSwitchToast, switchWithReturn, type SwitchSide } from "@/components/layout/switch-toast";

/**
 * Точка, с которой человека увела автосмена на офис. В localStorage, а не в
 * sessionStorage (12.11.2026): автосмена пишет cookie на весь браузер, и новая
 * вкладка тоже должна вернуть точку, а не остаться на офисе.
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
 * Держит точку в шапке и открытый раздел согласованными (владелец,
 * 2026-11-10; правила — `lib/point-section-sync.ts`):
 *   • раздел всей компании при выбранной торговой точке — выбор сам
 *     становится офисом («Вся организация»); в тосте — «Вернуться на
 *     „точку“»: нажал не туда — одно нажатие назад;
 *   • страница точки — в шапке эта точка;
 *   • уход из раздела компании (по меню или «назад», с 12.11.2026)
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
  const nameOf = (id: string | null) =>
    id === organizationTarget?.id ? organizationTarget.name : (points.find((point) => point.id === id)?.name ?? "");

  useEffect(() => {
    if (isPending) return;
    const pathChanged = lastPath.current !== pathname;
    if (pathChanged) {
      lastPath.current = pathname;
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
      if (action.kind === "organization") {
        // Раздел всей компании: выбор — офис / «Вся организация»; в тосте —
        // «Вернуться на «точку»» (`switch-toast.tsx`). Возврат — точка и
        // страница, откуда пришли; его тост предлагает снова в раздел.
        const companyHref = `${pathname}${window.location.search}`;
        const fromName = nameOf(fromPointId);
        const company: SwitchSide = {
          tag: action.targetId,
          go: async () => {
            const ok = await postActiveBuilding(action.targetId, t("failed"));
            if (!ok) return false;
            // Запоминаем, откуда увели: «назад» и кнопка в тосте вернут точку.
            writeReturnPoint(fromPointId);
            // Снова в раздел после возврата — по адресу, не по истории.
            if (`${window.location.pathname}${window.location.search}` !== companyHref) router.push(companyHref);
            return true;
          },
          message: t("companySection", { name: targetName }),
          returnLabel: t("returnTo", { name: shortSwitchName(targetName) }),
        };
        const point: SwitchSide | null =
          fromPointId && fromName
            ? {
                tag: fromPointId,
                go: async () => {
                  forgetReturnPoint();
                  const ok = await postActiveBuilding(fromPointId, t("failed"));
                  if (!ok) return false;
                  // Туда, откуда пришли; по прямой ссылке — страница точки.
                  if (window.history.length > 1) router.back();
                  else router.push(`/settings/buildings/${fromPointId}`);
                  return true;
                },
                message: t("switched", { name: fromName }),
                returnLabel: t("returnTo", { name: shortSwitchName(fromName) }),
              }
            : null;
        switchWithReturn(refreshAfter, company, point);
        return;
      }
      refreshAfter(
        action.targetId,
        () => postActiveBuilding(action.targetId, t("failed")),
        () => {
          forgetReturnPoint();
          // Страница точки сама держит точку в шапке — возвращать некуда.
          // Фильтр мест — вернуть прежний выбор фильтра (и с ним шапку).
          const fromId = fromPointId ?? organizationTarget?.id ?? null;
          const fromName = nameOf(fromId);
          showSwitchToast(
            t("switched", { name: targetName }),
            action.kind === "place" && fromId && fromName
              ? {
                  label: t("returnTo", { name: shortSwitchName(fromName) }),
                  // Прежний выбор фильтра — он и шапку вернёт (её тост — снова с возвратом).
                  onClick: () => router.push(`${pathname}?place=${encodeURIComponent(fromPointId ?? "all")}`, { scroll: false }),
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
    const restore = pointReturnTarget({ pathname, viewedPointId, returnPointId, pointIds: ids });
    if (restore) {
      forgetReturnPoint();
      const name = nameOf(restore);
      // Ушли из раздела компании (по меню или «назад») — снова точка, с которой
      // пришли; тост без кнопки возврата: в раздел компании ведёт меню.
      refreshAfter(restore, () => postActiveBuilding(restore, t("failed")), () => showSwitchToast(t("switched", { name })));
      return;
    }
    // Точка вручную выбрана в шапке или стала недоступной — возвращать нечего.
    if (viewedPointId !== null || !ids.includes(returnPointId)) forgetReturnPoint();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- names come from `points`, keyed by pointsKey
  }, [action?.kind, action?.targetId, pathname, placeParam, viewedPointId, pointsKey, isPending, refreshAfter, router, t]);

  return null;
}
