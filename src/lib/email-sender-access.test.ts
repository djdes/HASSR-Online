import assert from "node:assert/strict";
import test from "node:test";
import { permittedEmailSenderIds } from "./email-sender-access";

test("only explicit actor grants broaden mailbox access; malformed settings fail closed", () => {
  for (const raw of [null, "", "{", "[]", "null", '"admin"', '{"other":["admin"]}', '{"actor":"admin"}']) {
    assert.deepEqual(permittedEmailSenderIds("actor", raw), ["actor"]);
  }
  assert.deepEqual(permittedEmailSenderIds("actor", JSON.stringify({ actor: ["admin", "actor", "admin", null, {}, 1, "", "x".repeat(101)] })), ["actor", "admin"]);
  assert.deepEqual(permittedEmailSenderIds("toString", "{}"), ["toString"]);
});
