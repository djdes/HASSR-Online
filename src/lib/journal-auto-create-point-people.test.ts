import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";
import { aliveAtPoint } from "./journal-auto-create";

/**
 * Новый документ точки наследует ответственных только из людей этой точки
 * (2026-11-01): старый общий документ или политика «всей организации» не
 * должны приводить в документ точки Б человека точки А.
 */
function fakeDb(users: Array<{ id: string; buildingIds: string[] }>, buildings: string[]) {
  return {
    user: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => users.filter((user) => where.id.in.includes(user.id)) },
    building: { findMany: async () => buildings.map((id) => ({ id })) },
  } as unknown as PrismaClient;
}

const people = [
  { id: "anna-a", buildingIds: ["a"] },
  { id: "boris-b", buildingIds: ["b"] },
  { id: "vera-all", buildingIds: [] },
  { id: "gone", buildingIds: ["deleted-point"] },
];

test("документ точки Б — только люди точки Б и все точки", async () => {
  const ids = await aliveAtPoint(fakeDb(people, ["a", "b"]), { organizationId: "o", buildingId: "b" }, people.map((p) => p.id));
  assert.deepEqual([...ids].sort(), ["boris-b", "gone", "vera-all"]);
});

test("без точки — все живые сотрудники", async () => {
  const ids = await aliveAtPoint(fakeDb(people, ["a", "b"]), { organizationId: "o", buildingId: null }, people.map((p) => p.id));
  assert.deepEqual([...ids].sort(), ["anna-a", "boris-b", "gone", "vera-all"]);
});
