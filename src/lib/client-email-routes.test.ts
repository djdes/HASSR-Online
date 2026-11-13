import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
const context = { params: Promise.resolve({ id: "org-a" }) };
const input = { to: "client@example.com", subject: "Subject", message: "Body", requestId: "c0d0ad5b-6bbb-4fb6-9b09-9523f4ece3d8", senderUserId: "forged-user" };

/** Execute the actual route with transport/session/database boundaries replaced. */
function load(preview: boolean, mocks: Record<string, unknown>) {
  const file = `src/app/api/root/organizations/[id]/emails/${preview ? "preview/" : ""}route.ts`;
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} as Record<string, Handler> };
  vm.runInNewContext(source, { module: mod, exports: mod.exports, Request, Response, URL, require: (id: string) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (["@/lib/db", "@/lib/auth-helpers", "@/lib/client-email.server"].includes(id)) throw new Error(`Unmocked side effect: ${id}`);
    return require(id);
  } });
  return mod.exports;
}

test("actual correspondence routes enforce guard, org existence, validation, authenticated sender and audit idempotency", async () => {
  let denied = false, exists = true, repeated = false, configured = true;
  const calls: unknown[] = [];
  const item = { id: "email-a", to: input.to, subject: input.subject, status: "sent", fromEmail: "staff@example.com" };
  const mocks = {
    "@/lib/auth-helpers": { requireRoot: async () => { calls.push("guard"); if (denied) throw new Error("DENIED"); return { user: { id: "signed-in-staff" } }; } },
    "@/lib/db": { db: { organization: { findUnique: async (args: { where: { id: string } }) => { assert.equal(calls[0], "guard"); assert.equal(args.where.id, "org-a"); return exists ? { id: "org-a" } : null; } } } },
    "@/lib/audit-log": { recordAuditLog: async () => { calls.push("audit"); } },
    "@/lib/client-email.server": {
      clientEmailHistory: async (organizationId: string, cursor: string | null) => { calls.push(["history", organizationId, cursor]); return { items: [], nextCursor: null }; },
      clientEmailPreview: async (userId: string) => { assert.equal(userId, "signed-in-staff"); calls.push("preview"); return configured ? { html: "<html>brand</html>" } : null; },
      sendClientEmail: async (organizationId: string, userId: string) => { calls.push(["send", organizationId, userId]); return configured ? { item, repeated } : null; },
    },
  };
  const route = load(false, mocks), preview = load(true, mocks);
  const request = (body: unknown = input) => new Request("https://fixture.invalid/api?cursor=cursor-a", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  for (const handler of [route.GET, route.POST, preview.POST]) {
    denied = true; calls.length = 0;
    await assert.rejects(handler(request(), context), /DENIED/); assert.deepEqual(calls, ["guard"]);
    denied = false; exists = false; calls.length = 0;
    assert.equal((await handler(request(), context)).status, 404);
    assert.deepEqual(calls, ["guard"]); exists = true;
  }
  calls.length = 0;
  assert.equal((await route.GET(request(), context)).status, 200);
  assert.deepEqual(calls[1], ["history", "org-a", "cursor-a"]);
  for (const handler of [route.POST, preview.POST]) {
    calls.length = 0;
    assert.equal((await handler(request({ ...input, to: "synthetic@org.staff.local" }), context)).status, 400);
    assert.deepEqual(calls, ["guard"]);
    configured = false; calls.length = 0;
    assert.equal((await handler(request(), context)).status, 409); configured = true;
  }
  calls.length = 0;
  assert.equal((await route.POST(request(), context)).status, 200);
  assert.deepEqual(calls, ["guard", ["send", "org-a", "signed-in-staff"], "audit"]);
  repeated = true; calls.length = 0;
  assert.equal((await route.POST(request(), context)).status, 200); assert.ok(!calls.includes("audit"));
  calls.length = 0;
  assert.equal((await preview.POST(request(), context)).status, 200); assert.deepEqual(calls, ["guard", "preview"]);
});
