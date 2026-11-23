import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  climateRowIdForRoom,
  climateSeedRooms,
  createClimateRoomConfig,
  type ClimateRoomConfig,
} from "@/lib/climate-document";
import {
  climateRowHasReadings,
  findClimateRowIndex,
  pickClimateDocumentsForRoom,
  planClimateRoomMembership,
} from "@/lib/climate-room-membership";
import { roomEditorInitial } from "@/app/(dashboard)/settings/buildings/buildings-client";

/**
 * «Контролировать климат в этом помещении» (владелец, 2026-11-23): включили —
 * помещение в журнале климата; окно «Объектов» видит и не стирает нормы.
 */

const norms = {
  temperature: { enabled: true, min: 12, max: 20 },
  humidity: { enabled: false, min: null, max: null },
};
const office = { id: "R-office", name: "Офис", climateNorms: norms };

function row(id: string, name: string, roomId?: string): ClimateRoomConfig {
  return createClimateRoomConfig({ id, name, ...(roomId ? { roomId } : {}) });
}

test("включили климат: помещения нет в документе — строка добавляется с нормами", () => {
  const rooms = [row(climateRowIdForRoom("R-dry"), "Сухой склад", "R-dry")];
  const plan = planClimateRoomMembership({ rooms, room: office, controlled: true, hasReadings: () => false });
  assert.equal(plan.action, "write");
  if (plan.action !== "write") return;
  assert.equal(plan.rooms.length, 2);
  const added = plan.rooms[1];
  assert.equal(added.id, climateRowIdForRoom("R-office"));
  assert.equal(added.roomId, "R-office");
  assert.equal(added.name, "Офис");
  assert.deepEqual(added.temperature, norms.temperature);
  assert.equal(added.humidity.enabled, false);
});

test("включили климат: строка уже есть — меняются только название и нормы, ключ тот же", () => {
  const rooms = [row("custom-key", "Старое имя", "R-office"), row("room-R2", "Склад", "R2")];
  const plan = planClimateRoomMembership({ rooms, room: office, controlled: true, hasReadings: () => true });
  assert.equal(plan.action, "write");
  if (plan.action !== "write") return;
  assert.equal(plan.rooms.length, 2);
  assert.equal(plan.rooms[0].id, "custom-key");
  assert.equal(plan.rooms[0].name, "Офис");
  assert.deepEqual(plan.rooms[0].temperature, norms.temperature);
  // Повтор ничего не пишет.
  const again = planClimateRoomMembership({ rooms: plan.rooms, room: office, controlled: true, hasReadings: () => true });
  assert.equal(again.action, "none");
});

test("включили климат: старая строка без связи с тем же названием связывается, а не дублируется", () => {
  const rooms = [row("legacy-1", "офис"), row("room-R2", "Склад", "R2")];
  const plan = planClimateRoomMembership({ rooms, room: office, controlled: true, hasReadings: () => false });
  assert.equal(plan.action, "write");
  if (plan.action !== "write") return;
  assert.equal(plan.rooms.length, 2);
  assert.equal(plan.rooms[0].id, "legacy-1", "ключ замеров не меняется");
  assert.equal(plan.rooms[0].roomId, "R-office");
});

test("выключили климат: строка без замеров уходит, с замерами — остаётся, последняя — остаётся", () => {
  const rooms = [row("room-R-office", "Офис", "R-office"), row("room-R2", "Склад", "R2")];
  const off = { ...office, climateNorms: null };
  const removed = planClimateRoomMembership({ rooms, room: off, controlled: false, hasReadings: () => false });
  assert.equal(removed.action, "write");
  if (removed.action === "write") assert.deepEqual(removed.rooms.map((r) => r.roomId), ["R2"]);

  const kept = planClimateRoomMembership({ rooms, room: off, controlled: false, hasReadings: () => true });
  assert.equal(kept.action, "none", "данные ХАССП не удаляем");

  const last = planClimateRoomMembership({ rooms: [rooms[0]], room: off, controlled: false, hasReadings: () => false });
  assert.equal(last.action, "none", "у документа климата всегда есть строка");

  const absent = planClimateRoomMembership({ rooms: [rooms[1]], room: off, controlled: false, hasReadings: () => false });
  assert.equal(absent.action, "none");
});

