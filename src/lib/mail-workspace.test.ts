import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { mailWorkspaceSchema } from "./mail-workspace";
import { clientDocumentRecipients } from "./client-documents";
import type { Session } from "next-auth";
import type * as Service from "./mail-workspace.server";
import { MailAttachmentError, readMailRequest } from "./mail-attachments.server";

const require = createRequire(import.meta.url);
const session = { user: { id: "manager" } } as Session;
const input = { subject: "Subject", message: "Body", mailboxUserId: "shared", requestId: "a5925eb7-7db2-4bea-8474-4c1ee539e2e5", recipients: [{ organizationId: "org-a", email: "a@example.com" }, { organizationId: "org-b", email: "b@example.com" }] };

function fixture() {
  let allowed = true, own = true, verified = true, superadmin = false;
  const queries: Record<string, unknown>[] = [], sends: Array<Record<string, unknown>> = [];
  const rows = ["a", "b"].map(key => ({ id: `org-${key}`, name: `Company ${key}`, accountManagerId: "manager", accountantEmail: `${key}@example.com`, legalProfileJson: null, account: null, users: [
    { id: "person", name: "Person", email: "placeholder@fake.staff.local", contactEmail: "PERSON@example.com" },
  ] }));
  const source = ts.transpileModule(readFileSync("src/lib/mail-workspace.server.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mocks: Record<string, unknown> = {
    "@/lib/db": { db: {
      organization: { findMany: async (query: { where: { AND: Array<{ id?: { in?: string[] }; accountManagerId?: string }> } }) => {
        queries.push(query);
        const ids = query.where.AND.find(item => item.id?.in)?.id?.in;
        const manager = query.where.AND.find(item => item.accountManagerId)?.accountManagerId;
        return rows.filter(row => (!ids || ids.includes(row.id)) && (!manager || row.accountManagerId === manager));
      } },
      clientEmail: {
        findFirst: async (query: Record<string, unknown>) => { queries.push(query); return null; },
        findMany: async (query: Record<string, unknown>) => { queries.push(query); return []; },
      },
    } },
    "@/lib/platform-access.server": { platformViewerForSession: async () => ({ superadmin, scope: own ? "own" : "all" }) },
    "@/lib/platform-access": { canAccessPlatformPath: () => allowed },
    "@/lib/client-documents": { clientDocumentRecipients },
    "@/lib/org-legal-profile": { readLegalProfile: () => null },
    "@/lib/client-email.server": {
      clientEmailPreview: async () => verified ? { html: "brand" } : null,
      clientEmailView: (row: unknown) => row,
      sendClientEmail: async (org: string, actor: string, mail: Record<string, unknown>, attachments: unknown[]) => {
        sends.push({ org, actor, ...mail, attachments });
        return { item: { id: org, to: mail.to, status: org === "org-a" ? "sent" : "failed", error: org === "org-a" ? null : "SMTP rejected" } };
      },
    },
  };
  const mod = { exports: {} };
  vm.runInNewContext(source, { module: mod, exports: mod.exports, process, require: (id: string) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith("@/")) throw new Error(`Unmocked side effect: ${id}`);
    return require(id);
  } });
  return { service: mod.exports as typeof Service, queries, sends, rows, deny: () => { allowed = false; }, all: () => { own = false; }, root: () => { superadmin = true; }, unverify: () => { verified = false; } };
}

test("batch input normalizes addresses, rejects duplicates, malformed content and excessive recipients", () => {
  assert.equal(mailWorkspaceSchema.parse({ ...input, recipients: [{ organizationId: "a", email: "PERSON@Example.com" }] }).recipients[0].email, "person@example.com");
  for (const data of [
    { ...input, recipients: [] }, { ...input, recipients: Array.from({ length: 11 }, (_, n) => ({ organizationId: "a", email: `p${n}@example.com` })) },
    { ...input, recipients: [input.recipients[0], { organizationId: "org-b", email: "A@example.com" }] },
    { ...input, recipients: [{ organizationId: "a", email: "placeholder@org.staff.local" }] }, { ...input, subject: "Injected\r\nBcc: another" },
  ]) assert.equal(mailWorkspaceSchema.safeParse(data).success, false);
});

