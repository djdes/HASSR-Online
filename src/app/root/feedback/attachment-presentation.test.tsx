import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/i18n/messages";
import { formatBytes } from "@/lib/support-attachments-shared";
import { formatRootAttachmentBytes, getRootUploadFailureContent } from "./attachment-presentation";

test("ROOT size profile preserves defaults and deterministic Uzbek thresholds", () => {
  const values = [0, 1, 1023, 1024, 1025, 1048575, 1048576, 1048577, 50 * 1048576];
  for (const locale of ["ru", "en"] as const) for (const value of values) assert.equal(formatRootAttachmentBytes(value, locale), formatBytes(value, locale));
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(formatRootAttachmentBytes(value, "uz"), formatBytes(value, "uz"));
  assert.deepEqual(values.map(value => formatRootAttachmentBytes(value, "uz")), ["0 bayt", "1 bayt", "1\u00a0023 bayt", "1 kB", "1 kB", "1\u00a0024 kB", "1,0 MB", "1,0 MB", "50,0 MB"]);
});

test("upload failure node reads the actual rendering provider instead of a captured translator", async () => {
  const node = getRootUploadFailureContent();
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const message = messages.publicSupport.attachment.uploadFailed;
    assert.equal(renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={{ publicSupport: messages.publicSupport }} timeZone="UTC">{node}</NextIntlClientProvider>), message);
  }
});
