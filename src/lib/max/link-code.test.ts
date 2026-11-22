import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { db } from "@/lib/db";
import { formatMaxLinkCode, generateMaxLinkCode, hashMaxLinkCode, parseMaxLinkCode } from "./link-code";
import { claimMaxLinkByCode, createMaxLink, MaxError } from "./service";
import { safeMaxReturnPath } from "./security";
import { unlinkedView } from "./bot-views";

/*
 * Привязка MAX по шестизначному коду (2026-11-22): код рядом со ссылкой,
 * бот принимает его сообщением и, как после ссылки, только называет аккаунт;
 * привязку подтверждает владелец кабинета на сайте. БД подменена.
 */

const original = {
  findUser: db.user.findUnique,
  findRequest: db.maxLinkRequest.findFirst,
  updateRequests: db.maxLinkRequest.updateMany,
  transaction: db.$transaction,
};
afterEach(() => {
  db.user.findUnique = original.findUser;
  db.maxLinkRequest.findFirst = original.findRequest;
  db.maxLinkRequest.updateMany = original.updateRequests;
  db.$transaction = original.transaction;
});

const activeUser = { id: "u1", isActive: true, archivedAt: null, isRoot: false };
const stubUser = () => {
  db.user.findUnique = (async () => activeUser) as unknown as typeof db.user.findUnique;
};

test("code: six digits with leading zeros, read from «482913», «482 913», «482-913» only", () => {
  assert.equal(generateMaxLinkCode(() => 42), "000042");
  assert.match(generateMaxLinkCode(), /^\d{6}$/);
  for (const text of ["482913", " 482 913 ", "482-913"]) assert.equal(parseMaxLinkCode(text), "482913", text);
  for (const text of ["48291", "4829134", "код 482913", "/menu", "12:30", "", "482913a"]) assert.equal(parseMaxLinkCode(text), null, text);
  assert.equal(formatMaxLinkCode("482913"), "482 913");
  assert.equal(hashMaxLinkCode("482913").length, 64);
  assert.notEqual(hashMaxLinkCode("482913"), hashMaxLinkCode("482914"));
  assert.ok(!hashMaxLinkCode("482913").includes("482913"));
});

test("personal link request stores only the code hash; the code is unique among active requests", async () => {
  stubUser();
  const taken: string[] = [];
  let lookups = 0;
  db.maxLinkRequest.findFirst = (async ({ where }: { where: { codeHash: string } }) => {
    lookups += 1;
    // Первый вытянутый код уже занят другой заявкой — нужен новый.
    if (lookups === 1) {
      taken.push(where.codeHash);
      return { id: "other" };
    }
    return null;
  }) as unknown as typeof db.maxLinkRequest.findFirst;
  const created: Array<Record<string, unknown>> = [];
  const tx = {
    maxLinkRequest: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: "req-1", expiresAt: data.expiresAt };
      },
    },
  };
  db.$transaction = (async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as unknown as typeof db.$transaction;

  const result = await createMaxLink("u1", null);
  assert.match(result.code ?? "", /^\d{6}$/);
  assert.equal(lookups, 2);
  assert.equal(created.length, 1);
  assert.equal(created[0].codeHash, hashMaxLinkCode(result.code as string));
  assert.notEqual(created[0].codeHash, taken[0]);
  assert.ok(!JSON.stringify(created[0]).includes(result.code as string), "the plain code is never stored");
});

test("bot code nominates the MAX account for a personal request; unknown code and guessing are refused", async () => {
  stubUser();
  const request = { id: "req-1", userId: "u1", organizationId: null, claimedMaxUserId: null, claimedChatId: null };
  let found: typeof request | null = request;
  let whereSeen: Record<string, unknown> | null = null;
  db.maxLinkRequest.findFirst = (async ({ where }: { where: Record<string, unknown> }) => {
    whereSeen = where;
    return found;
  }) as unknown as typeof db.maxLinkRequest.findFirst;
  const nominated: Array<Record<string, unknown>> = [];
  db.maxLinkRequest.updateMany = (async ({ data }: { data: Record<string, unknown> }) => {
    nominated.push(data);
    return { count: 1 };
  }) as unknown as typeof db.maxLinkRequest.updateMany;

  const claim = { maxUserId: "777", chatId: "555", displayName: "Олег" };
  assert.equal(await claimMaxLinkByCode("482913", claim), "req-1");
  // Ищется действующая личная заявка по хэшу кода.
  assert.deepEqual(Object.keys(whereSeen ?? {}).sort(), ["codeHash", "expiresAt", "organizationId", "usedAt"]);
  assert.equal((whereSeen as unknown as { codeHash: string }).codeHash, hashMaxLinkCode("482913"));
  assert.equal((whereSeen as unknown as { organizationId: null }).organizationId, null);
  assert.deepEqual(nominated, [{ claimedMaxUserId: "777", claimedChatId: "555", claimedDisplayName: "Олег" }]);

  found = null;
  await assert.rejects(claimMaxLinkByCode("000000", claim), (error: unknown) => error instanceof MaxError && error.status === 400);

  // Подбор: не больше пяти попыток за 15 минут на человека в MAX.
  const guesser = { ...claim, maxUserId: "999" };
  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(claimMaxLinkByCode(String(100000 + i), guesser), (error: unknown) => error instanceof MaxError && error.status === 400);
  }
  await assert.rejects(claimMaxLinkByCode("482913", guesser), (error: unknown) => error instanceof MaxError && error.status === 429);
});

test("the bot explains the code; /max/connect may return to the home page", () => {
  assert.match(unlinkedView("https://wesetup.ru/max/connect").text, /шестизначный код/);
  assert.equal(safeMaxReturnPath("/home"), "/home");
  assert.equal(safeMaxReturnPath("/homepage-evil"), "/journals");
});
