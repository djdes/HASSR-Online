import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadMessages } from "@/i18n/messages";
import { checkSignatureForPdf, CmsError, parseCmsSignature } from "@/lib/cms-signature";
import {
  FIXTURE_ATTACHED_SIG_BASE64,
  FIXTURE_CERT_SERIAL,
  FIXTURE_DETACHED_SIG_BASE64,
  FIXTURE_PDF_BASE64,
} from "@/lib/cms-signature.fixtures";
import {
  CADES_PLUGIN_SCRIPT_URL,
  certificateLabel,
  listCertificates,
  loadCadesPlugin,
  signDetached,
  UkepPluginError,
  type CadesPlugin,
} from "@/lib/ukep-plugin";
import { signUkepToken, UKEP_TOKEN_TTL_MS, ukepSecret, verifyUkepToken } from "@/lib/ukep-token";

/**
 * Подпись журнала УКЭП (спека journal-ukep-signing-2026-11-21).
 */

const pdf = new Uint8Array(Buffer.from(FIXTURE_PDF_BASE64, "base64"));
const detached = new Uint8Array(Buffer.from(FIXTURE_DETACHED_SIG_BASE64, "base64"));
const attached = new Uint8Array(Buffer.from(FIXTURE_ATTACHED_SIG_BASE64, "base64"));
const INSIDE_VALIDITY = new Date("2026-12-01T10:00:00Z");

test("AC1: из откреплённой подписи — сертификат подписанта с русскими полями, хэш PDF сверен", () => {
  const parsed = parseCmsSignature(detached);
  assert.equal(parsed.detached, true);
  assert.equal(parsed.digest, "sha256");
  assert.deepEqual(
    {
      name: parsed.signer.subjectName,
      org: parsed.signer.organization,
      title: parsed.signer.title,
      inn: parsed.signer.inn,
      snils: parsed.signer.snils,
      ogrn: parsed.signer.ogrn,
      serial: parsed.signer.serialHex,
    },
    {
      name: "Иванов Иван Иванович",
      org: "ООО «Кафе Пример»",
      title: "Шеф-повар",
      inn: "770123456789",
      snils: "12345678901",
      ogrn: "1027700000000",
      serial: FIXTURE_CERT_SERIAL,
    },
  );
  assert.equal(parsed.signer.validFrom.toISOString(), "2026-11-21T16:02:48.000Z");
  assert.equal(parsed.signer.validTo.toISOString(), "2036-11-18T16:02:48.000Z");
  assert.ok(parsed.signingTime instanceof Date);
  assert.deepEqual(checkSignatureForPdf(parsed, pdf, INSIDE_VALIDITY), { ok: true, digestChecked: true });
});

test("AC1: отказы — мусор, присоединённая подпись, чужой PDF, сертификат не действует, ГОСТ без сверки хэша", () => {
  assert.throws(() => parseCmsSignature(new Uint8Array([1, 2, 3, 4])), CmsError);
  assert.throws(() => parseCmsSignature(new TextEncoder().encode("-----BEGIN PKCS7-----")), CmsError);
  assert.throws(() => parseCmsSignature(detached.subarray(0, 200)), CmsError, "обрезанная подпись");

  const attachedParsed = parseCmsSignature(attached);
  assert.equal(attachedParsed.detached, false);
  assert.deepEqual(checkSignatureForPdf(attachedParsed, pdf, INSIDE_VALIDITY), { ok: false, error: "Нужна откреплённая подпись: файл .sig отдельно от PDF" });

  const parsed = parseCmsSignature(detached);
  const otherPdf = new TextEncoder().encode("%PDF-1.4 другой журнал");
  assert.deepEqual(checkSignatureForPdf(parsed, otherPdf, INSIDE_VALIDITY), { ok: false, error: "Подпись сделана не для этого PDF" });

  const late = { ...parsed, signingTime: new Date("2040-01-01T00:00:00Z") };
  assert.deepEqual(checkSignatureForPdf(late, pdf, INSIDE_VALIDITY), { ok: false, error: "Сертификат подписанта не действует на момент подписания" });
  const noTime = { ...parsed, signingTime: null };
  assert.equal(checkSignatureForPdf(noTime, pdf, new Date("2040-01-01T00:00:00Z")).ok, false, "без времени подписи — по текущему");

  const noAttrs = { ...parsed, messageDigest: null };
  assert.deepEqual(checkSignatureForPdf(noAttrs, pdf, INSIDE_VALIDITY), { ok: false, error: "Подпись без подписанных атрибутов — нужна CAdES-BES" });

  const gost = { ...parsed, digest: "gost2012-256" as const };
  assert.deepEqual(checkSignatureForPdf(gost, otherPdf, INSIDE_VALIDITY), { ok: true, digestChecked: false }, "ГОСТ: хэш на сервере не посчитать — проверка на Госуслугах");
});

