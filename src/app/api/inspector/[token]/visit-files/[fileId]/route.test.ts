import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { db } from "@/lib/db";
import { GET } from "./route";

/**
 * Вложения посещений для проверяющего (AC3, AC8): только файлы записей,
 * внесённых этим же токеном, и только пока токен действует. Всё остальное —
 * один и тот же 404 без подсказки, без кэша и с `nosniff`.
 */

const original = {
  findToken: db.inspectorToken.findUnique,
  findFile: db.inspectionVisitFile.findUnique,
  audit: db.auditLog.create,
};

type TokenRow = { id: string; revokedAt: Date | null; expiresAt: Date; organizationId: string };
type FileRow = { id: string; organizationId: string; visitOrg: string; tokenId: string | null };

let tokenRow: TokenRow | null;
let files: FileRow[];
let ipCounter = 0;
const CONTENT = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

beforeEach(() => {
  tokenRow = { id: "tok-1", revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000), organizationId: "org-a" };
  files = [
    { id: "own", organizationId: "org-a", visitOrg: "org-a", tokenId: "tok-1" },
    { id: "other-token", organizationId: "org-a", visitOrg: "org-a", tokenId: "tok-2" },
    { id: "manager", organizationId: "org-a", visitOrg: "org-a", tokenId: null },
    { id: "other-org", organizationId: "org-b", visitOrg: "org-b", tokenId: "tok-1" },
  ];
  db.inspectorToken.findUnique = (async () =>
    tokenRow
      ? {
          ...tokenRow,
          label: null,
          periodFrom: new Date("2026-07-01T00:00:00Z"),
          periodTo: new Date("2026-10-17T00:00:00Z"),
          organization: {
            id: tokenRow.organizationId,
            name: "Кафе",
            journalShortName: null,
            legalProfileJson: null,
            inn: null,
            address: null,
            timezone: "Europe/Moscow",
            disabledJournalCodes: [],
          },
        }
      : null) as unknown as typeof db.inspectorToken.findUnique;
  db.inspectionVisitFile.findUnique = (async (args: { where: { id: string } }) => {
    const row = files.find((file) => file.id === args.where.id);
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      fileName: "Решение 12-р.jpg",
      mimeType: "image/jpeg",
      visit: { organizationId: row.visitOrg, tokenId: row.tokenId },
      content: CONTENT,
    };
  }) as unknown as typeof db.inspectionVisitFile.findUnique;
  db.auditLog.create = (async (args: { data: unknown }) => args.data) as unknown as typeof db.auditLog.create;
});

afterEach(() => {
  db.inspectorToken.findUnique = original.findToken;
  db.inspectionVisitFile.findUnique = original.findFile;
  db.auditLog.create = original.audit;
});

const RAW_TOKEN = "B".repeat(43);

async function get(fileId: string, token = RAW_TOKEN) {
  ipCounter += 1;
  const request = new Request(`https://wesetup.ru/api/inspector/${token}/visit-files/${fileId}`, {
    headers: { "x-forwarded-for": `10.1.0.${ipCounter}` },
  });
  return GET(request, { params: Promise.resolve({ token, fileId }) });
}

function assertHardened(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test("проверяющий получает вложение записи своего токена: private, no-store, nosniff", async () => {
  const response = await get("own");
  assert.equal(response.status, 200);
  assertHardened(response);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.match(String(response.headers.get("content-disposition")), /^inline; filename\*=UTF-8''/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), CONTENT);
});

test("чужой токен, запись руководства, чужая организация, несуществующий файл — одинаковый 404", async () => {
  for (const id of ["other-token", "manager", "other-org", "missing", "../../etc"]) {
    const response = await get(id);
    assert.equal(response.status, 404, id);
    assertHardened(response);
    assert.equal(await response.text(), "Не найдено");
  }
});

test("отозванный, истёкший и неизвестный токен — тот же 404, а не подсказка", async () => {
  tokenRow = { id: "tok-1", revokedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), organizationId: "org-a" };
  assert.equal((await get("own")).status, 404);
  tokenRow = { id: "tok-1", revokedAt: null, expiresAt: new Date(Date.now() - 1000), organizationId: "org-a" };
  const expired = await get("own");
  assert.equal(expired.status, 404);
  assertHardened(expired);
  tokenRow = null;
  assert.equal((await get("own")).status, 404);
  assert.equal((await get("own", "bad")).status, 404);
});
