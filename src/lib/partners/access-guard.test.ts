import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluatePartnerRequest, type PartnerAccessClaim } from "@/lib/partners/access-guard";

const edit: PartnerAccessClaim = { partnerId: "p1", organizationId: "org1", level: "edit" };

describe("evaluatePartnerRequest", () => {
  it("удаление организации клиента консультанту закрыто и при редактировании", () => {
    for (const method of ["POST", "DELETE"]) {
      const verdict = evaluatePartnerRequest({ method, pathname: "/api/settings/organization/deletion", claim: edit });
      assert.equal(verdict.allow, false, method);
    }
  });

  it("перевод организации клиента в партнёрский кабинет консультанту закрыт", () => {
    const verdict = evaluatePartnerRequest({
      method: "POST",
      pathname: "/api/settings/organization/partner-client",
      claim: edit,
    });
    assert.equal(verdict.allow, false);
  });

  it("обычные изменения при уровне «редактирование» разрешены", () => {
    assert.deepEqual(evaluatePartnerRequest({ method: "POST", pathname: "/api/journals", claim: edit }), { allow: true });
  });
});
