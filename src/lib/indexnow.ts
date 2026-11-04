/**
 * IndexNow protocol helpers for instant URL submission to Yandex and Bing
 * (which also feeds DuckDuckGo, ChatGPT Search, Seznam, and Naver).
 *
 * Spec:
 * - https://www.indexnow.org/documentation
 * - https://yandex.ru/support/webmaster/indexnow/key.html
 */

export const INDEXNOW_KEY = "4f8b92c17e3a4d60a5c8192eb7304d1f";

export const INDEXNOW_ENDPOINTS = [
  "https://yandex.com/indexnow",
  "https://api.indexnow.org/indexnow",
] as const;

export const INDEXNOW_MAX_BATCH = 10_000;

export interface IndexNowEndpointResult {
  endpoint: string;
  batchIndex: number;
  urlCount: number;
  status: number;
  accepted: boolean;
  responseBody: string;
}

export interface IndexNowSummary {
  host: string;
  keyLocation: string;
  urlCount: number;
  results: IndexNowEndpointResult[];
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Extracts unique, valid URLs belonging to `expectedOrigin` from a sitemap XML body.
 */
export function extractSitemapUrls(xml: string, expectedOrigin = "https://wesetup.ru"): string[] {
  const origin = expectedOrigin.replace(/\/+$/, "");
  const targetUrl = new URL(origin);
  const seen = new Set<string>();
  const locRegex = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;

  while ((match = locRegex.exec(xml)) !== null) {
    const decoded = decodeXmlEntities(match[1].trim());
    let parsed: URL;
    try {
      parsed = new URL(decoded);
    } catch {
      continue;
    }
    if (parsed.protocol === targetUrl.protocol && parsed.host === targetUrl.host) {
      seen.add(parsed.toString());
    }
  }

  return [...seen];
}

export function chunkIndexNowUrls(urls: readonly string[], maxBatchSize = INDEXNOW_MAX_BATCH): string[][] {
  if (maxBatchSize < 1) throw new RangeError("maxBatchSize must be >= 1");
  const chunks: string[][] = [];
  for (let i = 0; i < urls.length; i += maxBatchSize) {
    chunks.push(urls.slice(i, i + maxBatchSize));
  }
  return chunks;
}

export function isIndexNowAcceptedStatus(status: number): boolean {
  // 200 OK = submitted, 202 Accepted = queued pending asynchronous key verification.
  return status === 200 || status === 202;
}

export interface SubmitIndexNowOptions {
  baseUrl?: string;
  key?: string;
  endpoints?: readonly string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function submitSitemapToIndexNow(
  options: SubmitIndexNowOptions = {},
): Promise<IndexNowSummary> {
  const baseUrl = (options.baseUrl ?? "https://wesetup.ru").replace(/\/+$/, "");
  const key = options.key ?? INDEXNOW_KEY;
  const endpoints = options.endpoints ?? INDEXNOW_ENDPOINTS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

  const parsedBase = new URL(baseUrl);
  const host = parsedBase.host;
  const keyLocation = `${baseUrl}/${key}.txt`;

  // 1. Verify the public key file is live before asking search engines to fetch it.
  const keyRes = await fetchImpl(keyLocation, {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const keyText = (await keyRes.text()).trim();
  if (keyRes.status !== 200 || keyText !== key) {
    throw new Error(
      `IndexNow key verification failed at ${keyLocation}: status=${keyRes.status}, body=${JSON.stringify(keyText.slice(0, 64))}`,
    );
  }

  // 2. Fetch sitemap.xml and collect all canonical URLs on this host.
  const sitemapUrl = `${baseUrl}/sitemap.xml`;
  const sitemapRes = await fetchImpl(sitemapUrl, {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (sitemapRes.status !== 200) {
    throw new Error(`Failed to fetch ${sitemapUrl}: HTTP ${sitemapRes.status}`);
  }
  const sitemapXml = await sitemapRes.text();
  const urls = extractSitemapUrls(sitemapXml, baseUrl);
  if (urls.length === 0) {
    throw new Error(`No URLs extracted for ${baseUrl} from ${sitemapUrl}`);
  }

  const batches = chunkIndexNowUrls(urls);
  const results: IndexNowEndpointResult[] = [];

  // 3. Submit batches to each endpoint.
  for (const endpoint of endpoints) {
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const urlList = batches[batchIndex];
      const payload = {
        host,
        key,
        keyLocation,
        urlList,
      };
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseBody = (await res.text()).slice(0, 500);
      results.push({
        endpoint,
        batchIndex,
        urlCount: urlList.length,
        status: res.status,
        accepted: isIndexNowAcceptedStatus(res.status),
        responseBody,
      });
    }
  }

  return {
    host,
    keyLocation,
    urlCount: urls.length,
    results,
  };
}
