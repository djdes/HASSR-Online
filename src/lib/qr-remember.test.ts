import assert from "node:assert/strict";
import test from "node:test";

process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "test-secret-for-qr-pin-pass-0123456789";

import {
  REMEMBER_MAX_AGE_SEC,
  mintRememberValue,
  readRememberValue,
  rememberClearCookie,
  rememberCookieName,
  rememberSetCookie,
  shouldRefreshRemember,
} from "@/lib/qr-remember";

/**
 * «Запомнить выбор на этом оборудовании»: одна cookie на организацию для
 * всех QR-страниц (журналы, помещения, холодильники), подписанная, на
 * максимальный для браузеров срок с продлением при использовании.
 */
test("cookie своя у каждой организации", () => {
  assert.equal(rememberCookieName("org1"), "wesetup.qr.who.org1");
  assert.notEqual(rememberCookieName("org1"), rememberCookieName("org2"));
});

test("значение читается только своей организацией и не подделывается", () => {
  const value = mintRememberValue("org1", "emp1", 1000);
  assert.deepEqual(readRememberValue("org1", value), { employeeId: "emp1", issuedAtSec: 1000 });
  assert.equal(readRememberValue("org2", value), null);
  assert.equal(readRememberValue("org1", value.replace("emp1", "emp2")), null);
  assert.equal(readRememberValue("org1", "emp1"), null);
  assert.equal(readRememberValue("org1", undefined), null);
});

test("Set-Cookie: весь сайт, HttpOnly, 400 дней; очистка — Max-Age=0", () => {
  const header = rememberSetCookie("org1", "emp1", { secure: true, nowSec: 1000 });
  assert.match(header, /^wesetup\.qr\.who\.org1=1\.emp1\.1000\./);
  assert.match(header, /Path=\//);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, new RegExp(`Max-Age=${REMEMBER_MAX_AGE_SEC}`));
  assert.equal(REMEMBER_MAX_AGE_SEC, 400 * 24 * 3600);
  assert.match(rememberClearCookie("org1", { secure: false }), /^wesetup\.qr\.who\.org1=; .*Max-Age=0/);
});

test("продлеваем, если cookie старше недели", () => {
  assert.equal(shouldRefreshRemember(0, 6 * 24 * 3600), false);
  assert.equal(shouldRefreshRemember(0, 8 * 24 * 3600), true);
});