test("directory filters current delegated scope, searches active contacts and exposes no credential or user internals", async () => {
  const f = fixture();
  const directory = await f.service.mailRecipientDirectory(session, "Company a");
  assert.equal(directory.items.length, 2);
  assert.equal(directory.items.some(item => item.email.includes("staff.local")), false);
  assert.deepEqual(Object.keys(directory.items[0]).sort(), ["email", "label", "organizationId", "organizationName"]);
  const query = JSON.stringify(f.queries[0]);
  assert.match(query, /"accountManagerId":"manager"/); assert.match(query, /"isActive":true/); assert.match(query, /"archivedAt":null/);
  assert.match(query, /"not":"platform"/);
  f.deny(); const before = f.queries.length;
  await assert.rejects(f.service.mailRecipientDirectory(session), /Нет доступа/); assert.equal(f.queries.length, before);
});

test("all recipients are validated before SMTP; forged, stale and other manager contacts fail closed", async () => {
  for (const kind of ["forged", "stale", "foreign", "unverified"]) {
    const f = fixture();
    const data = structuredClone(input);
    if (kind === "forged") data.recipients[1].email = "stranger@example.com";
    if (kind === "stale") f.rows.splice(1, 1);
    if (kind === "foreign") f.rows[1].accountManagerId = "someone-else";
    if (kind === "unverified") f.unverify();
    await assert.rejects(f.service.sendWorkspaceMail(session, data)); assert.equal(f.sends.length, 0, kind);
  }
});

test("individual copies keep actor and selected mailbox, partial failures and stable recipient retry keys", async () => {
  const f = fixture();
  const result = await f.service.sendWorkspaceMail(session, input);
  assert.equal(result.interrupted, false); assert.deepEqual(Array.from(result.items, item => item.status), ["sent", "failed"]);
  assert.equal(f.sends.length, 2);
  for (const send of f.sends) { assert.equal(send.actor, "manager"); assert.equal(send.mailboxUserId, "shared"); assert.equal(Array.isArray(send.to), false); }
  assert.notEqual(f.sends[0].requestId, f.sends[1].requestId);
  await f.service.sendWorkspaceMail(session, { ...input, recipients: [...input.recipients].reverse() });
  assert.equal(f.sends[0].requestId, f.sends[3].requestId); assert.equal(f.sends[1].requestId, f.sends[2].requestId);
  const recipient = { ...input.recipients[0], organizationName: "a", label: "a" };
  const id = f.service.mailRecipientRequestId("manager", input, recipient);
  assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(f.service.mailRecipientRequestId("another", input, recipient), id);
  assert.notEqual(f.service.mailRecipientRequestId("manager", { ...input, message: "Changed" }, recipient), id);
});

test("history and foreign cursors are constrained to accessible organizations", async () => {
  const f = fixture();
  const empty = await f.service.workspaceMailHistory(session, "foreign");
  assert.equal(empty.items.length, 0); assert.equal(f.queries.length, 1);
  assert.match(JSON.stringify(f.queries[0]), /"accountManagerId":"manager"/);
  await f.service.workspaceMailHistory(session);
  assert.match(JSON.stringify(f.queries[1]), /"organization":\{"id":\{"not":"platform"\},"accountManagerId":"manager"\}/);
  f.all(); await f.service.workspaceMailHistory(session);
  assert.doesNotMatch(JSON.stringify(f.queries[2]), /accountManagerId/);
});

test("unregistered recipients need no customer record; external history is actor-scoped even with all-customer access", async () => {
  const f = fixture();
  const external = mailWorkspaceSchema.parse({ ...input, recipients: [{ email: "NEW@outside.example" }] });
  const result = await f.service.sendWorkspaceMail(session, external);
  assert.equal(f.sends.length, 1); assert.equal(f.sends[0].org, "platform");
  assert.equal(f.sends[0].to, "new@outside.example"); assert.equal(f.sends[0].actor, "manager");
  assert.equal(result.items[0].organizationId, null); assert.equal(result.items[0].organizationName, null);
  await f.service.workspaceMailHistory(session);
  assert.match(JSON.stringify(f.queries.at(-1)), /"organizationId":"platform","senderUserId":"manager"/);
  f.all(); await f.service.workspaceMailHistory(session);
  assert.match(JSON.stringify(f.queries.at(-1)), /"organizationId":"platform","senderUserId":"manager"/);
  f.root(); await f.service.workspaceMailHistory(session);
  assert.doesNotMatch(JSON.stringify(f.queries.at(-1)), /senderUserId/);
  await assert.rejects(f.service.sendWorkspaceMail(session, { ...input, recipients: [{ organizationId: "platform", email: "new@outside.example" }] }));
  f.deny(); await assert.rejects(f.service.sendWorkspaceMail(session, external), /Нет доступа/);
});

