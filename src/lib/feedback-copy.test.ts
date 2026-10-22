import assert from "node:assert/strict";
import test from "node:test";
import { feedbackFailure, feedbackValidationDescriptor } from "./feedback-copy";

test("feedback validation descriptors preserve stable field/limit semantics", () => {
  const cases = [
    [{ code: "invalid_value", path: ["type"] }, { errorCode: "FEEDBACK_TYPE_REQUIRED" }],
    [{ code: "too_small", path: ["message"], minimum: 3 }, { errorCode: "FEEDBACK_MESSAGE_TOO_SHORT", errorParams: { min: 3 } }],
    [{ code: "too_big", path: ["message"], maximum: 4000 }, { errorCode: "FEEDBACK_MESSAGE_TOO_LONG", errorParams: { max: 4000 } }],
    [{ code: "too_big", path: ["phone"], maximum: 40 }, { errorCode: "FEEDBACK_PHONE_TOO_LONG", errorParams: { max: 40 } }],
    [undefined, { errorCode: "FEEDBACK_INVALID_REQUEST" }],
    [{ code: "invalid_type", path: ["message"] }, { errorCode: "FEEDBACK_INVALID_REQUEST" }],
  ] as const;
  for (const [issue, expected] of cases) assert.deepEqual(feedbackValidationDescriptor(issue), expected);
});

test("feedback failure copy only accepts known own codes and bounded numeric parameters", () => {
  assert.deepEqual(feedbackFailure({ errorCode: "FEEDBACK_MESSAGE_TOO_SHORT", errorParams: { min: 3 } }), { key: "messageTooShort", min: 3 });
  assert.deepEqual(feedbackFailure({ errorCode: "FEEDBACK_MESSAGE_TOO_LONG", errorParams: { max: 4000 } }), { key: "messageTooLong", max: 4000 });
  assert.deepEqual(feedbackFailure({ errorCode: "FEEDBACK_PHONE_TOO_LONG", errorParams: { max: 40 } }), { key: "phoneTooLong", max: 40 });
  for (const [errorCode, key] of [["FEEDBACK_TYPE_REQUIRED", "typeRequired"], ["FEEDBACK_INVALID_REQUEST", "invalidRequest"], ["FEEDBACK_UNREADABLE_REQUEST", "unreadableRequest"], ["FEEDBACK_INVALID_ATTACHMENTS", "invalidAttachments"]]) {
    assert.deepEqual(feedbackFailure({ errorCode }), { key });
  }
  const invalid: unknown[] = [null, [], "server diagnostic", { error: "Russian or sensitive diagnostic" }, { errorCode: "constructor" }, Object.create({ errorCode: "FEEDBACK_TYPE_REQUIRED" })];
  for (const max of [undefined, null, "40", -1, 0, 2.5, Number.NaN, Infinity, 100_001]) invalid.push({ errorCode: "FEEDBACK_PHONE_TOO_LONG", errorParams: { max } });
  invalid.push({ errorCode: "FEEDBACK_PHONE_TOO_LONG", errorParams: Object.create({ max: 40 }) });
  invalid.push({ errorCode: "FEEDBACK_MESSAGE_TOO_SHORT", errorParams: [] });
  for (const value of invalid) assert.deepEqual(feedbackFailure(value), { key: "submitError" });
});
