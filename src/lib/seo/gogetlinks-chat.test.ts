import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { GglCallError, GglIsolationError } from "@/lib/seo/gogetlinks-client.server";
import {
  GglChatError,
  getAndRefreshGglThread,
  listGglThreads,
  replyToGglThread,
  reviewGglPlacement,
} from "@/lib/seo/gogetlinks-chat.server";

const requireCjs = createRequire(import.meta.url);

function loadRouteFixture<T>(file: string, mocks: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const fixtureModule = { exports: {} };
  vm.runInNewContext(output, {
    module: fixtureModule,
    exports: fixtureModule.exports,
    console,
    process,
    Date,
    Response,
    Request,
    Headers,
    URL,
    URLSearchParams,
    require: (id: string) => (Object.hasOwn(mocks, id) ? mocks[id] : requireCjs(id)),
  });
  return fixtureModule.exports as T;
}

function createFakeDecimal(val: number) {
  return {
    toNumber: () => val,
    toString: () => val.toFixed(2),
    valueOf: () => val,
  };
}

test("Review Focus #3: replyToGglThread deduplicates same idempotencyKey and keeps 'sending' on uncertain network outcome", async () => {
  let networkCalls = 0;
  const store = new Map<string, { id: string; deliveryStatus: string; sentByName: string }>();
  const deps = {
    findThread: async () => ({
      id: "th_1",
      gglThreadKey: "rev_77",
      campaignId: "c_ws",
      campaignIsWesetup: true,
    }),
    claimOutboundMessage: async (key: string, user: { name: string }) => {
      const existing = store.get(key);
      if (existing) return { claimed: false as const, message: existing };
      const msg = { id: "m_1", deliveryStatus: "sending", sentByName: user.name };
      store.set(key, msg);
      return { claimed: true as const, message: msg };
    },
    markMessageStatus: async (key: string, status: string) => {
      store.get(key)!.deliveryStatus = status;
    },
    sendRemote: async () => {
      networkCalls += 1;
      return { status: "may_have_applied" as const, data: null };
    },
    writeAudit: async () => {},
  };

  const first = await replyToGglThread(
    {
      threadId: "th_1",
      body: "Добрый день, поправьте анкор, пожалуйста.",
      idempotencyKey: "k-1",
      user: { id: "u1", name: "Анна" },
    },
    deps,
  );
  const duplicate = await replyToGglThread(
    {
      threadId: "th_1",
      body: "Добрый день, поправьте анкор, пожалуйста.",
      idempotencyKey: "k-1",
      user: { id: "u1", name: "Анна" },
    },
    deps,
  );

  assert.equal(networkCalls, 1, "second call with same idempotencyKey must not re-send");
  assert.equal(first.deliveryStatus, "sending", "ambiguous network result stays 'sending' until sync confirms");
  assert.equal(duplicate.sentByName, "Анна");
});

test("replyToGglThread rejects non-wesetup.ru threads before claiming message or touching GoGetLinks", async () => {
  let claimCalled = false;
  let networkCalled = false;

  await assert.rejects(
    () =>
      replyToGglThread(
        {
          threadId: "th_yesbeat",
          body: "Проверка",
          idempotencyKey: "k-yb",
          user: { id: "u1", name: "Анна" },
        },
        {
          findThread: async () => ({
            id: "th_yesbeat",
            gglThreadKey: "rev_999",
            campaignId: "c_yb",
            campaignIsWesetup: false,
          }),
          claimOutboundMessage: async () => {
            claimCalled = true;
            throw new Error("must not claim");
          },
          markMessageStatus: async () => {},
          sendRemote: async () => {
            networkCalled = true;
            return { status: "applied" as const, data: null };
          },
          writeAudit: async () => {},
        },
      ),
    (err: unknown) => err instanceof GglIsolationError && /wesetup\.ru/i.test(err.message),
  );

  assert.equal(claimCalled, false);
  assert.equal(networkCalled, false);
});

