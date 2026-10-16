import assert from "node:assert/strict";
import test from "node:test";
import { extractApiKey, publicBaseUrl } from "./auth";

test("extractApiKey: ключ из пути важнее заголовка", () => {
  const req = new Request("http://x", { headers: { authorization: "Bearer HEADER" } });
  assert.equal(extractApiKey(req, "PATH"), "PATH");
});

test("extractApiKey: Bearer без учёта регистра, пробелы обрезаются; иначе null", () => {
  assert.equal(extractApiKey(new Request("http://x", { headers: { authorization: "bearer  abc " } })), "abc");
  assert.equal(extractApiKey(new Request("http://x", { headers: { authorization: "Basic abc" } })), null);
  assert.equal(extractApiKey(new Request("http://x")), null);
});

test("publicBaseUrl: без хвостового слэша, по умолчанию wesetup.ru", () => {
  const saved = process.env.NEXTAUTH_URL;
  try {
    process.env.NEXTAUTH_URL = "https://example.test///";
    assert.equal(publicBaseUrl(), "https://example.test");
    delete process.env.NEXTAUTH_URL;
    assert.equal(publicBaseUrl(), "https://wesetup.ru");
  } finally {
    if (saved === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = saved;
  }
});
