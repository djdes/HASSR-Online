import { buildingWhere } from "@/lib/building-scope";

/**
 * Откуда ещё приходят поставки в журнал приёмки (спека
 * mercury-iiko-acceptance-2026-11-21): ВСД из Меркурия, которые ждут
 * оформления, и подключён ли iiko (его накладные — во «Входящих»).
 * Журнал показывает это прямо над таблицей, а не только на отдельных экранах.
 *
 * Чистый модуль: типы и правила нужны и серверу, и журналу в браузере.
 */

/** Статусы ВСД, которые ждут приёмки, — как на экране «Входящие ВСД». */
export const MERCURY_PENDING_STATUSES = ["new", "acknowledged"] as const;

/** «Входящие ВСД»: оформление приёмки по ВСД. */
export const MERCURY_INCOMING_HREF = "/mercury";
/** «Входящие»: накладные iiko, Диадока, СБИС — кнопка «Принять». */
export const SUPPLY_INBOX_HREF = "/edo";
/** Подключение iiko. */
export const IIKO_SETTINGS_HREF = "/settings/integrations/iiko";

export type AcceptanceMercuryHint = { pending: number; overdue: number };

/**
 * Что показать в журнале приёмки руководителю. Человеку без доступа к
 * «Входящим» и Меркурию (там всё — только руководству) — `null`: ни полосы,
 * ни пунктов меню, чтобы кнопки не вели на запрет.
 */
export type AcceptanceSources = {
  /** null — Меркурий не подключён, выключен или его нет в тарифе. */
  mercury: AcceptanceMercuryHint | null;
  iikoConnected: boolean;
};

/** Условие выборки ожидающих ВСД точки документа (и общих). */
export function mercuryPendingWhere(organizationId: string, buildingId: string | null) {
  return {
    organizationId,
    ...buildingWhere(buildingId),
    localStatus: { in: [...MERCURY_PENDING_STATUSES] },
  };
}

export type MercuryPendingWhere = ReturnType<typeof mercuryPendingWhere>;

/** Полоса «В Меркурии N ВСД ждут приёмки» — только когда есть что оформлять. */
export function showMercuryStrip(sources: AcceptanceSources | null | undefined): boolean {
  return Boolean(sources?.mercury && sources.mercury.pending > 0);
}

/** Куда ведёт пункт «Из iiko»: во «Входящие» или подключить iiko. */
export function iikoTarget(connected: boolean): { href: string; kind: "inbox" | "connect" } {
  return connected ? { href: SUPPLY_INBOX_HREF, kind: "inbox" } : { href: IIKO_SETTINGS_HREF, kind: "connect" };
}
