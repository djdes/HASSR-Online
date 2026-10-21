import assert from "node:assert/strict";
import test from "node:test";
import {
  DIRECT_CAMPAIGNS, DIRECT_REGISTRATION_GOAL, DIRECT_ATTRIBUTION,
  DirectReportError, DirectRangeError, buildDirectReport, directTotals, moscowDate,
  parseDirectReport, validateDirectRange,
} from "./yandex-direct-report";
import { DirectApiError, DirectStatsReader } from "./yandex-direct-stats.server";
import { createDirectStatsHandler } from "./yandex-direct-handler";

const range = { from: "2026-10-19", to: "2026-10-21" };
const conversionColumn = `Conversions_${DIRECT_REGISTRATION_GOAL}_${DIRECT_ATTRIBUTION}`;
const header = `Date\tCampaignId\tCampaignName\tImpressions\tClicks\tCost\t${conversionColumn}`;
const tsv = `${header}\r\n2026-10-20\t715271358\tWeSetup Search\t100\t10\t10.10\t1\r\n2026-10-21\t715282028\tWeSetup Network\t1000\t1\t5.20\t0.5\r\n2026-10-21\t715283243\tOrdersFlow\t99999\t99999\t99999\t99999\r\n`;
const metadata = DIRECT_CAMPAIGNS.map(campaign => ({ id: campaign.id, name: campaign.name, state: "ON", status: "ACCEPTED" }));
const campaignsResponse = () => Response.json({ result: { Campaigns: metadata.map(campaign => ({ Id: campaign.id, Name: campaign.name, State: campaign.state, Status: campaign.status })) } });

test("Direct calendar uses Moscow midnight and validates actual bounded dates", () => {
  assert.equal(moscowDate(new Date("2026-10-20T22:30:00Z")), "2026-10-21");
  assert.deepEqual(validateDirectRange(null, null, "2026-10-21"), { from: "2026-09-22", to: "2026-10-21" });
  assert.deepEqual(validateDirectRange("2024-02-29", "2024-02-29", "2026-10-21"), { from: "2024-02-29", to: "2024-02-29" });
  for (const [from, to] of [["2026-02-29", "2026-03-01"], ["2026-10-22", "2026-10-22"], ["2026-10-21", "2026-10-20"], ["2025-01-01", "2026-10-21"], ["", "2026-10-21"], [null, "2026-10-21"], ["2026-10-1", "2026-10-21"]]) {
    assert.throws(() => validateDirectRange(from, to, "2026-10-21"), DirectRangeError);
  }
});

test("Direct parser selects registration goal, money in currency units and campaign allowlist", () => {
  const rows = parseDirectReport("\uFEFF" + tsv, range);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cost, 10.10);
  assert.equal(rows[1].conversions, 0.5);
  assert.throws(() => parseDirectReport(tsv.replace(conversionColumn, "Conversions"), range), DirectReportError);
  assert.throws(() => parseDirectReport(tsv.replace(conversionColumn, "Conversions_673081488_AUTO"), range), DirectReportError);
  assert.throws(() => parseDirectReport(tsv.replace("10.10", "not-a-number"), range), DirectReportError);
  assert.throws(() => parseDirectReport(tsv.replace("2026-10-20", "2026-10-18"), range), DirectReportError);
  assert.throws(() => parseDirectReport("", range), DirectReportError);
  assert.throws(() => parseDirectReport(tsv.replace("\t100\t", "\t-1\t"), range), DirectReportError);
});

test("Direct totals derive weighted rates, preserve fractional registrations and fill daily gaps", () => {
  const rows = parseDirectReport(tsv, range);
  const report = buildDirectReport([...metadata, { id: 715283243, name: "OrdersFlow", state: "ON", status: "ACCEPTED" }], rows, range, "2026-10-21T12:00:00Z");
  assert.equal(report.totals.impressions, 1100);
  assert.equal(report.totals.clicks, 11);
  assert.equal(report.totals.cost, 15.30);
  assert.equal(report.totals.ctr, 1);
  assert.equal(report.totals.cpc, 15.30 / 11);
  assert.equal(report.totals.conversions, 1.5);
  assert.equal(report.totals.cpa, 15.30 / 1.5);
  assert.deepEqual(report.campaigns.map(campaign => campaign.id), [715271358, 715282028]);
  assert.equal(report.daily.length, 3);
  assert.equal(report.daily[0].impressions, 0);
  assert.equal(report.daily[0].cpa, null);
  assert.equal(report.daily[1].clicks, 10);
  assert.equal(directTotals([{ ...rows[0], campaignId: 715283243 }]).cost, 0);
});

