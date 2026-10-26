import { promises as dns } from "node:dns";
import { isIPv6 } from "node:net";

/**
 * Search engine crawlers verified by DNS, as Google, Yandex and Bing
 * recommend: the address resolves back to a host under the engine's domain,
 * and that host resolves forward to the same address. The user-agent alone
 * proves nothing, so an unverified claim is an ordinary client. Only
 * requests whose user-agent names a crawler ever reach DNS.
 */

export type CrawlerFamily = "google" | "yandex" | "bing";

const CLAIMS: [CrawlerFamily, RegExp][] = [
  ["google", /Googlebot|Google-InspectionTool|GoogleOther|AdsBot-Google|Mediapartners-Google|Storebot-Google|APIs-Google/i],
  // Bot tokens only: the Yandex apps people browse with («YandexSearch», «YaBrowser») stay ordinary clients.
  ["yandex", /\bYandex[A-Za-z]*Bot\b|YandexImages|YandexMetrika|YandexWebmaster|YandexFavicons|YandexPagesChecker|YandexVideo|YandexMedia/],
  ["bing", /bingbot|BingPreview|msnbot|adidxbot/i],
];

const DOMAINS: Record<CrawlerFamily, string[]> = {
  // Not googleusercontent.com: any Google Cloud VM resolves under it.
  google: [".googlebot.com", ".google.com"],
  yandex: [".yandex.ru", ".yandex.net", ".yandex.com"],
  bing: [".search.msn.com"],
};

const POSITIVE_TTL = 24 * 60 * 60_000;
const NEGATIVE_TTL = 60 * 60_000;
const MAX_CACHE = 5_000;
const MAX_IN_FLIGHT = 16;
/** Per DNS query; a whole check (reverse, then forward) gets twice that. */
const TIMEOUT = 1_000;

/** The engine a user-agent claims to be, before any check. */
export function claimedCrawler(userAgent: string | null): CrawlerFamily | null {
  if (!userAgent) return null;
  for (const [family, pattern] of CLAIMS) if (pattern.test(userAgent)) return family;
  return null;
}

export type CrawlerResolver = {
  reverse(ip: string): Promise<string[]>;
  lookup(host: string): Promise<string[]>;
};

// c-ares queries, never `dns.lookup`: that one blocks a libuv thread the
// whole process shares with the file system and crypto.
const dnsResolver = new dns.Resolver({ timeout: TIMEOUT, tries: 1 });
const systemResolver: CrawlerResolver = {
  reverse: (ip) => dnsResolver.reverse(ip),
  lookup: async (host) => {
    const [v4, v6] = await Promise.allSettled([dnsResolver.resolve4(host), dnsResolver.resolve6(host)]);
    return [...(v4.status === "fulfilled" ? v4.value : []), ...(v6.status === "fulfilled" ? v6.value : [])];
  },
};

/** One spelling per address: IPv6 lower-case and compressed, without brackets. */
function canonical(ip: string): string {
  const bare = ip.replace(/^\[|\]$/g, "");
  return isIPv6(bare) ? new URL(`http://[${bare}]`).hostname.slice(1, -1) : bare;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Process-local cache of verdicts; failures count as "not a crawler". */
export function createCrawlerVerifier(resolver: CrawlerResolver = systemResolver, now = Date.now) {
  const cache = new Map<string, { ok: boolean; until: number }>();
  const inFlight = new Map<string, Promise<boolean>>();

  async function resolve(ip: string, family: CrawlerFamily): Promise<boolean> {
    const hosts = await resolver.reverse(ip);
    for (const host of hosts.slice(0, 4)) {
      const name = host.toLowerCase().replace(/\.$/, "");
      if (!DOMAINS[family].some((suffix) => name.endsWith(suffix))) continue;
      const addresses = await resolver.lookup(name);
      if (addresses.some((address) => canonical(address) === ip)) return true;
    }
    return false;
  }

  function remember(key: string, ok: boolean) {
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(key, { ok, until: now() + (ok ? POSITIVE_TTL : NEGATIVE_TTL) });
  }

  return {
    async verify(address: string, family: CrawlerFamily): Promise<boolean> {
      const ip = canonical(address);
      const key = `${family}:${ip}`;
      const cached = cache.get(key);
      if (cached && cached.until > now()) return cached.ok;
      const pending = inFlight.get(key);
      if (pending) return pending;
      // Too many checks at once: answer "not verified" without asking DNS.
      if (inFlight.size >= MAX_IN_FLIGHT) return false;
      const check = withTimeout(resolve(ip, family), TIMEOUT * 2)
        .catch(() => false)
        .then((ok) => {
          remember(key, ok);
          return ok;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, check);
      return check;
    },
  };
}
