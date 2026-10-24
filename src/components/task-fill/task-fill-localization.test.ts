/* eslint-disable react/no-children-prop -- Explicit children in SSR fixtures. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { createTranslator } from "use-intl/core";
import { loadMessages, pickMessages } from "@/i18n/messages";
import { TaskFillClient } from "@/app/task-fill/[taskId]/task-fill-client";
import { TaskVerifyClient } from "@/app/task-fill/[taskId]/task-verify-client";
import { taskFillErrorMessage, taskFillPhotoCopy } from "@/lib/task-fill-messages";
import { PhotoField, checkPhotoBeforeUpload, PHOTO_MAX_BYTES } from "@/components/journals/photo-field";
import { fieldIcon, fieldIconTone } from "./field-icons";

const base: ComponentProps<typeof TaskFillClient> = {
  taskId: 51, token: "test-token", journalCode: "custom", returnUrl: "/safe-return",
  journalLabel: "ACME", documentTitle: "Customer document O‘tkir", employeeName: "A. Karimov",
  employeePositionTitle: "Chef", form: null, alreadyCompleted: false, editLocked: false,
  taskScope: "personal", allowNoEvents: true, noEventsReasons: ["Custom reason O‘tkir"],
  allowFreeTextReason: true, todaysEntryCount: 2, closeEvent: null,
};

test("real filler, closed and already-completed states render scoped RU/EN/UZ messages without changing customer text", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const patch of [
      {}, { alreadyCompleted: true }, { alreadyCompleted: true, editLocked: true },
      { taskScope: "shared" as const },
      ...["no-events", "closed-with-events", "auto-closed-empty"].map(kind => ({ taskScope: "shared" as const, closeEvent: { kind, reason: "Custom reason O‘tkir", closedAt: "2026-10-15T01:00:00Z" } })),
    ]) {
      const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
        locale, messages: pickMessages(messages, ["common", "taskFill", "journalControls", "journalFillingGuides"]),
        timeZone: "UTC", onError: error => { throw error; },
        children: createElement(TaskFillClient, { ...base, ...patch }),
      }));
      assert.ok(html.includes("Customer document O‘tkir"));
      assert.ok(html.includes("A. Karimov"));
      if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
      assert.ok(html.includes("/safe-return"));
    }
  }
});

test("real verifier handles empty, pending, approved and rejected states in all locales", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const status of [null, "approved", "rejected"]) {
      for (const hasEntries of [false, true]) {
        const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
          locale, messages: pickMessages(messages, ["common", "taskFill", "journalControls"]), timeZone: "UTC", onError: error => { throw error; },
          children: createElement(TaskVerifyClient, {
            taskId: 51, token: "token", journalLabel: "ACME", documentTitle: "Customer document O‘tkir",
            documentClosed: false, documentVerificationStatus: status, previousRejectReason: "Customer reason",
            entries: hasEntries ? [{ id: "entry", date: "2026-10-15", employeeName: "Karimov", employeePosition: "Chef", verificationStatus: status, fields: [{ label: "Custom field", value: "Customer value" }] }] : [],
            verifierName: "Reviewer", returnUrl: null, totalFillers: 2, completedFillers: 1,
          }),
        }));
        assert.ok(html.includes(messages.taskFill.verify.title));
        assert.ok(html.includes("Customer document O‘tkir"));
        if (hasEntries) assert.ok(html.includes("Customer value"));
        if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
      }
    }
  }
});

test("stable API codes select translated errors; technical legacy text is never used as a translation key", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages, namespace: "taskFill", onError: error => { throw error; } });
    for (const code of Object.keys(messages.taskFill.errors)) {
      const actual = taskFillErrorMessage({ errorCode: code, error: "untrusted legacy text", errorParams: { field: "stable-field" } }, t, "fallback", [{ key: "stable-field", label: "Custom label O‘tkir" }]);
      assert.notEqual(actual, "fallback");
      assert.ok(!actual.includes("untrusted legacy text"));
      if (code === "fieldInvalid") assert.ok(actual.includes("Custom label O‘tkir"));
    }
    assert.equal(taskFillErrorMessage({ error: "Internal exception" }, t, "fallback"), "fallback");
    assert.equal(taskFillErrorMessage({ errorCode: "__proto__" }, t, "fallback"), "fallback");
  }
});

test("field icons preserve original semantic presentation when labels change", () => {
  const source = { type: "number" as const, key: "reading", label: "Температура", sourceLabel: "Температура" };
  const translated = { ...source, label: "Harorat" };
  assert.equal(fieldIcon(source), fieldIcon(translated));
  assert.deepEqual(fieldIconTone(source), fieldIconTone(translated));
});

test("photo presentation localizes validation and accessible copy while legacy callers and values stay compatible", async () => {
  const invalid = new File(["invalid"], "test.txt", { type: "text/plain" });
  assert.equal(checkPhotoBeforeUpload(invalid), "Подойдут JPG, PNG или WebP");
  assert.equal(checkPhotoBeforeUpload(new File(["photo"], "photo.png", { type: "image/png" })), null);
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages, namespace: "taskFill" });
    const copy = taskFillPhotoCopy(t);
    assert.equal(checkPhotoBeforeUpload(invalid, copy), messages.taskFill.photo.invalidType);
    assert.equal(checkPhotoBeforeUpload({ type: "image/png", size: PHOTO_MAX_BYTES + 1 } as File, copy), messages.taskFill.photo.tooLarge);
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages } as ComponentProps<typeof NextIntlClientProvider>, createElement(PhotoField, { label: "Customer photo", value: "/uploads/original.png", onChange() {}, required: true, copy })));
    assert.ok(html.includes("/uploads/original.png"));
    assert.ok(html.includes(copy.remove));
    assert.ok(html.includes(copy.alt(1)));
    if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
  }
});
