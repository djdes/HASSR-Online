import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-secret-for-proposal-token-0123456789";

import {
  PROPOSAL_TOKEN_MAX_LENGTH,
  proposalPdfUrl,
  proposalWebUrl,
  signProposalToken,
  verifyProposalToken,
} from "./token";
import type { ProposalVars } from "./types";

const vars: ProposalVars = {
  sphere: "cafe",
  companyName: "Кафе «Ромашка»",
  recipientName: "Анна Сергеевна",
  promo: { code: "romashka10", kind: "percent", value: 10, lifetime: true, endsAt: null },
  sender: { name: "Анна Петрова", phone: "+7 900 000-00-00", email: "Sales@Example.com", telegram: "@example_manager" },
};

describe("подписанный токен КП", () => {
  it("подпись и проверка: переменные возвращаются нормализованными", () => {
    const token = signProposalToken(vars);
    const check = verifyProposalToken(token);
    assert.equal(check.ok, true);
    if (!check.ok) return;
    assert.equal(check.vars.sphere, "cafe");
    assert.equal(check.vars.companyName, "Кафе «Ромашка»");
    assert.equal(check.vars.recipientName, "Анна Сергеевна");
    assert.deepEqual(check.vars.promo, { code: "ROMASHKA10", kind: "percent", value: 10, lifetime: true, endsAt: null });
    assert.deepEqual(check.vars.sender, {
      name: "Анна Петрова",
      phone: "+7 900 000-00-00",
      email: "sales@example.com",
      telegram: "example_manager",
    });
  });

  it("срок промокода переживает токен", () => {
    const endsAt = new Date("2026-10-31T21:00:00.000Z");
    const check = verifyProposalToken(signProposalToken({ sphere: "hotel", promo: { code: "OKT10", kind: "fixed", value: 500, lifetime: false, endsAt } }));
    assert.equal(check.ok, true);
    if (!check.ok) return;
    assert.equal(check.vars.promo?.kind, "fixed");
    assert.equal(check.vars.promo?.endsAt?.toISOString(), endsAt.toISOString());
  });

  it("одни и те же данные — одна и та же ссылка", () => {
    assert.equal(signProposalToken(vars), signProposalToken({ ...vars }));
  });

  it("подменённое тело или подпись — отказ", () => {
    const token = signProposalToken(vars);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, s: "cafe", p: { c: "FREE100", k: "p", v: 100, l: 1 } })).toString("base64url");
    assert.deepEqual(verifyProposalToken(`${forged}.${sig}`), { ok: false, reason: "bad-sig" });
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    assert.deepEqual(verifyProposalToken(`${body}.${flipped}`), { ok: false, reason: "bad-sig" });
  });

  it("подпись без контекста kp: не принимается", () => {
    const body = signProposalToken(vars).split(".")[0];
    const secret = process.env.NEXTAUTH_SECRET as string;
    const plain = crypto.createHmac("sha256", secret).update(body).digest("base64url");
    assert.deepEqual(verifyProposalToken(`${body}.${plain}`), { ok: false, reason: "bad-sig" });
    const withContext = crypto.createHmac("sha256", secret).update(`kp:${body}`).digest("base64url");
    assert.equal(verifyProposalToken(`${body}.${withContext}`).ok, true);
  });

  it("битый формат — отказ без исключений", () => {
    assert.deepEqual(verifyProposalToken(""), { ok: false, reason: "missing" });
    assert.deepEqual(verifyProposalToken("abc"), { ok: false, reason: "bad-format" });
    assert.deepEqual(verifyProposalToken("a.b.c"), { ok: false, reason: "bad-format" });
    assert.deepEqual(verifyProposalToken("тело.подпись"), { ok: false, reason: "bad-format" });
    assert.deepEqual(verifyProposalToken("%E0%A4%A.x"), { ok: false, reason: "bad-format" });
    assert.deepEqual(verifyProposalToken(`${"a".repeat(PROPOSAL_TOKEN_MAX_LENGTH)}.b`), { ok: false, reason: "bad-format" });
  });

  it("закодированный в адресе токен тоже читается", () => {
    const token = signProposalToken(vars);
    assert.equal(verifyProposalToken(encodeURIComponent(token).replace(".", "%2E")).ok, true);
  });

  it("неизвестная сфера в подписанном токене становится «other»", () => {
    const check = verifyProposalToken(signProposalToken({ sphere: "spaceport" as ProposalVars["sphere"] }));
    assert.equal(check.ok && check.vars.sphere, "other");
  });

  it("proposalWebUrl — /kp/<токен> на заданной базе, PDF — /pdf", () => {
    const url = proposalWebUrl(vars, "https://wesetup.ru/");
    assert.match(url, /^https:\/\/wesetup\.ru\/kp\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(proposalPdfUrl(url), `${url}/pdf`);
    const token = url.split("/kp/")[1];
    assert.equal(verifyProposalToken(token).ok, true);
  });
});
