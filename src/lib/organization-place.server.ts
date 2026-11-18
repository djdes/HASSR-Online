/**
 * Город, страна и часовой пояс новой организации (спека
 * tg-client-location-2026-11): город из формы регистрации, пояс браузера,
 * а без них — по IP. Пояс организации — это время в её журналах.
 */

import { db } from "@/lib/db";
import { findGeoPlace, resolveOrganizationPlace } from "@/lib/geo-places";
import { lookupIpGeo } from "@/lib/ip-geo";

export type OrganizationPlace = { city: string | null; countryCode: string | null; timeZone: string };

export async function resolveOrganizationPlaceForRequest(
  input: { city?: unknown; countryCode?: unknown; browserTimeZone?: unknown },
  client: { ip?: string | null; headers?: Headers | null },
): Promise<OrganizationPlace | null> {
  // Город из каталога знает и страну, и пояс — внешний запрос не нужен.
  const known = typeof input.city === "string" ? findGeoPlace(input.city, typeof input.countryCode === "string" ? input.countryCode : null) : null;
  const geo = known ? null : await lookupIpGeo(client.ip ?? null, { headers: client.headers ?? null }).catch(() => null);
  return resolveOrganizationPlace({ ...input, geo });
}

/** Записать место в организацию. Сбой не мешает регистрации. */
export async function applyOrganizationPlace(organizationId: string, place: OrganizationPlace | null): Promise<void> {
  if (!place) return;
  await db.organization
    .update({
      where: { id: organizationId },
      data: { timezone: place.timeZone, city: place.city, countryCode: place.countryCode },
    })
    .catch((error) => console.error("[organization-place] update failed", error));
}
