import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { MAIL_ATTACHMENT_BYTES, mailAttachmentError, mailAttachmentType } from "./mail-attachments";
import { readMailRequest } from "./mail-attachments.server";

function multipart(files: { name: string; bytes: Uint8Array; type?: string }[], content: unknown = { subject: "Test" }) {
  const body = new FormData(); body.set("content", JSON.stringify(content));
  for (const file of files) body.append("files", new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.type ?? "application/octet-stream" }), file.name);
  return new Request("https://fixture.invalid", { method: "POST", body });
}

test("multipart preserves exact binary bytes, derives safe MIME and hashes content", async () => {
  const bytes = new Uint8Array([0, 255, 13, 10, 128, 65]);
  const result = await readMailRequest(multipart([{ name: "счёт.PDF", bytes, type: "text/html" }]));
  assert.deepEqual(result.content, { subject: "Test" });
  const file = result.attachments[0];
  assert.deepEqual(file.content, Buffer.from(bytes)); assert.equal(file.filename, "счёт.PDF");
  assert.equal(file.contentType, "application/pdf"); assert.equal(file.size, bytes.length);
  assert.equal(file.sha256, createHash("sha256").update(bytes).digest("hex")); assert.equal("path" in file, false);
});

test("legacy JSON remains compatible; client paths cannot become attachments", async () => {
  const result = await readMailRequest(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify({ files: [{ path: "/etc/passwd" }] }) }));
  assert.deepEqual(result.attachments, []);
});

test("server rejects unsupported, empty, excessive and malformed file requests", async () => {
  for (const name of ["script.exe", "page.html", "graphic.svg", "test.constructor", "test.__proto__", "virus.js"]) {
    assert.equal(mailAttachmentType(name), null);
    await assert.rejects(readMailRequest(multipart([{ name, bytes: new Uint8Array([1]) }])));
  }
  assert.equal(mailAttachmentType("bad\u0001.pdf"), null);
  assert.equal(mailAttachmentType("../file.pdf"), null); assert.equal(mailAttachmentType("C:\\file.pdf"), null);
  await assert.rejects(readMailRequest(multipart([{ name: "empty.txt", bytes: new Uint8Array() }])));
  await assert.rejects(readMailRequest(multipart(Array.from({ length: 11 }, (_, n) => ({ name: `${n}.txt`, bytes: new Uint8Array([1]) })))));
  const body = new FormData(); body.set("content", "{}"); body.set("files", "https://internal.invalid/file.pdf");
  await assert.rejects(readMailRequest(new Request("https://fixture.invalid", { method: "POST", body })));
  assert.equal(mailAttachmentError([{ name: "large.pdf", size: MAIL_ATTACHMENT_BYTES + 1 }]), "size");
});

test("stream is limited even without Content-Length, and advertised oversize fails early", async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAIL_ATTACHMENT_BYTES + 512 * 1024 + 1)); }, cancel() { cancelled = true; } });
  const request = new Request("https://fixture.invalid", { method: "POST", body, duplex: "half" } as RequestInit);
  await assert.rejects(readMailRequest(request), /10 МБ/); assert.equal(cancelled, true);
  await assert.rejects(readMailRequest(new Request("https://fixture.invalid", { method: "POST", headers: { "content-length": "999999999" }, body: "x" })), /10 МБ/);
});
