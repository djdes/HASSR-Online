import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { parse } from "node-html-parser";
import type { DonorSiteFit } from "./gogetlinks-site-fit";

type Publication = DonorSiteFit["publications"][number] & {
  excerpt?: string;
  section?: string;
  date?: string;
  source?: string;
  references?: { domain: string; label: string }[];
};

type SiteSample = {
  description: string;
  sections: string[];
  publications: Publication[];
};

export type DonorReviewFit = DonorSiteFit & { sample?: SiteSample };

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const SECTOR = /общепит|ресторан|ресторатор|\bho\s?re\s?ca\b|кафе|столов[а-яё]+|пекарн|пищев[а-яё]+\s+(производ|промышл|предприят)|пищеблок|фудтех|фастфуд|food\s?safety/i;
const COMPLIANCE = /санпин|хассп|\bhaccp\b|роспотребнадзор|пищев[а-яё]+\s+безопасн|бракераж|санитарн[а-яё]+\s+(требован|правил|норм|контрол|безопасн)/i;
const OPERATIONS = /бизнес|предпринимател|владел|управлен|менеджмент|откры(ть|тие)|провер(к|я)|маркировк|гигиен|контрол|требован|безопасн|себестоим|персонал|оборудован|закупк|штраф|журнал|хранени|автоматизац|франчайзинг/i;
const BUSINESS_SECTION = /^(?:бизнес|малый бизнес|предпринимательство|экономика|менеджмент|проблемы и рекомендации|ресторанное оборудование)$/i;
const SECTION = /^(?:общепит|ресторанный бизнес|рестораны|horeca|в фокусе|советы|статьи|новости)$/i;
const MAX_HTML_BYTES = 768 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60_000;
const cache = new Map<string, { expiresAt: number; sample: Promise<SiteSample | null> }>();

function isRelevantTitle(title: string): boolean {
  return title.length >= 22 && SECTOR.test(title) && (COMPLIANCE.test(title) || OPERATIONS.test(title));
}

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|amp|quot|laquo|raquo|mdash|ndash|#\d+);/gi, " ")
    .replace(/\s+/g, " ").trim();
}

function isPublicIpv4(address: string): boolean {
  const [first, second, third] = address.split(".").map(Number);
  return first > 0 && first < 224 && first !== 10 && first !== 127 &&
    !(first === 100 && second >= 64 && second <= 127) &&
    !(first === 169 && second === 254) &&
    !(first === 172 && second >= 16 && second <= 31) &&
    !(first === 192 && (second === 168 || (second === 0 && (third === 0 || third === 2)))) &&
    !(first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) &&
    !(first === 203 && second === 0 && third === 113);
}

function sameSite(url: URL, domain: string): boolean {
  return url.protocol === "https:" && !url.port && !url.username && !url.password &&
    (url.hostname === domain || url.hostname === `www.${domain}`);
}

