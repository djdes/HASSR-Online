import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { notificationPresenter } from "@/i18n/notification-messages";
import type { upsertNotification } from "@/lib/notifications";

const require = createRequire(import.meta.url);
type Notice = Parameters<typeof upsertNotification>[0];

/** Execute production code with external I/O replaced at the module boundary. */
function fixture<T>(file: string, mocks: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const fixtureModule = { exports: {} };
  vm.runInNewContext(output, {
    module: fixtureModule, exports: fixtureModule.exports, console, process, Date, Response, Request, URL,
    require: (id: string) => Object.hasOwn(mocks, id) ? mocks[id] : require(id),
  });
  return fixtureModule.exports as T;
}

test("actual five producers attach descriptors while retaining recipient, dedupe, links and authored content", async () => {
  const notices: Notice[] = [];
  const capture = { upsertNotification: async (notice: Notice) => { notices.push(notice); } };
  const forbidden = () => { throw new Error("Unexpected external transport"); };
  const feedback = fixture<typeof import("./feedback-reply")>("src/lib/feedback-reply.ts", {
    "@/lib/db": { db: {} }, "@/lib/notifications": capture,
    "@/lib/telegram": { sendTelegramMessage: forbidden }, "@/lib/email": { sendFeedbackReplyEmail: forbidden },
  });
  await feedback.applyFeedbackReply({ reportId: "report", message: "Original support reply", respondedById: "root", respondedByName: "Original author" }, {
    findReport: async () => ({ id: "report", userId: "employee", userEmail: null, organizationId: "org", telegramChatId: null, message: "Original question" }),
    saveReply: async () => {}, findRecipient: async () => ({ id: "employee", telegramChatId: null }),
  });
  assert.equal(notices[0].messageKey, "feedbackReply");
  assert.equal(notices[0].items[0].label, "Original support reply");
  assert.equal(notices[0].dedupeKey, "feedback.reply:report");

  const pin = fixture<typeof import("./qr-pin-requests")>("src/lib/qr-pin-requests.ts", {
    "@/lib/db": { db: {
      user: { findFirst: async () => ({ id: "employee", name: "O‘tkir Иван" }), findMany: async () => [{ id: "manager" }] },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ qrPinRequest: { updateMany: async () => {}, create: async () => ({ id: "request" }) } }),
    } },
    "bcryptjs": { hash: async () => "mock-hash" },
    "@/lib/integration-crypto": { isIntegrationCryptoConfigured: () => false },
    "@/lib/notifications": capture, "@/lib/telegram": { notifyEmployee: async () => true },
    "@/lib/qr-fill-actor": { setEmployeeQrPinHash: forbidden },
  });
  await pin.createQrPinRequest({ organizationId: "org", userId: "employee", kind: "issue", pin: "4932", repeat: "4932", source: "journal-fill" });
  assert.equal(notices[1].userId, "manager");
  assert.equal(notices[1].dedupeKey, "qr-pin-requests:org");
  assert.equal(notices[1].items[0].labelKey, "pinRequestItem");
  assert.equal(notices[1].items[0].labelParams?.name, "O‘tkir Иван");

  const hygiene = fixture<typeof import("./hygiene-declaration-notify")>("src/lib/hygiene-declaration-notify.ts", {
    "@/lib/notifications": capture,
    "@/lib/core-journal-keepers": { listCoreJournalRecipients: async () => [{ id: "keeper" }], notifyCoreJournalRecipients: async () => {} },
  });
  for (const admitted of [true, false]) await hygiene.notifyHygieneDeclaration({ organizationId: "org", hygieneDocumentId: "doc", employee: { id: "employee", name: "O‘tkir Иван" }, todayKey: "2026-10-15", at: "12:45", decision: { admitted, complaints: admitted ? [] : ["Original complaint"] }, via: "QR" });
  assert.equal(notices[2].items[0].labelKey, "hygieneSigned");
  assert.equal(notices[3].items[0].labelKey, "hygieneComplaints");
  assert.equal(notices[3].items[0].labelParams?.complaints, "Original complaint");
  assert.equal(notices[3].userId, "keeper");
  assert.equal(notices[3].linkHref, "/journals/hygiene/documents/doc");

  const ideas = fixture<typeof import("../app/api/root/ideas/[id]/route")>("src/app/api/root/ideas/[id]/route.ts", {
    "@/lib/auth-helpers": { requireRoot: async () => ({ user: { id: "root" } }) },
    "@/lib/db": { db: { idea: { findUnique: async () => ({ id: "idea", title: "Original idea", status: "new", organizationId: "org", authorId: "employee" }), update: async () => ({ id: "idea", status: "done", statusChangedAt: null }) } } },
    "@/lib/notifications": capture, "@/lib/audit-log": { recordAuditLog: async () => {} }, "@/lib/webhooks/dispatch": { emitWebhook() {} },
  });
  assert.equal((await ideas.PATCH(new Request("https://local.test/api/root/ideas/idea", { method: "PATCH", body: JSON.stringify({ status: "done" }) }), { params: Promise.resolve({ id: "idea" }) })).status, 200);
  assert.equal(notices[4].messageParams?.status, "done");
  assert.equal(notices[4].items[0].label, "Original idea");
  assert.equal(notices[4].userId, "employee");

  const mailing = fixture<typeof import("./mailing/channels.server")>("src/lib/mailing/channels.server.ts", {
    "@/lib/db": { db: {} }, "@/lib/notifications": capture,
    "@/lib/mobile-push": {}, "@/lib/web-push": {}, "./transport.server": {},
  });
  await mailing.createChannelSenders().inApp({ organizationId: "org", userId: "employee", campaignId: "campaign", recipientId: "recipient", title: "Original campaign", body: "Original message", url: "/ideas", isTest: false });
  assert.equal(notices[5].messageKey, undefined);
  assert.equal(notices[5].linkLabelKey, "open");
  assert.equal(notices[5].push, false);
  assert.equal(notices[5].items[0].label, "Original message");
  for (const notice of notices) assert.equal(notice.organizationId, "org");
  for (const locale of ["ru", "en", "uz"] as const) {
    const presenter = await notificationPresenter(locale);
    for (const notice of notices) {
      const presented = presenter.row(notice);
      assert.equal(presented.userId, notice.userId);
      assert.equal(presented.linkHref, notice.linkHref);
      assert.equal(presented.dedupeKey, notice.dedupeKey);
      assert.ok(presenter.pushBody(presented.items));
      if (locale !== "ru" && notice.messageKey) assert.notEqual(presented.title, notice.title);
    }
  }
});

