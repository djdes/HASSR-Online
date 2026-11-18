"use client";

/**
 * Часовой пояс организации для клиентских компонентов кабинета (спека
 * tg-client-location-2026-11): время в журналах и чек-листах показывается
 * по месту организации (её городу), а не по Москве и не по поясу
 * браузера проверяющего. Пояс задаёт серверный layout кабинета.
 */

import { createContext, useContext } from "react";

const DEFAULT_TIME_ZONE = "Europe/Moscow";

const OrgTimeZoneContext = createContext<string>(DEFAULT_TIME_ZONE);

export function OrgTimeZoneProvider({ timeZone, children }: { timeZone: string | null | undefined; children: React.ReactNode }) {
  return <OrgTimeZoneContext.Provider value={timeZone || DEFAULT_TIME_ZONE}>{children}</OrgTimeZoneContext.Provider>;
}

export function useOrgTimeZone(): string {
  return useContext(OrgTimeZoneContext);
}
