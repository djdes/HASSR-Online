import assert from "node:assert/strict";
import test from "node:test";

import type { VerifiedUser } from "@/lib/credentials";
import {
  linkTelegramByVerifiedPhone,
  linkTelegramToAuthenticatedUser,
  type AuthLinkDb,
  type AuthLinkUserRecord,
  type PhoneLinkDb,
} from "@/lib/telegram-phone-link";

function makeUser(overrides: Partial<VerifiedUser> = {}): VerifiedUser {
  return {
    id: "u1",
    email: "u1@example.com",
    name: "Иван Повар",
    role: "cook",
    phone: "+79991234567",
    telegramChatId: null,
    organizationId: "org1",
    isActive: true,
    archivedAt: null,
    isRoot: false,
    permissionPreset: null,
    organization: {
      id: "org1",
      name: "Кафе Тест",
    },
    ...overrides,
  } as unknown as VerifiedUser;
}

test("linkTelegramByVerifiedPhone rejects invalid phone without querying DB", async () => {
  let called = false;
  const client: PhoneLinkDb = {
    user: {
      findFirst: async () => {
        called = true;
        return null;
      },
      findMany: async () => {
        called = true;
        return [];
      },
      update: async () => {
        called = true;
      },
    },
  };

  const result = await linkTelegramByVerifiedPhone(
    { chatId: "1001", rawPhone: "123" },
    client
  );
  assert.deepEqual(result, { ok: false, status: "invalid_phone" });
  assert.equal(called, false);
});

test("linkTelegramByVerifiedPhone returns not_found when no active users match phone", async () => {
  const client: PhoneLinkDb = {
    user: {
      findFirst: async () => null,
      findMany: async () => [],
      update: async () => {},
    },
  };

  const result = await linkTelegramByVerifiedPhone(
    { chatId: "1001", rawPhone: "8 (999) 123-45-67" },
    client
  );
  assert.deepEqual(result, { ok: false, status: "not_found" });
});

test("linkTelegramByVerifiedPhone links single matching user and normalizes phone", async () => {
  const user = makeUser({ id: "u1", phone: "+79991234567", telegramChatId: null });
  const updates: unknown[] = [];
  const queries: unknown[] = [];

  const client: PhoneLinkDb = {
    user: {
      findFirst: async () => null,
      findMany: async (args) => {
        queries.push(args);
        return [user];
      },
      update: async (args) => {
        updates.push(args);
      },
    },
  };

  const result = await linkTelegramByVerifiedPhone(
    { chatId: "555001", rawPhone: "8 999 123-45-67" },
    client
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.status, "linked");
    assert.equal(result.user.id, "u1");
    assert.equal(result.user.telegramChatId, "555001");
  }
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    where: { id: "u1" },
    data: { telegramChatId: "555001" },
  });
  assert.equal(
    (queries[0] as { where: { phone: string } }).where.phone,
    "+79991234567"
  );
});

test("linkTelegramByVerifiedPhone returns already_linked when user is already linked to same chatId", async () => {
  const user = makeUser({ id: "u1", telegramChatId: "555001" });
  let updated = false;
  const client: PhoneLinkDb = {
    user: {
      findFirst: async () => user,
      findMany: async () => [user],
      update: async () => {
        updated = true;
      },
    },
  };

  const result = await linkTelegramByVerifiedPhone(
    { chatId: "555001", rawPhone: "+79991234567" },
    client
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.status, "already_linked");
    assert.equal(result.user.id, "u1");
  }
  assert.equal(updated, false);
});

