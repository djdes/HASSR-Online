import assert from "node:assert/strict";
import test from "node:test";

import { QR_MISSING_CODE, qrMissingError } from "@/lib/qr-fill-missing";

test("нет предмета QR — понятное «не найдено» по виду, а не «Объект не найден»", () => {
  // «Объект» в кабинете — это объект компании (цех, кафе); холодильник так называть нельзя.
  for (const kind of ["equipment", "room", "journal"] as const) {
    const body = qrMissingError(kind);
    assert.equal(body.code, QR_MISSING_CODE);
    assert.doesNotMatch(body.error, /Объект/);
  }
  assert.match(qrMissingError("equipment").error, /Оборудование/);
  assert.match(qrMissingError("room").error, /Помещение/);
  assert.match(qrMissingError("journal").error, /Документ/);
});

test("окно холодильника журнала: нет единицы в справочнике — подсказка «Сохранить», а не «Объект не найден»", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("src/app/api/qr-fill/[kind]/[id]/route.ts", "utf8");
  assert.doesNotMatch(route, /Объект не найден/);
  assert.equal(route.match(/qrMissingError\(kind\)/g)?.length, 3);
  const dialog = readFileSync("src/components/journals/cold-equipment-document-client.tsx", "utf8");
  assert.match(dialog, /missingHint=\{t\("ui\.qrMissingHint"\)\}/);
  // Сохранение завело единицу заново — новый id: окно остаётся и показывает QR.
  assert.match(dialog, /saved\.sourceEquipmentId !== linkedEquipmentId/);
});

test("«Зачем нужны цеха» — без пункта «Группировка оборудования» (зачёркнут владельцем, 2026-11-23)", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync("src/app/(dashboard)/settings/areas/page.tsx", "utf8");
  const guide = page.slice(page.indexOf('storageKey="settings-areas"'), page.indexOf("/>", page.indexOf('storageKey="settings-areas"')));
  assert.doesNotMatch(guide, /guide3Title/);
  assert.match(guide, /guide4Title/);
});
