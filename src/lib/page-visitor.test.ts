import assert from "node:assert/strict";
import { test } from "node:test";
import { issueVisitorToken, verifiedVisitorId } from "./page-visitor";

const secret = "visitor-test-fixture-not-a-credential";

test("a cookie the server signed verifies, and every token is new", () => {
  const first = issueVisitorToken(secret)!;
  const second = issueVisitorToken(secret)!;
  assert.match(first, /^v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/);
  assert.notEqual(first, second);
  assert.equal(verifiedVisitorId(first, secret), first.split(".")[1]);
});

test("forged, altered or foreign cookies are not a visitor", () => {
  const token = issueVisitorToken(secret)!;
  const [version, id, sign] = token.split(".");
  const flip = (value: string) => `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
  for (const forged of [
    `${version}.${flip(id)}.${sign}`,
    `${version}.${id}.${flip(sign)}`,
    `v2.${id}.${sign}`,
    `${token}.extra`,
    `${version}.${id}`,
    `${version}.${id}.${sign.slice(1)}`,
    "",
    "x".repeat(100),
  ]) {
    assert.equal(verifiedVisitorId(forged, secret), null, forged);
  }
  assert.equal(verifiedVisitorId(token, "another-secret"), null);
  assert.equal(verifiedVisitorId(undefined, secret), null);
});

test("without a secret there is no cookie and nothing verifies", () => {
  assert.equal(issueVisitorToken(""), null);
  assert.equal(verifiedVisitorId(issueVisitorToken(secret)!, ""), null);
});