test("linkTelegramByVerifiedPhone rejects ambiguous phone matches unless chatId already belongs to one of them", async () => {
  const u1 = makeUser({ id: "u1", organizationId: "org1" });
  const u2 = makeUser({ id: "u2", organizationId: "org2" });

  const ambiguousClient: PhoneLinkDb = {
    user: {
      findFirst: async () => null,
      findMany: async () => [u1, u2],
      update: async () => {},
    },
  };
  assert.deepEqual(
    await linkTelegramByVerifiedPhone(
      { chatId: "555001", rawPhone: "+79991234567" },
      ambiguousClient
    ),
    { ok: false, status: "ambiguous" }
  );

  const alreadyLinkedInSet = makeUser({ id: "u2", telegramChatId: "555001" });
  const existingClient: PhoneLinkDb = {
    user: {
      findFirst: async () => alreadyLinkedInSet,
      findMany: async () => [u1, alreadyLinkedInSet],
      update: async () => {},
    },
  };
  const okResult = await linkTelegramByVerifiedPhone(
    { chatId: "555001", rawPhone: "+79991234567" },
    existingClient
  );
  assert.equal(okResult.ok, true);
  if (okResult.ok) {
    assert.equal(okResult.status, "already_linked");
    assert.equal(okResult.user.id, "u2");
  }
});

test("linkTelegramByVerifiedPhone refuses hijacking when chatId or user is already bound elsewhere", async () => {
  const otherByChat = makeUser({ id: "u-other", telegramChatId: "555001" });
  const candidate = makeUser({ id: "u-target", telegramChatId: null });

  const tgCollisionClient: PhoneLinkDb = {
    user: {
      findFirst: async () => otherByChat,
      findMany: async () => [candidate],
      update: async () => {},
    },
  };
  assert.deepEqual(
    await linkTelegramByVerifiedPhone(
      { chatId: "555001", rawPhone: "+79991234567" },
      tgCollisionClient
    ),
    { ok: false, status: "telegram_already_linked_other" }
  );

  const userBoundOtherTg = makeUser({ id: "u-target", telegramChatId: "999999" });
  const userCollisionClient: PhoneLinkDb = {
    user: {
      findFirst: async () => null,
      findMany: async () => [userBoundOtherTg],
      update: async () => {},
    },
  };
  assert.deepEqual(
    await linkTelegramByVerifiedPhone(
      { chatId: "555001", rawPhone: "+79991234567" },
      userCollisionClient
    ),
    { ok: false, status: "user_already_linked_other_tg" }
  );
});

test("linkTelegramToAuthenticatedUser handles conflict, not_found, already_linked, and other TG", async () => {
  const makeAuthClient = (opts: {
    collision?: { id: string } | null;
    user?: AuthLinkUserRecord | null;
    phoneOwner?: { id: string } | null;
    onUpdate?: (args: unknown) => void;
  }): AuthLinkDb => {
    let findFirstCalls = 0;
    return {
      user: {
        findFirst: async () => {
          findFirstCalls += 1;
          return findFirstCalls === 1
            ? (opts.collision ?? null)
            : (opts.phoneOwner ?? null);
        },
        findUnique: async () => opts.user ?? null,
        update: async (args) => {
          opts.onUpdate?.(args);
        },
      },
    };
  };

  assert.deepEqual(
    await linkTelegramToAuthenticatedUser(
      { userId: "u1", chatId: "777" },
      makeAuthClient({ collision: { id: "u2" } })
    ),
    { ok: false, status: "conflict" }
  );

  assert.deepEqual(
    await linkTelegramToAuthenticatedUser(
      { userId: "u1", chatId: "777" },
      makeAuthClient({ user: null })
    ),
    { ok: false, status: "not_found" }
  );

  assert.deepEqual(
    await linkTelegramToAuthenticatedUser(
      { userId: "u1", chatId: "777" },
      makeAuthClient({
        user: { id: "u1", organizationId: "org1", telegramChatId: "777", phone: null },
      })
    ),
    { ok: true, status: "already_linked", phoneSaved: null }
  );

  assert.deepEqual(
    await linkTelegramToAuthenticatedUser(
      { userId: "u1", chatId: "777" },
      makeAuthClient({
        user: { id: "u1", organizationId: "org1", telegramChatId: "888", phone: null },
      })
    ),
    { ok: false, status: "user_already_linked_other_tg" }
  );
});

