import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest } from "next/server";
import { mintTaskFillToken } from "./task-fill-token";

type Handler = (request: Request, ctx: { params: Promise<{ taskId: string }> }) => Promise<Response>;
const modules = ["", "checklist", "close-no-events", "photo", "reopen", "status", "step", "verify", "yesterday-prefill"];
const ctx = (taskId = "51") => ({ params: Promise.resolve({ taskId }) });

function fixture(route: string, options: { kind?: string; candidates?: boolean; adminOnly?: boolean } = {}) {
  const require = createRequire(import.meta.url);
  const calls: Array<{ name: string; input: unknown }> = [];
  const source = ts.transpileModule(readFileSync(`src/app/api/task-fill/[taskId]/${route ? route + "/" : ""}route.ts`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const record = (name: string) => async (input: unknown) => { calls.push({ name, input }); return {}; };
  const candidates = ["other-secret", "correct-secret"].map((secret, index) => ({
    id: `link-${index}`, tasksflowTaskId: 51, kind: options.kind ?? "verifier", journalCode: "custom", journalDocumentId: `doc-${index}`,
    rowKey: "employee-user-id", remoteStatus: "completed", integration: { webhookSecret: secret, organizationId: `org-${index}` },
  }));
  const fixtureModule = { exports: {} };
  vm.runInNewContext(source, {
    module: fixtureModule, exports: fixtureModule.exports, Date, Buffer, Request, Response, File, FormData, URL, console, process,
    require: (id: string) => {
      if (id === "@/lib/db") return { db: {
        tasksFlowTaskLink: { findMany: async () => options.candidates === false ? [] : candidates, update: record("link.update") },
        journalDocument: { update: record("document.update") }, journalDocumentEntry: { updateMany: record("entries.update") },
        journalTemplate: { findFirst: async () => ({ id: "template", taskScope: "personal" }) },
        organization: { findUnique: async () => ({ requireAdminForJournalEdit: options.adminOnly }) },
        user: { findUnique: async () => ({ id: "user-id", role: "cook" }) },
        $transaction: async (queries: Promise<unknown>[]) => Promise.all(queries),
      } };
      if (id === "@/lib/audit-log") return { recordAuditLog: record("audit") };
      if (id === "@/lib/tasksflow-adapters") return { getAdapter: () => ({ getTaskForm: async () => ({ fields: [{ key: "amount", label: "Customer amount", type: "number", required: true }] }) }) };
      if (id === "@/lib/tasksflow-client") return { TasksFlowError: class extends Error {}, tasksflowClientFor: () => { throw new Error("Unexpected remote call"); } };
      if (id === "@/lib/journal-close-events" || id === "@/lib/smart-defaults") return {};
      if (id === "fs/promises") return { writeFile: () => { throw new Error("Unexpected file write"); }, mkdir: () => { throw new Error("Unexpected mkdir"); } };
      return require(id);
    },
  });
  return { handlers: fixtureModule.exports as Record<string, Handler>, calls };
}

function request(body: unknown) { return new Request("http://fixture/task", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }); }

test("all nine actual task-fill handler modules retain validation status and return stable additive error codes", async () => {
  for (const route of modules) {
    const { handlers, calls } = fixture(route);
    const handler = handlers.POST ?? handlers.GET;
    const response = await handler(new NextRequest("http://fixture/task"), ctx("invalid"));
    assert.equal(response.status, 400, route);
    const data = await response.json();
    assert.ok(["badTaskId", "invalidBody"].includes(data.errorCode), route);
    assert.equal(typeof data.error, "string", route);
    assert.deepEqual(calls, []);
  }
});

test("actual verifier HMAC selects the matching integration, preserving organization, document and rejection text", async () => {
  const { handlers, calls } = fixture("verify");
  const token = mintTaskFillToken(51, "correct-secret");
  const reason = "Customer reason O‘tkir — исправить";
  const response = await handlers.POST(request({ token, decision: "rejected", reason }), ctx());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, decision: "rejected" });
  const serialized = JSON.parse(JSON.stringify(calls));
  assert.equal(serialized.find((item: {name: string}) => item.name === "document.update").input.where.id, "doc-1");
  assert.equal(serialized.find((item: {name: string}) => item.name === "document.update").input.data.verificationRejectReason, reason);
  assert.equal(serialized.find((item: {name: string}) => item.name === "audit").input.organizationId, "org-1");
  assert.ok(!JSON.stringify(serialized).includes("doc-0"));
});

test("invalid or mismatched tokens and non-verifier tasks cannot write; legacy error text is retained", async () => {
  for (const token of ["invalid-token", mintTaskFillToken(52, "correct-secret"), mintTaskFillToken(51, "wrong-secret")]) {
    const { handlers, calls } = fixture("verify");
    const response = await handlers.POST(request({ token, decision: "approved" }), ctx());
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { errorCode: "invalidToken", error: "Bad signature or expired token" });
    assert.deepEqual(calls, []);
  }
  const { handlers, calls } = fixture("verify", { kind: "filler" });
  const response = await handlers.POST(request({ token: mintTaskFillToken(51, "correct-secret"), decision: "approved" }), ctx());
  assert.equal(response.status, 400);
  assert.equal((await response.json()).errorCode, "notVerifierTask");
  assert.deepEqual(calls, []);
});

test("actual completion handler keeps admin edit restriction and field-key validation contract", async () => {
  const token = mintTaskFillToken(51, "correct-secret");
  const locked = fixture("", { adminOnly: true });
  const forbidden = await locked.handlers.POST(request({ token, values: { amount: 12 } }), ctx());
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).errorCode, "adminEditOnly");
  assert.deepEqual(locked.calls, []);
  const invalid = fixture("");
  const response = await invalid.handlers.POST(request({ token, values: { amount: "not-a-number" } }), ctx());
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.equal(data.errorCode, "fieldInvalid");
  assert.equal(data.errorParams.field, "amount");
  assert.ok(data.error.includes("Customer amount"));
  assert.deepEqual(invalid.calls, []);
});
