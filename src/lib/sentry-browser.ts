import {
  BrowserClient,
  breadcrumbsIntegration,
  captureException,
  dedupeIntegration,
  defaultStackParser,
  eventFiltersIntegration,
  getCurrentScope,
  globalHandlersIntegration,
  httpContextIntegration,
  linkedErrorsIntegration,
  makeFetchTransport,
} from "@sentry/browser";

import {
  SENTRY_DATA_COLLECTION,
  SENTRY_DENY_URLS,
  SENTRY_DSN,
  SENTRY_IGNORE_ERRORS,
  SENTRY_TUNNEL_PATH,
  scrubBreadcrumb,
  scrubEvent,
  sentryRelease,
} from "@/lib/sentry-config";

/**
 * Клиент Sentry в браузере. Грузится отдельным чанком уже после того, как страница открылась
 * (src/lib/sentry-lazy.ts), поэтому первый экран не тяжелеет.
 *
 * Минимальный @sentry/browser со своим набором интеграций, а не `Sentry.init` из @sentry/nextjs: тот всегда
 * тянет трассировку и замеры производительности (+88 КБ gzip). Здесь только ошибки: перехват, связанные
 * причины, без повторов, адрес страницы и последние действия.
 */
let started = false;

export function startSentryBrowser(): void {
  if (started) return;
  started = true;
  const client = new BrowserClient({
    dsn: SENTRY_DSN,
    tunnel: SENTRY_TUNNEL_PATH,
    environment: "production",
    release: sentryRelease(process.env.NEXT_PUBLIC_BUILD_ID),
    dataCollection: SENTRY_DATA_COLLECTION,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: [
      eventFiltersIntegration(),
      globalHandlersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
      httpContextIntegration(),
      breadcrumbsIntegration(),
    ],
    ignoreErrors: SENTRY_IGNORE_ERRORS,
    denyUrls: SENTRY_DENY_URLS,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
  getCurrentScope().setClient(client);
  client.init();
}

export function captureError(error: unknown): void {
  startSentryBrowser();
  captureException(error);
}
