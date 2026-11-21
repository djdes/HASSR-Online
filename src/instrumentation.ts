/**
 * Runs once when the server starts (Next.js instrumentation). Only the
 * Node.js runtime: Sentry (errors only, production on wesetup.ru), the
 * router-header guard on the HTTP server and the limiter statistics flusher.
 * Each failure is logged on its own and never stops the server.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { initSentryServer } = await import("./lib/sentry-server");
      initSentryServer();
    } catch (error) {
      console.error("[instrumentation] Sentry is off:", error instanceof Error ? error.message : error);
    }
    try {
      const { installFlightHeaderGuard } = await import("./lib/flight-header-guard");
      installFlightHeaderGuard();
    } catch (error) {
      console.error("[instrumentation] router header guard is off:", error instanceof Error ? error.message : error);
    }
    try {
      const { startPageLimitStatsFlusher } = await import("./lib/page-limit-stats.server");
      startPageLimitStatsFlusher();
    } catch (error) {
      console.error("[instrumentation] page limit statistics are off:", error instanceof Error ? error.message : error);
    }
  }
}

type CaptureRequestError = typeof import("@sentry/nextjs").captureRequestError;

/**
 * Errors of server components, route handlers and the proxy → Sentry, with
 * the real message (the browser only gets a digest). Does nothing while
 * Sentry is off (dev, CI, any host but wesetup.ru).
 */
export async function onRequestError(...args: Parameters<CaptureRequestError>): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { captureRequestError } = await import("@sentry/nextjs");
    captureRequestError(...args);
  } catch {
    // Monitoring must never break a response.
  }
}
