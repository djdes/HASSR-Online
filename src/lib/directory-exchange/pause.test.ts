import assert from "node:assert/strict";
import test from "node:test";

import { EXCHANGE_PAUSE_ENV, EXCHANGE_PAUSED_MESSAGE, isExchangePaused } from "@/lib/directory-exchange/pause";

test("Р1: the exchange pause is on only for an explicit yes in DIRECTORY_EXCHANGE_PAUSED", () => {
  assert.equal(EXCHANGE_PAUSE_ENV, "DIRECTORY_EXCHANGE_PAUSED");
  for (const value of ["1", "true", "TRUE", " yes ", "on"]) assert.equal(isExchangePaused({ [EXCHANGE_PAUSE_ENV]: value }), true, value);
  for (const value of [undefined, "", "0", "false", "no", "off", "paused"]) assert.equal(isExchangePaused({ [EXCHANGE_PAUSE_ENV]: value }), false, String(value));
  assert.equal(isExchangePaused({}), false);
  assert.match(EXCHANGE_PAUSED_MESSAGE, /^Обмен справочниками временно приостановлен/);
});
