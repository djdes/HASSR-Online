/**
 * Runs once when the server starts (Next.js instrumentation). Only the
 * Node.js runtime starts the limiter statistics flusher; a failure here is
 * logged and never stops the server.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { startPageLimitStatsFlusher } = await import("./lib/page-limit-stats.server");
      startPageLimitStatsFlusher();
    } catch (error) {
      console.error("[instrumentation] page limit statistics are off:", error instanceof Error ? error.message : error);
    }
  }
}
