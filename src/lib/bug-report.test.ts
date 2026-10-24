import test from "node:test";
import assert from "node:assert/strict";

import {
  absoluteReportPageUrl,
  composeAttachmentCaption,
  normalizeReportPagePath,
  ticketCode,
} from "@/lib/bug-report";

test("ticketCode takes the last six id characters in upper case", () => {
  assert.equal(ticketCode("cmabc123xyz4kx2qf"), "4KX2QF");
});

test("normalizeReportPagePath keeps only our path and query", () => {
  assert.equal(
    normalizeReportPagePath("https://wesetup.ru/journals/hygiene?doc=1#row"),
    "/journals/hygiene?doc=1"
  );
  assert.equal(normalizeReportPagePath("/dashboard"), "/dashboard");
  // A foreign host never reaches the admin as a link.
  assert.equal(
    normalizeReportPagePath("https://evil.example/login"),
    "/login"
  );
});

test("normalizeReportPagePath rejects junk", () => {
  assert.equal(normalizeReportPagePath(undefined), null);
  assert.equal(normalizeReportPagePath(42), null);
  assert.equal(normalizeReportPagePath("   "), null);
  assert.equal(normalizeReportPagePath("javascript:alert(1)"), null);
  assert.equal(normalizeReportPagePath(`/x${"a".repeat(2100)}`), null);
});

test("absoluteReportPageUrl joins without a double slash", () => {
  assert.equal(
    absoluteReportPageUrl("/dashboard", "https://wesetup.ru/"),
    "https://wesetup.ru/dashboard"
  );
});

test("composeAttachmentCaption escapes text and fits Telegram's limit", () => {
  const short = composeAttachmentCaption({
    reportId: "cmabc123xyz4kx2qf",
    message: "Кнопка <b>не</b> жмётся",
    pageUrl: "https://wesetup.ru/journals",
  });
  assert.match(short, /4KX2QF/);
  assert.match(short, /#fb_cmabc123xyz4kx2qf/);
  assert.match(short, /&lt;b&gt;не&lt;\/b&gt;/);
  assert.match(short, /https:\/\/wesetup\.ru\/journals/);

  const long = composeAttachmentCaption({
    reportId: "cmabc123xyz4kx2qf",
    message: "<".repeat(5000),
    pageUrl: "https://wesetup.ru/journals",
  });
  // Telegram counts an entity as one character.
  const visible = long.replace(/<\/?b>/g, "").replace(/&[a-z#0-9]+;/g, "x");
  assert.ok(visible.length <= 1024, `caption is ${visible.length} chars`);
  assert.ok(long.includes("…"));
  assert.ok(!/&[a-z#0-9]*$/.test(long.split("…")[0]));
});
