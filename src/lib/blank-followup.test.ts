import assert from "node:assert/strict";
import test from "node:test";

import { pickFollowupCandidates } from "@/lib/blank-followup.server";
import { buildBlankFollowupEmail } from "@/lib/email";

test("followup: last download per email, no account, known journal only", () => {
  const picked = pickFollowupCandidates([
    { id: "1", details: { email: "A@Example.com ", code: "hygiene", title: "Гигиенический журнал" } },
    { id: "2", details: { email: "a@example.com", code: "cleaning", title: "Журнал уборки" } },
    { id: "3", details: { email: "b@example.com", code: "hygiene", account: "created" } },
    { id: "4", details: { email: "c@example.com", code: "hygiene" } },
    { id: "5", details: { email: "c@example.com", code: "cleaning", account: "exists" } },
    { id: "6", details: { email: "d@example.com", paperId: "ot_intro" } },
    { id: "7", details: { email: "e@example.com", code: "no_such_journal" } },
    { id: "8", details: null },
  ]);
  assert.deepEqual(picked, [{ sourceId: "2", email: "a@example.com", code: "cleaning", title: "Журнал уборки" }]);
});

test("followup email: tips, page link, register link, one-off disclaimer", async () => {
  const { subject, html } = await buildBlankFollowupEmail({
    journalTitle: "Журнал уборки",
    tips: ["Совет 1", "Совет <2>", "Совет 3", "Совет 4"],
    pageUrl: "https://wesetup.ru/journals-info/cleaning",
    registerUrl: "https://wesetup.ru/register?email=a%40example.com",
  });
  assert.equal(subject, "Как вести журнал «Журнал уборки»: подсказки");
  assert.match(html, /Совет &lt;2&gt;/);
  assert.doesNotMatch(html, /Совет 4/, "не больше трёх подсказок");
  assert.match(html, /journals-info\/cleaning/);
  assert.match(html, /register\?email=a%40example\.com/);
  assert.match(html, /Больше писем по нему не будет/);
  assert.doesNotMatch(html, /бланк/i);
});

test("auto review requests run only 10–12 Moscow time", async () => {
  const { autoRequestReviews } = await import("@/lib/review-requests.server");
  // 03:00 UTC = 06:00 МСК — вне окна, база не трогается.
  assert.deepEqual(await autoRequestReviews(new Date("2026-11-18T03:00:00Z")), { sent: 0 });
});
