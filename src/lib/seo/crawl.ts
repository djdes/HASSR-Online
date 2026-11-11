import { extractFacts, findIssues, type PageFacts, type SeoIssue } from "@/lib/seo/health";

/**
 * Обход публичных страниц из sitemap для страницы ROOT «SEO-здоровье».
 * Ходим на сам сервер по локальному адресу с заголовком Host, чтобы не
 * зависеть от внешней сети; результат держим в памяти час.
 */
export type SeoHealthReport = {
  startedAt: string;
  finishedAt: string;
  pages: PageFacts[];
  issues: SeoIssue[];
  linksChecked: number;
};

export type SeoHealthProgress = {
  phase: "pages" | "links";
  startedAt: string;
  pagesDone: number;
  pagesTotal: number;
  linksDone: number;
  linksTotal: number;
};

export type SeoHealthStatus = {
  running: boolean;
  progress: SeoHealthProgress | null;
  report: SeoHealthReport | null;
};

const CONCURRENCY = 6;
const TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
let cached: { at: number; report: SeoHealthReport } | null = null;
let running: Promise<SeoHealthReport> | null = null;
let currentProgress: SeoHealthProgress | null = null;

function localBase(): string {
  return process.env.SEO_HEALTH_BASE ?? `http://127.0.0.1:${process.env.PORT ?? "3002"}`;
}

async function fetchPage(publicUrl: string): Promise<{ status: number; html: string; ms: number }> {
  const u = new URL(publicUrl);
  const started = Date.now();
  try {
    const res = await fetch(`${localBase()}${u.pathname}${u.search}`, {
      headers: {
        Host: u.host,
        "User-Agent": "WeSetup-SEO-Health/1.0",
        Accept: "text/html",
        ...(process.env.DEPLOY_WARM_TOKEN ? { "x-deploy-warm": process.env.DEPLOY_WARM_TOKEN } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const html = res.status === 200 ? await res.text() : "";
    return { status: res.status, html, ms: Date.now() - started };
  } catch {
    return { status: 0, html: "", ms: Date.now() - started };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

export async function runSeoHealth(urls: string[], options: { force?: boolean } = {}): Promise<SeoHealthReport> {
  if (!options.force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.report;
  if (running) return running;
  const startedAt = new Date().toISOString();
  currentProgress = {
    phase: "pages",
    startedAt,
    pagesDone: 0,
    pagesTotal: urls.length,
    linksDone: 0,
    linksTotal: 0,
  };
  running = (async () => {
    const pages = await mapLimit(urls, CONCURRENCY, async (url) => {
      const r = await fetchPage(url);
      if (currentProgress) currentProgress.pagesDone += 1;
      return extractFacts(url, r.status, r.html, r.ms);
    });
    const known = new Set(urls.map((u) => new URL(u).pathname.replace(/\/+$/, "") || "/"));
    const linkSet = new Set<string>();
    for (const p of pages) for (const l of p.internalLinks) if (!known.has(l)) linkSet.add(l);
    const links = [...linkSet].slice(0, 400);
    if (currentProgress) {
      currentProgress.phase = "links";
      currentProgress.linksTotal = links.length;
    }
    const statuses = await mapLimit(links, CONCURRENCY, async (path) => {
      try {
        const res = await fetch(`${localBase()}${path}`, {
          method: "HEAD",
          headers: {
            Host: "wesetup.ru",
            ...(process.env.DEPLOY_WARM_TOKEN ? { "x-deploy-warm": process.env.DEPLOY_WARM_TOKEN } : {}),
          },
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return [path, res.status] as const;
      } catch {
        return [path, 0] as const;
      } finally {
        if (currentProgress) currentProgress.linksDone += 1;
      }
    });
    const linkStatus: Record<string, number> = {};
    for (const [path, status] of statuses) linkStatus[path] = status;
    for (const p of known) linkStatus[p] = 200;
    const report: SeoHealthReport = { startedAt, finishedAt: new Date().toISOString(), pages, issues: findIssues(pages, linkStatus), linksChecked: links.length };
    cached = { at: Date.now(), report };
    return report;
  })().finally(() => {
    running = null;
    currentProgress = null;
  });
  return running;
}

export function cachedSeoHealth(): SeoHealthReport | null {
  return cached?.report ?? null;
}

export function seoHealthStatus(): SeoHealthStatus {
  return {
    running: running !== null,
    progress: currentProgress ? { ...currentProgress } : null,
    report: cached?.report ?? null,
  };
}

