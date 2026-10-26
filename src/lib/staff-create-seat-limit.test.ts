import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path: string, mocks: Record<string, unknown>): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const fixture = { exports: {} };
  vm.runInNewContext(output, { module: fixture, exports: fixture.exports, require: (id: string) => mocks[id] ?? require(id) });
  return fixture.exports;
}

const refusal = (tier: string, nextTier: "standard" | "premium" | null, limit: number) => ({
  ok: false,
  status: 402,
  error: "Места заняты",
  code: "billing_free_limit",
  payUrl: "/settings/subscription",
  limit,
  activeUsers: limit,
  tier,
  nextTier,
});

test("«Сотрудники → Добавить»: отказ по местам несёт tier и nextTier до ответа API", async () => {
  for (const [tier, nextTier, limit] of [
    ["free", "standard", 1],
    ["standard", "premium", 25],
    ["premium", null, 100],
  ] as const) {
    const staffCreate = load("src/lib/staff-create.ts", {
      "@/lib/db": { db: { jobPosition: { findFirst: async () => ({ id: "pos", categoryKey: "kitchen", name: "Повар" }) } } },
      "@/lib/billing.server": { checkSeatsForActivation: async () => refusal(tier, nextTier, limit) },
    });
    const created = (await staffCreate.createStaffMember("org", { jobPositionId: "pos", fullName: "Новый Сотрудник" })) as Record<string, unknown>;
    assert.equal(created.ok, false);
    assert.equal(created.status, 402);
    assert.equal(created.tier, tier);
    assert.equal(created.nextTier, nextTier);

    const route = load("src/app/api/staff/route.ts", {
      "@/lib/auth-helpers": {
        requireAuth: async () => ({ user: { id: "manager", role: "manager", isRoot: false } }),
        getActiveOrgId: () => "org",
      },
      "@/lib/staff-create": { createStaffMember: async () => created },
    });
    const response = (await route.POST(
      new Request("https://example.test/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobPositionId: "pos", fullName: "Новый Сотрудник" }),
      })
    )) as Response;
    assert.equal(response.status, 402);
    const body = await response.json();
    assert.equal(body.code, "billing_free_limit");
    assert.equal(body.limit, limit);
    assert.equal(body.tier, tier);
    // null у «Премиума» — тост покажет «по согласованию» и «Связаться».
    assert.ok("nextTier" in body);
    assert.equal(body.nextTier, nextTier);
  }
});
