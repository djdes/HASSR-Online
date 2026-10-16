import assert from "node:assert/strict";
import test from "node:test";
import { buildConnectionSnippets } from "./connection-snippets";

const SECRET = "wsk_" + "k".repeat(43);

test("без ключа во всех сниппетах плейсхолдер; с ключом — ключ, плейсхолдера нет", () => {
  const empty = buildConnectionSnippets({ baseUrl: "https://wesetup.ru", secret: null, placeholder: "<ваш ключ>" });
  for (const value of Object.values(empty)) assert.ok(value.includes("<ваш ключ>"), value);
  const filled = buildConnectionSnippets({ baseUrl: "https://wesetup.ru", secret: SECRET, placeholder: "<ваш ключ>" });
  for (const value of Object.values(filled)) {
    assert.ok(value.includes(SECRET), value);
    assert.equal(value.includes("<ваш ключ>"), false);
  }
  assert.equal(filled.claudeUrl, `https://wesetup.ru/api/mcp/${SECRET}`);
  assert.equal(filled.claudeCode, `claude mcp add --transport http wesetup https://wesetup.ru/api/mcp --header "Authorization: Bearer ${SECRET}"`);
});

test("cursorJson разбирается JSON.parse, url — base/api/mcp", () => {
  const s = buildConnectionSnippets({ baseUrl: "https://wesetup.ru", secret: SECRET, placeholder: "x" });
  const parsed = JSON.parse(s.cursorJson) as { mcpServers: { wesetup: { url: string; headers: { Authorization: string } } } };
  assert.equal(parsed.mcpServers.wesetup.url, "https://wesetup.ru/api/mcp");
  assert.equal(parsed.mcpServers.wesetup.headers.Authorization, `Bearer ${SECRET}`);
});

test("baseUrl со слэшем на конце не даёт двойного слэша", () => {
  const s = buildConnectionSnippets({ baseUrl: "https://wesetup.ru/", secret: null, placeholder: "K" });
  for (const value of Object.values(s)) assert.equal(value.includes("ru//"), false, value);
});
