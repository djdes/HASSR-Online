import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_API_TOOLS, findTool, toolsForAccess } from "./index";
import { toolInputJsonSchema } from "./types";

const ORDER = ["get_context", "list_journals", "get_journal_document", "fill_journal_cells", "list_employees", "add_employee"];

test("имена уникальны, в snake_case, порядок фиксирован", () => {
  const names = PUBLIC_API_TOOLS.map((t) => t.name);
  assert.deepEqual(names, ORDER);
  for (const name of names) assert.match(name, /^[a-z]+(_[a-z]+)*$/);
  assert.equal(findTool("list_journals")?.name, "list_journals");
  assert.equal(findTool("nope"), undefined);
});

test("у каждого инструмента inputSchema — объект без $schema", () => {
  for (const tool of PUBLIC_API_TOOLS) {
    const schema = toolInputJsonSchema(tool);
    assert.equal(schema.type, "object", tool.name);
    assert.equal("$schema" in schema, false, tool.name);
  }
});

test("пары rest.method + rest.path уникальны", () => {
  const keys = PUBLIC_API_TOOLS.map((t) => `${t.rest.method} ${t.rest.path}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("запись — только у fill_journal_cells и add_employee", () => {
  assert.deepEqual(
    PUBLIC_API_TOOLS.filter((t) => t.access === "write").map((t) => t.name),
    ["fill_journal_cells", "add_employee"]
  );
});

test("toolsForAccess: read — без инструментов записи, write — все шесть", () => {
  assert.deepEqual(toolsForAccess("read").map((t) => t.name), ["get_context", "list_journals", "get_journal_document", "list_employees"]);
  assert.equal(toolsForAccess("write").length, 6);
});

test("схема fill_journal_cells содержит описание поля documentId", () => {
  const schema = toolInputJsonSchema(findTool("fill_journal_cells")!) as { properties: Record<string, { description?: string }> };
  assert.ok(schema.properties.documentId.description);
  assert.ok((findTool("fill_journal_cells")!.description ?? "").length > 20);
});
