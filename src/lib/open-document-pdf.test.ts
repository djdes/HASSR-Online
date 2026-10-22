import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { getOpenDocumentPdfFailure, openDocumentPdf } from "./open-document-pdf";

function browser(t: TestContext, blocked = false) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const opened: unknown[][] = [], revoked: string[] = [], timers: Array<{ run: () => void; delay: number }> = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    open(...args: unknown[]) { opened.push(args); return blocked ? null : {}; },
    setTimeout(run: () => void, delay: number) { timers.push({ run, delay }); return 1; },
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  t.mock.method(URL, "createObjectURL", () => "blob:pdf-fixture");
  t.mock.method(URL, "revokeObjectURL", (url: string) => { revoked.push(url); });
  return { opened, revoked, timers };
}

test("PDF locale is explicit while old callers keep their original URL and cleanup", async (t) => {
  const web = browser(t), requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response("%PDF-fixture", { headers: { "content-type": "application/pdf" } });
  });
  await openDocumentPdf("raw-id");
  for (const locale of ["ru", "en", "uz"] as const) await openDocumentPdf("raw-id", locale);
  assert.deepEqual(requests.map(r => r.url), ["/api/journal-documents/raw-id/pdf", ...["ru", "en", "uz"].map(l => `/api/journal-documents/raw-id/pdf?locale=${l}`)]);
  assert(requests.every(r => r.init?.method === "GET" && r.init.credentials === "include"));
  assert.deepEqual(web.opened, Array.from({ length: 4 }, () => ["blob:pdf-fixture", "_blank", "noopener,noreferrer"]));
  assert.deepEqual(web.revoked, []);
  assert.equal(web.timers.length, 4);
  for (const timer of web.timers) { assert.equal(timer.delay, 60_000); timer.run(); }
  assert.deepEqual(web.revoked, Array(4).fill("blob:pdf-fixture"));
});

test("PDF fallback provenance retains raw errors and reads payload error once", async (t) => {
  for (const value of [undefined, null, false, 0, "", "Не удалось открыть PDF", "RAW/custom {error}"]) {
    let reads = 0;
    t.mock.method(globalThis, "fetch", async () => ({
      ok: false, headers: new Headers(),
      json: async () => ({ get error() { reads++; return value; } }),
    } as unknown as Response));
    await assert.rejects(openDocumentPdf("d", "uz"), (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.message, value || "Не удалось открыть PDF");
      assert.equal(getOpenDocumentPdfFailure(error), value ? undefined : "apiFallback");
      return true;
    });
    assert.equal(reads, 1);
    t.mock.restoreAll();
  }
  assert.equal(getOpenDocumentPdfFailure(new Error("Не удалось открыть PDF")), undefined);
});

test("PDF network rejection preserves identity and malformed JSON keeps the original fallback", async (t) => {
  const sentinel = new Error("RAW network");
  t.mock.method(globalThis, "fetch", async () => { throw sentinel; });
  await assert.rejects(openDocumentPdf("d", "en"), error => error === sentinel);
  assert.equal(getOpenDocumentPdfFailure(sentinel), undefined);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, headers: new Headers(), json: async () => { throw new SyntaxError("invalid JSON"); } } as unknown as Response));
  await assert.rejects(openDocumentPdf("d"), (error: unknown) => {
    assert(error instanceof Error);
    assert.equal(error.message, "Не удалось открыть PDF");
    assert.equal(getOpenDocumentPdfFailure(error), "apiFallback");
    return true;
  });
});

test("blocked PDF popup revokes its blob immediately without changing its raw Error", async (t) => {
  const web = browser(t, true);
  t.mock.method(globalThis, "fetch", async () => new Response("%PDF-fixture", { headers: { "content-type": "application/pdf" } }));
  await assert.rejects(openDocumentPdf("d", "uz"), (error: unknown) => {
    assert(error instanceof Error);
    assert.equal(error.message, "Браузер заблокировал открытие PDF");
    assert.equal(getOpenDocumentPdfFailure(error), "popupBlocked");
    return true;
  });
  assert.deepEqual(web.revoked, ["blob:pdf-fixture"]);
  assert.equal(web.timers.length, 0);
});
