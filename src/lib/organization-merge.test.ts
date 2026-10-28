import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { journalFillSubject, verifyJournalFillToken } from "./journal-fill";
import { mergedJournalFillPath } from "./organization-merge";
import { mintQrFillToken } from "./qr-fill-token";

process.env.EQUIPMENT_QR_TOKEN_SECRET ??= "test-secret-test-secret-1234";

const MERGED = { organizationId: "org-new", buildingId: "point-1" };

function oldCheck(subject: string, orgId: string, code: string) {
  const check = verifyJournalFillToken(mintQrFillToken("journal", subject), orgId, code);
  assert.equal(check.ok, true);
  return check as Extract<typeof check, { ok: true }>;
}

function follow(path: string, code: string) {
  const url = new URL(path, "https://wesetup.ru");
  const [, , orgId, pathCode] = url.pathname.split("/");
  assert.equal(orgId, "org-new");
  return { pathCode, check: verifyJournalFillToken(url.searchParams.get("token") ?? "", orgId, code) };
}

describe("mergedJournalFillPath: старый QR слитой организации", () => {
  it("основной QR журнала ведёт в точку прежней организации", () => {
    const path = mergedJournalFillPath(oldCheck("org-old:hygiene", "org-old", "hygiene"), "hygiene", MERGED);
    const { pathCode, check } = follow(path, "hygiene");
    assert.equal(pathCode, "hygiene");
    assert.equal(check.ok && check.buildingId, "point-1");
    assert.equal(check.ok && check.documentId, null);
  });

  it("QR документа ведёт в тот же документ, срок сохраняется", () => {
    const subject = journalFillSubject("org-old", "finished_product", "doc-9", { validUntil: "2026-10-31" });
    const path = mergedJournalFillPath(oldCheck(subject, "org-old", "finished_product"), "finished_product", MERGED);
    const { check } = follow(path, "finished_product");
    assert.equal(check.ok && check.documentId, "doc-9");
    assert.equal(check.ok && check.validUntil, "2026-10-31");
    assert.equal(check.ok && check.buildingId, null);
  });

  it("QR точки сохраняет свою точку", () => {
    const subject = journalFillSubject("org-old", "hygiene", null, { buildingId: "b-own" });
    const path = mergedJournalFillPath(oldCheck(subject, "org-old", "hygiene"), "hygiene", MERGED);
    const { check } = follow(path, "hygiene");
    assert.equal(check.ok && check.buildingId, "b-own");
  });

  it("QR всех журналов ведёт в хаб точки прежней организации", () => {
    const path = mergedJournalFillPath(oldCheck("org-old:all", "org-old", "all"), "all", MERGED);
    const { pathCode, check } = follow(path, "all");
    assert.equal(pathCode, "all");
    assert.equal(check.ok && check.hub, true);
    assert.equal(check.ok && check.buildingId, "point-1");
  });

  it("хаб точки сохраняет свою точку", () => {
    const subject = journalFillSubject("org-old", "all", null, { buildingId: "b-own" });
    const path = mergedJournalFillPath(oldCheck(subject, "org-old", "all"), "all", MERGED);
    const { check } = follow(path, "all");
    assert.equal(check.ok && check.hub, true);
    assert.equal(check.ok && check.buildingId, "b-own");
  });
});
