import * as Sentry from "@sentry/nextjs";

import {
  SENTRY_DATA_COLLECTION,
  SENTRY_DSN,
  scrubBreadcrumb,
  scrubEvent,
  sentryRelease,
  sentryServerEnabled,
} from "@/lib/sentry-config";

/**
 * Sentry на сервере (вызывается из src/instrumentation.ts при старте Node.js): ошибки серверных
 * компонентов, маршрутов и proxy приходят через `onRequestError`. Только ошибки: без трассировки, без
 * своего OpenTelemetry и без подмены модулей при загрузке — у сервера свои хуки (flight-header-guard).
 * Возвращает, включён ли Sentry.
 */
export function initSentryServer(env: Record<string, string | undefined> = process.env): boolean {
  if (!sentryServerEnabled(env)) return false;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: "production",
    release: sentryRelease(env.NEXT_PUBLIC_BUILD_ID ?? env.BUILD_SHA),
    dataCollection: SENTRY_DATA_COLLECTION,
    enableOpenTelemetrySetup: false,
    enableRuntimeChannelInjection: false,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
  return true;
}