test("actual notification dispatcher isolates recipient locales and shares bell presentation with both push transports", async () => {
  const pushes: { userId: string; payload: { title: string; body: string } }[] = [];
  const writes: unknown[] = [];
  const signals = new Map(["ru", "en", "uz"].map(locale => [locale, Promise.withResolvers<void>()]));
  const source = fixture<typeof import("./notifications")>("src/lib/notifications.ts", {
    "@/lib/db": { db: { user: { findUnique: async ({ where }: { where: { id: string } }) => ({ locale: where.id, organization: { locale: "ru" } }) }, notification: { findUnique: async () => null, upsert: async (args: unknown) => { writes.push(args); } } } },
    "@/lib/live-events": { publishToUser() {} },
    "@/lib/mobile-push": { sendMobilePushInBackground: (userId: string, payload: { title: string; body: string }) => { pushes.push({ userId, payload }); } },
    "@/lib/web-push": { sendPushToUser: async (userId: string, payload: { title: string; body: string }) => { pushes.push({ userId, payload }); signals.get(userId)!.resolve(); } },
  });
  const input = { organizationId: "org", kind: "hygiene-admission", dedupeKey: "same-key", title: "Fallback", messageKey: "hygieneAdmission" as const, items: [{ id: "employee", label: "Fallback", labelKey: "hygieneSigned" as const, labelParams: { name: "O‘tkir Иван" } }] };
  await Promise.all(["ru", "en", "uz"].map(userId => source.upsertNotification({ ...input, userId })));
  await Promise.all([...signals.values()].map(signal => signal.promise));
  assert.equal(writes.length, 3);
  assert.equal(pushes.length, 6);
  assert.equal(new Set(pushes.map(push => push.payload.title)).size, 3);
  for (const locale of ["ru", "en", "uz"] as const) {
    const presenter = await notificationPresenter(locale);
    const bell = presenter.row(input);
    for (const push of pushes.filter(push => push.userId === locale)) {
      assert.equal(push.payload.title, bell.title);
      assert.equal(push.payload.body, bell.items[0].label);
    }
  }
});
