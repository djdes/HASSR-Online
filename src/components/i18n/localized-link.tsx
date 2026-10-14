"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";
import { localizedHref, publicLocaleRoute } from "@/i18n/site-locale";
import { useSiteLocale } from "./site-locale-provider";

export default function LocalizedLink(props: ComponentProps<typeof NextLink>) {
  const locale = useSiteLocale();
  const href = typeof props.href === "string" ? localizedHref(props.href, locale) : props.href;
  // The root layout persists during client navigation. Reload it when crossing
  // into an untranslated Russian page so HTML lang and client context agree.
  if (typeof href === "string" && href.startsWith("/") && !href.startsWith("//") &&
      (publicLocaleRoute(href.split(/[?#]/)[0])?.locale ?? "ru") !== locale) {
    const { href: _href, as: _as, replace: _replace, scroll: _scroll,
      shallow: _shallow, passHref: _passHref, prefetch: _prefetch, locale: _locale,
      legacyBehavior: _legacyBehavior, onNavigate: _onNavigate, ...anchorProps } = props;
    return <a {...anchorProps} href={href} />;
  }
  return <NextLink {...props} href={href} />;
}
