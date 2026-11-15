import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import dns from "node:dns/promises";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/integration-crypto";
import { clientEmailHistory, clientEmailPreview, sendClientEmail } from "./client-email.server";
import { TRUSTED_SMTP_HOSTS_SETTING } from "./smtp-host-policy";

type Row = NonNullable<Awaited<ReturnType<typeof db.clientEmail.findFirst>>>;
const original = {
  unique: db.clientEmail.findUnique, first: db.clientEmail.findFirst, many: db.clientEmail.findMany,
  create: db.clientEmail.create, update: db.clientEmail.update,
  sender: db.platformMailSender.findUnique, senderUpdate: db.platformMailSender.update, user: db.user.findUnique,
  setting: db.platformSetting.findUnique, sharedUser: db.user.findFirst,
};
const oldSecret = process.env.INTEGRATION_KEY_SECRET;
const createRealTransport = nodemailer.createTransport;
let rows: Row[];
let smtpCalls: number;
let smtpError: Error | null;
let verified: boolean;
let rejectRecipient: boolean;
let smtpMessage: Record<string, unknown>;
let smtpOptions: Record<string, unknown>;
const input = { to: "client@example.com", subject: "Проверка", message: "Текст письма", requestId: "c0d0ad5b-6bbb-4fb6-9b09-9523f4ece3d8" };

beforeEach(() => {
  process.env.INTEGRATION_KEY_SECRET = "client-email-test-only-secret";
  rows = []; smtpCalls = 0; smtpError = null; verified = true; rejectRecipient = false;
  db.clientEmail.findUnique = (async (args) => rows.find((row) => row.organizationId === args.where.organizationId_requestId?.organizationId && row.requestId === args.where.organizationId_requestId?.requestId) ?? null) as typeof original.unique;
  db.clientEmail.findFirst = (async (args) => rows.find((row) => row.id === args?.where?.id && row.organizationId === args?.where?.organizationId) ?? null) as typeof original.first;
  db.clientEmail.create = (async (args) => {
    if (rows.some((row) => row.organizationId === args.data.organizationId && row.requestId === args.data.requestId)) throw Object.assign(new Error("unique"), { code: "P2002" });
    const row = { ...args.data, id: `mail-${rows.length}`, createdAt: new Date(), sentAt: null, error: null, messageId: null, status: "sending" } as Row;
    rows.push(row); return row;
  }) as typeof original.create;
  db.clientEmail.update = (async (args) => {
    const row = rows.find((item) => item.id === args.where.id && item.organizationId === args.where.organizationId);
    assert.ok(row); Object.assign(row, args.data); return row;
  }) as typeof original.update;
  db.clientEmail.findMany = (async (args) => {
    const scoped = rows.filter((row) => row.organizationId === args?.where?.organizationId).slice().reverse();
    const start = args?.cursor ? scoped.findIndex((row) => row.id === args.cursor?.id) + 1 : 0;
    return scoped.slice(start, start + Number(args?.take ?? 21));
  }) as typeof original.many;
  db.platformMailSender.findUnique = (async (args) => ({
    id: "smtp", userId: args.where.userId, host: "smtp.example.com", port: 465, secure: true, username: "staff@example.com",
    passwordEnc: encryptSecret("secret-smtp-password"), fromName: "Сотрудник", fromEmail: "staff@example.com", replyTo: "reply@example.com",
    signature: "Личная подпись", position: "Менеджер", phone: "+79990000000", enabled: true,
    verifiedAt: verified ? new Date() : null, lastError: null, createdAt: new Date(), updatedAt: new Date(),
  })) as typeof original.sender;
  db.platformMailSender.update = (async () => ({})) as unknown as typeof original.senderUpdate;
  db.user.findUnique = (async () => ({ name: "Сотрудник", email: "staff@example.com", contactEmail: null })) as unknown as typeof original.user;
  db.platformSetting.findUnique = (async () => ({ value: '{"staff-id":["admin-id"]}' })) as unknown as typeof original.setting;
  db.user.findFirst = (async args => args?.where?.id === "admin-id" ? { id: "admin-id" } : null) as typeof original.sharedUser;
  mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  mock.method(nodemailer, "createTransport", (options: Record<string, unknown>) => { smtpOptions = options; return { sendMail: async (message: Record<string, unknown>) => {
    assert.equal(rows.length > 0, true, "persist before SMTP");
    assert.equal(rows.at(-1)?.status, "sending");
    smtpCalls++; smtpMessage = message;
    if (smtpError) throw smtpError;
    return { messageId: "<smtp-test@example.com>", rejected: rejectRecipient ? [input.to] : [], accepted: rejectRecipient ? [] : [input.to] };
  } }; });
});

