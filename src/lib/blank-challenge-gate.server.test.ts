import assert from "node:assert/strict";
import test from "node:test";

import { createBlankChallengeGate, suspiciousUserAgent } from "@/lib/blank-challenge-gate.server";
import { issueRegistrationChallenge } from "@/lib/registration-antibot";

/**
 * Капча только для подозрительных (спека blank-download-seal-cover-captcha-2026-11-20):
 * обычный человек скачивает по невидимой отметке времени, Google — по просьбе сервера.
 */

const ENV = {
  NEXTAUTH_SECRET: "test-secret-for-blank-gate-0123456789",
  RECAPTCHA_SITE_KEY: "site-key-for-tests",
  RECAPTCHA_SECRET_KEY: "secret-key-for-tests",
  RECAPTCHA_HOSTNAMES: "wesetup.ru",
};
const NO_GOOGLE = { NEXTAUTH_SECRET: ENV.NEXTAUTH_SECRET };
const CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const NOW = Date.parse("2026-11-20T20:00:00Z");

/** Отметка, выданная `ageMs` назад (как её получает окно при открытии). */
function stamp(ageMs = 5000, env: Record<string, string> = ENV): string {
  return issueRegistrationChallenge({ env, now: NOW - ageMs })!.token;
}

const deps = (env: Record<string, string> = ENV, fetchImpl?: typeof fetch) => ({ env, now: NOW, ...(fetchImpl ? { fetch: fetchImpl } : {}) });

test("браузер против скрипта: обычные телефоны и ПК — не подозрительны", () => {
  for (const ua of [CHROME, SAFARI, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 YaBrowser/24.12.0.0 Safari/537.36"]) {
    assert.equal(suspiciousUserAgent(ua), false, ua);
  }
  for (const ua of [null, "", "\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120\"", "python-requests/2.31.0", "curl/8.4.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (compatible; axios/1.6.0)"]) {
    assert.equal(suspiciousUserAgent(ua), true, String(ua));
  }
});

test("обычное скачивание проходит без Google; без отметки, со свежей или поддельной — «Я не робот»", async () => {
  const gate = createBlankChallengeGate();
  const ok = await gate({ stamp: stamp(), website: "" }, { ip: "203.0.113.1", userAgent: CHROME }, deps());
  assert.deepEqual(ok, { ok: true, via: "invisible" });

  for (const body of [{}, { stamp: stamp(200) }, { stamp: `${stamp()}x` }, { stamp: stamp(5000, { NEXTAUTH_SECRET: "another-secret-0123456789abcdef" }) }, { stamp: stamp(), website: "spam" }]) {
    const result = await gate(body, { ip: "203.0.113.2", userAgent: CHROME }, deps());
    assert.equal(result.ok, false, JSON.stringify(body));
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.errorCode, "captcha_required");
    }
  }
  // Подпись браузера в кавычках (атака 18.11) — проверка даже с верной отметкой.
  const quoted = await gate({ stamp: stamp() }, { ip: "203.0.113.3", userAgent: `"${CHROME}"` }, deps());
  assert.equal(!quoted.ok && quoted.errorCode, "captcha_required");
  // Нужна проверка, а ключей Google нет — 503, как раньше.
  const unavailable = await gate({}, { ip: "203.0.113.4", userAgent: CHROME }, deps(NO_GOOGLE));
  assert.equal(!unavailable.ok && unavailable.status, 503);
  assert.equal(!unavailable.ok && unavailable.errorCode, "captcha_unavailable");
  // Без Google и с верной отметкой — скачивание проходит (разработка, сбой ключей).
  assert.deepEqual(await gate({ stamp: stamp(5000, NO_GOOGLE) }, { ip: "203.0.113.5", userAgent: CHROME }, deps(NO_GOOGLE)), { ok: true, via: "invisible" });
});

test("пороги: 5 в час с адреса и волна по всему сайту — дальше только с «Я не робот»", async () => {
  const gate = createBlankChallengeGate({ perIpPerHour: 2, sitewidePerTenMinutes: 3 });
  const pass = (ip: string) => gate({ stamp: stamp() }, { ip, userAgent: SAFARI }, deps());
  assert.equal((await pass("198.51.100.1")).ok, true);
  assert.equal((await pass("198.51.100.1")).ok, true);
  const third = await pass("198.51.100.1");
  assert.equal(!third.ok && third.errorCode, "captcha_required", "третье с адреса — с проверкой");
  assert.equal((await pass("198.51.100.2")).ok, true, "другой адрес — без проверки");
  const wave = await pass("198.51.100.3");
  assert.equal(!wave.ok && wave.errorCode, "captcha_required", "волна по сайту — с проверкой");
});

test("с галкой «Я не робот» — проверка Google, как раньше", async () => {
  const gate = createBlankChallengeGate({ perIpPerHour: 0, sitewidePerTenMinutes: 0 });
  const google = (body: Record<string, unknown>) => (async () => Response.json(body)) as unknown as typeof fetch;
  const passed = await gate({ captchaToken: "token-from-widget" }, { ip: "192.0.2.1", userAgent: CHROME }, deps(ENV, google({ success: true, hostname: "wesetup.ru" })));
  assert.deepEqual(passed, { ok: true, via: "captcha" });
  const failed = await gate({ captchaToken: "stale-token" }, { ip: "192.0.2.1", userAgent: CHROME }, deps(ENV, google({ success: false, "error-codes": ["timeout-or-duplicate"] })));
  assert.equal(!failed.ok && failed.errorCode, "captcha");
  assert.equal(!failed.ok && failed.status, 403);
});
