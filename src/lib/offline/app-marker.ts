/**
 * The WeSetup app marks itself in the User-Agent (`WeSetupApp/<version>
 * (<platform>)`), but Android WebView adds that suffix only to requests of
 * the page itself — a page fetched by the service worker reaches the server
 * as a plain browser. With offline work the cabinet service worker runs
 * inside the app, so the page also leaves the marker in a cookie, and the
 * proxy restores the User-Agent from it. Pure and client-safe.
 *
 * The marker changes presentation only (app shell, payments screen, version
 * check) and gives no rights — the same as a spoofed User-Agent would.
 */
import { parseMobileAppUserAgent } from "@/lib/mobile-app";

export const APP_MARKER_COOKIE = "wesetup-app";
const MARKER_RE = /^(\d+(?:\.\d+){0,3})-(ios|android)$/;

/** Cookie value for this User-Agent; `null` — not the app. */
export function appMarkerFromUserAgent(userAgent: string | null | undefined): string | null {
  const info = parseMobileAppUserAgent(userAgent);
  return info ? `${info.version}-${info.platform}` : null;
}

/** User-Agent as the server should see it: the original, plus the app suffix when only the cookie carries it. */
export function userAgentWithAppMarker(userAgent: string | null | undefined, marker: string | null | undefined): string | null {
  const original = userAgent ?? null;
  if (parseMobileAppUserAgent(original)) return original;
  const match = MARKER_RE.exec((marker ?? "").trim());
  if (!match) return original;
  return `${original ?? ""} WeSetupApp/${match[1]} (${match[2]})`.trim();
}

/** `document.cookie` string that stores the marker for a year. */
export function appMarkerCookieString(marker: string, secure: boolean): string {
  return `${APP_MARKER_COOKIE}=${marker}; Path=/; Max-Age=${365 * 24 * 60 * 60}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
