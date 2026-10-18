import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { db } from "@/lib/db";
import { inspectionVisitCookieName, signInspectionVisitIds } from "@/lib/inspection-visit-cookie";
import { GET } from "./route";

/**
 * Вложения посещений для проверяющего (AC3, AC8, ревью безопасности):
 * только файлы записей, внесённых этим же токеном И этим браузером
 * (подписанная cookie), не скрытых, и только пока токен действует. Всё
 * остальное — один и тот же 404 без подсказки, без кэша и с `nosniff`.
 */

const original = {
  findToken: db.inspectorToken.findUnique,
  findFile: db.inspectionVisitFile.findUnique,
  audit: db.auditLog.create,
};

type TokenRow = { id: string; revokedAt: Date | null; expiresAt: Date; organizationId: string };
type FileRow = { id: string; visitId: string; organizationId: string; visitOrg: string; tokenId: string | null; hiddenAt?: Date | null };

let tokenRow: TokenRow | null;
let files: FileRow[];
let ipCounter = 0;
let savedSecret: string | undefined;
const CONTENT = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

beforeEach(() => {
  savedSecret = process.env.EQUIPMENT_QR_TOKEN_SECRET;
  process.env.EQUIPMENT_QR_TOKEN_SECRET = "test-secret-for-inspection-visits";
  tokenRow = { id: "tok-1", revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000), organizationId: "org-a" };
  files = [
    { id: "own", visitId: "visit-own", organizationId: "org-a", visitOrg: "org-a", tokenId: "tok-1" },
    { id: "same-qr-other-browser", visitId: "visit-march", organizationId: "org-a", visitOrg: "org-a", tokenId: "tok-1" },
    { id: "hidden", visitId: "visit-hidden", organizationId: "org-a", visitOrg: "org-a", tokenId: "tok-1", hiddenAt: new Date() },
    { id: "other-token", visitId: "visit-own", organizationId: "org-a", visitOrg: "org-a", tokenId: "tok-2" },
    { id: "manager", visitId: "visit-own", organizationId: "org-a", visitOrg: "org-a", tokenId: null },
    { id: "other-org", visitId: "visit-own", organizationId: "org-b", visitOrg: "org-b", tokenId: "tok-1" },
  ];
  db.inspectorToken.findUnique = (async () =>
    tokenRow
      ? {
          ...tokenRow,
          label: null,
          periodFrom: new Date("2026-07-01T00:00:00Z"),
          periodTo: new Date("2099-12-31T00:00:00Z"),
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
      visitId: row.visitId,
      organizationId: row.organizationId,
      fileName: "Решение 12-р.jpg",
      mimeType: "image/jpeg",
      visit: { organizationId: row.visitOrg, tokenId: row.tokenId, hiddenAt: row.hiddenAt ?? null },
      content: CONTENT,
    };
  }) as unknown as typeof db.inspectionVisitFile.findUnique;
  db.auditLog.create = (async (args: { data: unknown }) => args.data) as unknown as typeof db.auditLog.create;
});

afterEach(() => {
  db.inspectorToken.findUnique = original.findToken;
  db.inspectionVisitFile.findUnique = original.findFile;
  db.auditLog.create = original.audit;
  if (savedSecret === undefined) delete process.env.EQUIPMENT_QR_TOKEN_SECRET;
  else process.env.EQUIPMENT_QR_TOKEN_SECRET = savedSecret;
});

const RAW_TOKEN = "B".repeat(43);

/** Cookie браузера, который внёс записи `ids` по токену `tokenId`. */
function browserCookie(tokenId: string, ids: string[]): string {
  return `${inspectionVisitCookieName(tokenId)}=${encodeURIComponent(signInspectionVisitIds(tokenId, ids))}`;
}

async function get(fileId: string, options: { token?: string; cookie?: string | null } = {}) {
  const token = options.token ?? RAW_TOKEN;
  ipCounter += 1;
  const cookie = options.cookie === undefined ? browserCookie("tok-1", ["visit-own", "visit-hidden"]) : options.cookie;
  const request = new Request(`https://wesetup.ru/api/inspector/${token}/visit-files/${fileId}`, {
    headers: { "x-real-ip": `10.1.0.${ipCounter % 250}`, ...(cookie ? { cookie } : {}) },
  });
  return GET(request, { params: Promise.resolve({ token, fileId }) });
}

function assertHardened(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test("проверяющий получает вложение своей записи (токен + cookie браузера): private, no-store, nosniff", async () => {
  const response = await get("own");
  assert.equal(response.status, 200);
  assertHardened(response);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.match(String(response.headers.get("content-disposition")), /^inline; filename\*=UTF-8''/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), CONTENT);
});

test("тот же постоянный QR, другой браузер: без cookie, с чужой или подделанной cookie — 404", async () => {
  assert.equal((await get("own", { cookie: null })).status, 404, "без cookie");
  assert.equal((await get("own", { cookie: browserCookie("tok-other", ["visit-own"]) })).status, 404, "cookie другого QR");
  const forged = `${inspectionVisitCookieName("tok-1")}=visit-own~forged`;
  assert.equal((await get("own", { cookie: forged })).status, 404, "подделка");
  assert.equal((await get("same-qr-other-browser")).status, 404, "мартовская запись того же QR");
});

test("скрытая запись, чужой токен, запись руководства, чужая организация, несуществующий файл — одинаковый 404", async () => {
  for (const id of ["hidden", "other-token", "manager", "other-org", "missing", "../../etc"]) {
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
  assert.equal((await get("own", { token: "bad" })).status, 404);
});