test("replyToGglThread marks 'synced' on applied/accepted and writes ggl.message.reply audit log", async () => {
  const store = new Map<string, { id: string; deliveryStatus: string; sentByName: string }>();
  const audits: Array<Record<string, unknown>> = [];

  const result = await replyToGglThread(
    {
      threadId: "th_ws",
      body: "Спасибо, ссылку проверили!",
      idempotencyKey: "k-ok-1",
      user: { id: "u_seo", name: "Анна SEO" },
    },
    {
      findThread: async () => ({
        id: "th_ws",
        gglThreadKey: "88123",
        campaignId: "c_ws",
        campaignIsWesetup: true,
      }),
      claimOutboundMessage: async (key, user) => {
        const msg = { id: "m_ok", deliveryStatus: "sending", sentByName: user.name };
        store.set(key, msg);
        return { claimed: true as const, message: msg };
      },
      markMessageStatus: async (key, status) => {
        store.get(key)!.deliveryStatus = status;
      },
      sendRemote: async () => ({ status: "accepted" as const, data: { ok: true } }),
      writeAudit: async (entry) => {
        audits.push(entry as unknown as Record<string, unknown>);
      },
    },
  );

  assert.equal(result.deliveryStatus, "synced");
  assert.equal(store.get("k-ok-1")?.deliveryStatus, "synced");
  assert.equal(result.sentByName, "Анна SEO");
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.action, "ggl.message.reply");
  assert.equal(audits[0]?.entity, "GglMessage");
  assert.equal(audits[0]?.entityId, "m_ok");
});

test("replyToGglThread marks 'failed' on explicit not_sent/not_applied GglCallError, but retains 'sending' on timeout error", async () => {
  const store = new Map<string, { id: string; deliveryStatus: string; sentByName: string }>();

  const makeDeps = (throwErr: Error) => ({
    findThread: async () => ({
      id: "th_ws",
      gglThreadKey: "88123",
      campaignId: "c_ws",
      campaignIsWesetup: true,
    }),
    claimOutboundMessage: async (key: string, user: { name: string }) => {
      const existing = store.get(key);
      if (existing) return { claimed: false as const, message: existing };
      const msg = { id: `m_${key}`, deliveryStatus: "sending", sentByName: user.name };
      store.set(key, msg);
      return { claimed: true as const, message: msg };
    },
    markMessageStatus: async (key: string, status: string) => {
      store.get(key)!.deliveryStatus = status;
    },
    sendRemote: async () => {
      throw throwErr;
    },
    writeAudit: async () => {},
  });

  await assert.rejects(
    () =>
      replyToGglThread(
        {
          threadId: "th_ws",
          body: "Сообщение отклонённое биржей",
          idempotencyKey: "k-not-applied",
          user: { id: "u1", name: "Анна" },
        },
        makeDeps(new GglCallError("GoGetLinks refused message", "not_applied")),
      ),
    GglCallError,
  );
  assert.equal(store.get("k-not-applied")?.deliveryStatus, "failed");

  await assert.rejects(
    () =>
      replyToGglThread(
        {
          threadId: "th_ws",
          body: "Сообщение не ушедшее в сеть",
          idempotencyKey: "k-not-sent",
          user: { id: "u1", name: "Анна" },
        },
        makeDeps(new GglCallError("Request blocked before dispatch", "not_sent")),
      ),
    GglCallError,
  );
  assert.equal(store.get("k-not-sent")?.deliveryStatus, "failed");

  await assert.rejects(
    () =>
      replyToGglThread(
        {
          threadId: "th_ws",
          body: "Сообщение с обрывом соединения",
          idempotencyKey: "k-timeout",
          user: { id: "u1", name: "Анна" },
        },
        makeDeps(new GglCallError("Request timed out mid-flight", "error")),
      ),
    GglCallError,
  );
  assert.equal(
    store.get("k-timeout")?.deliveryStatus,
    "sending",
    "timeout/uncertain failure must keep 'sending' so retry with same key cannot double-post",
  );
});