test("Unknown conversions remain unknown; no click/conversion denominator becomes Infinity", () => {
  const unknown = parseDirectReport(`${header}\n2026-10-20\t715271358\tSearch\t1\t0\t0.00\t--`, range);
  const totals = directTotals(unknown);
  assert.equal(totals.conversions, null);
  assert.equal(totals.cpa, null);
  assert.equal(totals.conversionRate, null);
  assert.equal(totals.cpc, null);
  assert.deepEqual(parseDirectReport(header + "\n", range), []);
  assert.equal(directTotals([]).conversions, 0);
});

test("Queued reports keep one report name, honor retryIn, coalesce reads and cache only complete data", async () => {
  let now = Date.parse("2026-10-21T12:00:00Z"), reportCalls = 0;
  const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    if (String(input).endsWith("campaigns")) return campaignsResponse();
    reportCalls++;
    if (reportCalls <= 2) return new Response(null, { status: reportCalls === 1 ? 201 : 202, headers: { retryIn: "2" } });
    return new Response(tsv);
  };
  const reader = new DirectStatsReader({ token: "fixture-token", clientLogin: "fixture-account", fetcher, now: () => now });
  const first = await Promise.all([reader.read(range), reader.read(range)]);
  assert.equal(requests.length, 2);
  assert.deepEqual(first[0], first[1]);
  assert.equal(first[0].status, "processing");
  assert.equal("totals" in first[0], false);
  await reader.read(range);
  assert.equal(requests.length, 2);
  now += 10_000;
  assert.equal((await reader.read(range)).status, "processing");
  now += 10_000;
  const ready = await reader.read(range);
  assert.equal(ready.status, "ready");
  const reportRequests = requests.filter(request => request.url.endsWith("reports"));
  assert.equal(new Set(reportRequests.map(request => (request.body.params as { ReportName: string }).ReportName)).size, 1);
  const params = reportRequests[0].body.params as Record<string, unknown>;
  assert.deepEqual(params.Goals, ["672676203"]);
  assert.deepEqual(params.AttributionModels, ["AUTO"]);
  assert.deepEqual((params.SelectionCriteria as { Filter: unknown }).Filter, [{ Field: "CampaignId", Operator: "IN", Values: ["715271358", "715282028"] }]);
  assert.equal(params.IncludeVAT, "YES");
  assert.equal(reportRequests[0].headers.get("returnMoneyInMicros"), "false");
  assert.equal(reportRequests[0].headers.get("Client-Login"), "fixture-account");
  assert.equal(reportRequests[0].headers.get("skipColumnHeader"), null);
  const before = requests.length;
  await reader.read(range);
  await reader.read(range, true);
  assert.equal(requests.length, before);
  now += 11_000;
  await reader.read(range, true);
  assert.equal(requests.length, before + 2);
  assert.notEqual((requests.at(-1)?.body.params as { ReportName: string }).ReportName, (reportRequests[0].body.params as { ReportName: string }).ReportName);
});

test("Provider authentication, throttling and invalid report responses are sanitized", async () => {
  for (const [response, code] of [[new Response("secret upstream", { status: 401 }), "provider_auth"], [new Response("secret upstream", { status: 429, headers: { retryIn: "900" } }), "rate_limited"], [new Response("secret upstream", { status: 503 }), "provider_unavailable"]] as const) {
    const reader = new DirectStatsReader({ token: "fixture-token", fetcher: async () => response });
    await assert.rejects(reader.read(range), error => {
      assert.ok(error instanceof DirectApiError);
      assert.equal(error.code, code);
      assert.ok(!error.message.includes("secret"));
      if (code === "rate_limited") assert.equal(error.retryAfter, 60);
      return true;
    });
  }
  let call = 0;
  const malformed = new DirectStatsReader({ token: "fixture-token", fetcher: async () => ++call === 1 ? campaignsResponse() : new Response("not a report") });
  await assert.rejects(malformed.read(range), error => error instanceof DirectApiError && error.code === "provider_unavailable");
});

