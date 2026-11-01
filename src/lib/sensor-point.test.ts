import assert from "node:assert/strict";
import test from "node:test";

import { pickPointSigner, pickSensorDocuments, sensorRowKeys } from "./sensor-point";

// Аудит 2026-11-01: показание холодильника точки А уходило в первый
// попавшийся документ организации (журнал точки Б), подписывал любой
// руководитель.

const coldConfig = (equipmentIds: string[]) => ({
  equipment: equipmentIds.map((sourceEquipmentId, index) => ({ id: `row-${index}`, sourceEquipmentId })),
});

test("sensorRowKeys: строки холодильника по sourceEquipmentId или id", () => {
  assert.deepEqual(sensorRowKeys(coldConfig(["fridge-a", "fridge-b"]), "fridge-b", "equipment"), ["row-1"]);
  assert.deepEqual(sensorRowKeys({ equipment: [{ id: "fridge-a" }] }, "fridge-a", "equipment"), ["fridge-a"]);
  assert.deepEqual(sensorRowKeys({ rooms: [{ id: "r1", sourceEquipmentId: "fridge-a" }] }, "fridge-a", "rooms"), ["r1"]);
  assert.deepEqual(sensorRowKeys({ rooms: [{ id: "r1", sourceEquipmentId: "fridge-a" }] }, "fridge-a", "equipment"), []);
  assert.deepEqual(sensorRowKeys(null, "fridge-a", "equipment"), []);
});

test("pickSensorDocuments: документ чужой точки не выбирается, свой — да", () => {
  const docs = [
    { id: "doc-b", buildingId: "B", config: coldConfig(["fridge-b"]) },
    { id: "doc-a", buildingId: "A", config: coldConfig(["fridge-a"]) },
  ];
  const picked = pickSensorDocuments(docs, {
    pointId: "A",
    rowKeys: (doc) => sensorRowKeys(doc.config, "fridge-a", "equipment"),
  });
  assert.deepEqual(
    picked.map((item) => [item.doc.id, item.keys]),
    [["doc-a", ["row-0"]]],
  );
});

test("pickSensorDocuments: без строки оборудования — свой документ, затем общий", () => {
  const docs = [
    { id: "doc-b", buildingId: "B", config: {} },
    { id: "shared", buildingId: null, config: {} },
    { id: "doc-a", buildingId: "A", config: {} },
  ];
  const rowKeys = () => [] as string[];
  assert.deepEqual(pickSensorDocuments(docs, { pointId: "A", rowKeys }).map((item) => item.doc.id), ["doc-a"]);
  assert.deepEqual(
    pickSensorDocuments(docs.filter((doc) => doc.id !== "doc-a"), { pointId: "A", rowKeys }).map((item) => item.doc.id),
    ["shared"],
  );
  // Только документ чужой точки — показание никуда не пишем.
  assert.deepEqual(pickSensorDocuments([docs[0]], { pointId: "A", rowKeys }), []);
});

test("pickSensorDocuments: оборудование без точки — где оно в строках, иначе общий или единственный", () => {
  const docs = [
    { id: "doc-a", buildingId: "A", config: coldConfig(["shared-fridge"]) },
    { id: "doc-b", buildingId: "B", config: coldConfig(["shared-fridge"]) },
    { id: "doc-c", buildingId: "C", config: coldConfig(["other"]) },
  ];
  const rowKeys = (doc: (typeof docs)[number]) => sensorRowKeys(doc.config, "shared-fridge", "equipment");
  assert.deepEqual(pickSensorDocuments(docs, { pointId: null, rowKeys }).map((item) => item.doc.id), ["doc-a", "doc-b"]);
  // Точки выключены: один общий документ — как раньше.
  assert.deepEqual(
    pickSensorDocuments([{ id: "only", buildingId: null, config: {} }], { pointId: null, rowKeys: () => [] }).map((item) => item.doc.id),
    ["only"],
  );
  // Несколько документов точек без строки оборудования — не угадываем.
  assert.deepEqual(pickSensorDocuments(docs, { pointId: null, rowKeys: () => [] }), []);
});

test("pickPointSigner: руководитель точки документа, без точки — вся организация", () => {
  const users = [
    { id: "mgr-b", role: "manager", buildingIds: ["B"] },
    { id: "cook-a", role: "cook", buildingIds: ["A"] },
    { id: "chef-a", role: "head_chef", buildingIds: ["A"] },
  ];
  assert.equal(pickPointSigner(users, "A")?.id, "chef-a");
  assert.equal(pickPointSigner(users, "B")?.id, "mgr-b");
  assert.equal(pickPointSigner(users, null)?.id, "mgr-b");
  // На точке никого — запасной вариант по организации.
  assert.equal(pickPointSigner(users, "C")?.id, "mgr-b");
});
