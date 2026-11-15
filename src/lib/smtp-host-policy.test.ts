import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedPrivateImapAddress, isTrustedPrivateSmtpAddress } from "./smtp-host-policy";

const trusted = JSON.stringify({ "wesetup.ru": ["192.168.33.3"] });
test("operator policy matches an exact owned hostname/LAN IP for required STARTTLS only", () => {
  assert.equal(isTrustedPrivateSmtpAddress("WESETUP.RU", "192.168.33.3", 587, false, trusted), true);
  for (const [host, ip, port, secure] of [
    ["other.example.com", "192.168.33.3", 587, false], ["wesetup.ru", "192.168.33.4", 587, false],
    ["wesetup.ru", "192.168.33.3", 25, false], ["wesetup.ru", "192.168.33.3", 465, true],
    ["wesetup.ru", "192.168.33.3", 587, true], ["192.168.33.3", "192.168.33.3", 587, false],
  ] as const) assert.equal(isTrustedPrivateSmtpAddress(host, ip, port, secure, trusted), false);
});

test("missing/malformed/operator mistakes fail closed, never allow CIDRs or special network targets", () => {
  for (const raw of [null, "", "{", "null", "[]", '"text"', '{"wesetup.ru":true}', '{"wesetup.ru":[]}', '{"wesetup.ru":["192.168.33.3",null]}', '{"*.ru":["192.168.33.3"]}', '{"wesetup.ru":["192.168.33.0/24"]}']) {
    assert.equal(isTrustedPrivateSmtpAddress("wesetup.ru", "192.168.33.3", 587, false, raw), false);
  }
  for (const ip of ["127.0.0.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "192.168.33.999", "::1", "::ffff:192.168.33.3", "fd00::1", "8.8.8.8"]) {
    assert.equal(isTrustedPrivateSmtpAddress("wesetup.ru", ip, 587, false, JSON.stringify({ "wesetup.ru": [ip] })), false, ip);
  }
});

test("owned IMAP policy requires port 143 STARTTLS and inherits exact-host fail-closed restrictions", () => {
  assert.equal(isTrustedPrivateImapAddress("wesetup.ru", "192.168.33.3", 143, false, trusted), true);
  for (const [host, ip, port, secure, policy] of [
    ["other.example.com", "192.168.33.3", 143, false, trusted],
    ["wesetup.ru", "192.168.33.4", 143, false, trusted],
    ["wesetup.ru", "192.168.33.3", 587, false, trusted],
    ["wesetup.ru", "192.168.33.3", 993, true, trusted],
    ["wesetup.ru", "192.168.33.3", 143, true, trusted],
    ["wesetup.ru", "192.168.33.3", 143, false, null],
    ["wesetup.ru", "192.168.33.3", 143, false, "{"],
    ["wesetup.ru", "127.0.0.1", 143, false, '{"wesetup.ru":["127.0.0.1"]}'],
  ] as const) assert.equal(isTrustedPrivateImapAddress(host, ip, port, secure, policy), false);
});