test("replyToGglThread default Prisma claim handles concurrent P2002 unique constraint without throwing 500", async () => {
  const createdRow = {
    id: "m_raced",
    threadId: "th_ws",
    gglMessageId: null,
    direction: "outbound",
    authorLabel: "Анна",
    sentByUserId: "u1",
    sentByName: "Анна",
    body: "Параллельный клик",
    deliveryStatus: "sending",
    idempotencyKey: "k-race-1",
    sentAt: new Date("2026-11-05T13:00:00.000Z"),
    createdAt: new Date("2026-11-05T13:00:00.000Z"),
  };

  let findUniqueCalls = 0;
  let remoteSendCalls = 0;
  const mockPrisma = {
    gglThread: {
      findUnique: async () => ({
        id: "th_ws",
        gglThreadKey: "7701",
        campaignId: "c_ws",
        campaign: { id: "c_ws", isWesetup: true },
        order: null,
      }),
      update: async () => ({}),
    },
    gglMessage: {
      findUnique: async () => {
        findUniqueCalls += 1;
        // First pre-check misses; second lookup after P2002 finds the winner's row
        return findUniqueCalls >= 2 ? createdRow : null;
      },
      create: async () => {
        const p2002 = Object.assign(new Error("Unique constraint failed on idempotencyKey"), {
          code: "P2002",
        });
        throw p2002;
      },
      update: async () => createdRow,
    },
  };

  const duplicate = await replyToGglThread(
    {
      threadId: "th_ws",
      body: "Параллельный клик",
      idempotencyKey: "k-race-1",
      user: { id: "u1", name: "Анна" },
    },
    {
      prismaClient: mockPrisma as never,
      sendRemote: async () => {
        remoteSendCalls += 1;
        return { status: "applied" as const, data: null };
      },
      writeAudit: async () => {},
    },
  );

  assert.equal(remoteSendCalls, 0, "loser of P2002 race must not call GoGetLinks");
  assert.equal(duplicate.id, "m_raced");
  assert.equal(duplicate.deliveryStatus, "sending");
  assert.equal(duplicate.sentByName, "Анна");
});

test("reviewGglPlacement rejects non-wesetup.ru orders before calling GoGetLinks", async () => {
  await assert.rejects(
    () =>
      reviewGglPlacement(
        { orderId: "ord_yesbeat", action: "accept", idempotencyKey: "rev-1", user: { id: "u1", name: "Олег" } },
        {
          findOrder: async () => ({
            id: "ord_yesbeat",
            gglReviewId: 501,
            status: "on_check",
            campaignId: "c_yb",
            campaignIsWesetup: false,
          }),
          reviewRemote: async () => {
            throw new Error("must not be called");
          },
          updateOrderStatus: async () => {},
          writeAudit: async () => {},
        },
      ),
    /wesetup\.ru/i,
  );
});

