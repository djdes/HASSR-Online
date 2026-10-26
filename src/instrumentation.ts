/**
 * Runs once when the server starts (Next.js instrumentation). Only the
 * Node.js runtime: the router-header guard on the HTTP server and the
 * limiter statistics flusher. Each failure is logged on its own and never
 * stops the server.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
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
