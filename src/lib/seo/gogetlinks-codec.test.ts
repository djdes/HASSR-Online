import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseSite } from "api-anything";

process.env.INTEGRATION_KEY_SECRET ||= "test-secret-at-least-16-chars-long";
import {
  decodeWin1251,
  encodeWin1251Form,
  isWesetupDomain,
  normalizeCampaignRow,
  normalizeReviewRow,
  parseRubAmount,
  parseTfCf,
} from "@/lib/seo/gogetlinks-codec";

test("Review Focus #1: redirect to view_closed & admin-locked row without checkbox stay closed with parsed id", () => {
  const row = normalizeCampaignRow(
    {
      campaignUrl: "/campaign/index/id/146053",
      campaignId: undefined,
      name: "FonMusic",
      domain: "fonmusic.ru",
      siteUrl: "https://fonmusic.ru",
      statusNote: "Кампания закрыта администратором",
      spent: "15 415 р.",
      linksCount: "42",
      requestsCount: "0",
    },
    { requestedState: "active", finalUrl: "https://gogetlinks.net/campaigns/index/action/view_closed" },
  );
  assert.ok(row);
  assert.equal(row.gglCampaignId, 146053);
  assert.equal(row.state, "closed");
  assert.equal(row.isWesetup, false);
  assert.equal(row.spentRub, 15415);
});

test("Review Focus #2: encodeWin1251Form round-trips Russian Cyrillic, № and ₽ without UTF-8 mojibake", () => {
  const encoded = encodeWin1251Form({
    name: "Журнал №1 — СанПиН",
    price_note: "850 ₽",
  });
  // UTF-8 Cyrillic leads with %D0%[80-BF] or %D1%[80-BF]; windows-1251 uses single-byte %C0-%FF
  assert.doesNotMatch(encoded, /%D0%[89AB]|%D1%[89AB]/i);
  // Decode percent-encoded bytes back through windows-1251 TextDecoder:
  const decodedPairs = Object.fromEntries(
    encoded.split("&").map((pair) => {
      const [k, v = ""] = pair.split("=");
      const bytes = Uint8Array.from(
        v.replace(/\+/g, "%20").split(/(%[0-9A-Fa-f]{2})/).filter(Boolean).flatMap((tok) =>
          tok.startsWith("%") ? [Number.parseInt(tok.slice(1), 16)] : [...Buffer.from(tok, "ascii")],
        ),
      );
      return [k, decodeWin1251(bytes)];
    }),
  );
  assert.equal(decodedPairs.name, "Журнал №1 — СанПиН");
  assert.equal(decodedPairs.price_note, "850 руб.");
});

test("isWesetupDomain isolates wesetup.ru from other owner domains and parseRubAmount handles decimals", () => {
  assert.equal(isWesetupDomain("https://www.wesetup.ru/journals-info"), true);
  assert.equal(isWesetupDomain("yesbeat.ru"), false);
  assert.equal(isWesetupDomain("wesetup.ru.evil.com"), false);
  assert.equal(parseRubAmount("8 936.06 р."), 8936.06);
});

test("config/api-anything/sites/gogetlinks.json pins loginCookies and carries zero secrets", () => {
  const raw = readFileSync("config/api-anything/sites/gogetlinks.json", "utf8");
  const spec = JSON.parse(raw);
  assert.deepEqual(spec.loginCookies, ["hash", "PHPSESSID"]);
  assert.doesNotMatch(raw, /PHPSESSID=|rem_acc=|password=/i);
  assert.ok(spec.operations.some((op: { name: string }) => op.name === "listClosedCampaigns"));
  assert.ok(spec.operations.some((op: { name: string; readOnly: boolean }) => op.name === "sendThreadMessage" && op.readOnly === false));
  assert.doesNotThrow(() => parseSite(spec));
});

