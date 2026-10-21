import { DirectRangeError, validateDirectRange, type DirectRange, type DirectStatsResult } from "./yandex-direct-report";
import { DirectApiError } from "./yandex-direct-stats.server";

type Dependencies = { authorize: () => Promise<unknown>; read: (range: DirectRange, refresh: boolean) => Promise<DirectStatsResult> };
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export function createDirectStatsHandler({ authorize, read }: Dependencies) {
  return async function GET(request: Request) {
    // Keep Next's ROOT-only 404 outside the provider error boundary.
    await authorize();
    const url = new URL(request.url);
    try {
      const range = validateDirectRange(url.searchParams.get("from"), url.searchParams.get("to"));
      const result = await read(range, url.searchParams.get("refresh") === "1");
      return Response.json(result, {
        status: result.status === "processing" ? 202 : 200,
        headers: { ...headers, ...(result.status === "processing" ? { "Retry-After": String(result.retryAfter) } : {}) },
      });
    } catch (error) {
      if (error instanceof DirectRangeError) return Response.json({ error: "invalid_range" }, { status: 400, headers });
      if (error instanceof DirectApiError) return Response.json({ error: error.code, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) }, {
        status: error.code === "rate_limited" ? 429 : error.code === "not_configured" ? 503 : 502,
        headers: { ...headers, ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) },
      });
      return Response.json({ error: "provider_unavailable" }, { status: 502, headers });
    }
  };
}