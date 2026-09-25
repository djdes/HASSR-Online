import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXTAUTH_SECRET = "test-secret-for-journal-samples-gate-0123";

import { GET as docxGET } from "@/app/api/journal-samples/[code]/docx/route";
import { GET as pdfGET } from "@/app/api/journal-samples/[code]/pdf/route";
import { GET as paperGET } from "@/app/api/journal-samples/paper/[id]/pdf/route";
import { BLANK_DOWNLOAD_TTL_MS, signBlankDownloadToken } from "@/lib/blank-download-token";

/**
 * Роуты файлов шаблонов (AC1): встроенный просмотр публичный, «вложение» —
 * только по подписанной ссылке; без неё браузер уходит на страницу журнала
 * с окном email, остальные получают 403.
 */

let ip = 0;
function get(path: string, headers: Record<string, string> = {}): Request {
  // Свой адрес на каждый запрос: у роутов лимит 20 файлов в минуту с адреса.
  ip += 1;
  return new Request(`http://localhost:3002${path}`, {
    headers: { "x-forwarded-for": `10.77.${Math.floor(ip / 250)}.${ip % 250}`, ...headers },
  });
}
const code = (value: string) => ({ params: Promise.resolve({ code: value }) });
const paper = (value: string) => ({ params: Promise.resolve({ id: value }) });
const BROWSER = { "sec-fetch-mode": "navigate", accept: "text/html" };
const HYGIENE = { kind: "code", code: "hygiene" } as const;

test("PDF: встроенный просмотр — без почты, inline, кеш сутки", async () => {
  const res = await pdfGET(get("/api/journal-samples/hygiene/pdf?inline=1"), code("hygiene"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.match(res.headers.get("content-disposition") ?? "", /^inline;/);
  assert.equal(res.headers.get("cache-control"), "public, max-age=86400, s-maxage=86400");
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
});

test("PDF без токена: браузер — на страницу журнала с окном email, скрипт — 403", async () => {
  const browser = await pdfGET(get("/api/journal-samples/hygiene/pdf", BROWSER), code("hygiene"));
  assert.equal(browser.status, 307);
  assert.equal(browser.headers.get("location"), "/journals-info/hygiene?download=pdf");

  const curl = await pdfGET(get("/api/journal-samples/hygiene/pdf", { accept: "*/*" }), code("hygiene"));
  assert.equal(curl.status, 403);
  assert.match(((await curl.json()) as { error: string }).error, /email/);

  const junk = await pdfGET(get("/api/journal-samples/hygiene/pdf?t=forged.token", { accept: "*/*" }), code("hygiene"));
  assert.equal(junk.status, 403);
});

test("PDF по подписанной ссылке — вложение, только в браузере скачавшего", async () => {
  const token = signBlankDownloadToken({ email: "zav@example.com", target: HYGIENE, format: "pdf" });
  const res = await pdfGET(get(`/api/journal-samples/hygiene/pdf?t=${encodeURIComponent(token)}`), code("hygiene"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename\*=UTF-8''obrazec-/);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");

  // Ссылка от гигиены не открывает другой журнал.
  const other = await pdfGET(get(`/api/journal-samples/health_check/pdf?t=${encodeURIComponent(token)}`, BROWSER), code("health_check"));
  assert.equal(other.status, 307);
  assert.equal(other.headers.get("location"), "/journals-info/health_check?download=pdf");

  // Протухшая ссылка из письма — на страницу, окно скажет, что ссылка устарела.
  const old = signBlankDownloadToken(
    { email: "zav@example.com", target: HYGIENE, format: "pdf" },
    Date.now() - BLANK_DOWNLOAD_TTL_MS - 60_000,
  );
  const expired = await pdfGET(get(`/api/journal-samples/hygiene/pdf?t=${encodeURIComponent(old)}`, BROWSER), code("hygiene"));
  assert.equal(expired.headers.get("location"), "/journals-info/hygiene?download=pdf&expired=1");
});

test("Word: только по ссылке для Word; ссылка от PDF не подходит", async () => {
  const noToken = await docxGET(get("/api/journal-samples/hygiene/docx", BROWSER), code("hygiene"));
  assert.equal(noToken.status, 307);
  assert.equal(noToken.headers.get("location"), "/journals-info/hygiene?download=docx");

  const pdfToken = signBlankDownloadToken({ email: "zav@example.com", target: HYGIENE, format: "pdf" });
  const wrong = await docxGET(get(`/api/journal-samples/hygiene/docx?t=${encodeURIComponent(pdfToken)}`, { accept: "*/*" }), code("hygiene"));
  assert.equal(wrong.status, 403);

  const token = signBlankDownloadToken({ email: "zav@example.com", target: HYGIENE, format: "docx" });
  const res = await docxGET(get(`/api/journal-samples/hygiene/docx?t=${encodeURIComponent(token)}`), code("hygiene"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 2).toString(), "PK");

  // Журнала без Word — как раньше, 404 (без редиректа в никуда).
  const noDocx = await docxGET(get("/api/journal-samples/med_books/docx", BROWSER), code("med_books"));
  assert.equal(noDocx.status, 404);
});

test("бумажный бланк: встроенный — публично (миниатюры), вложение — по ссылке, без неё — на /blanki", async () => {
  const inline = await paperGET(get("/api/journal-samples/paper/ot_intro/pdf?inline=1"), paper("ot_intro"));
  assert.equal(inline.status, 200);
  assert.match(inline.headers.get("content-disposition") ?? "", /^inline;/);

  const browser = await paperGET(get("/api/journal-samples/paper/ot_intro/pdf", BROWSER), paper("ot_intro"));
  assert.equal(browser.status, 307);
  assert.equal(browser.headers.get("location"), "/blanki?download=pdf&paper=ot_intro");

  const token = signBlankDownloadToken({ email: "zav@example.com", target: { kind: "paper", paperId: "ot_intro" }, format: "pdf" });
  const res = await paperGET(get(`/api/journal-samples/paper/ot_intro/pdf?t=${encodeURIComponent(token)}`), paper("ot_intro"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.equal(res.headers.get("cache-control"), "private, no-store");

  const unknown = await paperGET(get("/api/journal-samples/paper/nope/pdf", BROWSER), paper("nope"));
  assert.equal(unknown.status, 404);
});
