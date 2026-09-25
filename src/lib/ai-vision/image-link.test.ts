import assert from "node:assert/strict";
import test from "node:test";

import {
  VISION_IMAGE_TTL_MS,
  buildVisionImageUrl,
  isVisionImageId,
  signVisionImage,
  signedVisionImageUrl,
  verifyVisionImageLink,
} from "@/lib/ai-vision/image-link";

const SECRET = "test-secret-0123456789abcdef";
const ID = "0123456789abcdef0123456789abcdef-jpg";
const NOW = 1_790_000_000_000;

test("id: 32 hex + -jpg/-png/-webp, без точек и путей", () => {
  assert.equal(isVisionImageId(ID), true);
  assert.equal(isVisionImageId("0123456789abcdef0123456789abcdef-png"), true);
  for (const bad of ["../etc/passwd", "0123456789abcdef0123456789abcdef-gif", "0123456789abcdef0123456789abcdef.jpg", "0123456789ABCDEF0123456789ABCDEF-jpg", "abc-jpg", `${ID}/x`, 42]) {
    assert.equal(isVisionImageId(bad), false, String(bad));
  }
});

test("верная подпись до срока — ok", () => {
  const exp = NOW + VISION_IMAGE_TTL_MS;
  const sig = signVisionImage(ID, exp, SECRET);
  assert.deepEqual(verifyVisionImageLink({ id: ID, exp: String(exp), sig, now: NOW, secret: SECRET }), { ok: true });
});

test("подделка подписи, id или срока — bad_sig", () => {
  const exp = NOW + VISION_IMAGE_TTL_MS;
  const sig = signVisionImage(ID, exp, SECRET);
  const otherId = "fedcba9876543210fedcba9876543210-jpg";
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  assert.deepEqual(verifyVisionImageLink({ id: ID, exp: String(exp), sig: flipped, now: NOW, secret: SECRET }), {
    ok: false,
    reason: "bad_sig",
  });
  assert.deepEqual(verifyVisionImageLink({ id: otherId, exp: String(exp), sig, now: NOW, secret: SECRET }), {
    ok: false,
    reason: "bad_sig",
  });
  // Продлить срок, не зная секрета, нельзя.
  assert.deepEqual(verifyVisionImageLink({ id: ID, exp: String(exp + 60_000), sig, now: NOW, secret: SECRET }), {
    ok: false,
    reason: "bad_sig",
  });
  // Подпись другим секретом не подходит.
  const foreign = signVisionImage(ID, exp, "another-secret-0123456789");
  assert.equal(verifyVisionImageLink({ id: ID, exp: String(exp), sig: foreign, now: NOW, secret: SECRET }).ok, false);
});

test("истёкшая ссылка с верной подписью — expired", () => {
  const exp = NOW - 1;
  const sig = signVisionImage(ID, exp, SECRET);
  assert.deepEqual(verifyVisionImageLink({ id: ID, exp: String(exp), sig, now: NOW, secret: SECRET }), {
    ok: false,
    reason: "expired",
  });
});

test("мусор в параметрах — отказ без исключений", () => {
  const exp = NOW + 1000;
  assert.equal(verifyVisionImageLink({ id: ID, exp: "abc", sig: "x", now: NOW, secret: SECRET }).ok, false);
  assert.equal(verifyVisionImageLink({ id: ID, exp: null, sig: null, now: NOW, secret: SECRET }).ok, false);
  assert.equal(verifyVisionImageLink({ id: ID, exp: String(exp), sig: "short", now: NOW, secret: SECRET }).ok, false);
  assert.equal(verifyVisionImageLink({ id: "../../x", exp: String(exp), sig: "x".repeat(43), now: NOW, secret: SECRET }).ok, false);
});

test("без секрета подписывать нельзя", () => {
  assert.throws(() => signVisionImage(ID, NOW, "short"));
});

test("ссылка: база без хвостового слеша, срок = сейчас + 15 минут", () => {
  const url = signedVisionImageUrl("https://wesetup.ru/", ID, NOW, SECRET);
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://wesetup.ru");
  assert.equal(parsed.pathname, `/api/ai/vision-image/${ID}`);
  const exp = parsed.searchParams.get("exp");
  assert.equal(Number(exp), NOW + VISION_IMAGE_TTL_MS);
  assert.deepEqual(
    verifyVisionImageLink({ id: ID, exp, sig: parsed.searchParams.get("sig"), now: NOW + 60_000, secret: SECRET }),
    { ok: true }
  );
  assert.equal(buildVisionImageUrl("http://localhost:3042", ID, 1, "s"), `http://localhost:3042/api/ai/vision-image/${ID}?exp=1&sig=s`);
});