test("reviewGglPlacement enforces comment >= 5 chars on request_revision, updates status on accept/revision, and keeps status on may_have_applied", async () => {
  const audits: Array<Record<string, unknown>> = [];
  const statusUpdates: Array<{ orderId: string; status: string }> = [];

  await assert.rejects(
    () =>
      reviewGglPlacement(
        {
          orderId: "ord_ws_1",
          action: "request_revision",
          comment: "ок",
          idempotencyKey: "rev-short",
          user: { id: "u_seo", name: "Анна" },
        },
        {
          findOrder: async () => ({
            id: "ord_ws_1",
            gglReviewId: 6046338,
            status: "on_check",
            campaignId: "c_ws",
            campaignIsWesetup: true,
          }),
          reviewRemote: async () => {
            throw new Error("must not call GoGetLinks when comment is too short");
          },
          updateOrderStatus: async () => {},
          writeAudit: async () => {},
        },
      ),
    (err: unknown) => err instanceof GglChatError && err.status === 400,
  );

  const acceptedOrder = await reviewGglPlacement(
    {
      orderId: "ord_ws_1",
      action: "accept",
      idempotencyKey: "rev-acc-1",
      user: { id: "u_root", name: "Олег" },
    },
    {
      findOrder: async () => ({
        id: "ord_ws_1",
        gglReviewId: 6046338,
        status: "on_check",
        campaignId: "c_ws",
        campaignIsWesetup: true,
        donorDomain: "horeca.ru",
        priceRub: createFakeDecimal(850),
        targetUrl: "https://wesetup.ru/journals-info",
        anchor: "журналы хассп",
        placementFormat: "article",
        origin: "scheduled_wesetup",
      }),
      reviewRemote: async (args) => {
        assert.equal(args.reviewId, "6046338");
        assert.equal(args.action, "accept");
        return { status: "accepted" as const, data: { ok: true } };
      },
      updateOrderStatus: async (orderId, status) => {
        statusUpdates.push({ orderId, status });
      },
      writeAudit: async (entry) => {
        audits.push(entry as unknown as Record<string, unknown>);
      },
    },
  );

  assert.equal(acceptedOrder.status, "paid");
  assert.equal(acceptedOrder.priceRub, 850);
  assert.deepEqual(statusUpdates[0], { orderId: "ord_ws_1", status: "paid" });
  assert.equal(audits[0]?.action, "ggl.order.accept");

  const revisionOrder = await reviewGglPlacement(
    {
      orderId: "ord_ws_2",
      action: "request_revision",
      comment: "Пожалуйста, поставьте точный анкор из задания.",
      idempotencyKey: "rev-req-1",
      user: { id: "u_seo", name: "Анна" },
    },
    {
      findOrder: async () => ({
        id: "ord_ws_2",
        gglReviewId: 6046339,
        status: "on_check",
        campaignId: "c_ws",
        campaignIsWesetup: true,
        donorDomain: "restoranoff.ru",
        priceRub: createFakeDecimal(790),
        targetUrl: "https://wesetup.ru/sanpin",
        anchor: "санпин общепит",
        placementFormat: "note",
        origin: "manual_wesetup",
      }),
      reviewRemote: async (args) => {
        assert.equal(args.action, "request_revision");
        assert.match(String(args.comment), /анкор/);
        return { status: "applied" as const, data: { ok: true } };
      },
      updateOrderStatus: async (orderId, status) => {
        statusUpdates.push({ orderId, status });
      },
      writeAudit: async (entry) => {
        audits.push(entry as unknown as Record<string, unknown>);
      },
    },
  );

  assert.equal(revisionOrder.status, "in_progress");
  assert.deepEqual(statusUpdates[1], { orderId: "ord_ws_2", status: "in_progress" });
  assert.equal(audits[1]?.action, "ggl.order.request_revision");

  // Uncertain outcome (may_have_applied) keeps local status unchanged until sync confirms
  const uncertainOrder = await reviewGglPlacement(
    {
      orderId: "ord_ws_3",
      action: "accept",
      idempotencyKey: "rev-ambig-1",
      user: { id: "u_seo", name: "Анна" },
    },
    {
      findOrder: async () => ({
        id: "ord_ws_3",
        gglReviewId: 6046340,
        status: "on_check",
        campaignId: "c_ws",
        campaignIsWesetup: true,
      }),
      reviewRemote: async () => ({ status: "may_have_applied" as const, data: null }),
      updateOrderStatus: async (orderId, status) => {
        statusUpdates.push({ orderId, status });
      },
      writeAudit: async () => {},
    },
  );

  assert.equal(uncertainOrder.status, "on_check");
  assert.equal(statusUpdates.length, 2, "must not overwrite order status on may_have_applied");
});