test("AC2: токен — только для своего документа, человека, организации и PDF, 15 минут", () => {
  const secret = "test-secret-1234567890";
  const claims = { documentId: "doc-1", userId: "u-1", organizationId: "org-1", sha256: "ab".repeat(32) };
  const now = new Date("2026-11-21T12:00:00Z");
  const token = signUkepToken(claims, secret, now);
  assert.deepEqual(verifyUkepToken(token, secret, claims, new Date(now.getTime() + 60_000)), { ok: true });
  assert.equal(verifyUkepToken(token, "other-secret", claims, now).ok, false, "чужой ключ");
  assert.equal(verifyUkepToken(`${token}x`, secret, claims, now).ok, false, "подделанная подпись токена");
  const [body, mac] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), documentId: "doc-2" })).toString("base64url");
  assert.equal(verifyUkepToken(`${forged}.${mac}`, secret, { ...claims, documentId: "doc-2" }, now).ok, false, "подменённое тело");
  for (const other of [{ documentId: "doc-2" }, { userId: "u-2" }, { organizationId: "org-2" }, { sha256: "cd".repeat(32) }]) {
    assert.equal(verifyUkepToken(token, secret, { ...claims, ...other }, now).ok, false, JSON.stringify(other));
  }
  const expired = verifyUkepToken(token, secret, claims, new Date(now.getTime() + UKEP_TOKEN_TTL_MS + 1));
  assert.deepEqual(expired, { ok: false, error: "Прошло больше 15 минут — начните подписание заново" });
  assert.equal(verifyUkepToken("garbage", secret, claims, now).ok, false);
  assert.equal(ukepSecret({ NEXTAUTH_SECRET: "  s  " }), "s");
  assert.equal(ukepSecret({}), null);
});

function fakePlugin(certs: Array<{ thumb: string; key: boolean; validTo: string }>) {
  const calls: string[] = [];
  const certificates = certs.map((item) => ({
    get Thumbprint() { return Promise.resolve(item.thumb); },
    get SubjectName() { return Promise.resolve(`CN=Петров Пётр, SN=Петров, G=Пётр Петрович, O=ООО «Кафе»`); },
    get IssuerName() { return Promise.resolve("CN=УЦ Тест"); },
    get ValidToDate() { return Promise.resolve(item.validTo); },
    HasPrivateKey: async () => item.key,
  }));
  const store = {
    Open: async (...args: unknown[]) => void calls.push(`Open:${args.join(",")}`),
    Close: async () => void calls.push("Close"),
    get Certificates() {
      return Promise.resolve({ get Count() { return Promise.resolve(certificates.length); }, Item: async (index: number) => certificates[index - 1] });
    },
  };
  const signer = {
    propset_Certificate: async () => void calls.push("signer.Certificate"),
    propset_CheckCertificate: async (value: boolean) => void calls.push(`signer.CheckCertificate:${value}`),
    propset_Options: async (value: number) => void calls.push(`signer.Options:${value}`),
  };
  const data = {
    propset_ContentEncoding: async (value: number) => void calls.push(`data.ContentEncoding:${value}`),
    propset_Content: async (value: string) => void calls.push(`data.Content:${value}`),
    SignCades: async (_signer: unknown, type: number, isDetached: boolean) => {
      calls.push(`SignCades:${type}:${isDetached}`);
      return "MIIB\r\nAAAA";
    },
  };
  const plugin: CadesPlugin = {
    CreateObjectAsync: async (name: string) => {
      calls.push(`create:${name}`);
      return name === "CAdESCOM.Store" ? store : name === "CAdESCOM.CPSigner" ? signer : data;
    },
    CAPICOM_CURRENT_USER_STORE: 2,
    CAPICOM_MY_STORE: "My",
    CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED: 2,
    CAPICOM_CERTIFICATE_INCLUDE_END_ENTITY_ONLY: 2,
    CADESCOM_BASE64_TO_BINARY: 1,
    CADESCOM_CADES_BES: 1,
  };
  return { plugin, calls };
}

