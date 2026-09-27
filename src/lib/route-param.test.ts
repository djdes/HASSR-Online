import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { mintQrFillToken, verifyQrFillToken } from "@/lib/qr-fill-token";
import { decodeRouteParam, encodeRouteParam } from "@/lib/route-param";

process.env.EQUIPMENT_QR_TOKEN_SECRET ??= "route-param-test-secret-0000";

/** id, как у демо-оборудования организации WeSetup (сиды: `${org}-${area}-${name}`). */
const ODD_ID = "platform-Горячий цех-Горячий цех - термогигрометр";
const CUID = "cmui6rown001f54tsmlx9ztit";

/** Что кладёт в `params` Next 16: сегмент пути как есть, без раскодирования. */
function nextRouteParam(url: string, index: number): string {
  return new URL(url).pathname.split("/")[index];
}

describe("decodeRouteParam", () => {
  it("раскодирует кириллицу и пробелы из сегмента пути", () => {
    assert.equal(decodeRouteParam(encodeURIComponent(ODD_ID)), ODD_ID);
  });

  it("обычный cuid не меняется", () => {
    assert.equal(decodeRouteParam(CUID), CUID);
  });

  it("битая %-последовательность — значение как есть, без исключения", () => {
    assert.equal(decodeRouteParam("abc%E0%A4%A"), "abc%E0%A4%A");
    assert.equal(decodeRouteParam("50%"), "50%");
  });

  it("encodeRouteParam не трогает cuid и кодирует пробелы, кириллицу и слэш", () => {
    assert.equal(encodeRouteParam(CUID), CUID);
    assert.equal(encodeRouteParam("a b/в"), "a%20b%2F%D0%B2");
  });
});

describe("наклейка оборудования с нестандартным id — путь ссылки целиком", () => {
  for (const id of [ODD_ID, CUID]) {
    it(`токен из ?token= совпадает с id из пути: ${id}`, () => {
      const token = mintQrFillToken("equipment", id);
      const url = `https://wesetup.ru/equipment-fill/${encodeRouteParam(id)}?token=${encodeURIComponent(token)}`;

      const fromPath = decodeRouteParam(nextRouteParam(url, 2));
      const verify = verifyQrFillToken(new URL(url).searchParams.get("token") ?? "");

      assert.equal(verify.ok, true);
      assert.equal(verify.ok && verify.id, fromPath);
    });
  }

  it("без раскодирования id из пути не совпал бы (ошибка 27.09.2026)", () => {
    const url = `https://wesetup.ru/equipment-fill/${encodeRouteParam(ODD_ID)}?token=x`;
    assert.notEqual(nextRouteParam(url, 2), ODD_ID);
  });
});

describe("QR-маршруты объектов раскодируют id, ссылки его кодируют", () => {
  const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

  for (const relative of [
    "src/app/equipment-fill/[equipmentId]/page.tsx",
    "src/app/api/equipment-fill/[equipmentId]/route.ts",
    "src/app/api/equipment-fill/[equipmentId]/uv/route.ts",
    "src/app/room-fill/[roomId]/page.tsx",
    "src/app/api/room-fill/[roomId]/route.ts",
    "src/app/api/qr-fill/[kind]/[id]/route.ts",
  ]) {
    it(`params раскодируются: ${relative}`, () => {
      assert.match(read(relative), /decodeRouteParam\(/);
    });
  }

  for (const relative of ["src/lib/qr-fill-poster.ts", "src/lib/qr-fill-siblings.ts"]) {
    it(`id в пути ссылки закодирован: ${relative}`, () => {
      const source = read(relative);
      assert.match(source, /encodeRouteParam\(/);
      assert.doesNotMatch(source, /(equipment|room)-fill\/\$\{(?!encodeRouteParam)/);
    });
  }
});
