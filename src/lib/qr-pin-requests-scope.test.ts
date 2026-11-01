import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

/** Production module with I/O replaced at the import boundary (as in notification-descriptor-producers.test.ts). */
function load(mocks: Record<string, unknown>) {
  const output = ts.transpileModule(readFileSync("src/lib/qr-pin-requests.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(output, {
    module: mod, exports: mod.exports, console, process, Date,
    require: (id: string) => (Object.hasOwn(mocks, id) ? mocks[id] : require(id)),
  });
  return mod.exports as typeof import("./qr-pin-requests");
}

const pointA = "point-a";
const pointB = "point-b";

function mocks(writes: string[], sent: string[], employeeBuildings: string[]) {
  return {
    "@/lib/db": {
      db: {
        qrPinRequest: {
          findUnique: async () => ({ id: "req", organizationId: "org", userId: "emp", kind: "issue", status: "pending", pinHash: "h", pinEncrypted: null, expiresAt: new Date(Date.now() + 3600_000) }),
          update: async () => { writes.push("update"); },
        },
        user: {
          findFirst: async () => ({ id: "emp", name: "Повар", buildingIds: employeeBuildings }),
          findMany: async () => [
            { id: "manager-a", buildingIds: [pointA] },
            { id: "manager-b", buildingIds: [pointB] },
            { id: "office", buildingIds: [] },
          ],
        },
        journalDocument: { findUnique: async () => null },
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({ qrPinRequest: { updateMany: async () => {}, create: async () => ({ id: "req" }) } }),
      },
    },
    "bcryptjs": { hash: async () => "hash" },
    "@/lib/integration-crypto": { isIntegrationCryptoConfigured: () => false },
    "@/lib/notifications": { upsertNotification: async (notice: { userId: string }) => { sent.push(notice.userId); } },
    "@/lib/telegram": { notifyEmployee: async () => true },
    "@/lib/qr-fill-actor": { setEmployeeQrPinHash: async () => { writes.push("pin"); } },
    // Сотрудник точки А: сигнал — руководителю точки А и офису (правила receivesPlaceEvent).
    "@/lib/place-recipients": {
      placeOfEvent: async () => pointA,
      filterRecipientsByPlace: async (_org: string, users: Array<{ buildingIds: string[] }>, place: string | null) =>
        users.filter((user) => user.buildingIds.length === 0 || (place !== null && user.buildingIds.includes(place))),
    },
  };
}

test("запрос PIN сотрудника точки А не уходит руководителю точки Б", async () => {
  const sent: string[] = [];
  const pin = load(mocks([], sent, [pointA]));
  const result = await pin.createQrPinRequest({ organizationId: "org", userId: "emp", kind: "issue", pin: "4932", repeat: "4932", source: "equipment-fill" });
  assert.equal(result.ok, true);
  assert.deepEqual(sent.sort(), ["manager-a", "office"]);
});

test("руководитель точки Б не одобряет PIN сотрудника точки А", async () => {
  const writes: string[] = [];
  const pin = load(mocks(writes, [], [pointA]));
  const denied = await pin.decideQrPinRequest({ organizationId: "org", requestId: "req", decidedById: "manager-b", approve: true, actor: { pointScope: [pointB] } });
  // Объект создан в другом vm-контексте — сравниваем поля, не прототипы.
  assert.deepEqual({ ...denied }, { ok: false, status: 403, error: "Этот сотрудник работает не на вашей точке — его ведёт офис" });
  assert.deepEqual(writes, []);

  const allowed = await pin.decideQrPinRequest({ organizationId: "org", requestId: "req", decidedById: "manager-a", approve: true, actor: { pointScope: [pointA] } });
  assert.equal(allowed.ok, true);
  assert.deepEqual(writes, ["pin", "update"]);
});

test("офис (без ограничения точек) одобряет любой запрос", async () => {
  const writes: string[] = [];
  const pin = load(mocks(writes, [], [pointA]));
  const allowed = await pin.decideQrPinRequest({ organizationId: "org", requestId: "req", decidedById: "office", approve: false, actor: { pointScope: null } });
  assert.equal(allowed.ok, true);
});