test("замеры строки: число в любом сроке — есть, пустые и чужие строки — нет", () => {
  const entries = [
    { data: { measurements: { "room-A": { "10:00": { temperature: null, humidity: null } } } } },
    { data: { measurements: { "room-B": { "10:00": { temperature: 21.5, humidity: null } } } } },
    { data: null },
  ];
  assert.equal(climateRowHasReadings(entries, "room-A"), false);
  assert.equal(climateRowHasReadings(entries, "room-B"), true);
  assert.equal(climateRowHasReadings(entries, "room-C"), false);
  assert.equal(findClimateRowIndex([row("room-X", "x"), row("k", "y", "Y")], "Y"), 1);
  assert.equal(findClimateRowIndex([row("room-X", "x")], "X"), 0, "по ключу room-<id>");
});

test("какие документы правим: свой документ объекта, иначе общий; плюс те, где строка уже есть", () => {
  const docs = [
    { id: "shared", buildingId: null, hasRoom: false },
    { id: "own", buildingId: "B1", hasRoom: false },
    { id: "other-with-row", buildingId: "B2", hasRoom: true },
  ];
  assert.deepEqual(pickClimateDocumentsForRoom(docs, "B1").map((d) => d.id), ["own", "other-with-row"]);
  assert.deepEqual(pickClimateDocumentsForRoom(docs.slice(0, 1), "B1").map((d) => d.id), ["shared"]);
});

test("новый документ климата: помещения с включённым климатом, а без них — все, как раньше", () => {
  const rooms = [office, { id: "R2", name: "Склад", climateNorms: null }];
  assert.deepEqual(climateSeedRooms(rooms).map((r) => r.id), ["R-office"]);
  const legacy = [{ id: "R1", name: "A", climateNorms: null }, { id: "R2", name: "B" }];
  assert.deepEqual(climateSeedRooms(legacy).map((r) => r.id), ["R1", "R2"]);
});

test("«Объекты»: окно помещения получает нормы климата; без загрузки — поля нет", () => {
  const base = { id: "R1", name: "Офис", kind: "other", sortOrder: 0 };
  assert.deepEqual(roomEditorInitial({ ...base, climateNorms: norms }).climateNorms, norms);
  assert.equal(roomEditorInitial({ ...base, climateNorms: null }).climateNorms, null);
  assert.equal("climateNorms" in roomEditorInitial(base), false);
});

test("страницы «Объекты» и объекта грузят нормы; окно шлёт их, только если получило", () => {
  for (const file of [
    "src/app/(dashboard)/settings/buildings/page.tsx",
    "src/app/(dashboard)/settings/buildings/[id]/page.tsx",
  ]) {
    assert.match(readFileSync(file, "utf8"), /climateNorms: true/, file);
  }
  const dialog = readFileSync("src/components/cleaning/room-editor-dialog.tsx", "utf8");
  assert.match(dialog, /const climateLoaded = initial\?\.climateNorms !== undefined;/);
  assert.match(dialog, /\.\.\.\(climateLoaded \? \{ climateNorms \} : \{\}\)/);
  // Блок климата — с переключателем в заголовке, без стрелки сворачивания.
  assert.match(dialog, /\{climateLoaded \? \(\s*<div[^>]*data-room-block="climate"/);
  assert.doesNotMatch(dialog, /climateOpen/);
  assert.match(dialog, /data-room-block="verifiers"/);
  const api = readFileSync("src/app/api/settings/rooms/[id]/route.ts", "utf8");
  assert.match(api, /syncRoomClimateDocuments\(/);
});
