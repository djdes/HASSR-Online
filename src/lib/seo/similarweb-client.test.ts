import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import Module from "node:module";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import test from "node:test";
import { parseSite } from "api-anything";
import { isPublicSeoTargetAllowed } from "@/lib/seo/gogetlinks-planner";
import {
  buildCompetitorBenchmarkReport,
  mapSimilarwebPhraseToWesetupUrl,
  parseSimilarwebApiPayload,
  parseSimilarwebCookieInput,
  toCanonicalPublicWesetupPath,
} from "@/lib/seo/similarweb-client";
import {
  callSimilarwebRead,
  fetchSimilarwebSnapshotViaApiAnything,
  getSimilarwebConnectionStatus,
  initSimilarwebApiAnythingHome,
  saveSimilarwebConnection,
  SimilarwebAuthError,
  SimilarwebCallError,
} from "@/lib/seo/similarweb-client.server";

const requireCjs = Module.createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../..");

function loadRouteFixture<T>(
  relativeFile: string,
  mocks: Record<string, unknown>,
): T {
  const targetPath = path.join(REPO_ROOT, relativeFile);
  const internalModule = Module as unknown as {
    _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
    _cache: Record<string, NodeModule>;
  };

  const originalLoad = internalModule._load;
  delete internalModule._cache[targetPath];

  internalModule._load = function patchedLoad(request, parent, isMain) {
    if (request in mocks) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return requireCjs(targetPath) as T;
  } finally {
    internalModule._load = originalLoad;
  }
}

test("config/api-anything/sites/similarweb.json passes api-anything parseSite validation", () => {
  const specPath = join(
    process.cwd(),
    "config",
    "api-anything",
    "sites",
    "similarweb.json",
  );
  const raw = JSON.parse(readFileSync(specPath, "utf8"));
  const site = parseSite(raw);
  assert.equal(site.name, "similarweb");
  assert.equal(site.displayName, "Similarweb");
  const opNames = site.operations.map((o) => o.name);
  assert.deepEqual(opNames, [
    "getDomainOverview",
    "getWebsiteAnalysis",
    "getProSearchKeywords",
  ]);
  for (const op of site.operations) {
    assert.equal(op.readOnly, true);
    assert.equal(op.minTier, 1);
  }
});

test("mapSimilarwebPhraseToWesetupUrl maps search keywords to canonical 200 OK public URLs without 301 slugs or private routes", () => {
  const cases: Array<[string, string]> = [
    ["бракеражный журнал готовой продукции", "/journals-info/finished_product"],
    ["бактерицидный журнал уф ламп", "/journals-info/uv_lamp_runtime"],
    ["журнал проведения генеральных уборок", "/journals-info/general_cleaning"],
    ["гигиенический журнал здоровья сотрудников", "/journals-info/health_check"],
    ["журнал входного контроля сырья", "/journals-info/incoming_control"],
    ["журнал учета температуры и влажности", "/journals-info/climate_control"],
    ["температурный лист холодильника", "/journals-info/cold_equipment_control"],
    ["журнал учета фритюрных жиров", "/journals-info/fryer_oil"],
    ["санпин 2.3/2.4.4282-26 для общепита", "/sanpin-2-3-2-4-4282-26"],
    ["хассп журналы и их заполнение", "/journals-info"],
    ["журналы по хассп для пищевого производства", "/calc/journals"],
    ["приказы по хассп для общепита", "/prikazy"],
    ["разработка хассп и ппк под ключ", "/uslugi"],
  ];

  for (const [phrase, expectedUrl] of cases) {
    const mapped = mapSimilarwebPhraseToWesetupUrl(phrase);
    assert.equal(mapped, expectedUrl, `Mismatch for phrase: "${phrase}"`);
    assert.equal(
      isPublicSeoTargetAllowed(mapped),
      true,
      `Mapped URL ${mapped} must be a public SEO target`,
    );
  }

  // Remaps 301-merged slugs and private routes
  assert.equal(
    toCanonicalPublicWesetupPath("/brakerazhnyy-zhurnal"),
    "/journals-info/finished_product",
  );
  assert.equal(
    toCanonicalPublicWesetupPath("/zhurnal-uborki"),
    "/journals-info/cleaning",
  );
  assert.equal(
    toCanonicalPublicWesetupPath("/sanpin"),
    "/sanpin-2-3-2-4-4282-26",
  );
  assert.equal(toCanonicalPublicWesetupPath("/journals"), "/journals-info");
});

