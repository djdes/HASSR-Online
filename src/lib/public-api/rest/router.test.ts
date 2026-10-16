import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_API_TOOLS } from "../tools";
import { matchRestRoute } from "./router";

test("GET documents/abc → get_journal_document с documentId", () => {
  const m = matchRestRoute("GET", ["documents", "abc"], PUBLIC_API_TOOLS);
  assert.equal(m.kind, "tool");
  if (m.kind !== "tool") return;
  assert.equal(m.tool.name, "get_journal_document");
  assert.deepEqual(m.params, { documentId: "abc" });
});

test("POST documents/abc/cells → fill_journal_cells", () => {
  const m = matchRestRoute("POST", ["documents", "abc", "cells"], PUBLIC_API_TOOLS);
  assert.equal(m.kind === "tool" ? m.tool.name : m.kind, "fill_journal_cells");
});

test("GET и POST employees → list_employees и add_employee", () => {
  const get = matchRestRoute("GET", ["employees"], PUBLIC_API_TOOLS);
  const post = matchRestRoute("POST", ["employees"], PUBLIC_API_TOOLS);
  assert.equal(get.kind === "tool" ? get.tool.name : get.kind, "list_employees");
  assert.equal(post.kind === "tool" ? post.tool.name : post.kind, "add_employee");
});

test("DELETE employees → method_not_allowed с allow [GET, POST]", () => {
  assert.deepEqual(matchRestRoute("DELETE", ["employees"], PUBLIC_API_TOOLS), { kind: "method_not_allowed", allow: ["GET", "POST"] });
});

test("неизвестный путь и документ без id → not_found", () => {
  assert.deepEqual(matchRestRoute("GET", ["nope"], PUBLIC_API_TOOLS), { kind: "not_found" });
  assert.deepEqual(matchRestRoute("GET", ["documents"], PUBLIC_API_TOOLS), { kind: "not_found" });
});
