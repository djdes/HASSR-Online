import assert from "node:assert/strict";
import test from "node:test";

import {
  PUSH_ONLY_STATUS,
  recordPushOnlyDelivery,
  shouldSkipTelegramDelivery,
} from "@/lib/telegram-delivery-policy";

test("shouldSkipTelegramDelivery returns false without a user id", async () => {
  let called = false;

  const skipped = await shouldSkipTelegramDelivery(
    {
      userId: null,
      delivery: {
        kind: "digest.staff",
        dedupeKey: "org_1:2026-04-20:user_1",
      },
      now: new Date("2026-04-20T08:00:00.000Z"),
    },
    {
      findRecentDelivery: async () => {
        called = true;
        return { id: "log_1" };
      },
    }
  );

  assert.equal(skipped, false);
  assert.equal(called, false);
});

test("shouldSkipTelegramDelivery returns false when metadata is incomplete", async () => {
  let called = false;

  const skipped = await shouldSkipTelegramDelivery(
    {
      userId: "user_1",
      delivery: {
        kind: "digest.staff",
        dedupeKey: "",
      },
      now: new Date("2026-04-20T08:00:00.000Z"),
    },
    {
      findRecentDelivery: async () => {
        called = true;
        return { id: "log_1" };
      },
    }
  );

  assert.equal(skipped, false);
  assert.equal(called, false);
});

test("shouldSkipTelegramDelivery checks recent queued or sent deliveries by user kind and key", async () => {
  const calls: Array<{
    userId: string;
    organizationId: string | null;
    allowLegacyOrganizationlessMatch: boolean;
    kind: string;
    dedupeKey: string;
    since: Date;
    statuses: string[];
  }> = [];

  const skipped = await shouldSkipTelegramDelivery(
    {
      userId: "user_1",
      delivery: {
        organizationId: "org_1",
        kind: "digest.staff",
        dedupeKey: "org_1:2026-04-20:user_1",
      },
      now: new Date("2026-04-20T08:00:00.000Z"),
    },
    {
      findRecentDelivery: async (args) => {
        calls.push(args);
        return { id: "log_1" };
      },
    }
  );

  assert.equal(skipped, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    userId: "user_1",
    organizationId: "org_1",
    allowLegacyOrganizationlessMatch: true,
    kind: "digest.staff",
    dedupeKey: "org_1:2026-04-20:user_1",
    since: new Date("2026-04-18T20:00:00.000Z"),
    statuses: ["queued", "sent", "rate_limited", "push_only"],
  });
});

test("shouldSkipTelegramDelivery treats organization metadata as a first-class lookup field", async () => {
  let capturedOrganizationId: string | null | undefined;
  let allowLegacyOrganizationlessMatch = false;

  await shouldSkipTelegramDelivery(
    {
      userId: "user_1",
      delivery: {
        organizationId: "org_42",
        kind: "digest.manager",
        dedupeKey: "telegram-digest:manager:2026-04-20:org_42",
      },
      now: new Date("2026-04-20T08:00:00.000Z"),
    },
    {
      findRecentDelivery: async (args) => {
        capturedOrganizationId = args.organizationId;
        allowLegacyOrganizationlessMatch = args.allowLegacyOrganizationlessMatch;
        return null;
      },
    }
  );

  assert.equal(capturedOrganizationId, "org_42");
  assert.equal(allowLegacyOrganizationlessMatch, true);
});

test("shouldSkipTelegramDelivery ignores logs outside the configured lookback window", async () => {
  const skipped = await shouldSkipTelegramDelivery(
    {
      userId: "user_1",
      delivery: {
        kind: "digest.staff",
        dedupeKey: "org_1:2026-04-20:user_1",
      },
      now: new Date("2026-04-20T08:00:00.000Z"),
      lookbackMs: 60 * 60 * 1000,
    },
    {
      findRecentDelivery: async ({ since }) => {
        assert.equal(since.toISOString(), "2026-04-20T07:00:00.000Z");
        return null;
      },
    }
  );

  assert.equal(skipped, false);
});

