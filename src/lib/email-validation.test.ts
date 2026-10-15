import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEmail, replaceDomain } from "./email-validation";

test("email validation reports stable issue codes without changing validation statuses", () => {
  const cases = [
    ["", "empty", "required"],
    ["x".repeat(201) + "@example.com", "invalid", "tooLong"],
    ["first last@example.com", "invalid", "whitespace"],
    ["user.example.com", "invalid", "missingAt"],
    ["a@@example.com", "invalid", "multipleAt"],
    ["@example.com", "invalid", "missingLocalPart"],
    ["user@", "invalid", "missingDomain"],
    ["user@localhost", "invalid", "missingDomainDot"],
    ["user@.example.com", "invalid", "malformedDomain"],
    ["user@exam_ple.com", "invalid", "invalidDomainCharacters"],
    ["user@example.1a", "invalid", "invalidTld"],
  ] as const;

  for (const [value, status, code] of cases) {
    const result = checkEmail(value);
    const actualStatus: string = result.status;
    assert.equal(actualStatus, status, value);
    if ("code" in result) assert.equal(result.code, code, value);
  }
});

test("email typo checks preserve the suggested domain and correction behavior", () => {
  const known = checkEmail("user@gmail.ru");
  assert.equal(known.status, "typo");
  if (known.status === "typo") {
    assert.equal(known.code, "knownTypo");
    assert.equal(known.domain, "gmail.ru");
    assert.equal(known.suggestion, "gmail.com");
    assert.equal(replaceDomain("user@gmail.ru", known.suggestion), "user@gmail.com");
  }

  const suggested = checkEmail("user@gmaill.com");
  assert.equal(suggested.status, "typo");
  if (suggested.status === "typo") {
    assert.equal(suggested.code, "suggestedTypo");
    assert.equal(suggested.suggestion, "gmail.com");
  }
});
