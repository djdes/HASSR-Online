import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_API_TOOLS } from "../tools";
import { buildOpenApiDocument } from "./openapi";

type Doc = { openapi: string; paths: Record<string, Record<string, any>>; servers: Array<{ url: string }> };
const doc = buildOpenApiDocument(PUBLIC_API_TOOLS, "https://wesetup.ru") as Doc;

test("openapi 3.1.0; путь есть у каждого инструмента; operationId = имя", () => {
  assert.equal(doc.openapi, "3.1.0");
  assert.equal(doc.servers[0].url, "https://wesetup.ru/api/v1");
  for (const tool of PUBLIC_API_TOOLS) {
    const op = doc.paths[tool.rest.path]?.[tool.rest.method.toLowerCase()];
    assert.ok(op, `${tool.rest.method} ${tool.rest.path}`);
    assert.equal(op.operationId, tool.name);
  }
});

test("/documents/{documentId}/cells: documentId — path, required, нет в теле", () => {
  const op = doc.paths["/documents/{documentId}/cells"].post;
  const param = op.parameters.find((p: { name: string }) => p.name === "documentId");
  assert.deepEqual({ in: param.in, required: param.required }, { in: "path", required: true });
  const body = op.requestBody.content["application/json"].schema;
  assert.equal("documentId" in (body.properties ?? {}), false);
  assert.equal((body.required ?? []).includes("documentId"), false);
});

test("GET /journals: date — параметр query", () => {
  const op = doc.paths["/journals"].get;
  const param = op.parameters.find((p: { name: string }) => p.name === "date");
  assert.equal(param.in, "query");
  assert.equal(param.required, false);
});

test("в документе нигде нет ключа $schema", () => {
  const seen: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k === "$schema") seen.push(k);
        walk(v);
      }
    }
  };
  walk(doc);
  assert.deepEqual(seen, []);
});
