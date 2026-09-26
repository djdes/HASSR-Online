import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFERRED_STATUS,
  flushDeferredDeliveries,
  PUSH_ONLY_STATUS,
  recordPushOnlyDelivery,
  routeEmployeeDelivery,
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
    statuses: ["queued", "sent", "rate_limited", "push_only", "deferred"],
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

// --- notifyEmployee: тихие часы, push в приложение, опция appPush ---

type LogRow = {
  id: string;
  chatId: string;
  body: string;
  userId: string | null;
  organizationId: string | null;
  kind: string | null;
  dedupeKey: string | null;
  status: string;
  deliverAfter: Date | null;
  sentAt: Date | null;
  error: string | null;
};

/** Память вместо TelegramLog + счётчики отправок в Telegram и push. */
function makeStand(opts: { pushConfigured?: boolean; hasDevice?: boolean; startPush?: boolean } = {}) {
  const rows: LogRow[] = [];
  const pushes: Array<{ userId: string; title: string; body: string; url: string | null }> = [];
  const telegram: Array<{ chatId: string; body: string }> = [];
  let seq = 0;
  const deps = {
    isPushConfigured: () => opts.pushConfigured ?? true,
    hasPushDevice: async () => opts.hasDevice ?? true,
    startPush: (userId: string, msg: { title: string; body: string; url: string | null }) => {
      if (opts.startPush === false) return false;
      pushes.push({ userId, ...msg });
      return true;
    },
    createDeferred: async (row: {
      chatId: string;
      body: string;
      userId: string;
      organizationId: string | null;
      kind: string | null;
      dedupeKey: string | null;
      status: string;
      deliverAfter: Date;
    }) => {
      rows.push({ id: `log_${++seq}`, sentAt: null, error: null, ...row });
    },
    recordPushOnly: async (row: {
      userId: string;
      organizationId: string | null;
      kind: string;
      dedupeKey: string;
      body: string;
      status: string;
    }) => {
      rows.push({ id: `log_${++seq}`, chatId: "", deliverAfter: null, sentAt: new Date(), error: null, ...row });
    },
  };
  const flushDeps = {
    findDue: async (now: Date) =>
      rows.filter((r) => r.status === DEFERRED_STATUS && r.deliverAfter && r.deliverAfter <= now),
    sendTelegram: async (row: { id: string; chatId: string; body: string }) => {
      telegram.push({ chatId: row.chatId, body: row.body });
      const r = rows.find((x) => x.id === row.id)!;
      r.status = "sent";
      return true;
    },
    startPush: deps.startPush,
    markPushed: async (id: string, at: Date) => {
      const r = rows.find((x) => x.id === id)!;
      r.status = PUSH_ONLY_STATUS;
      r.sentAt = at;
    },
    markFailed: async (id: string, error: string) => {
      const r = rows.find((x) => x.id === id)!;
      r.status = "failed";
      r.error = error;
    },
  };
  return { rows, pushes, telegram, deps, flushDeps };
}

const night = new Date("2026-09-26T20:00:00.000Z");
const morning = new Date("2026-09-27T05:00:00.000Z");
const staffDelivery = { organizationId: "org_1", kind: "digest.staff", dedupeKey: "org_1:2026-09-26:user_1" };

test("тихие часы: сотрудник только с приложением получает push утром, а не теряет его", async () => {
  const stand = makeStand();
  const result = await routeEmployeeDelivery(
    {
      userId: "user_1",
      telegramChatId: null,
      text: "<b>Задачи</b> на сегодня",
      url: "/mini/today",
      quietUntilAt: morning,
      delivery: staffDelivery,
      policy: { skipOnRerun: true, now: night },
    },
    stand.deps
  );
  assert.deepEqual(result, { push: "deferred", telegram: "none" });
  assert.equal(stand.pushes.length, 0, "ночью push не будит");
  assert.equal(stand.rows.length, 1);
  assert.deepEqual(
    { ...stand.rows[0], id: undefined },
    {
      id: undefined,
      chatId: "",
      body: "<b>Задачи</b> на сегодня",
      userId: "user_1",
      organizationId: "org_1",
      kind: "digest.staff",
      dedupeKey: "org_1:2026-09-26:user_1",
      status: DEFERRED_STATUS,
      deliverAfter: morning,
      sentAt: null,
      error: null,
    }
  );

  // Ещё ночь — рано.
  assert.deepEqual(await flushDeferredDeliveries(night, stand.flushDeps), { sent: 0, failed: 0 });
  // Утро — ровно один push, без Telegram.
  assert.deepEqual(await flushDeferredDeliveries(morning, stand.flushDeps), { sent: 1, failed: 0 });
  assert.deepEqual(stand.pushes, [{ userId: "user_1", title: "WeSetup", body: "Задачи на сегодня", url: null }]);
  assert.equal(stand.telegram.length, 0);
  assert.equal(stand.rows[0].status, PUSH_ONLY_STATUS);
  // Повторный проход ничего не шлёт.
  assert.deepEqual(await flushDeferredDeliveries(morning, stand.flushDeps), { sent: 0, failed: 0 });
  assert.equal(stand.pushes.length, 1);
});

