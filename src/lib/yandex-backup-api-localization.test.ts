import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
type Options = { allowed?: boolean; connected?: boolean; pingOk?: boolean; uploadError?: boolean };
function fixture(run: boolean, options: Options = {}) {
  const calls: { name: string; input: unknown }[] = [];
  const record = (name: string) => async (input: unknown) => { calls.push({ name, input }); return {}; };
  const fixtureModule = { exports: {} as Record<string, (request?: Request) => Promise<Response>> };
  const code = ts.transpileModule(readFileSync(`src/app/api/settings/yandex-backup/${run ? "run/" : ""}route.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module: fixtureModule, exports: fixtureModule.exports, Date, Request, Response, Error,
    require: (id: string) => {
      if (id === "@/lib/auth-helpers") return { requireAuth: async () => ({ user: { id: "user", name: "Original user", organizationId: "home-org" } }), getActiveOrgId: () => "active-org" };
      if (id === "@/lib/role-access") return { hasFullWorkspaceAccess: () => options.allowed !== false };
      if (id === "@/lib/db") return { db: { organization: {
        findUnique: async (input: unknown) => { calls.push({ name: "find", input }); return { yandexDiskToken: options.connected === false ? null : "stored-secret", yandexDiskFolder: "/Original-folder", yandexDiskLastBackupAt: null }; },
        update: record("update"),
      }, auditLog: { create: record("audit") } } };
      if (id === "@/lib/org-backup") return { buildOrgBackup: async (orgId: string) => { calls.push({ name: "backup", input: orgId }); return { customer: "Original O‘rik", canonical: "Русское значение" }; } };
      if (id === "@/lib/yandex-disk") return {
        YandexDiskError: class extends Error {},
        pingDisk: async (token: string) => { calls.push({ name: "ping", input: token }); return { ok: options.pingOk !== false, userLogin: "original-login", reason: "Original provider diagnostic" }; },
        uploadJson: async (...args: unknown[]) => { calls.push({ name: "upload", input: args }); if (options.uploadError) throw new Error("Original provider diagnostic"); return { path: "/Original-file.json", sizeBytes: 1234 }; },
      };
      return require(id);
    },
  });
  return { handlers: fixtureModule.exports, calls };
}
const request = (body: unknown) => new Request("http://fixture/backup", { method: "PUT", body: JSON.stringify(body) });

test("Yandex API preserves authorization and legacy errors with additive stable codes", async () => {
  for (const run of [false, true]) for (const method of run ? ["POST"] : ["GET", "PUT", "DELETE"]) {
    const view = fixture(run, { allowed: false });
    const response = await view.handlers[method](request({}));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Это действие доступно руководителю", errorCode: "YANDEX_BACKUP_FORBIDDEN" });
    assert.deepEqual(view.calls, []);
  }
  const malformed = fixture(false);
  const invalid = await malformed.handlers.PUT(new Request("http://fixture", { method: "PUT", body: "{" }));
  assert.deepEqual(await invalid.json(), { error: "Invalid JSON", errorCode: "YANDEX_BACKUP_INVALID_INPUT" });
  const short = await malformed.handlers.PUT(request({ token: "x" }));
  assert.equal(short.status, 400); assert.equal((await short.json()).errorCode, "YANDEX_BACKUP_INVALID_INPUT");
  assert.deepEqual(malformed.calls, []);
  const rejected = fixture(false, { pingOk: false });
  const ping = await rejected.handlers.PUT(request({ token: "original-token" }));
  assert.deepEqual(await ping.json(), { error: "Не удалось подключиться: Original provider diagnostic", errorCode: "YANDEX_BACKUP_CONNECT_FAILED" });
  assert.equal(rejected.calls.length, 1);
});

test("Yandex API keeps active tenant, token/folder semantics, raw backup contents and audit", async () => {
  const view = fixture(false);
  assert.equal((await view.handlers.GET()).status, 200);
  const connected = await view.handlers.PUT(request({ token: " original-token ", folder: " Customer O‘rik " }));
  assert.deepEqual(await connected.json(), { ok: true, userLogin: "original-login" });
  await view.handlers.DELETE();
  const calls = JSON.parse(JSON.stringify(view.calls));
  assert.equal(calls[0].input.where.id, "active-org");
  assert.deepEqual(calls[2].input, { where: { id: "active-org" }, data: { yandexDiskToken: "original-token", yandexDiskFolder: "/Customer O‘rik" } });
  assert.deepEqual(calls[3].input, { where: { id: "active-org" }, data: { yandexDiskToken: null } });
  const run = fixture(true);
  assert.equal((await run.handlers.POST()).status, 200);
  const operations = JSON.parse(JSON.stringify(run.calls));
  assert.equal(operations.find((item: { name: string }) => item.name === "backup").input, "active-org");
  const upload = operations.find((item: { name: string }) => item.name === "upload").input;
  assert.equal(upload[0], "stored-secret"); assert.equal(upload[1], "/Original-folder");
  assert.deepEqual(upload[3], { customer: "Original O‘rik", canonical: "Русское значение" });
  const audit = operations.find((item: { name: string }) => item.name === "audit").input.data;
  assert.equal(audit.organizationId, "active-org"); assert.equal(audit.action, "yandex_backup.manual");
  const disconnected = fixture(true, { connected: false });
  const missing = await disconnected.handlers.POST();
  assert.equal(missing.status, 400); assert.equal((await missing.json()).errorCode, "YANDEX_BACKUP_NOT_CONNECTED");
  assert.equal(disconnected.calls.length, 1);
  const failure = fixture(true, { uploadError: true });
  const error = await failure.handlers.POST();
  assert.equal(error.status, 500);
  assert.deepEqual(await error.json(), { error: "Original provider diagnostic", errorCode: "YANDEX_BACKUP_UPLOAD_FAILED" });
  assert.ok(!failure.calls.some(call => call.name === "audit" || call.name === "update"));
});
