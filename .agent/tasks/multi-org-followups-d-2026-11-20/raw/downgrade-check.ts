/*
 * Series D, item Р1 (safe rollback of series C2) — AC1, end to end against the local DB.
 *
 * 1. An exchange with rooms and positions in two organizations of one account and a company of
 *    another account (approved link): after the exchange room links are `v2:`, position links
 *    `f:v2:` (positions have a restricted field set with the foreign company); a deleted position
 *    leaves a tombstone.
 * 2. Dry run (the library function and the script itself): the planned count, nothing written
 *    (every link of the cabinet identical, update dates too).
 * 3. A cabinet busy with an exchange is skipped with nothing written.
 * 4. `--apply` (the library function): room and position links become version 1 without marks,
 *    and each equals the fingerprint the code before C2 computes for its row (written out here
 *    independently: room {name, kind, sortOrder} + the building's group; position {name}) — so
 *    the code before C2 sees every record unchanged. Tombstones, other entities and the data stay.
 * 5. A second `--apply`: 0 changes.
 * 6. A normal exchange (current code) moves them back to version 2 with 0 created / 0 updated —
 *    to the very fingerprints they had before the rollback.
 * 7. Safety: a row edited after the last exchange keeps its version-2 link (the old code sees the
 *    edit and carries it — not hidden), a link whose row is gone is left alone; the next exchange
 *    carries the edit and tombstones the gone row.
 *
 * Run from the repository root: npx tsx .agent/tasks/multi-org-followups-d-2026-11-20/raw/downgrade-check.ts
 */
import "dotenv/config";

import { spawnSync } from "node:child_process";

import { syncRoomChecklistItems } from "@/lib/cleaning-room-checklist-sync";
import { parseScopeSteps } from "@/lib/cleaning-document";
import { db } from "@/lib/db";
import { downgradeCabinetHashes, listDowngradeCabinets } from "@/lib/directory-exchange/hash-downgrade.server";
import { hashFields, hashTag } from "@/lib/directory-exchange/kinds";
import { createExchangeRequest, decideExchangeRequest } from "@/lib/directory-exchange/requests.server";
import { runDirectoryExchange, withExchangeLock } from "@/lib/directory-exchange/run.server";
import { ensureExchangeCabinet, saveExchangeMembers } from "@/lib/directory-exchange/settings.server";
import { summaryTotals, type ExchangeSummary } from "@/lib/directory-exchange/summary";
import { createStaffMember } from "@/lib/staff-create";
import type { Prisma } from "@prisma/client";

// kinds.ts as it was before C2 (`git show 3e7e07731:src/lib/directory-exchange/kinds.ts`) — the code a revert brings back.
import * as preC2 from "./kinds-pre-c2";

const TAG = `dgchk${Date.now().toString(36)}`;
const DAY = 86_400_000;
const orgIds: string[] = [];
const accountIds: string[] = [];
let failed = 0;
let passed = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
}

/* Письма в dev не уходят, а пишутся в журнал — глушим его. */
console.info = () => undefined;

const PAID = { subscriptionPlan: "standard", subscriptionEnd: new Date(Date.now() + 30 * DAY), planPoints: 10, planCycle: "month" };

async function makeOrg(name: string, accountId: string | null = null) {
  const org = await db.organization.create({ data: { name: `${name} ${TAG}`, type: "restaurant", accountId } });
  orgIds.push(org.id);
  return org;
}

async function makeOwner(orgId: string, label: string) {
  const owner = await db.user.create({
    data: { email: `${TAG}-${label}@example.test`, name: `Владелец ${label}`, passwordHash: "not-a-real-hash", role: "manager", organizationId: orgId },
  });
  const account = await db.account.create({ data: { ownerUserId: owner.id, ...PAID } });
  accountIds.push(account.id);
  await db.organization.update({ where: { id: orgId }, data: { accountId: account.id } });
  await db.organizationMember.create({ data: { userId: owner.id, organizationId: orgId, role: "owner" } });
  return { owner, account, actor: { userId: owner.id, userName: owner.name } };
}

async function join(ownerId: string, orgId: string) {
  await db.organizationMember.create({ data: { userId: ownerId, organizationId: orgId, role: "owner" } });
}