test("routes: GET /threads, GET/POST /threads/[id], and POST /orders/[id]/review validate inputs, await Next.js 16 params, enforce isolation, and serialize Decimal", async () => {
  const sampleThreads = [
    {
      id: "th_ws_1",
      gglThreadKey: "5501",
      orderId: "ord_ws_1",
      campaignId: "c_ws",
      campaign: { id: "c_ws", gglCampaignId: 200001, name: "WeSetup", domain: "wesetup.ru", isWesetup: true },
      order: {
        id: "ord_ws_1",
        gglReviewId: 901,
        donorDomain: "horeca.ru",
        targetUrl: "https://wesetup.ru/journals-info",
        anchor: "журналы хассп",
        priceRub: createFakeDecimal(790.5),
        status: "on_check",
        publishedUrl: "https://horeca.ru/post-1",
      },
      donorDomain: "horeca.ru",
      webmasterLogin: "wm_ivan",
      subject: "Обзор #901",
      unreadCount: 2,
      needsReply: true,
      lastMessageAt: new Date("2026-11-05T12:00:00.000Z"),
      lastMessagePreview: "Разместил статью, проверьте",
      createdAt: new Date("2026-11-05T11:00:00.000Z"),
      updatedAt: new Date("2026-11-05T12:00:00.000Z"),
    },
    {
      id: "th_yb_1",
      gglThreadKey: "5502",
      orderId: null,
      campaignId: "c_yb",
      campaign: { id: "c_yb", gglCampaignId: 149699, name: "YesBeat", domain: "yesbeat.ru", isWesetup: false },
      order: null,
      donorDomain: "music.ru",
      webmasterLogin: "wm_music",
      subject: "Старый диалог",
      unreadCount: 0,
      needsReply: false,
      lastMessageAt: new Date("2024-01-01T12:00:00.000Z"),
      lastMessagePreview: "Ок",
      createdAt: new Date("2024-01-01T11:00:00.000Z"),
      updatedAt: new Date("2024-01-01T12:00:00.000Z"),
    },
  ];

  const mockListDb = {
    gglThread: {
      findMany: async (args?: {
        where?: {
          unreadCount?: { gt: number };
          needsReply?: boolean;
          campaign?: { isWesetup?: boolean };
        };
      }) => {
        return sampleThreads.filter((t) => {
          if (args?.where?.campaign?.isWesetup === true && !t.campaign.isWesetup) return false;
          if (args?.where?.unreadCount?.gt !== undefined && !(t.unreadCount > args.where.unreadCount.gt)) {
            return false;
          }
          if (args?.where?.needsReply === true && !t.needsReply) return false;
          return true;
        });
      },
    },
  };

  const threadsRoute = loadRouteFixture<{
    GET: (req: Request) => Promise<Response>;
  }>("src/app/api/root/gogetlinks/threads/route.ts", {
    "@/lib/auth-helpers": {
      requireRoot: async () => ({ user: { id: "u_seo", name: "Анна" } }),
    },
    "@/lib/seo/gogetlinks-chat.server": {
      GglChatError,
      listGglThreads: (opts: Parameters<typeof listGglThreads>[0]) =>
        listGglThreads(opts, { prismaClient: mockListDb as never }),
    },
  });

  const listRes = await threadsRoute.GET(
    new Request("https://wesetup.ru/api/root/gogetlinks/threads?onlyUnread=true&needsReply=true"),
  );
  assert.equal(listRes.status, 200);
  const listJson = await listRes.json();
  assert.equal(listJson.threads.length, 1);
  assert.equal(listJson.threads[0].id, "th_ws_1");
  assert.equal(listJson.threads[0].order.priceRub, 790.5);

  const allProjectsRes = await threadsRoute.GET(
    new Request("https://wesetup.ru/api/root/gogetlinks/threads?includeOtherProjects=true"),
  );
  const allProjectsJson = await allProjectsRes.json();
  assert.equal(allProjectsJson.threads.length, 2);

  // Thread detail GET + POST
  const storedMessages = new Map<string, Record<string, unknown>>([
    [
      "m_pending",
      {
        id: "m_pending",
        threadId: "th_ws_1",
        gglMessageId: null,
        direction: "outbound",
        authorLabel: "Анна",
        sentByUserId: "u_seo",
        sentByName: "Анна SEO",
        body: "Добрый день! Проверьте ссылку.",
        deliveryStatus: "sending",
        idempotencyKey: "k-prev",
        sentAt: new Date("2026-11-05T12:55:00.000Z"),
        createdAt: new Date("2026-11-05T12:55:00.000Z"),
      },
    ],
  ]);

  const mockThreadDetailDb = {
    gglAccount: {
      findFirst: async () => ({ id: "acc_1", email: "seo@wesetup.ru" }),
    },
    gglThread: {
      findUnique: async (args: { where: { id: string } }) =>
        args.where.id === "th_ws_1" ? sampleThreads[0] : null,
      update: async (_args: { where: { id: string }; data: Record<string, unknown> }) => ({
        ...sampleThreads[0],
        unreadCount: 0,
      }),
    },
    gglMessage: {
      findMany: async () => [...storedMessages.values()],
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const next = { ...storedMessages.get(args.where.id)!, ...args.data };
        storedMessages.set(args.where.id, next);
        return next;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        const id = `m_new_${storedMessages.size + 1}`;
        const row = { id, createdAt: new Date("2026-11-05T13:00:00.000Z"), ...args.data };
        storedMessages.set(id, row);
        return row;
      },
    },
  };

  const receivedReplyHolder: { input: Record<string, unknown> | null } = { input: null };
  const threadDetailRoute = loadRouteFixture<{
    GET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
    POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  }>("src/app/api/root/gogetlinks/threads/[id]/route.ts", {
    "@/lib/auth-helpers": {
      requireRoot: async () => ({ user: { id: "u_seo", name: "Анна SEO" } }),
    },
    "@/lib/seo/gogetlinks-chat.server": {
      GglChatError,
      getAndRefreshGglThread: (threadId: string) =>
        getAndRefreshGglThread(threadId, {
          prismaClient: mockThreadDetailDb as never,
          now: new Date("2026-11-05T13:00:00.000Z"),
          readGgl: async (opName, args) => {
            assert.equal(opName, "getMessageThread");
            assert.deepEqual(args, { threadKey: "5501" });
            return [
              { sender: "Вы", text: "Добрый день! Проверьте ссылку.", date: "05.11.2026 12:55" },
              { sender: "wm_ivan", text: "Готово, поправил!", date: "05.11.2026 12:59" },
            ] as never;
          },
        }),
      replyToGglThread: async (input: Record<string, unknown>) => {
        if (input.threadId === "th_yb_1") {
          throw new GglIsolationError("Чужой проект: не wesetup.ru");
        }
        receivedReplyHolder.input = input;
        return {
          id: "m_reply_1",
          threadId: String(input.threadId),
          gglMessageId: null,
          direction: "outbound",
          authorLabel: "Анна SEO",
          sentByUserId: "u_seo",
          sentByName: "Анна SEO",
          body: String(input.body),
          deliveryStatus: "synced",
          idempotencyKey: String(input.idempotencyKey),
          sentAt: "2026-11-05T13:01:00.000Z",
          createdAt: "2026-11-05T13:01:00.000Z",
        };
      },
    },
  });

  const detailGetRes = await threadDetailRoute.GET(
    new Request("https://wesetup.ru/api/root/gogetlinks/threads/th_ws_1"),
    { params: Promise.resolve({ id: "th_ws_1" }) },
  );
  assert.equal(detailGetRes.status, 200);
  const detailGetJson = await detailGetRes.json();
  assert.equal(detailGetJson.thread.order.priceRub, 790.5);
  assert.equal(detailGetJson.messages.length, 2);
  assert.equal(detailGetJson.messages[0].deliveryStatus, "synced");
  assert.equal(detailGetJson.messages[0].sentByName, "Анна SEO");
  assert.equal(detailGetJson.messages[1].direction, "inbound");

  const missingGetRes = await threadDetailRoute.GET(
    new Request("https://wesetup.ru/api/root/gogetlinks/threads/missing"),
    { params: Promise.resolve({ id: "missing" }) },
  );
  assert.equal(missingGetRes.status, 404);

  const invalidPostRes = await threadDetailRoute.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/threads/th_ws_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "   ", idempotencyKey: "k1" }),
    }),
    { params: Promise.resolve({ id: "th_ws_1" }) },
  );
  assert.equal(invalidPostRes.status, 400);

  const forbiddenPostRes = await threadDetailRoute.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/threads/th_yb_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Ответ", idempotencyKey: "k2" }),
    }),
    { params: Promise.resolve({ id: "th_yb_1" }) },
  );
  assert.equal(forbiddenPostRes.status, 403);

  const okPostRes = await threadDetailRoute.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/threads/th_ws_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Отлично, принимаем!", idempotencyKey: "k3" }),
    }),
    { params: Promise.resolve({ id: "th_ws_1" }) },
  );
  assert.equal(okPostRes.status, 200);
  assert.equal(receivedReplyHolder.input?.threadId, "th_ws_1");

  // Order review POST route
  const reviewRoute = loadRouteFixture<{
    POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  }>("src/app/api/root/gogetlinks/orders/[id]/review/route.ts", {
    "@/lib/auth-helpers": {
      requireRoot: async () => ({ user: { id: "u_root", name: "Олег" } }),
    },
    "@/lib/seo/gogetlinks-chat.server": {
      GglChatError,
      reviewGglPlacement: async (input: {
        orderId: string;
        action: "accept" | "request_revision";
        comment?: string;
        idempotencyKey: string;
      }) => {
        if (input.orderId === "ord_yb") {
          throw new GglIsolationError("Заявка не принадлежит wesetup.ru");
        }
        if (input.orderId === "ord_missing") {
          throw new GglChatError(404, "Заявка не найдена");
        }
        return {
          id: input.orderId,
          gglReviewId: 901,
          campaignId: "c_ws",
          donorDomain: "horeca.ru",
          placementFormat: "article",
          priceRub: 790.5,
          targetUrl: "https://wesetup.ru/journals-info",
          anchor: "журналы хассп",
          status: input.action === "accept" ? "paid" : "in_progress",
          origin: "scheduled_wesetup",
        };
      },
    },
  });

  const badRevisionRes = await reviewRoute.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/orders/ord_ws_1/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "request_revision", comment: "нет", idempotencyKey: "r1" }),
    }),
    { params: Promise.resolve({ id: "ord_ws_1" }) },
  );
  assert.equal(badRevisionRes.status, 400);

  const isolationReviewRes = await reviewRoute.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/orders/ord_yb/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "accept", idempotencyKey: "r2" }),
    }),
    { params: Promise.resolve({ id: "ord_yb" }) },
  );
  assert.equal(isolationReviewRes.status, 403);

  const missingReviewRes = await reviewRoute.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/orders/ord_missing/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "accept", idempotencyKey: "r3" }),
    }),
    { params: Promise.resolve({ id: "ord_missing" }) },
  );
  assert.equal(missingReviewRes.status, 404);

  const acceptReviewRes = await reviewRoute.POST(
    new Request("https://wesetup.ru/api/root/gogetlinks/orders/ord_ws_1/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "accept", idempotencyKey: "r4" }),
    }),
    { params: Promise.resolve({ id: "ord_ws_1" }) },
  );
  assert.equal(acceptReviewRes.status, 200);
  const acceptReviewJson = await acceptReviewRes.json();
  assert.equal(acceptReviewJson.order.status, "paid");
  assert.equal(acceptReviewJson.order.priceRub, 790.5);
});
