import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server";
import { AD_CAMPAIGN_COOKIE, AD_CAMPAIGN_ERID } from "./ad-campaign";
import { adCampaignStorage, recordAdCampaignVisit, loadAdCampaignReport } from "./ad-campaign.server";
import { readAdTouch } from "./ad-campaign-cookie.server";

test("repeat document views persist separately and reuse the signed browser cookie", async (t) => {
  const previous = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = "ad-visits-test";
  const writes: unknown[] = [];
  t.mock.method(adCampaignStorage, "db", async () => ({ auditLog: { create: async (input: unknown) => { writes.push(input); return {}; } } }) as never);
  try {
    const url = `https://wesetup.ru/akciya?erid=${AD_CAMPAIGN_ERID}`;
    const res = NextResponse.next();
    await recordAdCampaignVisit(new NextRequest(url, { headers: { "user-agent": "Mozilla/5.0" } }), res);
    const cookie = res.cookies.get(AD_CAMPAIGN_COOKIE)!;
    assert.ok(cookie);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, true);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const second = NextResponse.next();
    await recordAdCampaignVisit(new NextRequest(url, { headers: { "user-agent": "Mozilla/5.0", cookie: `${AD_CAMPAIGN_COOKIE}=${cookie.value}` } }), second);
    assert.equal(second.cookies.get(AD_CAMPAIGN_COOKIE)?.value, cookie.value);
    assert.equal(writes.length, 2);
    const rows = writes as Array<{ data: { details: { visitorId: string }; organizationId: string } }>;
    assert.equal(rows[0].data.details.visitorId, readAdTouch(cookie.value)!.visitorId);
    assert.equal(rows[0].data.details.visitorId, rows[1].data.details.visitorId);
    assert.equal(rows[0].data.organizationId, process.env.PLATFORM_ORG_ID || "platform");
    assert.deepEqual(Object.keys(rows[0].data.details), ["visitorId"]);
  } finally {
    if (previous === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = previous;
  }
});

test("analytics storage failure never breaks page navigation", async (t) => {
  const previous = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = "ad-visits-test";
  t.mock.method(adCampaignStorage, "db", async () => ({ auditLog: { create: async () => { throw new Error("DB unavailable"); } } }) as never);
  t.mock.method(console, "error", () => {});
  try {
    const req = new NextRequest(`https://wesetup.ru/akciya?erid=${AD_CAMPAIGN_ERID}`, { headers: { "user-agent": "Mozilla/5.0" } });
    await assert.doesNotReject(recordAdCampaignVisit(req, NextResponse.next()));
  } finally {
    if (previous === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = previous;
  }
});

test("report separates views, browsers, organizations and browser conversion", async (t) => {
  let query = 0;
  t.mock.method(adCampaignStorage, "db", async () => ({
    $queryRaw: async () => ++query === 1 ? [{ views: BigInt(9), visitors: BigInt(4), since: new Date("2026-11-25") }] : [{ count: BigInt(2) }],
    organization: { count: async () => 3, findMany: async () => [] },
  }) as never);
  const report = await loadAdCampaignReport();
  assert.equal(report.views, 9);
  assert.equal(report.visitors, 4);
  assert.equal(report.registrations, 3);
  assert.equal(report.conversion, 50); // Two converting browsers, even with three organizations.
});

test("unrelated paths and preview fetches do not access analytics storage", async (t) => {
  const storage = t.mock.method(adCampaignStorage, "db", async () => { throw new Error("must not initialize"); });
  for (const [path, ua] of [["/pricing", "Mozilla/5.0"], [`/akciya?erid=${AD_CAMPAIGN_ERID}`, "TelegramBot"]]) {
    await recordAdCampaignVisit(new NextRequest(`https://wesetup.ru${path}`, { headers: { "user-agent": ua } }), NextResponse.next());
  }
  assert.equal(storage.mock.callCount(), 0);
});

test("empty report has no fabricated conversion or collection start", async (t) => {
  t.mock.method(adCampaignStorage, "db", async () => ({
    $queryRaw: async () => [{ views: BigInt(0), visitors: BigInt(0), since: null, count: BigInt(0) }],
    organization: { count: async () => 0, findMany: async () => [] },
  }) as never);
  const report = await loadAdCampaignReport();
  assert.equal(report.conversion, null);
  assert.equal(report.since, null);
  assert.equal(report.registrations, 0);
});