test("AC3: сертификаты — «Личное», только с закрытым ключом и действующие; подпись — CAdES-BES, откреплённая", async () => {
  const { plugin, calls } = fakePlugin([
    { thumb: "AA", key: true, validTo: "2030-01-01T00:00:00Z" },
    { thumb: "BB", key: false, validTo: "2030-01-01T00:00:00Z" },
    { thumb: "CC", key: true, validTo: "2020-01-01T00:00:00Z" },
  ]);
  const list = await listCertificates(plugin, new Date("2026-11-21T00:00:00Z"));
  assert.deepEqual(list.map((item) => item.thumbprint), ["AA"]);
  assert.deepEqual(calls.slice(0, 2), ["create:CAdESCOM.Store", "Open:2,My,2"]);
  assert.equal(calls.at(-1), "Close", "хранилище закрываем");
  calls.length = 0;
  const signature = await signDetached(plugin, list[0], "JVBERi0=");
  assert.equal(signature, "MIIBAAAA", "переводы строк из base64 убраны");
  assert.deepEqual(calls, [
    "create:CAdESCOM.CPSigner",
    "signer.Certificate",
    "signer.CheckCertificate:true",
    "signer.Options:2",
    "create:CAdESCOM.CadesSignedData",
    "data.ContentEncoding:1",
    "data.Content:JVBERi0=",
    "SignCades:1:true",
  ]);
  assert.equal(certificateLabel("CN=Петров Пётр, SN=Петров, G=Пётр Петрович, O=ООО «Кафе»"), "Петров Пётр Петрович");
  assert.equal(certificateLabel("CN=ООО Ромашка, O=ООО Ромашка"), "ООО Ромашка");
});

test("AC3: нет плагина или сертификатов, ошибка подписи — понятным текстом", async () => {
  await assert.rejects(loadCadesPlugin({}, async () => { throw new Error("blocked"); }), (error: unknown) => error instanceof UkepPluginError && error.code === "no_plugin");
  const rejected = Object.assign(Promise.reject(new Error("Плагин недоступен")), { CreateObjectAsync: async () => ({}) });
  rejected.catch(() => undefined);
  await assert.rejects(loadCadesPlugin({ cadesplugin: rejected }, async () => undefined, 50), (error: unknown) => error instanceof UkepPluginError && error.code === "no_plugin");
  const { plugin } = fakePlugin([{ thumb: "AA", key: true, validTo: "2030-01-01T00:00:00Z" }]);
  const loadedScripts: string[] = [];
  const win: { cadesplugin?: unknown } = {};
  const ready = await loadCadesPlugin(win, async (src) => {
    loadedScripts.push(src);
    win.cadesplugin = Object.assign(Promise.resolve(), plugin);
  });
  assert.deepEqual(loadedScripts, [CADES_PLUGIN_SCRIPT_URL]);
  assert.equal(typeof ready.CreateObjectAsync, "function");
  assert.equal(typeof (ready as { then?: unknown }).then, "undefined", "не промис: async-функция вернула сам объект, а не результат промиса");
  assert.equal(ready.CADESCOM_CADES_BES, 1);
  assert.deepEqual((await listCertificates(ready)).map((item) => item.thumbprint), ["AA"], "через возвращённый объект плагин работает");

  const empty = fakePlugin([{ thumb: "BB", key: false, validTo: "2030-01-01T00:00:00Z" }]);
  await assert.rejects(listCertificates(empty.plugin), (error: unknown) => error instanceof UkepPluginError && error.code === "no_certificates");
  const failing: CadesPlugin = { ...plugin, CreateObjectAsync: async () => { throw new Error("0x8010006E"); }, getLastError: () => "Действие отменено пользователем" };
  await assert.rejects(signDetached(failing, { thumbprint: "AA", subjectName: "", issuerName: "", validTo: "", handle: {} }, "AA=="), /Действие отменено пользователем/);
});