test("parseSimilarwebCookieInput parses raw Cookie headers and JSON cookie arrays", () => {
  const fromHeader = parseSimilarwebCookieInput(
    "Cookie: aws-waf-token=tok_123; sw_Session=sess_456; Path=/; Secure; HttpOnly",
  );
  assert.equal(fromHeader.length, 2);
  assert.equal(fromHeader[0].name, "aws-waf-token");
  assert.equal(fromHeader[0].value, "tok_123");
  assert.equal(fromHeader[1].name, "sw_Session");
  assert.equal(fromHeader[1].value, "sess_456");

  const fromJson = parseSimilarwebCookieInput(
    JSON.stringify([
      {
        name: "aws-waf-token",
        value: "json_waf",
        domain: ".similarweb.com",
        path: "/",
      },
      {
        name: ".SGTOKEN",
        value: "sg_999",
        domain: "pro.similarweb.com",
      },
    ]),
  );
  assert.equal(fromJson.length, 2);
  assert.equal(fromJson[0].domain, "similarweb.com");
  assert.equal(fromJson[1].name, ".SGTOKEN");
});

test("parseSimilarwebApiPayload normalizes Engagments, TrafficSources, and TopKeywords ratios into percentages", () => {
  const snapshot = parseSimilarwebApiPayload("https://www.haccp-online.ru/", {
    SiteName: "haccp-online.ru",
    Engagments: {
      Visits: 16450.4,
      BounceRate: 0.3842,
      PagePerVisit: 2.456,
      Month: "11",
      Year: "2026",
    },
    TrafficSources: {
      Search: 0.142,
      "Paid Referrals": 0.256,
    },
    TopKeywords: [
      {
        Name: "бракеражный журнал готовой продукции",
        Share: 0.194,
        Cpc: 1.25,
      },
      {
        Name: "бактерицидный журнал",
        Share: 0.085,
        Cpc: 0,
      },
    ],
  });

  assert.equal(snapshot.domain, "haccp-online.ru");
  assert.equal(snapshot.periodLabel, "Sep–Nov 2026");
  assert.equal(snapshot.visitsMonthly, 16450);
  assert.equal(snapshot.organicSharePct, 14.2);
  assert.equal(snapshot.paidSharePct, 25.6);
  assert.equal(snapshot.bouncePct, 38.42);
  assert.equal(snapshot.pagesPerVisit, 2.46);
  assert.equal(snapshot.clusters.length, 2);
  assert.equal(snapshot.clusters[0].phrase, "бракеражный журнал готовой продукции");
  assert.equal(snapshot.clusters[0].trafficSharePct, 19.4);
  assert.equal(snapshot.clusters[0].channel, "paid");
  assert.equal(
    snapshot.clusters[0].mappedTargetUrl,
    "/journals-info/finished_product",
  );
  assert.equal(snapshot.clusters[1].channel, "organic");
  assert.equal(
    snapshot.clusters[1].mappedTargetUrl,
    "/journals-info/uv_lamp_runtime",
  );
});

