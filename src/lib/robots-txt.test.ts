import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { CITIES } from "@/content/cities";
import { COMPARISONS } from "@/content/comparisons";
import { FEATURES_ORDER } from "@/content/features";
import { GLOSSARY } from "@/content/glossary";
import { JOURNAL_INFO } from "@/content/journal-info";
import { NICHES } from "@/content/niches";
import { SEO_LANDINGS } from "@/content/seo-landings";
import { INDEXNOW_KEY } from "@/lib/indexnow";
import {
  isAllowedByRobots,
  isPublicCacheablePage,
  renderRobotsTxt,
  ROBOTS_CLEAN_PARAMS,
} from "@/lib/robots-txt";

describe("robots.txt crawl rules", () => {
  it("renders Yandex Clean-param, Host, and Sitemap directives", () => {
    const txt = renderRobotsTxt();
    assert.match(txt, /^User-Agent: \*/m);
    assert.match(txt, /^Allow: \/$/m);
    assert.ok(txt.includes(`Clean-param: ${ROBOTS_CLEAN_PARAMS}`));
    assert.match(txt, /^Host: https:\/\/wesetup\.ru$/m);
    assert.match(txt, /^Sitemap: https:\/\/wesetup\.ru\/sitemap\.xml$/m);
  });

  it("allows every public route in sitemap and social preview endpoints", () => {
    const publicPaths = [
      "/",
      "/en",
      "/uz",
      "/llms.txt",
      "/sanpin-2-3-2-4-4282-26",
      "/avtozapolnenie",
      "/security",
      "/status",
      "/pricing",
      "/blanki",
      "/prikazy",
      "/uslugi",
      "/partners",
      "/partner-agreement",
      "/en/partners",
      "/uz/partners",
      "/developers",
      "/whats-new",
      "/whats-new/feed.xml",
      "/blog",
      "/en/blog",
      "/uz/blog",
      "/blog/feed.xml",
      "/blog/chek-list-priemki-syrya-v-restorane",
      "/calc/journals",
      "/calc/fines",
      "/compare",
      "/glossary",
      "/journals-info",
      "/en/journals-info",
      "/uz/journals-info",
      "/oferta",
      "/privacy",
      "/terms",
      "/consent",
      "/delete-account",
      "/setup-helper/privacy",
      "/og-default",
      "/og/landing/ru",
      "/b/demo-badge",
      "/google192cf36dfa933fa5.html",
      "/yandex_66925265b553c7d1.html",
      `/${INDEXNOW_KEY}.txt`,
      ...Object.keys(JOURNAL_INFO).flatMap((code) => [
        `/journals-info/${code}`,
        `/en/journals-info/${code}`,
        `/uz/journals-info/${code}`,
      ]),
      ...Object.values(NICHES).map((n) => `/${n.slug}`),
      ...Object.values(SEO_LANDINGS).map((s) => `/${s.slug}`),
      ...FEATURES_ORDER.flatMap((slug) => [
        `/features/${slug}`,
        `/en/features/${slug}`,
        `/uz/features/${slug}`,
      ]),
      ...Object.keys(COMPARISONS).map((slug) => `/compare/${slug}`),
      ...GLOSSARY.map((term) => `/glossary/${term.slug}`),
      ...Object.keys(CITIES).map((city) => `/v/${city}`),
    ];

    const blocked = publicPaths.filter((p) => !isAllowedByRobots(p));
    assert.deepEqual(blocked, [], `Public paths blocked by robots.txt: ${blocked.join(", ")}`);

    const gscFile = path.resolve(process.cwd(), "public/google192cf36dfa933fa5.html");
    assert.equal(
      fs.readFileSync(gscFile, "utf8").trim(),
      "google-site-verification: google192cf36dfa933fa5.html",
    );

    const yandexFile = path.resolve(process.cwd(), "public/yandex_66925265b553c7d1.html");
    assert.match(fs.readFileSync(yandexFile, "utf8"), /Verification:\s*66925265b553c7d1/);
  });

  it("blocks private workspace, admin, API, and tokenized routes", () => {
    const privatePaths = [
      "/api/status",
      "/api/journal-samples/hygiene/pdf",
      "/root",
      "/root/organizations",
      "/admin",
      "/admin/blog",
      "/dashboard",
      "/journals",
      "/journals/hygiene",
      "/journals-progress",
      "/settings",
      "/partner",
      "/partner/clients",
      "/p/consultant-demo",
      "/master",
      "/master/points",
      "/sanpin",
      "/sanpin/audit",
      "/inspection",
      "/inspection/bundle",
      "/orders",
      "/orders/list",
      "/order/tok-123",
      "/kp/tok-123",
      "/policy/tok-123",
      "/pair/tok-123",
      "/payment/success",
      "/promo/PARTNER10",
      "/q/short",
      "/qb/short",
      "/qj/short",
      "/r/short",
      "/unsubscribe/tok-123",
      "/inspector/tok-123",
      "/inspector-sheet/tok-123",
      "/mini",
      "/max/connect",
      "/room-fill/123",
      "/equipment-fill/123",
      "/task-fill/123",
      "/journal-fill/123",
    ];

    const leaked = privatePaths.filter((p) => isAllowedByRobots(p));
    assert.deepEqual(leaked, [], `Private paths allowed by robots.txt: ${leaked.join(", ")}`);
  });

  it("marks only public marketing and content pages as cacheable", () => {
    for (const cacheable of [
      "/",
      "/en",
      "/uz",
      "/pricing",
      "/blog",
      "/en/blog/article-slug",
      "/journals-info",
      "/journals-info/hygiene",
      "/en/journals-info/hygiene",
      "/features",
      "/features/ai-autofill",
      "/partners",
      "/en/partners",
      "/privacy",
      "/uz/privacy",
      "/blanki",
      "/prikazy",
      "/uslugi",
      "/avtozapolnenie",
      "/sanpin-2-3-2-4-4282-26",
      "/dlya-kafe",
      "/zhurnal-haccp",
      "/v/moskva",
      "/compare/excel",
      "/glossary/haccp",
      "/calc/fines",
    ]) {
      assert.equal(isPublicCacheablePage(cacheable), true, cacheable);
    }

    for (const nonCacheable of [
      "/login",
      "/en/login",
      "/register",
      "/en/register",
      "/delete-account",
      "/en/delete-account",
      "/kiosk/123",
      "/payment",
      "/en/root",
      "/en/dashboard",
      "/en/payment",
      "/dashboard",
      "/journals",
      "/settings",
      "/root",
      "/master",
      "/mini",
      "/api/status",
      "/order/tok-123",
      "/kp/tok-123",
      "/q/short",
    ]) {
      assert.equal(isPublicCacheablePage(nonCacheable), false, nonCacheable);
    }
  });
});