afterEach(() => {
  mock.restoreAll();
  db.clientEmail.findUnique = original.unique; db.clientEmail.findFirst = original.first;
  db.clientEmail.findMany = original.many; db.clientEmail.create = original.create; db.clientEmail.update = original.update;
  db.platformMailSender.findUnique = original.sender; db.platformMailSender.update = original.senderUpdate; db.user.findUnique = original.user;
  db.platformSetting.findUnique = original.setting; db.user.findFirst = original.sharedUser;
  if (oldSecret === undefined) delete process.env.INTEGRATION_KEY_SECRET; else process.env.INTEGRATION_KEY_SECRET = oldSecret;
});

test("personal SMTP sends the exact branded preview, snapshots identity/content and records SMTP acceptance", async () => {
  const preview = await clientEmailPreview("staff-id", input);
  assert.ok(preview); assert.match(preview.html, /logo-email.png/); assert.match(preview.html, /Личная подпись/);
  const result = await sendClientEmail("org-a", "staff-id", input);
  assert.ok(result); assert.equal(result.item.status, "sent"); assert.equal(smtpCalls, 1);
  assert.equal(smtpMessage.html, preview.html); assert.equal(smtpMessage.text, preview.text);
  assert.equal(smtpMessage.replyTo, "reply@example.com");
  assert.equal(rows[0].senderUserId, "staff-id"); assert.equal(rows[0].fromEmail, "staff@example.com");
  assert.equal(rows[0].messageId, "<smtp-test@example.com>"); assert.ok(rows[0].sentAt);
});

test("external mail carries real binary MIME attachments, stores metadata only and replays without a second SMTP send", async () => {
  const bytes = Buffer.from([0, 255, 13, 10, 128, 65]);
  const files = [{ filename: "счёт.pdf", content: bytes, size: bytes.length, contentType: "application/pdf", sha256: "test-content-digest" }];
  const result = await sendClientEmail("platform", "staff-id", input, files);
  assert.equal(result?.item.status, "sent");
  assert.deepEqual(result?.item.attachments, [{ filename: "счёт.pdf", size: bytes.length, contentType: "application/pdf" }]);
  assert.doesNotMatch(JSON.stringify(rows[0].attachmentsJson), /"(?:content|path|sha256)":/);
  const attachments = smtpMessage.attachments as Array<{ content: Buffer; filename: string; path?: string }>;
  assert.deepEqual(attachments[0].content, bytes); assert.equal(attachments[0].path, undefined);
  const stream = createRealTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const mime = await stream.sendMail({ ...smtpMessage, to: "not-registered@outside.example" });
  const parsed = await simpleParser(mime.message);
  assert.deepEqual(parsed.attachments[0].content, bytes); assert.equal(parsed.attachments[0].filename, "счёт.pdf");
  assert.equal(parsed.attachments[0].contentType, "application/pdf");
  await sendClientEmail("platform", "staff-id", input, files); assert.equal(smtpCalls, 1);
});

test("granted shared mailbox controls preview, signature, SMTP and snapshots while actor remains accountable", async () => {
  const ownSender = db.platformMailSender.findUnique;
  db.platformMailSender.findUnique = (async args => {
    const row = await ownSender(args);
    return { ...row, userId: args.where.userId, fromName: "Admin", fromEmail: "admin@wesetup.ru", host: "wesetup.ru", port: 587, secure: false, username: "admin@wesetup.ru", signature: "Admin signature" };
  }) as typeof original.sender;
  const shared = { ...input, mailboxUserId: "admin-id" };
  const preview = await clientEmailPreview("staff-id", shared);
  assert.ok(preview); assert.match(preview.text, /Admin signature/);
  assert.equal(preview.mailboxUserId, "admin-id");
  const result = await sendClientEmail("org-a", "staff-id", shared);
  assert.equal(result?.item.status, "sent");
  assert.equal(rows[0].senderUserId, "staff-id"); assert.equal(rows[0].fromEmail, "admin@wesetup.ru");
  assert.equal(smtpMessage.from, '"Admin" <admin@wesetup.ru>');
  assert.equal(smtpMessage.html, preview.html);
  assert.deepEqual(smtpOptions.auth, { user: "admin@wesetup.ru", pass: "secret-smtp-password" });
  assert.equal(smtpOptions.requireTLS, true); assert.deepEqual(smtpOptions.tls, { servername: "wesetup.ru" });
  await sendClientEmail("org-a", "staff-id", shared); assert.equal(smtpCalls, 1);
});