test("files reach every recipient and retry identity binds file bytes while retaining old no-file keys", async () => {
  const f = fixture();
  const attachment = { filename: "invoice.pdf", size: 2, contentType: "application/pdf", content: Buffer.from([1, 2]), sha256: "first-content" };
  await f.service.sendWorkspaceMail(session, input, [attachment]);
  for (const send of f.sends) assert.equal((send.attachments as unknown[])[0], attachment);
  const recipient = { ...input.recipients[0], organizationName: "a", label: "a" };
  const legacy = f.service.mailRecipientRequestId("manager", input, recipient);
  assert.equal(f.service.mailRecipientRequestId("manager", input, recipient, []), legacy);
  const withFile = f.service.mailRecipientRequestId("manager", input, recipient, [attachment]);
  assert.notEqual(withFile, legacy);
  assert.notEqual(f.service.mailRecipientRequestId("manager", input, recipient, [{ ...attachment, sha256: "changed-content" }]), withFile);
  assert.notEqual(f.service.mailRecipientRequestId("manager", input, recipient, [{ ...attachment, filename: "renamed.pdf" }]), withFile);
});

test("actual workspace routes guard every entry, reject invalid input and use the session actor", async () => {
  let denied = false, checks = 0;
  let transported: Buffer | null = null;
  const load = (suffix: string) => {
    const file = `src/app/api/root/correspondence/${suffix}route.ts`;
    const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const mod = { exports: {} };
    const guarded = async (actor: Session, _input: unknown, attachments?: { content: Buffer }[]) => { assert.equal(actor.user.id, session.user.id); checks++; transported = attachments?.[0]?.content ?? null; return { items: [], nextCursor: null }; };
    class MailWorkspaceError extends Error { status = 403; }
    const mocks: Record<string, unknown> = {
      "@/lib/auth-helpers": { requireRoot: async () => { if (denied) throw new Error("DENIED"); return session; } },
      "@/lib/mail-workspace.server": { MailWorkspaceError, workspaceMailHistory: guarded, mailRecipientDirectory: guarded, validateMailRecipients: guarded, sendWorkspaceMail: guarded },
      "@/lib/client-email.server": { clientEmailPreview: async (id: string) => { assert.equal(id, session.user.id); return { html: "<p>preview</p>" }; } },
      "@/lib/audit-log": { recordAuditLog: async () => {} },
      "@/lib/mail-attachments.server": { readMailRequest, MailAttachmentError },
    };
    vm.runInNewContext(source, { module: mod, exports: mod.exports, URL, Request, Response, require: (id: string) => Object.hasOwn(mocks, id) ? mocks[id] : require(id) });
    return mod.exports as Record<string, (request: Request) => Promise<Response>>;
  };
  const routes = [load(""), load("recipients/"), load("preview/")];
  const request = (body = input) => new Request("https://fixture.invalid/api/root/correspondence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  for (const route of routes) for (const handler of Object.values(route).filter(value => typeof value === "function")) {
    denied = true; const before = checks;
    await assert.rejects(handler(request()), /DENIED/); assert.equal(checks, before);
    denied = false; assert.equal((await handler(request())).status, 200);
  }
  for (const route of [routes[0], routes[2]]) {
    const before = checks;
    assert.equal((await route.POST(request({ ...input, recipients: [] }))).status, 400); assert.equal(checks, before);
  }
  for (const name of ["document.pdf", "script.exe"]) {
    const form = new FormData(); form.set("content", JSON.stringify(input)); form.append("files", new Blob([new Uint8Array([0, 255, 10])]), name);
    const before = checks;
    const response = await routes[0].POST(new Request("https://fixture.invalid/api/root/correspondence", { method: "POST", body: form }));
    if (name.endsWith(".exe")) { assert.equal(response.status, 400); assert.equal(checks, before); }
    else { assert.equal(response.status, 200); assert.deepEqual(transported, Buffer.from([0, 255, 10])); }
  }
});
