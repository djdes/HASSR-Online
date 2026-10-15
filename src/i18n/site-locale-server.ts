import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { publicLocaleRoute, SITE_LOCALE_COOKIE } from "./site-locale";
import { resolveLocale } from "./locales";
import { PARTNER_HEADER_PATH } from "@/lib/partners/request-context";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";

// The proxy overwrites this header. cache() is scoped to the server render,
// unlike a mutable module-global locale which could leak between visitors.
export const getSiteLocale = cache(async () => {
  const requestHeaders = await headers();
  const route = publicLocaleRoute(requestHeaders.get(PARTNER_HEADER_PATH) ?? "");
  if (route) return route.locale;
  const session = await getServerSession(authOptions);
  return resolveLocale({
    authenticated: Boolean(session),
    userLocale: session?.user.locale,
    organizationLocale: session?.user.organizationLocale,
    cookieLocale: (await cookies()).get(SITE_LOCALE_COOKIE)?.value,
  });
});
