import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXTAUTH_SECRET = "test-secret-for-blank-download-0123456789";

import {
  BLANK_DOWNLOAD_TTL_MS,
  blankDownloadDenied,
  blankDownloadHref,
  isBrowserNavigation,
  signBlankDownloadToken,
  verifyBlankDownloadToken,
} from "@/lib/blank-download-token";

/**
 * Подписанная ссылка на шаблон (HMAC, 7 дней, почта + журнал + формат) и
 * ответ роута на файл без действующего токена.
 */

const HYGIENE = { kind: "code", code: "hygiene" } as const;
const NOW = Date.parse("2026-09-25T10:00:00Z");

test("токен: подпись сходится, внутри почта; срок — 7 дней", () => {
  const token = signBlankDownloadToken({ email: "zav@example.com", target: HYGIENE, format: "pdf" }, NOW);
  const check = verifyBlankDownloadToken(token, { target: HYGIENE, format: "pdf" }, NOW + 1000);
  assert.equal(check.ok, true);
  if (check.ok) {
    assert.equal(check.email, "zav@example.com");
    assert.equal(check.expiresAt.getTime(), Math.floor((NOW + BLANK_DOWNLOAD_TTL_MS) / 1000) * 1000);
  }
  assert.equal(BLANK_DOWNLOAD_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  const expired = verifyBlankDownloadToken(token, { target: HYGIENE, format: "pdf" }, NOW + BLANK_DOWNLOAD_TTL_MS + 1000);
  assert.deepEqual(expired, { ok: false, reason: "expired" });
});

test("токен не открывает другой журнал, формат или бумажный бланк", () => {
  const token = signBlankDownloadToken({ email: "zav@example.com", target: HYGIENE, format: "pdf" }, NOW);
  assert.deepEqual(verifyBlankDownloadToken(token, { target: HYGIENE, format: "docx" }, NOW), { ok: false, reason: "mismatch" });
  assert.deepEqual(
    verifyBlankDownloadToken(token, { target: { kind: "code", code: "health_check" }, format: "pdf" }, NOW),
    { ok: false, reason: "mismatch" },
  );
  assert.deepEqual(
    verifyBlankDownloadToken(token, { target: { kind: "paper", paperId: "hygiene" }, format: "pdf" }, NOW),
    { ok: false, reason: "mismatch" },
  );
});

test("подделка: чужая подпись, изменённая почта, мусор, пусто", () => {
  const token = signBlankDownloadToken({ email: "zav@example.com", target: HYGIENE, format: "pdf" }, NOW);
  const [body, sig] = token.split(".");
  const forgedBody = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), e: "evil@example.com" }),
  ).toString("base64url");
  const expect = { target: HYGIENE, format: "pdf" } as const;
  assert.deepEqual(verifyBlankDownloadToken(`${forgedBody}.${sig}`, expect, NOW), { ok: false, reason: "bad-sig" });
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  assert.deepEqual(verifyBlankDownloadToken(`${body}.${flipped}`, expect, NOW), { ok: false, reason: "bad-sig" });
  assert.deepEqual(verifyBlankDownloadToken("abc", expect, NOW), { ok: false, reason: "bad-format" });
  assert.deepEqual(verifyBlankDownloadToken(`${token}.x`, expect, NOW), { ok: false, reason: "bad-format" });
  assert.deepEqual(verifyBlankDownloadToken("", expect, NOW), { ok: false, reason: "missing" });
  assert.deepEqual(verifyBlankDownloadToken(null, expect, NOW), { ok: false, reason: "missing" });

  // Другой секрет (другой сервер) — ссылка не подходит.
  const saved = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = "another-secret-for-blank-download-987654";
  try {
    assert.deepEqual(verifyBlankDownloadToken(token, expect, NOW), { ok: false, reason: "bad-sig" });
  } finally {
    process.env.NEXTAUTH_SECRET = saved;
  }
});

test("ссылка на файл с токеном", () => {
  const token = signBlankDownloadToken({ email: "zav@example.com", target: HYGIENE, format: "docx" }, NOW);
  const href = blankDownloadHref(HYGIENE, "docx", token);
  assert.ok(href.startsWith("/api/journal-samples/hygiene/docx?t="));
  assert.equal(new URL(href, "https://wesetup.ru").searchParams.get("t"), token);
});

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost:3002/api/journal-samples/hygiene/pdf", { headers });
}

test("кто пришёл: браузер (переход по ссылке) или скрипт", () => {
  assert.equal(isBrowserNavigation(req({ "sec-fetch-mode": "navigate" })), true);
  assert.equal(isBrowserNavigation(req({ "sec-fetch-mode": "cors", accept: "text/html" })), false);
  assert.equal(isBrowserNavigation(req({ accept: "text/html,application/xhtml+xml" })), true);
  assert.equal(isBrowserNavigation(req({ accept: "*/*" })), false);
  assert.equal(isBrowserNavigation(req({})), false);
});

test("файл без токена: браузер — на страницу журнала с окном email, остальным — 403", async () => {
  const browser = blankDownloadDenied(req({ "sec-fetch-mode": "navigate" }), HYGIENE, "pdf", "missing");
  assert.equal(browser.status, 307);
  assert.equal(browser.headers.get("location"), "/journals-info/hygiene?download=pdf");
  assert.equal(browser.headers.get("cache-control"), "no-store");

  const stale = blankDownloadDenied(req({ accept: "text/html" }), HYGIENE, "docx", "expired");
  assert.equal(stale.headers.get("location"), "/journals-info/hygiene?download=docx&expired=1");

  const paper = blankDownloadDenied(req({ "sec-fetch-mode": "navigate" }), { kind: "paper", paperId: "ot_intro" }, "pdf", "bad-sig");
  assert.equal(paper.headers.get("location"), "/blanki?download=pdf&paper=ot_intro");

  const script = blankDownloadDenied(req({ accept: "*/*" }), HYGIENE, "pdf", "missing");
  assert.equal(script.status, 403);
  const body = (await script.json()) as { error: string; page: string };
  assert.match(body.error, /после ввода email/);
  assert.equal(body.page, "/journals-info/hygiene?download=pdf");
});