test("parseTfCf and normalizeReviewRow parse donor metrics, dates and statuses", () => {
  const parsedTfCf = parseTfCf("14 / 22");
  assert.deepEqual(parsedTfCf, { tf: 14, cf: 22, label: "14 / 22" });
  assert.deepEqual(parseTfCf("18"), { tf: 18, cf: 0, label: "18" });

  const rev = normalizeReviewRow(
    {
      rowId: "col_row_6046338",
      publishedUrl: "http://uznayslovo.ru/blog/?p=541",
      siteCell: "uznayslovo.ru Кампания: fonmusic",
      anchor: "www.fonmusic.ru",
      dailyTraffic: "300",
      tfCf: "14 / 22",
      price: "116 Р",
      paidDate: "05.07.2013",
      targetUrl: "https://wesetup.ru/journals-info",
    },
    "paid",
  );
  assert.ok(rev);
  assert.equal(rev.gglReviewId, 6046338);
  assert.equal(rev.donorDomain, "uznayslovo.ru");
  assert.equal(rev.priceRub, 116);
  assert.equal(rev.status, "paid");
  assert.equal(rev.dailyTraffic, 300);
});

test("callGglWrite throws GglIsolationError before touching network if campaign does not belong to wesetup", async () => {
  const { callGglWrite, GglIsolationError, assertCampaignIsolation } = await import("@/lib/seo/gogetlinks-client.server");

  // Pure assertion checks
  assert.throws(() => assertCampaignIsolation(null, "null-comp"), GglIsolationError);
  assert.throws(() => assertCampaignIsolation({ isWesetup: false }, "other-comp"), GglIsolationError);
  assert.doesNotThrow(() => assertCampaignIsolation({ isWesetup: true }, "wesetup-comp"));

  // Integration guard check
  await assert.rejects(
    async () => {
      await callGglWrite({
        opName: "sendThreadMessage",
        args: { threadKey: "123", text: "test" },
        idempotencyKey: "test-key-isolation",
        campaignIdForGuard: "non-existent-campaign-id",
      });
    },
    GglIsolationError,
  );
});

