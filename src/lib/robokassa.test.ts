import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, describe, it } from "node:test";

import { verifyResultSignature } from "./robokassa";

const md5 = (value: string) => createHash("md5").update(value, "utf8").digest("hex");
const saved = { live: process.env.ROBOKASSA_PASSWORD2, test: process.env.ROBOKASSA_TEST_PASSWORD2 };

afterEach(() => {
  for (const [key, value] of [["ROBOKASSA_PASSWORD2", saved.live], ["ROBOKASSA_TEST_PASSWORD2", saved.test]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("подпись уведомления Робокассы (ResultURL)", () => {
  it("верная подпись с Паролем #2 принимается, чужая — нет", () => {
    process.env.ROBOKASSA_PASSWORD2 = "secret-two";
    const signature = md5("3000.00:42:secret-two");
    assert.equal(verifyResultSignature({ outSum: "3000.00", invId: "42", signature, isTest: false }), true);
    assert.equal(verifyResultSignature({ outSum: "3000.00", invId: "42", signature: md5("3000.00:42:other"), isTest: false }), false);
  });

  it("без Пароля #2 уведомление не принимается — даже с подписью от пустого пароля", () => {
    delete process.env.ROBOKASSA_PASSWORD2;
    delete process.env.ROBOKASSA_TEST_PASSWORD2;
    for (const isTest of [false, true]) {
      assert.equal(verifyResultSignature({ outSum: "3000.00", invId: "42", signature: md5("3000.00:42:"), isTest }), false);
    }
  });
});
