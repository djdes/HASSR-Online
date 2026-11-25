import assert from "node:assert/strict";
import test from "node:test";
import { AD_CAMPAIGN_ERID, isAdCampaignNavigation } from "./ad-campaign";

function request(patch: { method?: string; path?: string; headers?: Record<string, string> } = {}) {
  return { method: patch.method ?? "GET", url: `https://wesetup.ru${patch.path ?? `/akciya?erid=${AD_CAMPAIGN_ERID}`}`,
    headers: new Headers({ "user-agent": "Mozilla/5.0 Chrome/130", ...patch.headers }) };
}

test("existing ad link counts document visits without adding URL parameters", () => {
  assert.equal(isAdCampaignNavigation(request()), true);
  assert.equal(isAdCampaignNavigation(request({ headers: { "sec-fetch-dest": "document" } })), true);
  for (const path of ["/akciya", "/akciya?erid=wrong", `/vizitka?erid=${AD_CAMPAIGN_ERID}`, `/akciya/admin?erid=${AD_CAMPAIGN_ERID}`]) {
    assert.equal(isAdCampaignNavigation(request({ path })), false, path);
  }
});

test("previews, crawlers, HEAD, RSC and speculative requests do not inflate visits", () => {
  assert.equal(isAdCampaignNavigation(request({ method: "HEAD" })), false);
  const excludedHeaders: Array<Record<string, string>> = [
    { "user-agent": "TelegramBot (like TwitterBot)" }, { "user-agent": "Googlebot" },
    { "user-agent": "WhatsApp/2.0" }, { "user-agent": "" },
    { rsc: "1" }, { "next-router-prefetch": "1" }, { purpose: "prefetch" },
    { "sec-purpose": "prefetch;prerender" }, { "sec-fetch-dest": "empty" },
  ];
  for (const headers of excludedHeaders) assert.equal(isAdCampaignNavigation(request({ headers })), false, JSON.stringify(headers));
});
