import assert from "node:assert/strict";
import test from "node:test";

import { LOCALES } from "@/i18n/locales";
import { ROOM_KINDS, isRoomKind, roomKindLabel, roomKindOptions } from "./room-kinds";

test("виды помещений: есть «Основное производство» и прежние виды", () => {
  for (const kind of ["guest", "kitchen", "wash", "bar", "storage", "other", "production"]) {
    assert.ok(isRoomKind(kind), kind);
  }
  assert.equal(roomKindLabel("production"), "Основное производство");
  assert.equal(roomKindLabel("production", "en"), "Main production");
  assert.equal(roomKindLabel("production", "uz"), "Asosiy ishlab chiqarish");
});

test("виды помещений: подпись на каждом языке, неизвестный вид — как есть", () => {
  for (const locale of LOCALES) {
    const options = roomKindOptions(locale);
    assert.deepEqual(options.map((option) => option.value), [...ROOM_KINDS]);
    for (const option of options) assert.ok(option.label.trim().length > 0, `${locale}:${option.value}`);
  }
  assert.equal(roomKindLabel("цех №5"), "цех №5");
  assert.equal(isRoomKind("цех №5"), false);
});

test("виды помещений: API помещений и окно помещения берут список из room-kinds", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of [
    "src/app/api/settings/rooms/route.ts",
    "src/app/api/settings/rooms/[id]/route.ts",
    "src/components/cleaning/room-editor-dialog.tsx",
    "src/app/(dashboard)/settings/buildings/buildings-client.tsx",
  ]) {
    const source = await readFile(file, "utf8");
    assert.match(source, /@\/lib\/room-kinds/, file);
    assert.doesNotMatch(source, /"guest",\s*"kitchen",\s*"wash"/, `${file}: свой перечень видов`);
  }
});
