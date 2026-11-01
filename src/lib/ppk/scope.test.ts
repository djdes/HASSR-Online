import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ppkDocKindKey,
  ppkDocKindKeys,
  ppkDocKindOf,
  ppkScopeAllowed,
  ppkSingletonKey,
  ppkWhere,
  remapPpkIds,
} from "@/lib/ppk/scope";

/** ППК на точку (владелец 2026-11-01: «ппк на точку»). */
const read = (path: string) => readFileSync(path, "utf8");

test("ключи ППК точки не меняют уникальные индексы БД", () => {
  assert.deepEqual(ppkWhere({ organizationId: "org", buildingId: "a" }), { organizationId: "org", buildingId: "a" });
  assert.deepEqual(ppkWhere({ organizationId: "org", buildingId: null }), { organizationId: "org", buildingId: null });
  assert.equal(ppkSingletonKey("policy", null), "policy");
  assert.equal(ppkSingletonKey("policy", "a"), "policy@a");
  assert.equal(ppkDocKindKey("ppk", null), "ppk");
  assert.equal(ppkDocKindKey("haccp_plan", "a"), "haccp_plan@a");
  assert.deepEqual(ppkDocKindKeys("a"), ["ppk@a", "haccp_plan@a"]);
  assert.equal(ppkDocKindOf("ppk@a"), "ppk");
  assert.equal(ppkDocKindOf("haccp_plan"), "haccp_plan");
  assert.equal(ppkDocKindOf(null), null);
  assert.equal(ppkDocKindOf("other"), null);
});

test("копия ППК точке: ссылки между записями ведут на копии, текст не трогается", () => {
  const ids = new Map([
    ["c-hazard-1", "c-copy-1"],
    ["c-hazard-2", "c-copy-2"],
  ]);
  const data = {
    hazardId: "c-hazard-1",
    title: "Опасность c-hazard-1 в тексте не id",
    nested: [{ id: "c-hazard-2" }, "c-hazard-2", 3, null],
    responsibleId: "user-1",
  };
  assert.deepEqual(remapPpkIds(data, ids), {
    hazardId: "c-copy-1",
    title: "Опасность c-hazard-1 в тексте не id",
    nested: [{ id: "c-copy-2" }, "c-copy-2", 3, null],
    responsibleId: "user-1",
  });
});

test("руководитель точки — только ППК своей точки", () => {
  const head = { user: { pointScope: ["a"] } };
  assert.equal(ppkScopeAllowed(head, { organizationId: "org", buildingId: "a" }), true);
  assert.equal(ppkScopeAllowed(head, { organizationId: "org", buildingId: "b" }), false);
  assert.equal(ppkScopeAllowed(head, { organizationId: "org", buildingId: null }), false);
  const owner = { user: { pointScope: null } };
  assert.equal(ppkScopeAllowed(owner, { organizationId: "org", buildingId: null }), true);
  assert.equal(ppkScopeAllowed(owner, { organizationId: "org", buildingId: "b" }), true);
});

test("область ППК: точка из шапки, первое открытие копирует ППК организации один раз", () => {
  const server = read("src/lib/ppk/scope.server.ts");
  assert.match(server, /buildingId: viewedPointId\(await loadBuildingContext\(session\)\)/);
  assert.match(server, /ppkSeededAt: null \},\s*data: \{ ppkSeededAt: new Date\(\) \}/);
  assert.match(server, /if \(claimed\.count !== 1\) return;/);
  assert.match(server, /singleton: record\.singleton \? ppkSingletonKey\(record\.singleton, buildingId\) : null/);
  // Политика точки получает свою публичную ссылку.
  assert.match(server, /record\.block === "policy"[\s\S]{0,200}token: randomBytes\(16\)/);
  const access = read("src/lib/ppk/access.server.ts");
  assert.match(access, /const scope = await ppkScopeForSession\(auth\.session\);\s*if \(!ppkScopeAllowed\(auth\.session, scope\)\)/);
  assert.match(read("src/lib/production-control-docs.server.ts"), /if \(!ppkScopeAllowed\(auth\.session, scope\)\)/);
});

test("API раздела работают с ППК точки", () => {
  const records = read("src/app/api/production-control/records/route.ts");
  assert.match(records, /where: \{ \.\.\.ppkWhere\(auth\.scope\), block \}/);
  assert.match(records, /buildingId: auth\.scope\.buildingId,/);
  assert.match(records, /ppkSingletonKey\(block, auth\.scope\.buildingId\)/);
  assert.equal(read("src/app/api/production-control/records/[id]/route.ts").match(/where: \{ id, \.\.\.ppkWhere\(auth\.scope\) \}/g)?.length, 2);
  assert.match(read("src/app/api/production-control/documents/route.ts"), /ppkDocKindKey\(kind, auth\.scope\.buildingId\)/);
  assert.match(read("src/app/api/production-control/files/route.ts"), /buildingId: auth\.scope\.buildingId,/);
  assert.match(read("src/app/api/production-control/starter/route.ts"), /buildingId: auth\.scope\.buildingId,/);
  assert.match(read("src/lib/ppk/records.server.ts"), /await ppkStaffWhere\(scope\)/);
  // База знаний по id не отдаёт документы ППК точек.
  for (const path of [
    "src/app/api/knowledge-documents/[id]/file/route.ts",
    "src/app/api/knowledge-documents/[id]/preview/route.ts",
    "src/app/api/knowledge-documents/[id]/route.ts",
  ]) {
    assert.match(read(path), /kind: null, folder: null/, path);
  }
});

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

test("страницы раздела читают ППК точки из шапки", () => {
  for (const path of pages("src/app/(dashboard)/production-control")) {
    const source = read(path);
    if (!/ppkRecord\.|loadPpk|loadTeamMeetings|loadDiagramRecord|loadDocVersions|NormDocumentsBody/.test(source)) continue;
    assert.match(source, /await ppkPageScope\(session\)/, `${path}: нет области ППК`);
    assert.doesNotMatch(source, /where: \{ organizationId, block/, `${path}: запрос ППК без точки`);
    assert.doesNotMatch(source, /loadPpkStaff\(organizationId\)/, `${path}: люди организации вместо точки`);
  }
});

test("проверяющий, напоминания и схема — по точке", () => {
  assert.match(read("src/app/api/inspector/[token]/production-control/[doc]/route.ts"), /ppkScopeForPoint\(organizationId, access\.token\.buildingId\)/);
  assert.match(read("src/app/inspector/[token]/page.tsx"), /ppkScopeForPoint\(orgId, access\.token\.buildingId\)\.then\(loadInspectionNorms\)/);
  const cron = read("src/app/api/cron/ppk-reminders/route.ts");
  assert.match(cron, /const key = `\$\{row\.organizationId\}:\$\{row\.buildingId \?\? ""\}`/);
  assert.match(cron, /"compliance", plans\.buildingId\)/);
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model PpkRecord \{[\s\S]*?buildingId\s+String\?[\s\S]*?onDelete: Cascade/);
  assert.match(schema, /model KnowledgeDocument \{[\s\S]*?buildingId\s+String\?[\s\S]*?onDelete: Cascade/);
  assert.match(schema, /model Building \{[\s\S]*?ppkSeededAt\s+DateTime\?/);
  // Уникальные индексы прежние — `prisma db push` без потери данных.
  assert.match(schema, /@@unique\(\[organizationId, singleton\]\)/);
  assert.match(schema, /@@unique\(\[organizationId, kind\]\)/);
});