test("Fix Round 1: write operations inject parameters into HTTP body using Windows-1251 form encoding", async () => {
  const { callGglWrite } = await import("@/lib/seo/gogetlinks-client.server");
  const { encryptSecret } = await import("@/lib/integration-crypto");

  let capturedBody = "";
  const mockFetch: typeof fetch = async (_url, init) => {
    capturedBody = String(init?.body || "");
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const validSession = {
    cookies: [
      { name: "hash", value: "valid_hash", domain: "gogetlinks.net", path: "/", expires: 2000000000, httpOnly: true, secure: true },
      { name: "PHPSESSID", value: "valid_sess", domain: "gogetlinks.net", path: "/", expires: 2000000000, httpOnly: true, secure: true },
    ],
  };

  const mockDb = {
    gglCampaign: {
      findFirst: async () => ({ id: "camp_wesetup", isWesetup: true }),
    },
    gglAccount: {
      findFirst: async () => ({
        id: "acc_1",
        email: "test@wesetup.ru",
        passwordEnc: encryptSecret("pass"),
        sessionEnc: encryptSecret(JSON.stringify(validSession)),
      }),
      update: async () => ({}),
    },
  };

  await callGglWrite({
    opName: "sendThreadMessage",
    args: { threadKey: "th_9988", text: "Здравствуйте №1 — 850 ₽" },
    idempotencyKey: `wire-test-${Date.now()}`,
    campaignIdForGuard: "camp_wesetup",
    prismaClient: mockDb,
    fetchImpl: mockFetch,
  });

  // Verify parameters were not dropped (slots work)
  assert.match(capturedBody, /threadKey=th_9988/);
  assert.match(capturedBody, /text=/);
  // Verify Windows-1251 encoding over the wire without UTF-8 Cyrillic mojibake
  assert.doesNotMatch(capturedBody, /%D0%[89AB]|%D1%[89AB]/i);
  assert.match(capturedBody, /%B9/); // № in win1251 is %B9
  assert.match(capturedBody, /%97/); // — in win1251 is %97
  assert.match(capturedBody, /%F0%F3%E1/); // руб. in win1251
});

test("Fix Round 1: isolation guard verifies campaignId in args and blocks non-wesetup siteUrl", async () => {
  const { callGglWrite, GglIsolationError } = await import("@/lib/seo/gogetlinks-client.server");

  const mockDb = {
    gglCampaign: {
      findFirst: async () => null, // campaign not found
    },
    gglAccount: {
      findFirst: async () => null,
      update: async () => ({}),
    },
  };

  // 1. Guard detects args.campaignId without campaignIdForGuard
  await assert.rejects(
    async () => {
      await callGglWrite({
        opName: "submitLinkOrder",
        args: { campaignId: "146053", donorSiteId: "1", targetUrl: "https://wesetup.ru", anchor: "тест" },
        idempotencyKey: "test-args-camp-id",
        prismaClient: mockDb,
      });
    },
    GglIsolationError,
  );

  // 2. Guard detects args.comp_id
  await assert.rejects(
    async () => {
      await callGglWrite({
        opName: "submitLinkOrder",
        args: { comp_id: "146053", donorSiteId: "1", targetUrl: "https://wesetup.ru", anchor: "тест" },
        idempotencyKey: "test-args-comp-id",
        prismaClient: mockDb,
      });
    },
    GglIsolationError,
  );

  // 3. Guard detects non-wesetup siteUrl in createOrUpdateCampaign
  await assert.rejects(
    async () => {
      await callGglWrite({
        opName: "createOrUpdateCampaign",
        args: { name: "Evil", siteUrl: "https://fonmusic.ru" },
        idempotencyKey: "test-non-wesetup-siteurl",
        prismaClient: mockDb,
      });
    },
    GglIsolationError,
  );
});

test("Fix Round 1: auto-relogin in callGglRead succeeds on expired session without recursion or deadlock", async () => {
  const { callGglRead } = await import("@/lib/seo/gogetlinks-client.server");
  const { encryptSecret } = await import("@/lib/integration-crypto");

  let loginAttempts = 0;
  let readAttempts = 0;
  const mockFetch: typeof fetch = async (url, _init) => {
    const urlStr = String(url);
    if (urlStr.includes("/user/signIn")) {
      loginAttempts++;
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "hash=fresh_hash_123; path=/; domain=gogetlinks.net, PHPSESSID=fresh_sess_456; path=/; domain=gogetlinks.net",
        },
      });
    }
    if (urlStr.includes("/campaigns")) {
      readAttempts++;
      if (readAttempts === 1) {
        // First read attempt fails with auth class
        return new Response("<html><body>Пожалуйста, авторизуйтесь</body></html>", {
          status: 401,
          headers: { "content-type": "text/html; charset=windows-1251" },
        });
      }
      // Second read attempt succeeds
      return new Response(
        `<html><body><table class="finance__table">
          <tr><td class="balance__all">5 000 Р</td><td class="balance__open">3 000 Р</td><td class="balance__block">2 000 Р</td></tr>
        </table></body></html>`,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=windows-1251" },
        },
      );
    }
    return new Response("Not found", { status: 404 });
  };

  let savedSession: string | null = "stale_session";
  const mockDb = {
    gglAccount: {
      findFirst: async () => ({
        id: "acc_1",
        email: "test@wesetup.ru",
        passwordEnc: encryptSecret("supersecret"),
        sessionEnc: savedSession
          ? encryptSecret(
              JSON.stringify({
                cookies: [
                  {
                    name: "hash",
                    value: "old",
                    domain: "gogetlinks.net",
                    path: "/",
                    expires: 2000000000,
                    httpOnly: true,
                    secure: true,
                  },
                ],
              }),
            )
          : null,
      }),
      update: async (args: { data: { sessionEnc?: string } }) => {
        if (args.data.sessionEnc) savedSession = args.data.sessionEnc;
        return {};
      },
    },
    gglCampaign: {
      findFirst: async () => ({ id: "c1", isWesetup: true }),
    },
  };

  const balance = await callGglRead<{ balanceRub: number; availableRub: number; blockedRub: number }>(
    "getAccountBalance",
    undefined,
    { prismaClient: mockDb, fetchImpl: mockFetch },
  );

  assert.equal(balance.balanceRub, 5000);
  assert.equal(balance.availableRub, 3000);
  assert.equal(balance.blockedRub, 2000);
  assert.equal(loginAttempts, 1);
  assert.equal(readAttempts, 2);
});

