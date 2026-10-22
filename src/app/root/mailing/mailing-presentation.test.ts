import test from "node:test";
import assert from "node:assert/strict";
import { BILLING_KIND_LABELS } from "@/lib/mailing/labels";
import { ORG_SPHERES } from "@/lib/org-profile";
import ru from "@/i18n/messages/ru.json";
import { billingDisplayKey, sphereDisplayKey, literalMailingCounter, formatMailingDate, formatMailingSaveClock } from "./mailing-presentation";
import { api, formatDate, formatDateTime } from "./ui";

test("known audience codes have source-exact RU copy and prototype lookalikes remain literal", () => {
  const messages = ru.rootMailingShellAudience;
  for (const [code, label] of Object.entries(BILLING_KIND_LABELS)) {
    const key = billingDisplayKey(code);
    assert.ok(key);
    assert.equal(messages.billing[code as keyof typeof messages.billing], label);
  }
  for (const sphere of ORG_SPHERES) {
    assert.ok(sphereDisplayKey(sphere.value));
    assert.equal(messages.spheres[sphere.value], sphere.label);
  }
  for (const raw of ["constructor", "__proto__", "toString", "hasOwnProperty", "", "Подписка", "Ресторан", "PAID", " custom "]) {
    assert.equal(billingDisplayKey(raw), null);
    assert.equal(sphereDisplayKey(raw), null);
  }
});

test("bare JSX counters retain nullish absence and ungrouped large values", () => {
  for (const [value, expected] of [[0, "0"], [1, "1"], [12500, "12500"], [null, ""], [undefined, ""]] as const) {
    assert.equal(literalMailingCounter(value), expected);
  }
  assert.equal(String(["raw"].length), "1");
});

test("audience dates preserve original RU/default behavior and healthy UZ including historical instants", () => {
  const values = [null, "", "invalid-date", "0001-01-01T00:00:00Z", "0099-12-31T23:59:59Z", "1880-01-01T21:30:00Z", "1969-12-31T21:30:00Z", "1970-01-01T00:00:00Z", "2026-10-17T21:34:56.789Z", new Date(-8640000000000000).toISOString(), new Date(8640000000000000).toISOString()];
  for (const value of values) {
    const original = value ? new Date(value).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }) : "—";
    const healthy = value ? new Date(value).toLocaleDateString("en-GB", { timeZone: "Europe/Moscow" }) : "—";
    assert.equal(formatDate(value), original);
    assert.equal(formatDate(value, "ru"), original);
    assert.equal(formatMailingDate(value, "ru"), original);
    assert.equal(formatDate(value, "en"), healthy);
    assert.equal(formatDate(value, "uz"), healthy);
    assert.equal(formatDateTime(value), value ? new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
  }
});

test("saved clock retains host-local hours and minutes", () => {
  const timestamp = Date.parse("2026-10-17T21:34:56.789Z");
  for (const locale of ["ru", "en", "uz"] as const) {
    assert.equal(formatMailingSaveClock(timestamp, locale), new Date(timestamp).toLocaleTimeString(locale === "ru" ? "ru-RU" : "en-GB", { hour: "2-digit", minute: "2-digit" }));
  }
});

test("shared API retains malformed-success/null and legacy nonOK/body/header contracts", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  try {
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response("not JSON", { status: 200 });
    };
    assert.equal(await api("offline-fixture://no-network", { method: "POST", json: { title: "Рассылка", count: null }, headers: { "X-Raw": "original" } }), null);
    assert.equal(calls[0].init?.cache, "no-store");
    assert.equal(calls[0].init?.body, '{"title":"Рассылка","count":null}');
    assert.deepEqual(calls[0].init?.headers, { "Content-Type": "application/json", "X-Raw": "original" });
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "RAW diagnostics" }), { status: 422 });
    await assert.rejects(api("offline-fixture://no-network"), { message: "RAW diagnostics" });
    globalThis.fetch = async () => new Response("bad JSON", { status: 503 });
    await assert.rejects(api("offline-fixture://no-network"), { message: "Ошибка 503" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
