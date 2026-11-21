import { sentryBrowserEnabled } from "@/lib/sentry-config";

/**
 * Ленивый вход в Sentry для браузера: сам клиент (src/lib/sentry-browser.ts) — отдельный чанк, который
 * грузится один раз — после загрузки страницы (src/instrumentation-client.ts) или сразу, если ошибку
 * поймал error boundary. Пока Sentry выключен (не wesetup.ru, не продакшен), ничего не грузится.
 */
type SentryBrowser = typeof import("./sentry-browser");

let loading: Promise<SentryBrowser> | null = null;

export function browserSentryEnabled(): boolean {
  return typeof window !== "undefined" && sentryBrowserEnabled({ nodeEnv: process.env.NODE_ENV, hostname: window.location.hostname });
}

export function loadSentryBrowser(): Promise<SentryBrowser> | null {
  if (!browserSentryEnabled()) return null;
  loading ??= import("./sentry-browser").then((sentry) => {
    sentry.startSentryBrowser();
    return sentry;
  });
  return loading;
}

export function reportError(error: unknown): void {
  loadSentryBrowser()
    ?.then((sentry) => sentry.captureError(error))
    .catch(() => undefined);
}
