import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseSite } from "api-anything";
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