test("fetchSimilarwebSnapshotViaApiAnything executes api-anything operations and merges Pro keywords", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "wesetup-sw-test-"));
  const prevHome = process.env.API_ANYTHING_HOME;
  const prevSecret = process.env.INTEGRATION_KEY_SECRET;
  process.env.API_ANYTHING_HOME = tempHome;
  process.env.INTEGRATION_KEY_SECRET = "test-integration-secret-key-32-chars!";

  try {
    initSimilarwebApiAnythingHome();
    const conn = saveSimilarwebConnection({
      cookieInput: "aws-waf-token=waf_ok; sw_Session=pro_ok",
      apiKey: "sw_api_key_test",
    });
    assert.equal(conn.configured, true);
    assert.equal(conn.cookieCount, 2);
    assert.equal(conn.hasApiKey, true);

    const requestedUrls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(url);

      if (url.includes("data.similarweb.com/api/v1/data")) {
        return new Response(
          JSON.stringify({
            SiteName: "haccp-online.ru",
            Engagments: {
              Visits: 19200,
              BounceRate: 0.351,
              PagePerVisit: 3.1,
              Month: "10",
              Year: "2026",
            },
            TrafficSources: {
              "Organic Search": 0.412,
              "Paid Search": 0.189,
            },
            TopKeywords: [
              {
                Name: "санпин для общепита",
                Share: 0.11,
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.includes("pro.similarweb.com/widgetApi/SearchKeywords")) {
        return new Response(
          JSON.stringify({
            Data: [
              {
                SearchTerm: "бракеражный журнал готовой продукции",
                TotalShare: 0.225,
                Organic: 0.05,
                Paid: 0.95,
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("Not Found", { status: 404 });
    };

    const snapshot = await fetchSimilarwebSnapshotViaApiAnything(
      "haccp-online.ru",
      {
        fetchImpl: mockFetch,
        minIntervalMs: 0,
      },
    );

    assert.equal(snapshot.domain, "haccp-online.ru");
    assert.equal(snapshot.periodLabel, "Aug–Oct 2026");
    assert.equal(snapshot.visitsMonthly, 19200);
    assert.equal(snapshot.organicSharePct, 41.2);
    assert.equal(snapshot.paidSharePct, 18.9);
    assert.equal(snapshot.clusters.length, 2);
    assert.equal(
      snapshot.clusters[0].phrase,
      "бракеражный журнал готовой продукции",
    );
    assert.equal(snapshot.clusters[0].channel, "paid");
    assert.equal(
      snapshot.clusters[0].mappedTargetUrl,
      "/journals-info/finished_product",
    );
    assert.equal(snapshot.clusters[1].phrase, "санпин для общепита");
    assert.equal(
      snapshot.clusters[1].mappedTargetUrl,
      "/sanpin-2-3-2-4-4282-26",
    );

    // Verify API key was attached and both overview + Pro keywords were called
    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[0], /domain=haccp-online\.ru/);
    assert.match(requestedUrls[0], /api_key=sw_api_key_test/);
    assert.match(requestedUrls[1], /keys=haccp-online\.ru/);

    const afterStatus = getSimilarwebConnectionStatus();
    assert.ok(afterStatus.lastSyncedAt);
    assert.equal(afterStatus.lastError, null);
  } finally {
    if (prevHome === undefined) delete process.env.API_ANYTHING_HOME;
    else process.env.API_ANYTHING_HOME = prevHome;
    if (prevSecret === undefined) delete process.env.INTEGRATION_KEY_SECRET;
    else process.env.INTEGRATION_KEY_SECRET = prevSecret;
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test("callSimilarwebRead classifies CloudFront 403 / AWS WAF 202 as SimilarwebCallError(blocked) and 401 as SimilarwebAuthError", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "wesetup-sw-err-"));
  const prevHome = process.env.API_ANYTHING_HOME;
  process.env.API_ANYTHING_HOME = tempHome;

  try {
    initSimilarwebApiAnythingHome();

    // 1. AWS WAF 202 challenge
    const wafFetch: typeof fetch = async () =>
      new Response(
        "<!DOCTYPE html><html><head><script>window.awsWafCookieDomainList=['.similarweb.com']</script></head><body></body></html>",
        { status: 202, headers: { "content-type": "text/html" } },
      );

    await assert.rejects(
      () =>
        callSimilarwebRead(
          "getDomainOverview",
          { domain: "haccp-online.ru" },
          { fetchImpl: wafFetch, minIntervalMs: 0 },
        ),
      (err: unknown) => {
        assert.ok(err instanceof SimilarwebCallError);
        assert.equal(err.swClass, "blocked");
        assert.match(err.message, /CloudFront|AWS WAF/i);
        return true;
      },
    );

    // 2. HTTP 401 unauthorized
    const authFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });

    await assert.rejects(
      () =>
        callSimilarwebRead(
          "getProSearchKeywords",
          { domain: "haccp-online.ru" },
          { fetchImpl: authFetch, minIntervalMs: 0 },
        ),
      (err: unknown) => {
        assert.ok(err instanceof SimilarwebAuthError);
        return true;
      },
    );
  } finally {
    if (prevHome === undefined) delete process.env.API_ANYTHING_HOME;
    else process.env.API_ANYTHING_HOME = prevHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test("POST /api/root/gogetlinks/similarweb supports action=sync_domain and action=save_connection via api-anything", async () => {
  const auditEvents: Array<Record<string, unknown>> = [];
  const snapshotStore = new Map<string, Record<string, unknown>>();

  const mockDb = {
    seoCompetitorSnapshot: {
      findMany: async () => [...snapshotStore.values()],
      upsert: async (args: {
        where: { domain_periodLabel: { domain: string; periodLabel: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = `${args.where.domain_periodLabel.domain}::${args.where.domain_periodLabel.periodLabel}`;
        const row = {
          id: `snap_${snapshotStore.size + 1}`,
          createdAt: new Date("2026-11-26T06:00:00.000Z"),
          ...args.create,
          ...args.update,
        };
        snapshotStore.set(key, row);
        return row;
      },
    },
    gglOrder: { findMany: async () => [] },
    article: { findMany: async () => [] },
  };

  let savedConnCookieInput: string | null | undefined = null;

  const routeModule = loadRouteFixture<{
    runtime: string;
    dynamic: string;
    maxDuration: number;
    GET: (req: Request) => Promise<Response>;
    POST: (req: Request) => Promise<Response>;
  }>("src/app/api/root/gogetlinks/similarweb/route.ts", {
    "@/lib/auth-helpers": {
      requireRoot: async () => ({
        user: { id: "u_root", name: "Root SEO", email: "root@wesetup.ru", isRoot: true },
      }),
    },
    "@/lib/db": { db: mockDb },
    "@/lib/audit-helper": {
      audit: async (args: Record<string, unknown>) => {
        auditEvents.push(args);
      },
    },
    "@/lib/seo/similarweb-seed": {
      ensureDefaultSimilarwebSnapshots: async () => 0,
    },
    "@/lib/topvisor": {
      isTopvisorConfigured: () => false,
      getPositionsHistory: async () => ({ dates: [], existsDates: [], rows: [] }),
    },
    "@/lib/seo/gogetlinks-planner": requireCjs("./gogetlinks-planner.ts"),
    "@/lib/seo/gogetlinks-article-ai.server": requireCjs("./gogetlinks-article-ai.server.ts"),
    "@/lib/seo/similarweb-client.server": {
      SimilarwebAuthError,
      SimilarwebCallError,
      getSimilarwebConnectionStatus: () => ({
        configured: Boolean(savedConnCookieInput),
        hasCookies: Boolean(savedConnCookieInput),
        hasApiKey: false,
        cookieCount: savedConnCookieInput ? 2 : 0,
        cookieNames: savedConnCookieInput ? ["aws-waf-token", "sw_Session"] : [],
        updatedAt: "2026-11-26T06:00:00.000Z",
        lastSyncedAt: "2026-11-26T06:00:00.000Z",
        lastError: null,
        operations: ["getDomainOverview", "getWebsiteAnalysis", "getProSearchKeywords"],
      }),
      saveSimilarwebConnection: (input: { cookieInput?: string | null }) => {
        savedConnCookieInput = input.cookieInput;
        return {
          configured: true,
          hasCookies: true,
          hasApiKey: false,
          cookieCount: 2,
          cookieNames: ["aws-waf-token", "sw_Session"],
          updatedAt: "2026-11-26T06:00:00.000Z",
          lastSyncedAt: null,
          lastError: null,
          operations: ["getDomainOverview", "getWebsiteAnalysis", "getProSearchKeywords"],
        };
      },
      fetchSimilarwebSnapshotViaApiAnything: async (domain: string) => ({
        domain,
        periodLabel: "Sep–Nov 2026",
        visitsMonthly: 21400,
        organicSharePct: 58.4,
        paidSharePct: 14.2,
        bouncePct: 37.5,
        pagesPerVisit: 2.8,
        clusters: [
          {
            phrase: "бракеражный журнал готовой продукции",
            trafficSharePct: 21.3,
            channel: "organic",
            mappedTargetUrl: "/journals-info/finished_product",
            notes: "Импорт Similarweb (api-anything)",
          },
        ],
      }),
    },
  });

  // 1. Save connection cookies
  const connRes = await routeModule.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/similarweb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "save_connection",
        cookieInput: "aws-waf-token=abc; sw_Session=def",
      }),
    }),
  );
  assert.equal(connRes.status, 200);
  const connJson = await connRes.json();
  assert.equal(connJson.similarwebConnection.configured, true);
  assert.equal(connJson.similarwebConnection.cookieCount, 2);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, "ggl.similarweb.connection");

  // 2. Sync domain via api-anything
  const syncRes = await routeModule.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/similarweb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "sync_domain",
        domains: ["haccp-online.ru", "wesetup.ru"],
      }),
    }),
  );
  assert.equal(syncRes.status, 200);
  const syncJson = await syncRes.json();
  assert.equal(syncJson.snapshots.length, 2);
  assert.equal(syncJson.snapshot.domain, "haccp-online.ru");
  assert.equal(syncJson.snapshot.visitsMonthly, 21400);
  assert.equal(syncJson.snapshot.sourceKind, "agent_import");
  assert.equal(auditEvents.length, 3);
  assert.equal(auditEvents[1].action, "ggl.similarweb.import");
  assert.equal((auditEvents[1].details as { via?: string }).via, "api-anything");
});

