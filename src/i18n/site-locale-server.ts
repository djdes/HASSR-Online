import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { parseSiteLocale, SITE_LOCALE_HEADER } from "./site-locale";

// The proxy overwrites this header. cache() is scoped to the server render,
// unlike a mutable module-global locale which could leak between visitors.
export const getSiteLocale = cache(async () => parseSiteLocale((await headers()).get(SITE_LOCALE_HEADER)));
