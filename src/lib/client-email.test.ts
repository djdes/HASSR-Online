import assert from "node:assert/strict";
import test from "node:test";
import { clientEmailContent, clientEmailSchema } from "./client-email";
import { canAccessPlatformPath } from "./platform-access";

const input = { to: "client@example.com", subject: "Письмо", message: "Здравствуйте!\n\nВторая строка", requestId: "c0d0ad5b-6bbb-4fb6-9b09-9523f4ece3d8" };

test("custom email validation rejects synthetic addresses, lists, headers, empty and oversized values", () => {
  assert.equal(clientEmailSchema.parse({ ...input, to: " Client@Example.com " }).to, "client@example.com");
  for (const extra of [
    { to: "staff@org.staff.local" }, { to: "staff@org.local.haccp" }, { to: "a@x.ru,b@x.ru" },
    { to: "a@x.ru\r\nBcc:other@x.ru" }, { subject: "Subject\r\nBcc: x@y.ru" }, { subject: "a\u0000b" },
    { subject: " " }, { message: " " }, { subject: "x".repeat(201) }, { message: "x".repeat(20001) }, { requestId: "not-a-uuid" },
  ]) assert.equal(clientEmailSchema.safeParse({ ...input, ...extra }).success, false, JSON.stringify(extra).slice(0, 80));
});

test("HTML-looking content and personal signature are escaped and line breaks preserved", () => {
  const result = clientEmailContent({ subject: '<img src=x onerror="x">', message: '<script>alert(1)</script>\nline\n\nNext & last' }, {
    fromName: "Иван <admin>", fromEmail: "ivan@example.com", phone: "+79990000000", position: "Менеджер", signature: "<b>Signature</b>",
  });
  assert.doesNotMatch(result.title + result.body, /<script|<img|<admin>|<b>Signature/);
  assert.match(result.body, /&lt;script&gt;/);
  assert.match(result.body, /&lt;b&gt;Signature&lt;\/b&gt;/);
  assert.match(result.body, /Next &amp; last/);
  assert.match(result.text, /Иван <admin>\nМенеджер\n\+79990000000\nivan@example.com/);
});

test("email routes are clients-section only and inaccessible to ordinary customers or unrelated staff", () => {
  for (const path of ["/api/root/organizations/org/emails", "/api/root/organizations/org/emails/preview"]) {
    for (const method of ["GET", "POST"]) {
      assert.equal(canAccessPlatformPath({ superadmin: true, sections: [] }, path, method), true);
      assert.equal(canAccessPlatformPath({ superadmin: false, sections: ["clients"] }, path, method), true);
      assert.equal(canAccessPlatformPath({ superadmin: false, sections: ["seo"] }, path, method), false);
      assert.equal(canAccessPlatformPath({ superadmin: false, sections: [] }, path, method), false);
    }
  }
});