/** JSON with sorted keys: jsonb does not keep the key order. */
function canon(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === "object" && !(item instanceof Date)
        ? Object.fromEntries(Object.keys(item as Record<string, unknown>).sort().map((key) => [key, sort((item as Record<string, unknown>)[key])]))
        : item;
  return JSON.stringify(sort(value));
}
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const totals = (summary: ExchangeSummary | undefined) => summaryTotals(summary ?? { organizations: [], notes: [] });
const of = (summary: ExchangeSummary | undefined, orgId: string) => summary?.organizations.find((o) => o.organizationId === orgId)?.kinds;

async function setJournals(orgId: string, positionId: string, codes: string[]) {
  const templates = await db.journalTemplate.findMany({ where: { code: { in: codes } }, select: { id: true } });
  await db.jobPositionJournalAccess.deleteMany({ where: { jobPositionId: positionId, organizationId: orgId } });
  if (templates.length > 0) {
    await db.jobPositionJournalAccess.createMany({ data: templates.map((t) => ({ organizationId: orgId, jobPositionId: positionId, templateId: t.id })) });
  }
}

/** A room edit as the room card saves it (PATCH /api/settings/rooms/[id]): checklist sync first, then the room. */
async function editRoom(orgId: string, roomId: string, data: Record<string, unknown>) {
  const currentScope = data.currentScope !== undefined ? parseScopeSteps(data.currentScope) : undefined;
  const generalScope = data.generalScope !== undefined ? parseScopeSteps(data.generalScope) : undefined;
  if (currentScope || generalScope) {
    await syncRoomChecklistItems({
      organizationId: orgId,
      roomId,
      currentScope: currentScope?.map((step) => step.label),
      generalScope: generalScope?.map((step) => step.label),
    });
  }
  await db.room.update({
    where: { id: roomId },
    data: { ...(data as Prisma.RoomUpdateInput), ...(currentScope ? { currentScope } : {}), ...(generalScope ? { generalScope } : {}) },
  });
}

const room = (orgId: string, name: string) => db.room.findFirstOrThrow({ where: { name, building: { organizationId: orgId } } });
const position = (orgId: string, name: string) => db.jobPosition.findFirstOrThrow({ where: { organizationId: orgId, name, categoryKey: "staff" } });

/** Rooms, positions, journal access, checklist items and staff of an org, with update dates. */
async function snapshot(orgId: string) {
  const rooms = await db.room.findMany({ where: { building: { organizationId: orgId } }, orderBy: { name: "asc" } });
  const positions = await db.jobPosition.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } });
  const access = await db.jobPositionJournalAccess.findMany({ where: { organizationId: orgId }, orderBy: [{ jobPositionId: "asc" }, { templateId: "asc" }] });
  const items = await db.journalChecklistItem.findMany({ where: { organizationId: orgId }, orderBy: { id: "asc" } });
  const staff = await db.user.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" }, select: { id: true, name: true, phone: true, jobPositionId: true, weeklyDaysOff: true, journalAccessMigrated: true } });
  return canon({ rooms, positions, access, items, staff });
}

/** Every link of the cabinet as stored, update dates included. */
const allLinks = (cabinetId: string) =>
  db.directoryExchangeLink.findMany({
    where: { masterOrganizationId: cabinetId },
    orderBy: { id: "asc" },
    select: { id: true, entity: true, organizationId: true, entityId: true, groupId: true, hash: true, updatedAt: true },
  });
type Link = Awaited<ReturnType<typeof allLinks>>[number];
const versioned = (links: Link[]) => links.filter((link) => (link.entity === "room" || link.entity === "position") && link.entityId);

/** The fields and the parent group of a link's row, read straight from the tables. */
async function rowOf(cabinetId: string, link: Link): Promise<{ fields: Record<string, string | number | null>; parent: string | null } | null> {
  if (link.entity === "room") {
    const row = await db.room.findUnique({ where: { id: link.entityId! }, select: { name: true, kind: true, sortOrder: true, buildingId: true } });
    if (!row) return null;
    const building = await db.directoryExchangeLink.findFirst({
      where: { masterOrganizationId: cabinetId, entity: "building", organizationId: link.organizationId, entityId: row.buildingId },
      select: { groupId: true },
    });
    return { fields: { name: row.name, kind: row.kind, sortOrder: row.sortOrder }, parent: building?.groupId ?? null };
  }
  const row = await db.jobPosition.findUnique({ where: { id: link.entityId! }, select: { name: true } });
  return row ? { fields: { name: row.name }, parent: null } : null;
}

