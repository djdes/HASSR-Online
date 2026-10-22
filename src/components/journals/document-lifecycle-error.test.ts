import assert from "node:assert/strict";
import test from "node:test";
import { attachLifecycleErrorMetadata, presentLifecycleError } from "./document-lifecycle-error";

const translate = (key: string) => key === "closeDocument.networkError" ? "network" : "failed";

test("private lifecycle presenter accepts only allowlisted same-locale API errors", () => {
  const error = new Error("localized API message");
  Object.defineProperty(error, "cause", { value: "original cause", enumerable: true });
  const ownProperties = Object.getOwnPropertyDescriptors(error);
  const identity = error;
  attachLifecycleErrorMetadata(error, "unsigned-rows", "uz");
  assert.equal(error, identity);
  assert.equal(error.message, "localized API message");
  assert.deepEqual(Object.getOwnPropertyDescriptors(error), ownProperties);
  assert.equal(presentLifecycleError(error, "uz", translate), "localized API message");
  assert.equal(presentLifecycleError(error, "en", translate), "failed");
  assert.equal(presentLifecycleError(attachLifecycleErrorMetadata(new Error("wrong header"), "DOCUMENT_CLOSED", "ru"), "uz", translate), "failed");
  assert.equal(presentLifecycleError(attachLifecycleErrorMetadata(new Error("missing header"), "DOCUMENT_CLOSED", null), "ru", translate), "failed");
  assert.equal(presentLifecycleError(new Error("raw diagnostic"), "ru", translate), "failed");
  assert.equal(presentLifecycleError(new Error("Failed to fetch"), "ru", translate), "network");
});

test("untrusted codes and inherited-looking codes never preserve server text", () => {
  for (const code of ["toString", "constructor", "unknown"]) {
    const error = attachLifecycleErrorMetadata(new Error("untrusted"), code, "ru");
    assert.equal(presentLifecycleError(error, "ru", translate), "failed");
  }
});