test("тихие часы: у сотрудника с Telegram утром приходят и Telegram, и push", async () => {
  const stand = makeStand();
  const result = await routeEmployeeDelivery(
    { userId: "user_1", telegramChatId: "555", text: "Задачи на сегодня", quietUntilAt: morning, delivery: staffDelivery },
    stand.deps
  );
  assert.deepEqual(result, { push: "deferred", telegram: "deferred" });
  assert.equal(stand.pushes.length, 0);
  assert.deepEqual(
    stand.rows.map((r) => [r.chatId, r.status]).sort(),
    [["", DEFERRED_STATUS], ["555", DEFERRED_STATUS]]
  );
  assert.deepEqual(await flushDeferredDeliveries(morning, stand.flushDeps), { sent: 2, failed: 0 });
  assert.deepEqual(stand.telegram, [{ chatId: "555", body: "Задачи на сегодня" }]);
  assert.equal(stand.pushes.length, 1);
});

test("тихие часы: без Telegram и без телефона строки нет", async () => {
  const noDevice = makeStand({ hasDevice: false });
  assert.deepEqual(
    await routeEmployeeDelivery(
      { userId: "user_1", telegramChatId: null, text: "x", quietUntilAt: morning, delivery: staffDelivery },
      noDevice.deps
    ),
    { push: "skipped", telegram: "none" }
  );
  assert.equal(noDevice.rows.length, 0);

  const noFirebase = makeStand({ pushConfigured: false });
  await routeEmployeeDelivery(
    { userId: "user_1", telegramChatId: null, text: "x", quietUntilAt: morning, delivery: staffDelivery },
    noFirebase.deps
  );
  assert.equal(noFirebase.rows.length, 0);
});

test("appPush: false — push не уходит и доставка не записывается", async () => {
  const stand = makeStand();
  const day = await routeEmployeeDelivery(
    {
      userId: "user_1",
      telegramChatId: null,
      text: "PIN",
      appPush: false,
      quietUntilAt: null,
      delivery: staffDelivery,
      policy: { skipOnRerun: true },
    },
    stand.deps
  );
  assert.deepEqual(day, { push: "skipped", telegram: "none" });
  const atNight = await routeEmployeeDelivery(
    { userId: "user_1", telegramChatId: "555", text: "PIN", appPush: false, quietUntilAt: morning, delivery: staffDelivery },
    stand.deps
  );
  // Telegram откладывается как обычно, push-строки нет.
  assert.deepEqual(atNight, { push: "skipped", telegram: "deferred" });
  assert.equal(stand.pushes.length, 0);
  assert.deepEqual(stand.rows.map((r) => r.chatId), ["555"]);
});

test("push не начат — доставка не записывается, повтор крона пришлёт его", async () => {
  const stand = makeStand({ startPush: false });
  const result = await routeEmployeeDelivery(
    {
      userId: "user_1",
      telegramChatId: null,
      text: "Задачи",
      quietUntilAt: null,
      delivery: staffDelivery,
      policy: { skipOnRerun: true },
    },
    stand.deps
  );
  assert.deepEqual(result, { push: "skipped", telegram: "none" });
  assert.equal(stand.rows.length, 0);

  const ok = makeStand();
  assert.deepEqual(
    await routeEmployeeDelivery(
      {
        userId: "user_1",
        telegramChatId: "555",
        text: "Задачи",
        quietUntilAt: null,
        delivery: staffDelivery,
        policy: { skipOnRerun: true },
      },
      ok.deps
    ),
    { push: "sent", telegram: "send" }
  );
  assert.equal(ok.pushes.length, 1);
  // С Telegram строку пишет сама отправка в Telegram.
  assert.equal(ok.rows.length, 0);
});

test("утром push не отправился — строка помечается сбоем, а не доставкой", async () => {
  const stand = makeStand();
  await routeEmployeeDelivery(
    { userId: "user_1", telegramChatId: null, text: "Задачи", quietUntilAt: morning, delivery: staffDelivery },
    stand.deps
  );
  const failing = { ...stand.flushDeps, startPush: () => false };
  assert.deepEqual(await flushDeferredDeliveries(morning, failing), { sent: 0, failed: 1 });
  assert.equal(stand.rows[0].status, "failed");
});