/**
 * The fingerprint the code before C2 computed for the row of a link, written out independently:
 * room {name, kind, sortOrder} + the group of its building in the same cabinet and org; position
 * {name} with no scope mark (no «between accounts» list for positions then).
 */
async function preC2Hash(cabinetId: string, link: Link): Promise<string | null> {
  const row = await rowOf(cabinetId, link);
  return row ? hashFields({ ...row.fields, "#parent": row.parent }) : null;
}

/**
 * What the code before C2 decides about a link (its `exchangeEntity`, 3e7e077): the lists have a
 * company of another account, so the scope is `entityScope(entity, "foreign")`; a link whose
 * `hashScope` is that scope is «current» and compared with `rowHash` of the row as is.
 */
async function preC2Sees(cabinetId: string, link: Link): Promise<"unchanged" | "edited" | "rebase" | "missing"> {
  const row = await rowOf(cabinetId, link);
  if (!row) return "missing";
  const entity = link.entity as "room" | "position";
  const scope = preC2.entityScope(entity, "foreign");
  if (preC2.hashScope(entity, link.hash) !== scope) return "rebase";
  return preC2.rowHash(entity, row.fields, row.parent, scope) === link.hash ? "unchanged" : "edited";
}

/** The script itself, as on the server (dry run unless `--apply` is passed). */
function runScript(args: string[]) {
  const result = spawnSync("npx", ["tsx", "scripts/directory-exchange-hash-downgrade.ts", ...args], { cwd: process.cwd(), encoding: "utf8", timeout: 180_000 });
  return { code: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

async function main() {
  /* ── аккаунт X: организации A и B; компания другого аккаунта F ── */
  const a = await makeOrg("Первая");
  const x = await makeOwner(a.id, "x");
  const b = await makeOrg("Вторая", x.account.id);
  await join(x.owner.id, b.id);

  const cafeA = await db.building.create({ data: { organizationId: a.id, name: "Кафе на Ленина" } });
  const cafeB = await db.building.create({ data: { organizationId: b.id, name: "Кафе на Ленина" } });
  const kitchenA = await db.room.create({ data: { buildingId: cafeA.id, name: "Кухня", kind: "kitchen", sortOrder: 1 } });
  await editRoom(a.id, kitchenA.id, { currentScope: ["Полы", "Столы"], currentDays: 31, detergent: "Хлорамин", requirePhoto: true });
  const storeA = await db.room.create({ data: { buildingId: cafeA.id, name: "Склад сухой", kind: "storage", sortOrder: 2 } });
  await editRoom(a.id, storeA.id, { currentScope: ["Стеллажи"], climateNorms: { temperature: { enabled: true, min: 10, max: 20 }, humidity: { enabled: false, min: null, max: null } } });
  const kitchenB = await db.room.create({ data: { buildingId: cafeB.id, name: "Кухня", kind: "kitchen", sortOrder: 1 } });
  await editRoom(b.id, kitchenB.id, { currentScope: ["Пол"], detergent: "Ника" });

  const cookA = await db.jobPosition.create({ data: { organizationId: a.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  const cashierA = await db.jobPosition.create({ data: { organizationId: a.id, categoryKey: "staff", name: "Кассир", sortOrder: 2 } });
  await db.jobPosition.create({ data: { organizationId: a.id, categoryKey: "staff", name: "Уборщик", sortOrder: 3 } });
  const cookB = await db.jobPosition.create({ data: { organizationId: b.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  await setJournals(a.id, cookA.id, ["hygiene", "cleaning"]);
  await setJournals(a.id, cashierA.id, ["health_check"]);
  await setJournals(b.id, cookB.id, ["hygiene"]);
  await createStaffMember(a.id, { jobPositionId: cookA.id, fullName: "Иванов Иван" });

  const cabinet = await ensureExchangeCabinet(x.owner.id, x.account.id);
  orgIds.push(cabinet.id);
  const code = (await db.organization.findUnique({ where: { id: cabinet.id }, select: { serviceCode: true } }))!.serviceCode!;
  await saveExchangeMembers({
    ownerUserId: x.owner.id,
    ownerName: x.owner.name,
    organizationId: a.id,
    members: [
      { organizationId: a.id, kinds: ["staff", "objects"] },
      { organizationId: b.id, kinds: ["staff", "objects"] },
    ],
  });
  const setup = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("setup: B received rooms and positions", (of(setup, b.id)?.objects.created ?? 0) >= 1 && (of(setup, b.id)?.staff.created ?? 0) >= 2, of(setup, b.id));

  const f = await makeOrg("Компания-F");
  const fo = await makeOwner(f.id, "f");
  const request = await createExchangeRequest({ organizationId: f.id, actor: fo.actor, code, mode: "link", kinds: ["staff", "objects"] });
  const approved = await decideExchangeRequest({
    token: request.token,
    actor: x.actor,
    decision: "approve",
    allowedKinds: ["staff", "objects"],
    organizationIds: [a.id, b.id],
    waitMs: 120_000,
  });
  check("setup: the company of another account F is linked and got the rooms and positions", approved.status === "approved" && Boolean(await room(f.id, "Кухня")) && Boolean(await position(f.id, "Повар")));

  // A tombstone: B deletes «Уборщик», the exchange remembers it.
  await db.jobPosition.delete({ where: { id: (await position(b.id, "Уборщик")).id } });
  await runDirectoryExchange(cabinet.id, { actor: x.actor });
  const settled = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("setup: the exchange is settled (an empty run)", totals(settled).created === 0 && totals(settled).updated === 0, totals(settled));

  const before = await allLinks(cabinet.id);
  const tombstones = before.filter((link) => (link.entity === "room" || link.entity === "position") && !link.entityId);
  const targets = versioned(before);
  check("setup: a position tombstone with a version-2 fingerprint", tombstones.length === 1 && tombstones[0].hash.startsWith("f:v2:"), tombstones);
  const roomTargets = targets.filter((link) => link.entity === "room").length;
  const positionTargets = targets.filter((link) => link.entity === "position").length;
  check(
    "setup: after the exchange room links are v2:, position links f:v2: (restricted set with F)",
    roomTargets === 6 &&
      positionTargets === 8 &&
      targets.filter((link) => link.entity === "room").every((link) => link.hash.startsWith("v2:")) &&
      targets.filter((link) => link.entity === "position").every((link) => link.hash.startsWith("f:v2:")),
    { count: targets.length, hashes: targets.map((link) => `${link.entity}:${link.hash.slice(0, 5)}`) },
  );
  const data = async () => [await snapshot(a.id), await snapshot(b.id), await snapshot(f.id)];
  const dataBefore = await data();

  /* ── пробный прогон ── */
  console.log("--- dry run");
  const listed = await listDowngradeCabinets();
  check("dry run: the cabinet is among the cabinets to roll back", listed.includes(cabinet.id));
  const dry = await downgradeCabinetHashes(cabinet.id);
  check(
    "AC1 dry run (library): planned = every room and position link with a record; the tombstone left",
    dry.status === "planned" && dry.counts.rewrite === targets.length && dry.written === 0 && dry.counts.left.tombstone === 1 && !dry.counts.left.edited,
    dry,
  );
  const script = runScript([`--cabinet=${cabinet.id}`]);
  check(
    "AC1 dry run (script): reports the count and exits 0",
    script.code === 0 && script.out.includes("ПРОБНЫЙ ПРОГОН") && script.out.includes(`переписать ${targets.length} (position ${positionTargets}, room ${roomTargets})`),
    script.out,
  );
  check("AC1 dry run: nothing written — every link of the cabinet identical, update dates too", same(await allLinks(cabinet.id), before));

  /* ── кабинет занят ── */
  const busy = await withExchangeLock(cabinet.id, () => downgradeCabinetHashes(cabinet.id, { apply: true, waitMs: 300 }));
  check("--apply while the cabinet is busy: skipped, nothing written", busy.status === "busy" && same(await allLinks(cabinet.id), before), busy);
  const busyScript = await withExchangeLock(cabinet.id, async () => runScript([`--cabinet=${cabinet.id}`, "--apply"]), { waitMs: 1_000 });
  check("--apply (script) while busy: «ЗАНЯТ», exit code 1, nothing written", busyScript.code === 1 && busyScript.out.includes("ЗАНЯТ") && same(await allLinks(cabinet.id), before), busyScript.out);

  /* ── запись ── */
  console.log("--- apply");
  const applied = await downgradeCabinetHashes(cabinet.id, { apply: true });
  check("AC1 --apply: every planned link written", applied.status === "applied" && applied.written === targets.length && applied.stale === 0, applied);
  const after = await allLinks(cabinet.id);
  const downgraded = versioned(after);
  check(
    "AC1 --apply: room and position links are version 1 without marks",
    downgraded.length === targets.length && downgraded.every((link) => hashTag(link.hash).version === 1 && hashTag(link.hash).scope === "account" && /^[0-9a-f]{28}$/.test(link.hash)),
    downgraded.map((link) => link.hash),
  );
  const mismatched: string[] = [];
  for (const link of downgraded) if ((await preC2Hash(cabinet.id, link)) !== link.hash) mismatched.push(`${link.entity}:${link.organizationId}:${link.entityId}`);
  check("AC1 --apply: each link equals the version-1 fingerprint of its row computed independently", mismatched.length === 0, mismatched);
  const seen: string[] = [];
  for (const link of downgraded) seen.push(await preC2Sees(cabinet.id, link));
  check("AC1 --apply: the code before C2 (kinds.ts of 3e7e077) sees every room and position «unchanged»", seen.length === targets.length && seen.every((item) => item === "unchanged"), seen);
  const seenBefore: string[] = [];
  for (const link of targets) seenBefore.push(await preC2Sees(cabinet.id, link));
  check("control: without the rollback the code before C2 would see every one of them «edited»", seenBefore.every((item) => item === "edited"), seenBefore);
  const untouched = (link: Link) => !downgraded.some((item) => item.id === link.id);
  check(
    "AC1 --apply: the tombstone and the links of other entities are untouched (update dates too)",
    same(after.filter(untouched), before.filter(untouched)) && after.filter(untouched).length === before.length - targets.length,
  );
  check("AC1 --apply: no record of A, B or F changed", same(await data(), dataBefore));

  const again = await downgradeCabinetHashes(cabinet.id, { apply: true });
  check("AC1 second --apply: 0 changes", again.status === "applied" && again.written === 0 && again.counts.rewrite === 0, again);
  const againScript = runScript([`--cabinet=${cabinet.id}`, "--apply"]);
  check("AC1 second --apply (script): «записано 0», exit code 0", againScript.code === 0 && againScript.out.includes("записано 0 из 0"), againScript.out);
  check("AC1 second --apply: links as after the first", same(await allLinks(cabinet.id), after));

  /* ── обычный обмен возвращает версию 2 без правок ── */
  console.log("--- a normal exchange after the rollback (current code)");
  const back = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("normal exchange: 0 created, 0 updated", totals(back).created === 0 && totals(back).updated === 0, totals(back));
  const restored = versioned(await allLinks(cabinet.id));
  check(
    "normal exchange: the links are version 2 again — the very fingerprints they had before the rollback",
    same(
      restored.map((link) => [link.id, link.hash]),
      targets.map((link) => [link.id, link.hash]),
    ),
  );
  check("normal exchange: no record of A, B or F changed", same(await data(), dataBefore));

  /* ── правка после обмена и пропавшая запись ── */
  console.log("--- safety: an edit after the last exchange, a row that is gone");
  await editRoom(a.id, kitchenA.id, { detergent: "Хлорамин Б" });
  const cashierB = await position(b.id, "Кассир");
  await db.jobPosition.delete({ where: { id: cashierB.id } });
  const kitchenLinkA = restored.find((link) => link.entityId === kitchenA.id)!;
  const cashierLinkB = restored.find((link) => link.entityId === cashierB.id)!;
  const safeDry = await downgradeCabinetHashes(cabinet.id);
  check(
    "dry run: the edited room and the gone position are left, the rest planned",
    safeDry.status === "planned" && safeDry.counts.rewrite === targets.length - 2 && safeDry.counts.left.edited === 1 && safeDry.counts.left.missing_row === 1,
    safeDry,
  );
  const safeApply = await downgradeCabinetHashes(cabinet.id, { apply: true });
  const safeLinks = await allLinks(cabinet.id);
  const kitchenAfter = safeLinks.find((link) => link.id === kitchenLinkA.id)!;
  const cashierAfter = safeLinks.find((link) => link.id === cashierLinkB.id)!;
  check("--apply: the rest written", safeApply.status === "applied" && safeApply.written === targets.length - 2, safeApply);
  check("--apply: the edited room keeps its version-2 link", kitchenAfter.hash === kitchenLinkA.hash && kitchenAfter.hash.startsWith("v2:"));
  check(
    "--apply: the code before C2 sees that room as edited — the edit is not hidden; every other room and position «unchanged»",
    (await preC2Hash(cabinet.id, kitchenAfter)) !== kitchenAfter.hash &&
      (await preC2Sees(cabinet.id, kitchenAfter)) === "edited" &&
      (await Promise.all(versioned(safeLinks).filter((link) => link.id !== kitchenAfter.id && link.id !== cashierAfter.id).map((link) => preC2Sees(cabinet.id, link)))).every((item) => item === "unchanged"),
  );
  check("--apply: the link of the gone position is untouched", cashierAfter.hash === cashierLinkB.hash && cashierAfter.entityId === cashierLinkB.entityId);
  const carried = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check(
    "next exchange: A's edit reaches B and F, nothing else is updated",
    (await room(b.id, "Кухня")).detergent === "Хлорамин Б" &&
      (await room(f.id, "Кухня")).detergent === "Хлорамин Б" &&
      of(carried, b.id)?.objects.updated === 1 &&
      of(carried, f.id)?.objects.updated === 1 &&
      totals(carried).updated === 2 &&
      totals(carried).created === 0,
    totals(carried),
  );
  const finalLinks = await allLinks(cabinet.id);
  check(
    "next exchange: the gone position became a tombstone (not created again), every other link is version 2",
    finalLinks.find((link) => link.id === cashierLinkB.id)?.entityId === null &&
      (await db.jobPosition.count({ where: { organizationId: b.id, name: "Кассир" } })) === 0 &&
      versioned(finalLinks).every((link) => hashTag(link.hash).version === 2),
  );
}

async function cleanup() {
  const cabinets = await db.organization.findMany({ where: { accountId: { in: accountIds }, kind: "directory" }, select: { id: true } });
  const ids = [...new Set([...cabinets.map((item) => item.id), ...orgIds])].reverse();
  for (const id of ids) {
    await db.organization.delete({ where: { id } }).catch((error) => {
      if (!String((error as Error).message).includes("not found") && !String((error as Error).message).includes("No record")) console.log(`cleanup: ${id} — ${(error as Error).message.split("\n").pop()}`);
    });
  }
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  const leftUsers = await db.user.count({ where: { email: { contains: TAG } } });
  const leftAccounts = await db.account.count({ where: { id: { in: accountIds } } });
  const leftLinks = await db.directoryExchangeLink.count({ where: { OR: [{ organizationId: { in: orgIds } }, { masterOrganizationId: { in: orgIds } }] } });
  console.log(`cleanup: organizations left ${left}, users left ${leftUsers}, accounts left ${leftAccounts}, links left ${leftLinks}`);
}

main()
  .catch((error) => {
    failed += 1;
    console.error("FAIL script crashed", error);
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup failed", error));
    console.log(`TOTAL: ${passed} PASS, ${failed} FAIL`);
    console.log(failed === 0 ? "RESULT: all checks passed" : `RESULT: ${failed} check(s) failed`);
    await db.$disconnect().catch(() => undefined);
    process.exit(failed === 0 ? 0 : 1);
  });
