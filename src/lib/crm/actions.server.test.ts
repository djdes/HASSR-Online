import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import type { ContactMessageInput } from "./forms";
import type { CrmActor, MessageResult } from "./actions.server";

function fixture({ allowed = true, ready = true, smtpOk = true } = {}) {
  const smtp: Record<string, unknown>[] = [], items: Record<string, unknown>[] = [];
  const mailbox = { enabled: true, verifiedAt: ready ? "verified" : null, fromEmail: "admin@wesetup.ru", fromName: "Admin", signature: "Admin signature" };
  const modules: Record<string, unknown> = {
    "@/lib/db": { db: { crmContact: { findUnique: async () => ({ id: "client", email: "client@example.com" }) } } },
    "@/lib/email-sender-access.server": { resolveEmailSender: async () => allowed ? "admin" : null },
    "@/lib/platform-mail": { formatFromAddress: () => '"Admin" <admin@wesetup.ru>' },
    "@/lib/platform-mail.server": { readMailSender: async () => mailbox, sendStaffEmail: async (message: Record<string, unknown>) => {
      smtp.push(message); return smtpOk ? { ok: true, via: "personal" } : { ok: false, error: "SMTP unavailable" };
    } },
    "@/lib/html-escape": { escapeHtml: (text: string) => text },
    "@/lib/crm/constants": {}, "@/lib/crm/identity": {}, "@/lib/client-documents.server": {}, "@/lib/telegram": {},
    "@/lib/crm/ingest.server": { ingestCrmItems: async (rows: Record<string, unknown>[]) => { items.push(...rows); } },
  };
  const source = ts.transpileModule(readFileSync(resolve("src/lib/crm/actions.server.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: { addContactMessage?: (id: string, input: ContactMessageInput, actor: CrmActor) => Promise<MessageResult> } = {};
  const nativeRequire = createRequire(resolve("package.json"));
  runInNewContext(source, { exports, require: (name: string) => Object.hasOwn(modules, name) ? modules[name] : nativeRequire(name), console });
  assert.ok(exports.addContactMessage);
  return { send: exports.addContactMessage, smtp, items };
}
const actor = { id: "alexey", name: "Alexey", organizationId: "platform" };
const message: ContactMessageInput = { kind: "email", subject: "Test", body: "Hello", mailboxUserId: "admin" };

test("CRM uses selected mailbox and signature, keeps acting employee and sender in history", async () => {
  const f = fixture();
  assert.equal((await f.send("client", message, actor)).ok, true);
  assert.equal(f.smtp[0].senderUserId, "admin"); assert.equal(f.smtp[0].personalOnly, true);
  assert.equal(f.smtp[0].expectedFrom, '"Admin" <admin@wesetup.ru>'); assert.match(String(f.smtp[0].text), /Admin signature/);
  assert.equal(f.items[0].authorUserId, "alexey"); assert.equal(f.items[0].fromAddress, "admin@wesetup.ru");
});
test("CRM rejects forbidden/unverified mailbox before SMTP; failure never records successful correspondence", async () => {
  for (const settings of [{ allowed: false }, { ready: false }]) {
    const f = fixture(settings); assert.equal((await f.send("client", message, actor)).ok, false);
    assert.equal(f.smtp.length, 0); assert.equal(f.items.length, 0);
  }
  const f = fixture({ smtpOk: false }); assert.equal((await f.send("client", message, actor)).ok, false);
  assert.equal(f.smtp.length, 1); assert.equal(f.items.length, 0);
});
