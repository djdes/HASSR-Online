import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { TRUSTED_SMTP_HOSTS_SETTING } from "@/lib/smtp-host-policy";
import type { ImapConfig, MailSession } from "./imap.server";

const config: ImapConfig = { host: "wesetup.ru", port: 143, secure: false, username: "admin@example.com", password: "test-only-password" };
function fixture({ addresses = ["192.168.33.3"], policy = '{"wesetup.ru":["192.168.33.3"]}', failure = null }: { addresses?: readonly string[]; policy?: string | null; failure?: Error | null } = {}) {
  let lookups = 0, connections = 0, closed = 0, policyReads = 0;
  let options: Record<string, unknown> = {};
  const modules: Record<string, unknown> = {
    "node:dns/promises": { lookup: async () => { lookups++; return addresses.map(address => ({ address })); } },
    "@/lib/db": { db: { platformSetting: { findUnique: async (args: { where: { key: string } }) => { policyReads++; assert.equal(args.where.key, TRUSTED_SMTP_HOSTS_SETTING); return policy === null ? null : { value: policy }; } } } },
    imapflow: { ImapFlow: class {
      constructor(input: Record<string, unknown>) { options = input; }
      on() {}
      async connect() { connections++; if (failure) throw failure; }
      async list() { return [{ path: "INBOX", specialUse: null }]; }
      async logout() { closed++; }
      close() { closed++; }
    } },
  };
  const source = ts.transpileModule(readFileSync(resolve("src/lib/crm/imap.server.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: { openImapSession?: (config: ImapConfig) => Promise<MailSession> } = {};
  const nativeRequire = createRequire(resolve("package.json"));
  runInNewContext(source, { exports, require: (name: string) => Object.hasOwn(modules, name) ? modules[name] : nativeRequire(name), console });
  assert.ok(exports.openImapSession);
  return { open: exports.openImapSession, stats: () => ({ lookups, connections, closed, policyReads, options }), revoke: () => { policy = null; } };
}

test("owned IMAP pins one DNS lookup and mandates STARTTLS with trusted CA and original hostname", async () => {
  const f = fixture(); const session = await f.open(config); const s = f.stats();
  assert.equal(s.lookups, 1); assert.equal(s.connections, 1); assert.equal(s.policyReads, 1);
  assert.equal(s.options.host, "192.168.33.3"); assert.equal(s.options.port, 143); assert.equal(s.options.secure, false); assert.equal(s.options.doSTARTTLS, true);
  assert.equal(s.options.servername, config.host); assert.equal(JSON.stringify(s.options.tls), JSON.stringify({ servername: config.host, rejectUnauthorized: true }));
  assert.equal(JSON.stringify(s.options.auth), JSON.stringify({ user: config.username, pass: config.password }));
  assert.equal((await session.listFolders())[0].path, "INBOX");await session.logout();assert.equal(f.stats().closed, 1);
});

for (const [name, settings, connection] of [
  ["missing policy", { policy: null }, {}], ["malformed policy", { policy: "{" }, {}],
  ["unlisted address", { addresses: ["192.168.33.4"] }, {}],
  ["rebinding answer", { addresses: ["192.168.33.3", "127.0.0.1"] }, {}],
  ["loopback even if listed", { addresses: ["127.0.0.1"], policy: '{"wesetup.ru":["127.0.0.1"]}' }, {}],
  ["metadata even if listed", { addresses: ["169.254.169.254"], policy: '{"wesetup.ru":["169.254.169.254"]}' }, {}],
  ["other host", {}, { host: "other.example.com" }], ["other port", {}, { port: 587 }],
] as const) test(`private IMAP rejects before connecting: ${name}`, async () => {
  const f = fixture(settings);
  await assert.rejects(() => f.open({ ...config, ...connection })); assert.equal(f.stats().connections, 0);
});

test("policy revocation is read on every new IMAP session", async () => {
  const f = fixture();await (await f.open(config)).logout();f.revoke();await assert.rejects(() => f.open(config));assert.equal(f.stats().connections, 1);assert.equal(f.stats().policyReads, 2);
});

test("TLS certificate rejection closes the client and never reconnects without validation", async () => {
  const error = Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" });const f = fixture({ failure: error });
  await assert.rejects(() => f.open(config), e => e === error);assert.equal(f.stats().connections, 1);assert.equal(f.stats().closed, 1);
});

test("public IMAP needs no operator exception and supports implicit TLS or mandatory STARTTLS", async () => {
  for (const secure of [false, true]) { const f = fixture({ addresses: ["8.8.8.8"], policy: null });await (await f.open({ ...config, host: "imap.example.com", secure, port: secure ? 993 : 143 })).logout();const s = f.stats();assert.equal(s.policyReads, 0);assert.equal(s.options.doSTARTTLS, secure ? undefined : true);assert.equal(s.options.host, "8.8.8.8"); }
});