test("AC4: API — сессия, организация, точка, доступ к журналу, право подписи, аудит", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const access = read("./ukep-access.server.ts");
  assert.match(access, /db\.journalDocument\.findFirst\(\{\s*where: \{ id: documentId, organizationId \}/);
  assert.match(access, /canSeeDocumentPoint\(session, document\.buildingId\)/);
  assert.match(access, /hasJournalAccess\(actor, document\.template\.code\)/);
  assert.match(access, /hasFullWorkspaceAccess\(session\.user\) \|\| \(await canFinalizeJournal\(actor, document\.template\.code\)\)/);

  const prepare = read("../app/api/journal-documents/[id]/ukep/prepare/route.ts");
  const route = read("../app/api/journal-documents/[id]/ukep/route.ts");
  const download = read("../app/api/journal-documents/[id]/ukep/[signatureId]/route.ts");
  for (const source of [prepare, route, download]) {
    assert.match(source, /getServerSession\(authOptions\)/);
    assert.match(source, /loadUkepDocument\(session, id\)/);
  }
  for (const source of [prepare, route]) {
    assert.match(source, /if \(!access\.canSign\) return NextResponse\.json\(\{ error: "Подписывать журнал может руководитель" \}, \{ status: 403 \}\)/);
    assert.match(source, /orgLockedResponse\(access\.organizationId\)/);
  }
  assert.match(prepare, /generateJournalDocumentPdf\(\{ documentId: id, organizationId: access\.organizationId, locale \}\)/);
  assert.match(route, /verifyUkepToken\(body\.token, secret, \{\s*documentId: id,\s*userId: session\.user\.id,\s*organizationId: access\.organizationId,\s*sha256: pdfSha256,/);
  assert.ok(route.indexOf("verifyUkepToken(") < route.indexOf("parseCmsSignature("), "сначала токен и хэш, потом разбор");
  assert.ok(route.indexOf("checkSignatureForPdf(") < route.indexOf("db.journalDocumentSignature.create("), "сохраняем только проверенное");
  assert.match(route, /action: "journal\.ukep_sign"/);
  assert.match(route, /where: \{ organizationId: access\.organizationId, documentId: id \}/);
  assert.match(download, /where: \{ id: signatureId, documentId: id, organizationId: access\.organizationId \}/);
});

test("AC5/AC6: меню документа, тексты ru/en/uz, документация, таблица в схеме", async () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const bar = read("../components/journals/document-actions-bar.tsx");
  assert.match(bar, /const hasUkep = Boolean\(canManage && documentId\)/);
  assert.match(bar, /key: "ukep-sign"/);
  assert.match(bar, /<UkepSignDialog documentId=\{documentId as string\}/);
  for (const locale of ["ru", "en", "uz"] as const) {
    const controls = (await loadMessages(locale)).journalControls;
    assert.ok(controls.actions.ukep.trim() && controls.actions.ukepHint.trim(), locale);
    for (const key of ["title", "intro", "empty", "start", "sign", "signing", "verifyHint", "verifyLink", "onlyManagers", "installCsp", "installPlugin", "downloadPdf", "downloadSig"] as const) {
      assert.ok(controls.ukep[key].trim(), `${locale}: ukep.${key}`);
    }
    for (const key of ["load", "plugin", "failed"] as const) assert.ok(controls.ukep.errors[key].trim(), `${locale}: errors.${key}`);
  }
  const doc = read("../../docs/ukep-signing.md");
  assert.match(doc, /Не проверяет математику подписи ГОСТ Р 34\.10-2012/);
  assert.match(doc, /https:\/\/www\.gosuslugi\.ru\/eds/);
  const schema = read("../../prisma/schema.prisma");
  assert.match(schema, /model JournalDocumentSignature \{/);
  assert.match(schema, /journalDocumentSignatures\s+JournalDocumentSignature\[\]/);
});