test("ungranted mailbox never reaches preview, persistence or SMTP", async () => {
  const forged = { ...input, mailboxUserId: "other-id" };
  assert.equal(await clientEmailPreview("staff-id", forged), null);
  assert.equal(await sendClientEmail("org-a", "staff-id", forged), null);
  assert.equal(rows.length, 0); assert.equal(smtpCalls, 0);
});

test("concurrent duplicate requests claim a unique key before SMTP and never send twice", async () => {
  const results = await Promise.all([sendClientEmail("org-a", "staff-id", input), sendClientEmail("org-a", "staff-id", input)]);
  assert.equal(rows.length, 1); assert.equal(smtpCalls, 1);
  assert.equal(results.filter((result) => result?.repeated).length, 1);
  const repeated = await sendClientEmail("org-a", "staff-id", input);
  assert.equal(repeated?.repeated, true); assert.equal(smtpCalls, 1);
});

test("SMTP failure is persisted, hides transport secrets, never falls back or automatically retries", async () => {
  smtpError = new Error("Authentication failed secret-smtp-password");
  const result = await sendClientEmail("org-a", "staff-id", input);
  assert.equal(result?.item.status, "failed"); assert.equal(smtpCalls, 1);
  assert.equal(rows[0].sentAt, null); assert.doesNotMatch(result?.item.error ?? "", /secret-smtp-password/);
  await sendClientEmail("org-a", "staff-id", input); assert.equal(smtpCalls, 1);
});

test("rejected recipient cannot appear as sent", async () => {
  rejectRecipient = true;
  assert.equal((await sendClientEmail("org-a", "staff-id", input))?.item.status, "failed");
});

test("unverified personal SMTP blocks preview and send without a history entry or transport", async () => {
  verified = false;
  assert.equal(await clientEmailPreview("staff-id", input), null);
  assert.equal(await sendClientEmail("org-a", "staff-id", input), null);
  assert.equal(rows.length, 0); assert.equal(smtpCalls, 0);
});

test("history and idempotency are tenant-scoped and cursor pagination does not leak another client", async () => {
  await sendClientEmail("org-a", "staff-id", input);
  await sendClientEmail("org-b", "staff-id", input);
  assert.equal(smtpCalls, 2);
  assert.deepEqual(await clientEmailHistory("org-a", rows[1].id), { items: [], nextCursor: null });
  assert.equal((await clientEmailHistory("org-a")).items.length, 1);
  for (let index = 0; index < 22; index++) rows.push({ ...rows[0], id: `history-${index}`, requestId: `history-${index}` });
  const first = await clientEmailHistory("org-a");
  assert.equal(first.items.length, 20); assert.ok(first.nextCursor);
  const next = await clientEmailHistory("org-a", first.nextCursor);
  assert.equal(next.items.length, 3); assert.equal(next.nextCursor, null);
  assert.ok(!next.items.some((item) => first.items.some((old) => old.id === item.id)));
});

test("persistence failure before SMTP prevents sending", async () => {
  db.clientEmail.create = (async () => { throw new Error("database unavailable"); }) as unknown as typeof original.create;
  await assert.rejects(() => sendClientEmail("org-a", "staff-id", input), /database unavailable/);
  assert.equal(smtpCalls, 0);
});

test("failure to save the SMTP result leaves a pending record and a repeated request cannot resend", async () => {
  db.clientEmail.update = (async () => { throw new Error("database unavailable"); }) as unknown as typeof original.update;
  await assert.rejects(() => sendClientEmail("org-a", "staff-id", input), /database unavailable/);
  assert.equal(smtpCalls, 1); assert.equal(rows[0].status, "sending");
  const repeated = await sendClientEmail("org-a", "staff-id", input);
  assert.equal(repeated?.repeated, true); assert.equal(repeated?.item.status, "sending"); assert.equal(smtpCalls, 1);
});

