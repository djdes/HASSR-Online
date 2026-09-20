import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { claimReasonRu } from "@/app/mini/_lib/claim-errors";

describe("claimReasonRu", () => {
  it("переводит коды причин", () => {
    assert.match(claimReasonRu("not_owner"), /другой сотрудник/);
    assert.match(claimReasonRu("not_active"), /уже закрыта/);
    assert.match(claimReasonRu("validation_failed"), /поля/);
  });

  it("падает на HTTP-статус, когда причины нет", () => {
    assert.match(claimReasonRu(null, 401), /войдите заново/);
    assert.match(claimReasonRu(undefined, 403), /Нет доступа/);
  });

  it("никогда не возвращает английский код", () => {
    for (const r of ["not_owner", "not_found", "wat", null]) {
      assert.doesNotMatch(claimReasonRu(r, 500), /[a-z]+_[a-z]+/);
    }
  });
});