// Сотрудник без Telegram получает только push в приложение. Строки
// TelegramLog для него раньше не было, и повтор крона с `skipOnRerun`
// слал тот же push снова. Теперь доставка push записывается строкой
// со статусом `push_only`, и проверка повтора её видит.
test("без Telegram повтор крона с тем же ключом шлёт push один раз", async () => {
  type Row = {
    userId: string;
    organizationId: string | null;
    kind: string;
    dedupeKey: string;
    status: string;
    createdAt: Date;
  };
  const rows: Row[] = [];
  let pushes = 0;
  const now = new Date("2026-09-26T08:00:00.000Z");
  const delivery = { organizationId: "org_1", kind: "digest.staff", dedupeKey: "org_1:2026-09-26:user_1" };
  const policy = { skipOnRerun: true, now };

  const findRecentDelivery = async (args: {
    userId: string;
    kind: string;
    dedupeKey: string;
    since: Date;
    statuses: string[];
  }) => {
    const row = rows.find(
      (r) =>
        r.userId === args.userId &&
        r.kind === args.kind &&
        r.dedupeKey === args.dedupeKey &&
        args.statuses.includes(r.status) &&
        r.createdAt >= args.since
    );
    return row ? { id: "log" } : null;
  };

  // Так же, как notifyEmployee: проверка повтора → push → запись.
  async function cronRun() {
    const skip = await shouldSkipTelegramDelivery(
      { userId: "user_1", delivery, now },
      { findRecentDelivery }
    );
    if (skip) return;
    pushes++;
    await recordPushOnlyDelivery(
      { userId: "user_1", hasTelegram: false, body: "Задачи на сегодня", delivery, policy },
      {
        hasPushDevice: async () => true,
        recordPushOnly: async (row) => {
          rows.push({ ...row, createdAt: now });
        },
      }
    );
  }

  await cronRun();
  await cronRun();

  assert.equal(pushes, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, PUSH_ONLY_STATUS);
});

test("запись push_only только когда она нужна проверке повтора", async () => {
  const delivery = { organizationId: "org_1", kind: "digest.staff", dedupeKey: "k1" };
  const recorded: unknown[] = [];
  const deps = {
    hasPushDevice: async () => true,
    recordPushOnly: async (row: unknown) => {
      recorded.push(row);
    },
  };

  // Есть Telegram — строку и так пишет отправка в Telegram.
  assert.equal(
    await recordPushOnlyDelivery(
      { userId: "u", hasTelegram: true, body: "x", delivery, policy: { skipOnRerun: true } },
      deps
    ),
    false
  );
  // Без skipOnRerun повтор не проверяется — лог не засоряем.
  assert.equal(
    await recordPushOnlyDelivery(
      { userId: "u", hasTelegram: false, body: "x", delivery, policy: {} },
      deps
    ),
    false
  );
  // Без ключа повтора — тоже.
  assert.equal(
    await recordPushOnlyDelivery(
      {
        userId: "u",
        hasTelegram: false,
        body: "x",
        delivery: { kind: "digest.staff", dedupeKey: "" },
        policy: { skipOnRerun: true },
      },
      deps
    ),
    false
  );
  // Телефона с включёнными уведомлениями нет — push никуда не ушёл.
  assert.equal(
    await recordPushOnlyDelivery(
      { userId: "u", hasTelegram: false, body: "x", delivery, policy: { skipOnRerun: true } },
      { ...deps, hasPushDevice: async () => false }
    ),
    false
  );
  assert.equal(recorded.length, 0);

  assert.equal(
    await recordPushOnlyDelivery(
      { userId: "u", hasTelegram: false, body: "x", delivery, policy: { skipOnRerun: true } },
      deps
    ),
    true
  );
  assert.deepEqual(recorded, [
    {
      userId: "u",
      organizationId: "org_1",
      kind: "digest.staff",
      dedupeKey: "k1",
      body: "x",
      status: PUSH_ONLY_STATUS,
    },
  ]);
});
