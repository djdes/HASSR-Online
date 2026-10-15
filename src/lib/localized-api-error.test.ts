import assert from "node:assert/strict";
import test from "node:test";
import { readLocalizedApiError } from "./localized-api-error";
import { journalApiErrors } from "./journal-api-errors";

test("client error presentation retains actual localized journal failures and ICU counts", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const api = await journalApiErrors(new Request("https://wesetup.ru/api/journal-documents/id"), { locale });
    const response = api.unsignedRows(Array.from({ length: 21 }, () => ({ productName: "Авторское O‘tkir" })));
    const payload = await response.clone().json();
    assert.equal(await readLocalizedApiError(response, locale, "Fallback"), payload.error);
    assert.ok(payload.error.includes("21"));
  }
});

test("legacy, mismatched, malformed and non-string errors use the caller's fallback", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const fallback = { ru: "Не удалось закрыть журнал", en: "Could not close the journal", uz: "Jurnalni yopib bo‘lmadi" }[locale];
    for (const response of [
      Response.json({ error: "Старая ошибка" }),
      Response.json({ error: "Different language" }, { headers: { "Content-Language": locale === "ru" ? "en" : "ru" } }),
      Response.json({ error: { private: "internal" } }, { headers: { "Content-Language": locale } }),
      Response.json({ error: "   " }, { headers: { "Content-Language": locale } }),
      new Response("upstream failure", { status: 502 }),
    ]) assert.equal(await readLocalizedApiError(response, locale, fallback), fallback);
    const customerReason = "Customer-authored: Цех O‘tkir";
    assert.equal(await readLocalizedApiError(Response.json({ error: customerReason }, { headers: { "Content-Language": locale } }), locale, fallback), customerReason);
  }
});

test("deferred response parsing resolves locale and fallback at feedback time", async () => {
  const body = Promise.withResolvers<unknown>();
  let locale = "en";
  const response = new Response(null, { headers: { "Content-Language": "en" } });
  response.json = () => body.promise;
  const pending = readLocalizedApiError(response, () => locale, () => `Fallback ${locale}`);
  locale = "uz";
  body.resolve({ error: "Old English response" });
  assert.equal(await pending, "Fallback uz");
});
