/**
 * Verifier (independent), AC6: «текст утверждённой редакции соответствует её отпечатку».
 * A text document of a test point is edited non-stop (every version unique, so no A-B-A)
 * while approveRevision runs; afterwards every created revision must satisfy
 *   contentHash == sha256("text\n" + title + "\n" + normalizeRevisionText(content)).
 * Runs the branch code (expect: no mismatches, some 409 doc_changed) and origin/master's
 * copy (control: the race window exists, mismatches appear), then a quiet approval.
 * Usage: node --import tsx ac6-approve-race.ts run | cleanup
 */
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { db } from "@/lib/db";
import { approveRevision as newApprove } from "../../../../../../src/lib/ppk/revisions.server";
import { approveRevision as oldApprove } from "./old-revisions.server";
import { normalizeRevisionText } from "../../../../../../src/lib/ppk/revisions";

const ORG = "cmwv7iv6e0000x27drxkm0q2a";
const BUILDING = "cmwv9fd4i000hye7duwz934zr"; // «Клиника e2e 22:22:09» (test point)
const BLOCK = "text-ccp-method";
const DOC_KEY = `text:${BLOCK}@${BUILDING}`;
const SINGLETON = `${BLOCK}@${BUILDING}`;
const scope = { organizationId: ORG, buildingId: BUILDING };
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanup() {
  const revs = await db.ppkRevision.deleteMany({ where: { organizationId: ORG, docKey: DOC_KEY } });
  const recs = await db.ppkRecord.deleteMany({ where: { organizationId: ORG, singleton: SINGLETON } });
  console.log(`cleanup: removed ${revs.count} revisions and ${recs.count} records for ${DOC_KEY}`);
}

async function audit(label: string, sinceNumber: number) {
  const rows = await db.ppkRevision.findMany({
    where: { organizationId: ORG, docKey: DOC_KEY, number: { gt: sinceNumber } },
    orderBy: { number: "asc" },
    select: { number: true, title: true, contentHash: true, content: true },
  });
  let mismatched = 0; let withoutText = 0;
  for (const row of rows) {
    if (row.content === null) { withoutText += 1; continue; }
    const expected = sha256(`text\n${row.title}\n${normalizeRevisionText(row.content)}`);
    if (expected !== row.contentHash) mismatched += 1;
  }
  console.log(`${label}: created revisions=${rows.length}, text≠fingerprint=${mismatched}, without text=${withoutText}`);
  return { created: rows.length, mismatched, withoutText };
}

async function phase(label: string, approve: typeof newApprove, attempts: number) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const before = (await db.ppkRevision.aggregate({ where: { organizationId: ORG }, _max: { number: true } }))._max.number ?? 0;
  let stop = false; let version = 0;
  const flipper = (async () => {
    while (!stop) {
      version += 1;
      await client.query(`update "PpkRecord" set data=$2::jsonb, "updatedAt"=now() where "organizationId"=$1 and singleton=$3`,
        [ORG, JSON.stringify({ text: `${label} версия ${version}: метод определения ККТ — дерево принятия решений, шаг ${version}.` }), SINGLETON]);
      await sleep(Math.floor(Math.random() * 6));
    }
  })();
  const outcomes: Record<string, number> = {};
  for (let i = 0; i < attempts; i += 1) {
    const result = await approve(scope, { id: "verifier", name: "Verifier" }, DOC_KEY);
    const key = result.ok ? (result.created ? "created" : "same") : `${result.status} ${(result as { code?: string }).code ?? result.error}`;
    outcomes[key] = (outcomes[key] ?? 0) + 1;
    await sleep(Math.floor(Math.random() * 4));
  }
  stop = true; await flipper; await client.end();
  console.log(`${label}: ${attempts} approvals during ${version} edits → ${JSON.stringify(outcomes)}`);
  return { outcomes, ...(await audit(label, before)) };
}

async function run() {
  const existing = await db.ppkRecord.count({ where: { organizationId: ORG, singleton: SINGLETON } });
  const revisions = await db.ppkRevision.count({ where: { organizationId: ORG, docKey: DOC_KEY } });
  if (existing || revisions) throw new Error(`precondition: ${DOC_KEY} already has ${existing} records / ${revisions} revisions`);
  const maxBefore = (await db.ppkRevision.aggregate({ where: { organizationId: ORG }, _max: { number: true } }))._max.number;
  console.log(`org max revision number before: ${maxBefore}`);
  await db.ppkRecord.create({
    data: { id: `cver${randomBytes(10).toString("hex")}`, organizationId: ORG, block: BLOCK, data: { text: "Начальный текст метода ККТ." }, singleton: SINGLETON, buildingId: BUILDING },
  });
  const branch = await phase("BRANCH approveRevision", newApprove, 60);
  const master = await phase("origin/master approveRevision (control)", oldApprove, 60);
  // Quiet: no edits — a normal approval passes, a repeat is «same».
  await db.ppkRecord.updateMany({ where: { organizationId: ORG, singleton: SINGLETON }, data: { data: { text: "Спокойная версия: ККТ определяются по дереву решений." } } });
  const first = await newApprove(scope, { id: "verifier", name: "Verifier" }, DOC_KEY);
  const second = await newApprove(scope, { id: "verifier", name: "Verifier" }, DOC_KEY);
  const latest = await db.ppkRevision.findFirst({ where: { organizationId: ORG, docKey: DOC_KEY }, orderBy: { number: "desc" }, select: { content: true } });
  console.log(`QUIET branch approval: first=${first.ok ? (first.created ? "created" : "same") : first.status} second=${second.ok ? (second.created ? "created" : "same") : second.status} content="${latest?.content}"`);
  const verdict = branch.mismatched === 0 && (branch.outcomes["409 doc_changed"] ?? 0) > 0 && branch.created > 0
    && first.ok && first.created && second.ok && !second.created && latest?.content === "Спокойная версия: ККТ определяются по дереву решений.";
  console.log(`\nAC6 race: branch mismatches=${branch.mismatched} (409 doc_changed=${branch.outcomes["409 doc_changed"] ?? 0}, created=${branch.created}); control mismatches=${master.mismatched} → ${verdict ? "PASS" : "FAIL"}`);
}

const mode = process.argv[2];
(mode === "cleanup" ? cleanup() : run()).then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
