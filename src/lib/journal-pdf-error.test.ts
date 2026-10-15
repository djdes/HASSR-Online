import assert from "node:assert/strict";
import test from "node:test";
import { journalPdfErrorResponse } from "./journal-pdf-error";

test("PDF errors preserve HTTP semantics and stable codes in HTML and JSON for every language", async () => {
  const statuses = { UNAUTHORIZED: 401, INVALID_LOCALE: 400, DOCUMENT_NOT_FOUND: 404, JOURNAL_FORBIDDEN: 403, PDF_FAILED: 500 } as const;
  for (const locale of ["ru", "en", "uz"] as const) {
    for (const code of Object.keys(statuses) as (keyof typeof statuses)[]) {
      for (const accept of ["text/html", "application/json"]) {
        const request = new Request("https://wesetup.ru/api/journal-documents/example/pdf", { headers: { accept } });
        const response = journalPdfErrorResponse(request, code, locale);
        assert.equal(response.status, statuses[code]);
        assert.equal(response.headers.get("Content-Language"), locale);
        assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
        if (accept === "text/html") {
          const html = await response.text();
          assert.ok(html.includes(`<html lang="${locale}">`));
          assert.match(html, /<h1>[^<]+<\/h1><p>[^<]+<\/p>/);
          if (locale !== "ru") assert.doesNotMatch(html, /[А-Яа-яЁё]/);
        } else {
          const body = await response.json();
          assert.equal(body.code, code);
          assert.ok(body.error.trim());
          if (locale !== "ru") assert.doesNotMatch(body.error, /[А-Яа-яЁё]/);
        }
      }
    }
  }
});
