import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const { additiveSchemaSql } = createRequire(import.meta.url)("../../scripts/lib/schema-safety.cjs") as { additiveSchemaSql:(sql:string)=>{sql:string;preserved:string[];statementCount:number} };
test("deployment accepts additive schema and preserves the custom partial unique index",()=>{
  const result=additiveSchemaSql('-- DropIndex\nDROP INDEX "PartnerClient_one_active_per_org";\n-- CreateTable\nCREATE TABLE "New" ("id" TEXT NOT NULL); ALTER TABLE "New" ADD COLUMN "name" TEXT; ALTER TABLE "New" ADD CONSTRAINT "fk" FOREIGN KEY ("id") REFERENCES "Other"("id") ON DELETE CASCADE ON UPDATE CASCADE; CREATE INDEX "ix" ON "New"("name");');
  assert.equal(result.statementCount,4);assert.deepEqual(result.preserved,["PartnerClient_one_active_per_org"]);assert.ok(!result.sql.includes("DROP"));
});
test("deployment refuses destructive and unrecognized schema changes",()=>{
  for(const sql of ['DROP TABLE "Organization";','DROP INDEX "another";','ALTER TABLE "User" DROP COLUMN "email";','ALTER TABLE "User" ADD COLUMN "x" TEXT, DROP COLUMN "email";','ALTER TABLE "User" ALTER COLUMN "email" TYPE INTEGER;','DELETE FROM "User";','UPDATE "User" SET name=\'x\';','TRUNCATE "User";'])assert.throws(()=>additiveSchemaSql(sql),/non-additive/);
});