test("buildCompetitorBenchmarkReport compares wesetup.ru against competitors and classifies cluster gaps", () => {
  const report = buildCompetitorBenchmarkReport({
    snapshots: [
      {
        id: "snap_ws",
        domain: "wesetup.ru",
        periodLabel: "Jul–Sep 2026",
        visitsMonthly: 800,
        organicSharePct: 54.0,
        paidSharePct: 12.0,
        bouncePct: 39.5,
        pagesPerVisit: 2.1,
        sourceKind: "agent_import",
        clusters: [
          {
            phrase: "бактерицидный журнал",
            trafficSharePct: 10.5,
            channel: "organic",
            mappedTargetUrl: "/journals-info/uv_lamp_runtime",
          },
        ],
      },
      {
        id: "snap_haccp",
        domain: "haccp-online.ru",
        periodLabel: "Jul–Sep 2026",
        visitsMonthly: 16000,
        organicSharePct: 32.0,
        paidSharePct: 28.0,
        bouncePct: 42.0,
        pagesPerVisit: 2.4,
        sourceKind: "agent_import",
        clusters: [
          {
            phrase: "журнал учета фритюрных жиров",
            trafficSharePct: 15.0,
            channel: "organic",
            mappedTargetUrl: "/zhurnal-frityurnyh-zhirov",
          },
          {
            phrase: "бракеражный журнал готовой продукции",
            trafficSharePct: 25.0,
            channel: "paid",
            mappedTargetUrl: "/journals-info/finished_product",
          },
          {
            phrase: "бактерицидный журнал",
            trafficSharePct: 5.0,
            channel: "organic",
            mappedTargetUrl: "/journals-info/uv_lamp_runtime",
          },
        ],
      },
    ],
    topvisorRows: [
      {
        phrase: "журнал учета фритюрных жиров",
        yandexPos: 9,
        googlePos: "--",
        relevantUrl: "/journals-info/fryer_oil",
      },
      {
        phrase: "бактерицидный журнал",
        yandexPos: 2,
        googlePos: 3,
        relevantUrl: "/journals-info/uv_lamp_runtime",
      },
    ],
    existingOrders: [
      {
        targetUrl: "/journals-info/uv_lamp_runtime",
        status: "paid",
      },
    ],
  });

  assert.equal(report.ownDomain, "wesetup.ru");
  assert.equal(report.ownVisitsMonthly, 800);
  assert.equal(report.domains.length, 2);
  assert.equal(report.domains[0].domain, "wesetup.ru");
  assert.equal(report.domains[1].domain, "haccp-online.ru");
  assert.equal(report.domains[1].visitsRatioVsWesetup, 20);

  // Cluster gaps:
  // 1) "журнал учета фритюрных жиров" -> mapped from 301 /zhurnal-frityurnyh-zhirov to /journals-info/fryer_oil, pos #9 -> push_top3
  // 2) "бракеражный журнал готовой продукции" -> unranked, 0 links -> gap_no_rank
  // 3) "бактерицидный журнал" -> pos #2 -> leader
  assert.equal(report.clusterGaps.length, 3);
  assert.equal(report.clusterGaps[0].verdict, "push_top3");
  assert.equal(report.clusterGaps[0].mappedTargetUrl, "/journals-info/fryer_oil");
  assert.equal(report.clusterGaps[0].yandexPos, 9);

  assert.equal(report.clusterGaps[1].verdict, "gap_no_rank");
  assert.equal(report.clusterGaps[1].mappedTargetUrl, "/journals-info/finished_product");
  assert.equal(report.clusterGaps[1].estimatedMonthlyTraffic, 4000);

  assert.equal(report.clusterGaps[2].verdict, "leader");
  assert.equal(report.clusterGaps[2].wesetupSharePct, 10.5);
  assert.equal(report.summary.pushTop3Count, 1);
  assert.equal(report.summary.gapNoRankCount, 1);
  assert.equal(report.summary.leaderCount, 1);
});