async function loadHtml(
  url: URL,
  domain: string,
  signal: AbortSignal,
  redirects = 0,
): Promise<{ url: URL; html: string }> {
  if (!sameSite(url, domain) || redirects > 2) throw new Error("Unsupported donor URL");
  signal.throwIfAborted();
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    const abortLookup = () => reject(signal.reason);
    signal.addEventListener("abort", abortLookup, { once: true });
    void lookup(url.hostname, { family: 4, all: true }).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abortLookup));
  });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIpv4(address))) {
    throw new Error("Donor does not resolve to public IPv4");
  }
  // Pin the connection to the address we just checked. TLS still verifies the original host.
  const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    const req = request(url, {
      agent: false,
      family: 4,
      signal,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, 4);
      },
      headers: { accept: "text/html", "accept-encoding": "identity", "user-agent": "WeSetup-DonorReview/1.0" },
    }, resolve);
    req.once("error", reject);
    req.end();
  });

  const status = response.statusCode ?? 0;
  if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
    response.destroy();
    return loadHtml(new URL(response.headers.location, url), domain, signal, redirects + 1);
  }
  const contentType = response.headers["content-type"] ?? "";
  if (status !== 200 || !/^(text\/html|application\/xhtml\+xml)\b/i.test(contentType)) {
    response.destroy();
    throw new Error("Donor did not return HTML");
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response) {
    bytes += chunk.length;
    if (bytes > MAX_HTML_BYTES) {
      chunks.push(chunk.subarray(0, MAX_HTML_BYTES - bytes + chunk.length));
      break;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const charset = /charset\s*=\s*["']?(windows-1251|cp1251)/i;
  const encoding = charset.test(contentType) || charset.test(body.toString("ascii", 0, 4096))
    ? "windows-1251"
    : "utf-8";
  return { url, html: new TextDecoder(encoding).decode(body) };
}

export function collectDonorLinks(html: string, pageUrl: URL, domain: string) {
  const links = new Map<string, Publication>();
  const markup = html.replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi, " ");
  for (const anchor of markup.split(/<a\b/i).slice(1)) {
    const match = /^[^>]*?\shref\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a\s*>/i.exec(anchor);
    if (!match) continue;
    const title = visibleText(match[3]).slice(0, 220);
    if (!title) continue;
    let url: URL;
    try {
      url = new URL((match[1] ?? match[2]).replace(/&amp;/g, "&"), pageUrl);
    } catch {
      continue;
    }
    if (!sameSite(url, domain) || (url.pathname === "/" && !url.search)) continue;
    url.hash = "";
    const key = url.pathname.replace(/\/$/, "") + url.search;
    const existing = links.get(key);
    if (!existing || (isRelevantTitle(title) && !isRelevantTitle(existing.title)) ||
        (isRelevantTitle(title) === isRelevantTitle(existing.title) && title.length > existing.title.length)) {
      links.set(key, { title, url: url.href });
    }
  }
  return [...links.values()];
}

export function discoverDonorSearchUrls(html: string, pageUrl: URL, domain: string): URL[] {
  const forms = parse(html).querySelectorAll("form");
  for (const form of forms) {
    if ((form.getAttribute("method") ?? "get").toLowerCase() !== "get") continue;
    const field = form.querySelectorAll("input").find((input) =>
      /^(?:s|q|query|search|searchword|text)$/.test(input.getAttribute("name") ?? "") &&
      /search|poisk|поиск/i.test([
        input.getAttribute("type"), input.getAttribute("placeholder"),
        form.getAttribute("role"), form.getAttribute("action"), form.getAttribute("class"),
      ].join(" ")),
    );
    const name = field?.getAttribute("name");
    if (!name) continue;
    let search: URL;
    try {
      search = new URL(form.getAttribute("action") || pageUrl, pageUrl);
    } catch {
      continue;
    }
    if (!sameSite(search, domain)) continue;
    return ["общепит", "Роспотребнадзор кафе", "СанПиН"].map((keyword) => {
      const url = new URL(search);
      url.searchParams.set(name, keyword);
      return url;
    });
  }
  return [];
}

export function assessDonorPublications(
  publications: Publication[],
  targetUrl: string,
  targetKeyword: string,
): DonorSiteFit | null {
  const targetWords = (targetKeyword.toLowerCase().match(/[а-яёa-z]{5,}/g) ?? [])
    .filter((word) => !SECTOR.test(word) && !/^журнал|^электронн/.test(word));
  const seenTitles = new Set<string>();
  const seenPages = new Set<string>();
  const relevant = publications.flatMap((publication) => {
    const title = publication.title.toLowerCase();
    const content = `${title} ${publication.excerpt ?? ""}`.toLowerCase();
    const url = new URL(publication.url);
    const page = url.pathname.replace(/\/$/, "") + (url.searchParams.get("p") ?? "");
    if (seenTitles.has(title) || seenPages.has(page) || !isRelevantTitle(content)) return [];
    const compliance = COMPLIANCE.test(content);
    seenTitles.add(title);
    seenPages.add(page);
    const targetMatch = targetWords.some((word) => content.includes(word.slice(0, -2)));
    return [{ publication, targetMatch, score: 1 + Number(compliance) + Number(targetMatch) }];
  }).sort((a, b) => b.score - a.score);
  if (relevant.length < 2) return null;
  const strongest = relevant.slice(0, 3);
  return {
    version: 1,
    targetUrl,
    checkedAt: Date.now(),
    level: strongest.some((item) => item.targetMatch) ? "topic" : "audience",
    score: strongest.reduce((score, item) => score + item.score, 0),
    publications: strongest.map(({ publication: { title, url } }) => ({ title, url })),
  };
}

async function sampleSite(domain: string): Promise<SiteSample | null> {
  if (!DOMAIN.test(domain) || domain.length > 253) return null;
  const signal = AbortSignal.timeout(8000);
  const home = await loadHtml(new URL(`https://${domain}/`), domain, signal);
  const homepage = parse(home.html);
  const description = (homepage.querySelector('meta[name="description"]')?.getAttribute("content") ?? "").slice(0, 300);
  const sectionLabels = [...new Set(homepage.querySelectorAll("nav a")
    .map(link => visibleText(link.rawText).slice(0, 80)).filter(Boolean))].slice(0, 18);
  const links = collectDonorLinks(home.html, home.url, domain);
  const sectionPriority = (title: string) => SECTOR.test(title) ? 2 : Number(BUSINESS_SECTION.test(title));
  const sections = links.filter((link) => SECTION.test(link.title) || BUSINESS_SECTION.test(link.title))
    .sort((a, b) => sectionPriority(b.title) - sectionPriority(a.title))
    .slice(0, 3);
  const sectionSignal = AbortSignal.any([signal, AbortSignal.timeout(2800)]);
  const searchUrls = discoverDonorSearchUrls(home.html, home.url, domain);
  const pageUrls = [...searchUrls, ...sections.map(({ url }) => new URL(url))];
  const pages = await Promise.all(pageUrls.map(async (url, index) => {
    const section = await loadHtml(url, domain, sectionSignal);
    return collectDonorLinks(section.html, section.url, domain).filter(({ title }) =>
      isRelevantTitle(title) || (index < searchUrls.length && title.length >= 22 && SECTOR.test(title)),
    );
  }).map((page) => page.catch(() => [])));
  const candidates = [...new Map(pages.flat().concat(links.filter(({ title }) => isRelevantTitle(title)))
    .map((publication) => [publication.url, publication])).values()]
    .sort((a, b) => Number(COMPLIANCE.test(b.title)) - Number(COMPLIANCE.test(a.title)))
    .slice(0, 5);
  const verified = await Promise.all(candidates.map(async ({ url }) => {
    const page = await loadHtml(new URL(url), domain, signal);
    const article = /<(article|main)\b[^>]*>[\s\S]*?<\/\1\s*>/i.exec(page.html)?.[0] ?? page.html;
    const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(article)?.[1];
    const title = heading && visibleText(heading).slice(0, 220);
    const paragraphs = article.split(/<p\b/i).slice(1).flatMap((paragraph) => {
      const body = /^[^>]*>([\s\S]*?)<\/p\s*>/i.exec(paragraph)?.[1];
      return body ? [visibleText(body)] : [];
    }).filter((paragraph) => paragraph.length >= 120).slice(0, 4);
    if (!title || !paragraphs.length) return null;
    const excerpt = paragraphs.find((paragraph) => isRelevantTitle(`${title} ${paragraph}`));
    if (!excerpt && !isRelevantTitle(title)) return null;
    const document = parse(page.html);
    const body = document.querySelector(".entry-content, .post-content, [itemprop=articleBody], article");
    const references = collectDonorReferences(body?.querySelectorAll("a[href]") ?? [], page.url);
    const sectionLabel = document.querySelector("a[rel='category tag'], .cat-links, .td-category a")?.rawText ??
      document.querySelector('meta[property="article:section"]')?.getAttribute("content") ?? "";
    const section = visibleText(sectionLabel).slice(0, 80);
    const date = document.querySelector('meta[property="article:published_time"]')?.getAttribute("content")?.slice(0, 32);
    const canonical = document.querySelector("link[rel='canonical']")?.getAttribute("href");
    let source = visibleText(body?.rawText ?? "").match(/(?:источник|по материалам)\s*:\s*[^.\n]{3,100}/i)?.[0];
    if (!source && canonical) {
      try {
        const canonicalUrl = new URL(canonical, page.url);
        if (/^https?:$/.test(canonicalUrl.protocol) && !sameSite(canonicalUrl, domain)) source = canonicalUrl.hostname;
      } catch { /* An invalid canonical is not evidence. */ }
    }
    return { title, url: page.url.href, excerpt: excerpt?.slice(0, 500), section, date, references, source };
  }).map((page) => page.catch(() => null)));
  return { description, sections: sectionLabels, publications: verified.filter(publication => publication !== null) };
}

function collectDonorReferences(links: { getAttribute(name: string): string | undefined; rawText: string }[], page: URL) {
  const references = new Map<string, { domain: string; label: string }>();
  for (const link of links) {
    try {
      const url = new URL(link.getAttribute("href") ?? "", page);
      const domain = url.hostname.replace(/^www\./, "");
      if (!/^https?:$/.test(url.protocol) || !domain || domain === page.hostname.replace(/^www\./, "")) continue;
      references.set(domain, { domain, label: visibleText(link.rawText).slice(0, 100) });
      if (references.size >= 4) break;
    } catch {
      continue;
    }
  }
  return [...references.values()];
}

export async function assessGglDonorSite(
  domain: string,
  targetUrl: string,
  targetKeyword: string,
): Promise<DonorReviewFit | null> {
  const now = Date.now();
  let cached = cache.get(domain);
  if (!cached || cached.expiresAt <= now) {
    if (cache.size >= 256) cache.delete(cache.keys().next().value!);
    cached = {
      expiresAt: now + CACHE_TTL_MS,
      sample: sampleSite(domain).catch(() => null),
    };
    cache.set(domain, cached);
  }
  const sample = await cached.sample;
  if (!sample) return null;
  const fit = assessDonorPublications(sample.publications, targetUrl, targetKeyword);
  return fit ? { ...fit, sample } : null;
}
