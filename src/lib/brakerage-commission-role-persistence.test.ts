import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as commission from "@/lib/brakerage-commission";

const require = createRequire(import.meta.url);
function load(path: string, mocks: Record<string, unknown>): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const fixture = { exports: {} };
  vm.runInNewContext(output, { module: fixture, exports: fixture.exports, require: (id: string) => mocks[id] ?? require(id) });
  return fixture.exports;
}
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("actual commission APIs and organization persistence retain role provenance through save, GET and adding a person", async () => {
  let organization: Record<string, unknown> = { another_journal: ["untouched"] };
  let activeConfig: Record<string, unknown> = { rows: [{ id: "row", signatures: [{ role: "Председатель", signedAt: "2026-10-15T07:06:00Z" }] }] };
  const originalRows = JSON.stringify(activeConfig.rows);
  const users = [{ id: "u1", name: "First" }, { id: "u2", name: "Second" }, { id: "u3", name: "Third" }, { id: "u4", name: "Fourth" }];
  const db = {
    user: { findMany: async ({ where }: { where: { organizationId: string; id?: { in: string[] } } }) => { assert.equal(where.organizationId, "org"); return users.filter(user => !where.id || where.id.in.includes(user.id)); } },
    organization: {
      findUnique: async () => ({ journalCommissionJson: organization }),
      update: async ({ data }: { data: { journalCommissionJson: Record<string, unknown> } }) => { organization = plain(data.journalCommissionJson); },
    },
    journalDocument: { findMany: async ({ where }: { where: { status: string; organizationId: string } }) => { assert.equal(where.status, "active"); assert.equal(where.organizationId, "org"); return [{ id: "active-document" }]; } },
  };
  const org = load("src/lib/brakerage-commission-org.ts", {
    "@/lib/brakerage-commission": commission, "@/lib/db": { db },
    "@/lib/document-config-lock": { withDocumentConfigLock: async (id: string, callback: (locked: unknown) => Promise<{ config: Record<string, unknown>; result: boolean }>) => { assert.equal(id, "active-document"); const result = await callback({ config: activeConfig }); activeConfig = plain(result.config); return result.result; } },
  });
  let management = true;
  const common = {
    "@/lib/auth-helpers": { getActiveOrgId: () => "org" }, "@/lib/auth": { authOptions: {} },
    "@/lib/server-session": { getServerSession: async () => ({ user: { id: "manager" } }) },
    "@/lib/role-access": { hasFullWorkspaceAccess: () => management },
    "@/lib/db": { db }, "@/lib/audit-log": { recordAuditLog: async () => undefined },
    "@/lib/brakerage-commission-org": org,
  };
  const api = load("src/app/api/settings/brakerage-commission/[code]/route.ts", common);
  const ctx = { params: Promise.resolve({ code: "finished_product" }) };
  const request = (members: unknown[]) => new Request("https://example.test/api/settings/brakerage-commission/finished_product", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ members }) });
  const response = await api.PUT(request([{ employeeId: "u1", ...commission.defaultCommissionRole("chair") }, { employeeId: "u2", role: "Член комиссии" }, { employeeId: "u3", roleKind: "invalid" }]), ctx) as Response;
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.members.map((member: commission.BrakerageCommissionMember) => [member.role, member.roleKind]), [["Председатель", "chair"], ["Член комиссии", undefined], ["Член комиссии", "member"]]);
  assert.deepEqual(activeConfig.commissionMembers, body.members);
  assert.equal(JSON.stringify(activeConfig.rows), originalRows);
  assert.deepEqual(organization.another_journal, ["untouched"]);
  const reopened = await api.GET(new Request("https://example.test"), ctx) as Response;
  assert.deepEqual((await reopened.json()).members, body.members);

  const create = load("src/app/api/settings/brakerage-commission/[code]/members/route.ts", {
    ...common,
    "@/lib/brakerage-commission-org": { ...org, ensureCommissionPosition: async () => ({ id: "commission-position" }) },
    "@/lib/staff-create": { createStaffMember: async () => ({ ok: true, user: users[3] }) },
    "@/lib/qr-fill-actor": { generateEmployeeQrPin: () => "739251", setEmployeeQrPin: async () => null },
  });
  const createResponse = await create.POST(new Request("https://example.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName: "Fourth", ...commission.defaultCommissionRole("member") }) }), ctx) as Response;
  assert.equal(createResponse.status, 200);
  const created = await createResponse.json();
  assert.deepEqual(created.members.map((member: commission.BrakerageCommissionMember) => member.roleKind), ["chair", undefined, "member", "member"]);
  const edited = created.members.map((member: commission.BrakerageCommissionMember) => ({ employeeId: member.employeeId, role: member.role }));
  const editedResponse = await api.PUT(request(edited), ctx) as Response;
  assert.ok((await editedResponse.json()).members.every((member: commission.BrakerageCommissionMember) => !member.roleKind));
  management = false;
  const before = JSON.stringify(organization);
  assert.equal((await api.PUT(request([]), ctx) as Response).status, 403);
  assert.equal(JSON.stringify(organization), before);
});
