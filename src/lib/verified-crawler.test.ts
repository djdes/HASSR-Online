import assert from "node:assert/strict";
import { test } from "node:test";
import { claimedCrawler, createCrawlerVerifier, type CrawlerResolver } from "./verified-crawler";

function resolver(reverse: Record<string, string[]>, forward: Record<string, string[]>, calls: string[] = []): CrawlerResolver {
  return {
    async reverse(ip) {
      calls.push(`reverse ${ip}`);
      if (!reverse[ip]) throw new Error("ENOTFOUND");
      return reverse[ip];
    },
    async lookup(host) {
      calls.push(`lookup ${host}`);
      return forward[host] ?? [];
    },
  };
}

test("only crawler tokens count as a claim, not apps people browse with", () => {
  assert.equal(claimedCrawler("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), "google");
  assert.equal(claimedCrawler("Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)"), "yandex");
  assert.equal(claimedCrawler("Mozilla/5.0 (compatible; YandexRenderResourcesBot/1.0)"), "yandex");
  assert.equal(claimedCrawler("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"), "bing");
  for (const ua of [null, "Mozilla/5.0 Chrome/130 YaBrowser/24.1", "Mozilla/5.0 YandexSearch/23.10 Mobile", "curl/8", "Mozilla/5.0 Chrome/130"]) {
    assert.equal(claimedCrawler(ua), null, String(ua));
  }
});

test("a crawler is verified by reverse DNS under its domain and the same address forward", async () => {
  const verify = createCrawlerVerifier(resolver(
    { "66.249.66.1": ["crawl-66-249-66-1.googlebot.com"], "5.255.231.1": ["5-255-231-1.spider.yandex.com."], "203.0.113.9": ["crawl.googlebot.com.evil.example"], "203.0.113.10": ["fake.googlebot.com"] },
    { "crawl-66-249-66-1.googlebot.com": ["66.249.66.1"], "5-255-231-1.spider.yandex.com": ["5.255.231.1"], "fake.googlebot.com": ["66.249.66.2"] },
  ));
  assert.equal(await verify.verify("66.249.66.1", "google"), true);
  assert.equal(await verify.verify("5.255.231.1", "yandex"), true);
  assert.equal(await verify.verify("66.249.66.1", "yandex"), false, "the domain must belong to the claimed engine");
  assert.equal(await verify.verify("203.0.113.9", "google"), false, "a suffix in the middle is not the domain");
  assert.equal(await verify.verify("203.0.113.10", "google"), false, "the forward lookup must return the same address");
  assert.equal(await verify.verify("198.51.100.1", "google"), false, "no PTR record");
  const cloud = createCrawlerVerifier(resolver({ "34.1.2.3": ["3.2.1.34.bc.googleusercontent.com"] }, { "3.2.1.34.bc.googleusercontent.com": ["34.1.2.3"] }));
  assert.equal(await cloud.verify("34.1.2.3", "google"), false, "a Google Cloud VM is not Googlebot");
});

test("IPv6 crawlers: the proxy's bracketed address matches any spelling of the forward answer", async () => {
  const verify = createCrawlerVerifier(resolver(
    { "2001:4860:4801:10::1": ["crawl-2001-4860-4801-10--1.googlebot.com"] },
    { "crawl-2001-4860-4801-10--1.googlebot.com": ["2001:4860:4801:10:0:0:0:1"] },
  ));
  assert.equal(await verify.verify("[2001:4860:4801:10::1]", "google"), true);
});

test("verdicts are cached, failures are negative, and a slow DNS gives up", async () => {
  const calls: string[] = [];
  let now = 0;
  const verify = createCrawlerVerifier(resolver({ "66.249.66.1": ["a.googlebot.com"] }, { "a.googlebot.com": ["66.249.66.1"] }, calls), () => now);
  assert.equal(await verify.verify("66.249.66.1", "google"), true);
  assert.equal(await verify.verify("66.249.66.1", "google"), true);
  assert.equal(calls.length, 2, "the second answer comes from the cache");
  now = 25 * 60 * 60_000;
  await verify.verify("66.249.66.1", "google");
  assert.equal(calls.length, 4, "a day later it is checked again");

  const hanging = createCrawlerVerifier({ reverse: () => new Promise(() => undefined), lookup: async () => [] });
  const started = Date.now();
  assert.equal(await hanging.verify("66.249.66.9", "google"), false);
  assert.ok(Date.now() - started < 3_000);
});

test("too many checks at once are answered without DNS, concurrent ones share a lookup", async () => {
  const calls: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const verify = createCrawlerVerifier({
    reverse: async (ip) => {
      calls.push(ip);
      await gate;
      return [];
    },
    lookup: async () => [],
  });
  const pending = Array.from({ length: 16 }, (_, index) => verify.verify(`198.51.100.${index}`, "google"));
  const same = verify.verify("198.51.100.0", "google");
  assert.equal(await verify.verify("198.51.100.200", "google"), false);
  assert.equal(calls.length, 16, "the seventeenth address never reached DNS");
  release();
  assert.deepEqual(await Promise.all([...pending, same]), Array(17).fill(false));
});
