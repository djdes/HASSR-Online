import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/i18n/messages";
import { AttachmentChips, MessageAttachments } from "./attachment-composer";
import { formatBytes } from "@/lib/support-attachments-shared";

test("omitted size callback preserves original chip and historical attachment formatting", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const sizeBytes of [0, 1023, 1024, 1048576, 50 * 1048576]) {
    const messages = await loadMessages(locale);
    const metadata = { url: "/unchanged", filename: "Отправить Oʻtkir.txt", mimeType: "text/plain", sizeBytes };
    const provider = (child: React.ReactNode) => <NextIntlClientProvider locale={locale} messages={{ publicSupport: messages.publicSupport }} timeZone="UTC">{child}</NextIntlClientProvider>;
    const chip = renderToStaticMarkup(provider(<AttachmentChips uploads={[{ ...metadata, key: "raw-key", status: "ready" }]} onRemove={() => undefined} />));
    assert.ok(chip.includes(formatBytes(sizeBytes, locale)));
    assert.ok(chip.includes(metadata.filename));
    const message = renderToStaticMarkup(provider(<MessageAttachments attachments={[metadata]} />));
    assert.ok(message.includes(formatBytes(sizeBytes, locale)));
    const custom = renderToStaticMarkup(provider(<AttachmentChips uploads={[{ ...metadata, key: "raw-key", status: "ready" }]} onRemove={() => undefined} formatSizeBytes={(size, lang) => `${size}:${lang}`} />));
    assert.ok(custom.includes(`${sizeBytes}:${locale}`));
    assert.ok(message.includes('href="/unchanged"'));
  }
});