test("ROOT authorization runs before validation or any provider access and preserves the 404 exception", async () => {
  const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  let reads = 0;
  const handler = createDirectStatsHandler({ authorize: async () => { throw notFound; }, read: async () => { reads++; throw new Error("must not run"); } });
  await assert.rejects(handler(new Request("https://wesetup.ru/api/root/yandex-direct?from=invalid")), error => error === notFound);
  assert.equal(reads, 0);
});

test("ROOT API validates ranges, preserves queued state and never returns provider secrets", async () => {
  let reads = 0;
  const pending = { status: "processing" as const, range, retryAfter: 4 };
  const handler = createDirectStatsHandler({ authorize: async () => undefined, read: async (requested, refresh) => {
    reads++; assert.deepEqual(requested, range); assert.equal(refresh, true); return pending;
  } });
  const invalid = await handler(new Request("https://wesetup.ru/api/root/yandex-direct?from=2026-02-30&to=2026-10-21"));
  assert.equal(invalid.status, 400); assert.equal(reads, 0);
  const response = await handler(new Request("https://wesetup.ru/api/root/yandex-direct?from=2026-10-19&to=2026-10-21&refresh=1&campaignId=715283243"));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("Retry-After"), "4");
  assert.match(response.headers.get("Cache-Control") ?? "", /private.*no-store/);
  assert.deepEqual(await response.json(), pending);
  const broken = createDirectStatsHandler({ authorize: async () => undefined, read: async () => { throw new Error("provider-token-database-password"); } });
  const failure = await broken(new Request("https://wesetup.ru/api/root/yandex-direct"));
  assert.equal(failure.status, 502);
  assert.deepEqual(await failure.json(), { error: "provider_unavailable" });
});
 test("Direct method throttle preserves the queued report and spaces requests across periods", async () => {
  let now = Date.parse("2026-10-21T12:00:00Z"), calls = 0;
  const names: string[] = [];
  const reader = new DirectStatsReader({ token: "fixture", now: () => now, fetcher: async (input, init) => {
    if (String(input).endsWith("campaigns")) return campaignsResponse();
    calls++; names.push(JSON.parse(String(init?.body)).params.ReportName);
    if (calls === 1) return Response.json({ error: { error_code: 56, error_detail: "private upstream text" } }, { status: 400 });
    return new Response(header + "\n");
  } });
  const pending = await reader.read(range);
  assert.deepEqual(pending, { status: "processing", range, retryAfter: 10 });
  const otherRange = { from: "2026-10-20", to: "2026-10-21" };
  assert.equal((await reader.read(otherRange)).status, "processing");
  assert.equal(calls, 1);
  now += 10_000;
  assert.equal((await reader.read(range)).status, "ready");
  assert.equal(names[0], names[1]);
  assert.equal((await reader.read(otherRange)).status, "processing");
  assert.equal(calls, 2);
});

test("Unapproved OAuth applications report an actionable authorization error", async () => {
 const reader = new DirectStatsReader({ token: "fixture", fetcher: async () => Response.json({ error: { error_code: 58, error_detail: "private detail" } }) });
 await assert.rejects(reader.read(range), error => error instanceof DirectApiError && error.code === "provider_auth");
});

test("Queued reports survive HTTP 429 and honor the provider retry deadline", async () => {
 let now = Date.parse("2026-10-21T12:00:00Z"), calls = 0;
 const names: string[] = [];
 const reader = new DirectStatsReader({ token: "fixture", now: () => now, fetcher: async (input, init) => {
  if (String(input).endsWith("campaigns")) return campaignsResponse();
  calls++; names.push(JSON.parse(String(init?.body)).params.ReportName);
  if (calls === 1) return new Response(null, {status:201,headers:{retryIn:"1"}});
  if (calls === 2) return new Response("private upstream", {status:429,headers:{retryIn:"60"}});
  return new Response(header + "\n");
 } });
 assert.equal((await reader.read(range)).status, "processing");
 now += 10_000;
 await assert.rejects(reader.read(range), error => error instanceof DirectApiError && error.code === "rate_limited" && error.retryAfter === 60);
 now += 10_000;
 assert.deepEqual(await reader.read(range, true), {status:"processing",range,retryAfter:50});
 assert.equal(calls, 2);
 now += 50_000;
 assert.equal((await reader.read(range)).status, "ready");
 assert.equal(calls, 3);assert.equal(new Set(names).size, 1);
});
