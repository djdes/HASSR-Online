import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import * as buildingIcons from "@/lib/building-icons";
import * as orgLogoFile from "@/lib/org-logo-file";

/*
 * Значок объекта (2026-11-22): PUT ключа библиотеки, POST своего файла.
 * Настоящий обработчик, подменены сессия, БД и запись файла: проверяем,
 * что чужой объект, сотрудник без прав, руководитель чужой точки и ключ не
 * из библиотеки ничего не меняют.
 */

type Call = { kind: "library" | "file"; buildingId: string; value: unknown };

function handler({ role = "owner", inScope = true }: { role?: string; inScope?: boolean } = {}) {
  const calls: Call[] = [];
  const audits: string[] = [];
  const session = { user: { id: "u1", role, isRoot: false } };
  const buildings: Record<string, { id: string; organizationId: string }> = {
    "b-own": { id: "b-own", organizationId: "org-a" },
    "b-foreign": { id: "b-foreign", organizationId: "org-b" },
  };
  const db = {
    building: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) => {
        const row = buildings[where.id];
        return row && row.organizationId === where.organizationId ? { id: row.id } : null;
      },
    },
  };
  const fakeModule = { exports: {} as Record<string, unknown> };
  const file = path.join(process.cwd(), "src/app/api/settings/buildings/[id]/icon/route.ts");
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    module: fakeModule,
    exports: fakeModule.exports,
    console,
    Response,
    Request,
    FormData,
    Blob,
    Uint8Array,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "zod") return zod;
      if (name === "@/lib/db") return { db };
      if (name === "@/lib/auth-helpers") {
        return { getActiveOrgId: () => "org-a", requireApiAuth: async () => ({ ok: true, session }) };
      }
      if (name === "@/lib/role-access") {
        return { hasFullWorkspaceAccess: (user: { role: string }) => ["owner", "manager"].includes(user.role) };
      }
      if (name === "@/lib/point-scope") {
        return { BUILDING_OUT_OF_SCOPE_ERROR: "Чужая точка", buildingInScope: () => inScope };
      }
      if (name === "@/lib/audit-log") return { recordAuditLog: async (entry: { action: string }) => void audits.push(entry.action) };
      if (name === "@/lib/building-icons") return buildingIcons;
      if (name === "@/lib/org-logo-file") return orgLogoFile;
      if (name === "@/lib/building-icon-file.server") {
        return {
          setBuildingLibraryIcon: async (buildingId: string, value: unknown) => void calls.push({ kind: "library", buildingId, value }),
          setBuildingIconFile: async (organizationId: string, buildingId: string, prepared: { mime: string }) => {
            calls.push({ kind: "file", buildingId, value: prepared.mime });
            return buildingIcons.buildingIconUrl(organizationId, buildingId, 1);
          },
        };
      }
      throw new Error(`Unexpected icon API dependency: ${name}`);
    },
  });
  const api = fakeModule.exports as {
    PUT: (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
    POST: (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  };
  return { api, calls, audits };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (body: unknown) =>
  new Request("http://local/api/settings/buildings/x/icon", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Минимальный PNG 1×1: сигнатура, IHDR, IDAT, IEND.
const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
      "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
    "hex",
  ),
);

test("PUT: library key and «как было» (null) are saved and audit-logged", async () => {
  const { api, calls, audits } = handler();
  const school = await api.PUT(put({ icon: "school" }), ctx("b-own"));
  assert.equal(school.status, 200);
  assert.deepEqual(await school.json(), { icon: "school" });
  const reset = await api.PUT(put({ icon: null }), ctx("b-own"));
  assert.equal(reset.status, 200);
  assert.deepEqual(calls, [
    { kind: "library", buildingId: "b-own", value: "school" },
    { kind: "library", buildingId: "b-own", value: null },
  ]);
  assert.deepEqual(audits, ["building.icon.set", "building.icon.set"]);
});

test("PUT: a key outside the library and an uploaded-file URL are rejected", async () => {
  const { api, calls } = handler();
  for (const icon of ["rocket", "/api/org-assets/org-a/building-icon/b-own?v=1", 42]) {
    const response = await api.PUT(put({ icon }), ctx("b-own"));
    assert.equal(response.status, 400, String(icon));
  }
  assert.equal(calls.length, 0);
});

test("foreign building, employee without rights and a point manager outside scope change nothing", async () => {
  const foreign = handler();
  assert.equal((await foreign.api.PUT(put({ icon: "school" }), ctx("b-foreign"))).status, 404);
  const cook = handler({ role: "cook" });
  assert.equal((await cook.api.PUT(put({ icon: "school" }), ctx("b-own"))).status, 403);
  const scoped = handler({ inScope: false });
  assert.equal((await scoped.api.PUT(put({ icon: "school" }), ctx("b-own"))).status, 403);
  for (const run of [foreign, cook, scoped]) assert.equal(run.calls.length, 0);
});

test("POST: a PNG becomes the building's own icon; non-images and oversized files are refused", async () => {
  const { api, calls, audits } = handler();
  const form = new FormData();
  form.append("file", new Blob([PNG_1X1], { type: "image/png" }), "icon.png");
  const ok = await api.POST(new Request("http://local/x", { method: "POST", body: form }), ctx("b-own"));
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { icon: string };
  assert.ok(buildingIcons.buildingIconUrlBelongsTo(body.icon, "org-a", "b-own"));
  assert.deepEqual(calls, [{ kind: "file", buildingId: "b-own", value: "image/png" }]);
  assert.deepEqual(audits, ["building.icon.upload"]);

  const text = new FormData();
  text.append("file", new Blob(["hello"], { type: "text/plain" }), "a.txt");
  assert.equal((await api.POST(new Request("http://local/x", { method: "POST", body: text }), ctx("b-own"))).status, 415);

  const big = new FormData();
  big.append("file", new Blob([new Uint8Array(buildingIcons.BUILDING_ICON_MAX_BYTES + 1)], { type: "image/png" }), "big.png");
  assert.equal((await api.POST(new Request("http://local/x", { method: "POST", body: big }), ctx("b-own"))).status, 413);

  const empty = new FormData();
  assert.equal((await api.POST(new Request("http://local/x", { method: "POST", body: empty }), ctx("b-own"))).status, 400);
  assert.equal(calls.length, 1);
});