test("linkTelegramToAuthenticatedUser saves verifiedPhone only when user has no phone and org has no duplicate", async () => {
  const updates: unknown[] = [];
  let findFirstCalls = 0;
  const client: AuthLinkDb = {
    user: {
      findFirst: async () => {
        findFirstCalls += 1;
        return null;
      },
      findUnique: async () => ({
        id: "u1",
        organizationId: "org1",
        telegramChatId: null,
        phone: null,
      }),
      update: async (args) => {
        updates.push(args);
      },
    },
  };

  const res = await linkTelegramToAuthenticatedUser(
    { userId: "u1", chatId: "777", verifiedPhone: "8 999 000-11-22" },
    client
  );
  assert.deepEqual(res, {
    ok: true,
    status: "linked",
    phoneSaved: "+79990001122",
  });
  assert.deepEqual(updates[0], {
    where: { id: "u1" },
    data: { telegramChatId: "777", phone: "+79990001122" },
  });
  assert.equal(findFirstCalls, 2);

  // When another user in the org already owns that phone, link TG without overwriting/duplicating phone.
  const updates2: unknown[] = [];
  let calls2 = 0;
  const dupPhoneClient: AuthLinkDb = {
    user: {
      findFirst: async () => {
        calls2 += 1;
        return calls2 === 1 ? null : { id: "u-existing" };
      },
      findUnique: async () => ({
        id: "u1",
        organizationId: "org1",
        telegramChatId: null,
        phone: null,
      }),
      update: async (args) => {
        updates2.push(args);
      },
    },
  };

  const res2 = await linkTelegramToAuthenticatedUser(
    { userId: "u1", chatId: "777", verifiedPhone: "+79990001122" },
    dupPhoneClient
  );
  assert.deepEqual(res2, { ok: true, status: "linked", phoneSaved: null });
  assert.deepEqual(updates2[0], {
    where: { id: "u1" },
    data: { telegramChatId: "777" },
  });
});

test("linkTelegramToAuthenticatedUser с replacePhone меняет номер и при уже привязанном Telegram", async () => {
  const makeClient = (owner: { id: string } | null, updates: unknown[]): AuthLinkDb => {
    let calls = 0;
    return {
      user: {
        findFirst: async () => {
          calls += 1;
          return calls === 1 ? null : owner;
        },
        findUnique: async () => ({
          id: "u1",
          organizationId: "org1",
          telegramChatId: "777",
          phone: "+79990000000",
        }),
        update: async (args) => {
          updates.push(args);
        },
      },
    };
  };

  // Без флага — как раньше: уже привязан, номер не трогаем.
  const plain: unknown[] = [];
  assert.deepEqual(
    await linkTelegramToAuthenticatedUser({ userId: "u1", chatId: "777", verifiedPhone: "+79991112233" }, makeClient(null, plain)),
    { ok: true, status: "already_linked", phoneSaved: null },
  );
  assert.equal(plain.length, 0);

  // «Изменить номер»: номер из контакта Telegram заменяет сохранённый.
  const replaced: unknown[] = [];
  assert.deepEqual(
    await linkTelegramToAuthenticatedUser(
      { userId: "u1", chatId: "777", verifiedPhone: "8 999 111-22-33", replacePhone: true },
      makeClient(null, replaced),
    ),
    { ok: true, status: "already_linked", phoneSaved: "+79991112233" },
  );
  assert.deepEqual(replaced[0], { where: { id: "u1" }, data: { phone: "+79991112233" } });

  // Номер у другого сотрудника — не пишем, сообщаем.
  const taken: unknown[] = [];
  assert.deepEqual(
    await linkTelegramToAuthenticatedUser(
      { userId: "u1", chatId: "777", verifiedPhone: "+79991112233", replacePhone: true },
      makeClient({ id: "u2" }, taken),
    ),
    { ok: true, status: "already_linked", phoneSaved: null, phoneTaken: true },
  );
  assert.equal(taken.length, 0);
});
