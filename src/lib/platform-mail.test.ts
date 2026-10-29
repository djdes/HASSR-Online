import assert from "node:assert/strict";
import test from "node:test";
import { formatFromAddress, isAllowedSmtpHost, isPrivateIp, mailSenderSchema, mailSenderStatus, SMTP_PROVIDER_PRESETS } from "@/lib/platform-mail";

test("only public SMTP hosts are accepted", () => {
  for (const host of ["smtp.yandex.ru", "smtp.mail.ru", "mail.example.com", "8.8.8.8"]) assert.equal(isAllowedSmtpHost(host), true, host);
  for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.10", "172.20.1.1", "169.254.169.254", "relay", "mail.local", "a.internal", "smtp yandex.ru", "0.0.0.0"]) {
    assert.equal(isAllowedSmtpHost(host), false, host);
  }
  for (const preset of SMTP_PROVIDER_PRESETS) assert.equal(isAllowedSmtpHost(preset.host), true, preset.key);
});

test("sender form validation: required fields, ports, optional extras", () => {
  const ok = mailSenderSchema.safeParse({
    fromName: "Денис Волков",
    fromEmail: " Denis@Example.com ",
    host: "SMTP.Yandex.ru",
    port: "465",
    secure: true,
    username: "denis@example.com",
  });
  assert.ok(ok.success);
  assert.equal(ok.data.fromEmail, "denis@example.com");
  assert.equal(ok.data.host, "smtp.yandex.ru");
  assert.equal(ok.data.port, 465);
  assert.equal(ok.data.password, "");

  const bad = mailSenderSchema.safeParse({ fromName: "Д", fromEmail: "x", host: "127.0.0.1", port: 8080, secure: false, username: "" });
  assert.equal(bad.success, false);
  const fields = new Set(bad.error.issues.map((issue) => issue.path[0]));
  for (const field of ["fromName", "fromEmail", "host", "port", "username"]) assert.ok(fields.has(field), field);
});

test("From header and status", () => {
  assert.equal(formatFromAddress('Денис "БФС"\r\n', "d@x.ru"), '"Денис БФС" <d@x.ru>');
  assert.equal(formatFromAddress("", "d@x.ru"), "d@x.ru");
  assert.equal(mailSenderStatus(null), "none");
  assert.equal(mailSenderStatus({ enabled: false, verifiedAt: new Date(), lastError: null }), "disabled");
  assert.equal(mailSenderStatus({ enabled: true, verifiedAt: new Date(), lastError: null }), "verified");
  assert.equal(mailSenderStatus({ enabled: true, verifiedAt: null, lastError: "auth" }), "error");
  assert.equal(mailSenderStatus({ enabled: true, verifiedAt: null, lastError: null }), "unverified");
});

test("resolved addresses: internal networks are refused, public ones pass", () => {
  for (const ip of ["127.0.0.1", "127.92.2.3", "10.1.2.3", "172.16.0.1", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::ffff:127.0.0.1", "fd00::1", "fe80::1", "::"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["77.88.21.158", "217.69.139.160", "2a02:6b8::1", "::ffff:77.88.21.158"]) assert.equal(isPrivateIp(ip), false, ip);
});
