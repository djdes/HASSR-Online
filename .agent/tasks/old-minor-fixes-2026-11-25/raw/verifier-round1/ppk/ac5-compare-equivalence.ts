/**
 * Verifier (independent): compareRevisions on the branch vs origin/master's copy
 * against the local DB — same results for every docKey and many requested sides
 * (failures may only differ by the new `code` field, which must match the text).
 * Usage: node --import tsx ac5-compare-equivalence.ts            (equivalence)
 *        NODE_ENV=development node --import tsx ac5-compare-equivalence.ts --queries <docKey> <orgId> <buildingId|null>
 */
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { compareRevisions as newCompare } from "../../../../../../src/lib/ppk/revisions.server";
import { compareRevisions as oldCompare } from "./old-revisions.server";
import { parseRevisionDocKey } from "../../../../../../src/lib/ppk/revisions";

const CODE_BY_TEXT: Record<string, string> = {
  "Документ не найден": "doc_not_found",
  "У документа нет утверждённых редакций": "no_revisions",
  "Редакция не найдена": "revision_not_found",
  "Текущего текста документа нет": "no_current_text",
};

async function equivalence(only?: string) {
  const keys = (await db.ppkRevision.findMany({ distinct: ["organizationId", "docKey"], select: { organizationId: true, docKey: true } }))
    .filter((row) => !only || row.docKey === only);
  let calls = 0; let noCurrent = 0; let okCount = 0; let errCount = 0; const errCodes: Record<string, number> = {};
  const fakeKeys = [
    { organizationId: keys[0]?.organizationId ?? "x", docKey: "text:text-terms@cmwv8ulhe0001cn7dn05z8fvg" }, // a doc without revisions (likely)
    { organizationId: keys[0]?.organizationId ?? "x", docKey: "garbage" },
    { organizationId: keys[0]?.organizationId ?? "x", docKey: "knowledge:doesnotexist000000000000" },
  ];
  for (const { organizationId, docKey } of only ? keys : [...keys, ...fakeKeys]) {
    const parsed = parseRevisionDocKey(docKey);
    let buildingId: string | null = parsed?.buildingId ?? null;
    if (parsed?.ref.kind === "knowledge") {
      const kd = await db.knowledgeDocument.findFirst({ where: { id: parsed.ref.id }, select: { buildingId: true } });
      buildingId = kd?.buildingId ?? null;
    }
    const numbers = (await db.ppkRevision.findMany({ where: { organizationId, docKey }, select: { number: true } })).map((r) => r.number);
    const missing = Math.max(0, ...numbers) + 1000;
    // Many revisions (race test document): pairs over a sample — newest, oldest and a few in between.
    const sample = numbers.length > 10 ? [...new Set([...numbers.slice(0, 4), ...numbers.slice(-3), numbers[Math.floor(numbers.length / 2)]])] : numbers;
    const requests: Array<{ from?: number | null; to?: number | "current" | null }> = [{}, { from: null, to: null }, { to: "current" }];
    for (const n of [...sample, missing]) requests.push({ from: n }, { to: n }, { from: n, to: "current" });
    for (const a of [...sample, missing]) for (const b of [...sample, missing]) requests.push({ from: a, to: b });
    const pointIds: Array<string | null> = [null];
    if (buildingId) pointIds.push(buildingId, "cmwv8ulhe0001cn7dn05z8fvg");
    // Scopes: the doc's own area, the organization level and another point —
    // the last two exercise «no current text» (current side unavailable).
    const scopes = [...new Set([buildingId, null, "cmwv8ulhe0001cn7dn05z8fvg"])];
    for (const scopeBuilding of scopes) for (const pointId of pointIds) {
      for (const requested of requests) {
        const scope = { organizationId, buildingId: scopeBuilding };
        const [oldR, newR] = [await oldCompare(scope, docKey, pointId, requested), await newCompare(scope, docKey, pointId, requested)];
        calls += 1;
        if (!newR.ok) {
          errCount += 1;
          const { code, ...rest } = newR as typeof newR & { code: string };
          errCodes[code] = (errCodes[code] ?? 0) + 1;
          assert.equal(code, CODE_BY_TEXT[rest.error], `code matches text for ${docKey} ${JSON.stringify(requested)}`);
          assert.deepStrictEqual(rest, oldR, `failure differs for ${docKey} ${JSON.stringify(requested)} point=${pointId} scope=${scopeBuilding}`);
        } else {
          okCount += 1;
          assert.deepStrictEqual(newR, oldR, `result differs for ${docKey} ${JSON.stringify(requested)} point=${pointId} scope=${scopeBuilding}`);
          if (!newR.currentAvailable) noCurrent += 1;
        }
      }
    }
    console.log(`docKey ${docKey} (org ${organizationId.slice(0, 8)}…, revisions [${numbers.length > 10 ? `${numbers.length} revisions, sampled ${sample.join(",")}` : numbers.join(",")}]) — equal`);
  }
  console.log(`\nEQUIVALENT: ${calls} calls (${okCount} ok [${noCurrent} without current text], ${errCount} errors by code ${JSON.stringify(errCodes)})`);
}

async function queries(docKey: string, organizationId: string, buildingId: string | null) {
  // Prisma logs SQL to stdout in development; this run prints a marker around each call.
  console.log("=== NEW compareRevisions (default sides) ===");
  await newCompare({ organizationId, buildingId }, docKey, null, {});
  console.log("=== OLD compareRevisions (default sides) ===");
  await oldCompare({ organizationId, buildingId }, docKey, null, {});
  console.log("=== END ===");
}

const args = process.argv.slice(2);
(args[0] === "--queries" ? queries(args[1], args[2], args[3] === "null" ? null : args[3]) : equivalence(args[0] === "--only" ? args[1] : undefined))
  .then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