function ownedSmtp(options: { host?: string; addresses?: readonly string[]; policy?: string | null; port?: number; secure?: boolean } = {}) {
  const findSender = db.platformMailSender.findUnique;
  db.platformMailSender.findUnique = (async args => ({ ...await findSender(args), host: options.host ?? "wesetup.ru", port: options.port ?? 587, secure: options.secure ?? false })) as typeof original.sender;
  const setting = db.platformSetting.findUnique;
  db.platformSetting.findUnique = (async args => args.where.key === TRUSTED_SMTP_HOSTS_SETTING
    ? options.policy === null ? null : { value: options.policy ?? '{"wesetup.ru":["192.168.33.3"]}' }
    : setting(args)) as typeof original.setting;
  let lookups = 0;
  mock.method(dns, "lookup", async () => { lookups++; return (options.addresses ?? ["192.168.33.3"]).map(address => ({ address, family: 4 })); });
  return () => lookups;
}

test("owned LAN SMTP pins one DNS lookup/IP while preserving required STARTTLS, CA/hostname and actor identity", async () => {
  const lookups = ownedSmtp();
  const result = await sendClientEmail("org-a", "staff-id", input);
  assert.equal(result?.item.status, "sent"); assert.equal(lookups(), 1);
  assert.equal(smtpOptions.host, "192.168.33.3"); assert.equal(smtpOptions.port, 587);
  assert.equal(smtpOptions.secure, false); assert.equal(smtpOptions.requireTLS, true);
  assert.deepEqual(smtpOptions.tls, { servername: "wesetup.ru" });
  assert.equal(smtpMessage.from, '"Сотрудник" <staff@example.com>'); assert.equal(rows[0].senderUserId, "staff-id");
});

for (const [name, config] of [
  ["no operator policy", { policy: null }], ["malformed policy", { policy: "{" }],
  ["unlisted private DNS", { addresses: ["192.168.33.4"] }],
  ["DNS rebinding includes an unlisted answer", { addresses: ["192.168.33.3", "127.0.0.1"] }],
  ["loopback even if listed", { addresses: ["127.0.0.1"], policy: '{"wesetup.ru":["127.0.0.1"]}' }],
  ["metadata IP even if listed", { addresses: ["169.254.169.254"], policy: '{"wesetup.ru":["169.254.169.254"]}' }],
  ["another hostname", { host: "other.example.com" }], ["plaintext-capable port", { port: 25 }],
] as const) test(`private SMTP fails before transport: ${name}`, async () => {
  ownedSmtp(config);
  const result = await sendClientEmail("org-a", "staff-id", input);
  assert.equal(result?.item.status, "failed"); assert.equal(smtpCalls, 0);
});

test("trusted LAN policy never bypasses TLS certificate validation or falls back to system mail", async () => {
  ownedSmtp(); smtpError = Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" });
  let senderError: unknown;
  db.platformMailSender.update = (async (args: Parameters<typeof original.senderUpdate>[0]) => { senderError = args.data.lastError; return {}; }) as unknown as typeof original.senderUpdate;
  const result = await sendClientEmail("org-a", "staff-id", input);
  assert.equal(result?.item.status, "failed"); assert.match(String(senderError), /TLS-сертификата истёк/);
  assert.equal(smtpCalls, 1); assert.deepEqual(smtpOptions.tls, { servername: "wesetup.ru" });
});

test("operator revocation is re-read on each new delivery", async () => {
  ownedSmtp();
  assert.equal((await sendClientEmail("org-a", "staff-id", input))?.item.status, "sent");
  db.platformSetting.findUnique = (async () => null) as typeof original.setting;
  assert.equal((await sendClientEmail("org-a", "staff-id", { ...input, requestId: "c1d0ad5b-6bbb-4fb6-9b09-9523f4ece3d8" }))?.item.status, "failed");
  assert.equal(smtpCalls, 1);
});

test("public SMTP preserves existing behavior without reading an operator exception", async () => {
  db.platformSetting.findUnique = (async args => { assert.notEqual(args.where.key, TRUSTED_SMTP_HOSTS_SETTING); return null; }) as typeof original.setting;
  assert.equal((await sendClientEmail("org-a", "staff-id", input))?.item.status, "sent");
  assert.equal(smtpOptions.host, "8.8.8.8"); assert.equal(smtpOptions.secure, true);
  assert.deepEqual(smtpOptions.tls, { servername: "smtp.example.com" });
});
