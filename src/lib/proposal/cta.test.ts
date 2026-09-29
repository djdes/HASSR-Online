import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ORG_SPHERES } from "@/lib/org-profile";

import { isSafeAbsoluteUrl, proposalCta, proposalPromoUrl, sphereLandingPath } from "./cta";

const now = new Date("2026-09-29T09:00:00.000Z");
const promo = { code: "ROMASHKA10", kind: "percent" as const, value: 10, lifetime: true, endsAt: null };

describe("CTA и QR КП", () => {
  it("с промокодом — ровно контракт promo-personal", () => {
    assert.equal(proposalPromoUrl("ROMASHKA10", "cafe"), "https://wesetup.ru/promo/ROMASHKA10?s=cafe");
    assert.equal(proposalPromoUrl(" romashka 10 ", "gas_station"), "https://wesetup.ru/promo/ROMASHKA10?s=gas_station");
    assert.deepEqual(proposalCta({ sphere: "cafe", promo }, now), {
      url: "https://wesetup.ru/promo/ROMASHKA10?s=cafe",
      kind: "promo",
    });
  });

  it("без промокода — нишевая страница сферы, у «Другое» — регистрация", () => {
    assert.equal(sphereLandingPath("restaurant"), "/dlya-kafe");
    assert.equal(sphereLandingPath("cafe"), "/dlya-kafe");
    assert.equal(sphereLandingPath("education"), "/dlya-detskogo-sada");
    assert.equal(sphereLandingPath("fitness"), "/dlya-fitnes-centra");
    assert.equal(sphereLandingPath("beauty"), "/dlya-salona-krasoty");
    assert.equal(sphereLandingPath("other"), "/register");
    assert.deepEqual(proposalCta({ sphere: "hotel" }, now), { url: "https://wesetup.ru/dlya-otelya", kind: "landing" });
  });

  it("у каждой сферы страница существует в приложении", () => {
    for (const { value } of ORG_SPHERES) {
      const route = sphereLandingPath(value);
      const dir =
        route === "/register"
          ? path.join(process.cwd(), "src", "app", "(auth)", "register")
          : path.join(process.cwd(), "src", "app", route.slice(1));
      assert.ok(fs.existsSync(path.join(dir, "page.tsx")), `${value} → ${route}: нет страницы`);
    }
  });

  it("истёкший промокод — не на /promo, а на страницу сферы", () => {
    const expired = { ...promo, lifetime: false, endsAt: new Date("2026-09-01T00:00:00.000Z") };
    assert.equal(proposalCta({ sphere: "bar", promo: expired }, now).kind, "landing");
  });

  it("явная ссылка — только http(s)", () => {
    assert.deepEqual(proposalCta({ sphere: "bar", promo, ctaUrl: "https://wesetup.ru/pricing" }, now), {
      url: "https://wesetup.ru/pricing",
      kind: "custom",
    });
    assert.equal(proposalCta({ sphere: "bar", ctaUrl: "javascript:alert(1)" }, now).kind, "landing");
    assert.equal(isSafeAbsoluteUrl("/relative"), false);
    assert.equal(isSafeAbsoluteUrl("mailto:a@b.ru"), false);
  });
});
