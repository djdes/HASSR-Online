import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";

import { renderRobotsTxt } from "@/lib/robots-txt";
import { proxy } from "@/proxy";

describe("proxy & robots: AI Markdown negotiation and Content-Signal", () => {
  it("rewrites .md promo URLs to /promo-md with Vary: Accept", async () => {
    const req = new NextRequest("https://wesetup.ru/baza-znaniy/registraciya.md", {
      headers: { accept: "*/*", "user-agent": "ChatGPT-User/1.0" },
    });
    const res = await proxy(req);
    const rewrite = res.headers.get("x-middleware-rewrite") ?? "";
    assert.match(rewrite, /\/promo-md\?/);
    assert.match(rewrite, /target=%2Fbaza-znaniy%2Fregistraciya/);
    assert.match(rewrite, /via=ext/);
  });

  it("rewrites Accept: text/markdown on promo pages to /promo-md", async () => {
    const req = new NextRequest("https://wesetup.ru/pricing", {
      headers: { accept: "text/markdown, text/html;q=0.5", "user-agent": "ClaudeBot/1.0" },
    });
    const res = await proxy(req);
    const rewrite = res.headers.get("x-middleware-rewrite") ?? "";
    assert.match(rewrite, /\/promo-md\?/);
    assert.match(rewrite, /target=%2Fpricing/);
    assert.match(rewrite, /via=accept/);
  });

  it("sets Vary: Accept on anonymous HTML responses for cacheable promo pages", async () => {
    const req = new NextRequest("https://wesetup.ru/pricing", {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0",
      },
    });
    const res = await proxy(req);
    assert.equal(res.headers.get("x-middleware-next"), "1");
    assert.match(res.headers.get("cache-control") ?? "", /^public,/);
    assert.match(res.headers.get("vary") ?? "", /Accept/i);
  });

  it("never rewrites private routes on Accept: text/markdown", async () => {
    const req = new NextRequest("https://wesetup.ru/dashboard", {
      headers: { accept: "text/markdown" },
    });
    const res = await proxy(req);
    const rewrite = res.headers.get("x-middleware-rewrite") ?? "";
    assert.doesNotMatch(rewrite, /\/promo-md/);
  });

  it("includes Content-Signal for AI search and answer engines in robots.txt", () => {
    const txt = renderRobotsTxt();
    assert.match(txt, /^Content-Signal: search=yes, ai-input=yes, ai-train=no$/m);
    assert.match(txt, /^Disallow: \/promo-md$/m);
  });
});
