// Moved here from .agent/tasks/multi-org-followups-c2-2026-11-20/raw/versioning-check.ts (series C2); that file is now a wrapper that runs this one, and its logs stay as that series' evidence.
/*
 * Series C2, items Р8.0 (fingerprint versions), Р8.2 (positions with journals) and Р8.3 (rooms
 * with cleaning schedules and climate norms) — AC1, AC3, AC4 — end to end against the local DB.
 *
 * 1. The state production has at deploy time: organizations already linked, room and position
 *    links hold version-1 fingerprints (computed here independently: the v1 field lists and
 *    `hashFields`), and the rooms and positions differ in the NEW fields (different schedules,
 *    climate norms, journal access). The first exchange after the deploy changes nothing: 0
 *    created, 0 updated, every org's rooms, positions, journal access and checklist items are
 *    as they were, the links moved to version 2.
 * 2. After that an edit reaches the others: a room schedule (checklist items of the recipient's
 *    room rebuilt, cleaners not copied), a climate norm, position journals (a new employee on
 *    that position at the recipient gets the same journals — by the exchange and by hand); an
 *    empty journal list of the source does not erase the recipient's list.
 * 3. A company of another account (paid, approved link): gets rooms with schedules and checklist
 *    items, positions by name only — no journal access; the owner's room edit reaches it, a
 *    journal edit does not. Version-1 links in the foreign scope also move without any update.
 * 4. A one-off transfer carries schedules and journals and is still undone completely (its own
 *    checklist items and journal rows are not «use»); a transfer recorded before the deploy
 *    (version-1 fingerprints) is not mistaken for «edited».
 */
import "./env";

import { Prisma } from "@prisma/client";

import { syncRoomChecklistItems } from "@/lib/cleaning-room-checklist-sync";
import { parseScopeSteps } from "@/lib/cleaning-document";
import { db } from "@/lib/db";
import { hashFields } from "@/lib/directory-exchange/kinds";
import { createExchangeRequest, decideExchangeRequest } from "@/lib/directory-exchange/requests.server";
import { runDirectoryExchange, transferOnce } from "@/lib/directory-exchange/run.server";
import { ensureExchangeCabinet, saveExchangeMembers } from "@/lib/directory-exchange/settings.server";
import { summaryTotals, type ExchangeSummary } from "@/lib/directory-exchange/summary";
import { undoTransfer } from "@/lib/directory-exchange/transfer-undo.server";
import { createStaffMember } from "@/lib/staff-create";

const TAG = `vchk${Date.now().toString(36)}`;
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
      : item && typeof item === "object"
        ? Object.fromEntries(Object.keys(item as Record<string, unknown>).sort().map((key) => [key, sort((item as Record<string, unknown>)[key])]))
        : item;
  return JSON.stringify(sort(value));
}
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const totals = (summary: ExchangeSummary | undefined) => summaryTotals(summary ?? { organizations: [], notes: [] });
const of = (summary: ExchangeSummary | undefined, orgId: string) => summary?.organizations.find((o) => o.organizationId === orgId)?.kinds;

const SCHEDULE_SELECT = {
  currentScope: true,
  generalScope: true,
  currentDays: true,
  generalDays: true,
  currentScheduleType: true,
  generalScheduleType: true,
  currentMonthDays: true,
  generalMonthDays: true,
  detergent: true,
  requirePhoto: true,
  climateNorms: true,
} as const;

/** A room's schedule and norms — what the exchange carries (Р8.3). */
async function schedule(roomId: string) {
  return db.room.findUniqueOrThrow({ where: { id: roomId }, select: SCHEDULE_SELECT });
}
const room = (orgId: string, name: string) => db.room.findFirstOrThrow({ where: { name, building: { organizationId: orgId } } });
const position = (orgId: string, name: string) => db.jobPosition.findFirstOrThrow({ where: { organizationId: orgId, name, categoryKey: "staff" } });
async function journalsOf(positionId: string): Promise<string[]> {
  const rows = await db.jobPositionJournalAccess.findMany({ where: { jobPositionId: positionId }, select: { template: { select: { code: true } } } });
  return rows.map((row) => row.template.code).sort();
}
async function setJournals(orgId: string, positionId: string, codes: string[]) {
  // As PUT /api/settings/positions/[id]/journals: delete, then create.
  const templates = await db.journalTemplate.findMany({ where: { code: { in: codes } }, select: { id: true } });
  await db.jobPositionJournalAccess.deleteMany({ where: { jobPositionId: positionId, organizationId: orgId } });
  if (templates.length > 0) {
    await db.jobPositionJournalAccess.createMany({ data: templates.map((t) => ({ organizationId: orgId, jobPositionId: positionId, templateId: t.id })) });
  }
}
async function userJournals(userId: string): Promise<string[]> {
  return (await db.userJournalAccess.findMany({ where: { userId }, select: { templateCode: true } })).map((row) => row.templateCode).sort();
}
/** Active checklist items of a room: category and label in order. */
async function checklist(orgId: string, roomId: string) {
  const items = await db.journalChecklistItem.findMany({
    where: { organizationId: orgId, roomId, journalCode: "cleaning", archivedAt: null },
    orderBy: [{ sortOrder: "asc" }],
    select: { id: true, category: true, label: true },
  });
  return items;
}
const labels = (items: Array<{ category: string | null; label: string }>) => items.map((item) => `${item.category}:${item.label}`);

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
    data: {
      ...(data as Prisma.RoomUpdateInput),
      ...(currentScope ? { currentScope } : {}),
      ...(generalScope ? { generalScope } : {}),
    },
  });
}

/** Everything the exchange may touch in rooms and positions of an org, with update dates. */
async function snapshot(orgId: string) {
  const rooms = await db.room.findMany({
    where: { building: { organizationId: orgId } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, kind: true, sortOrder: true, ...SCHEDULE_SELECT, cleanerUserIds: true, updatedAt: true },
  });
  const positions = await db.jobPosition.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" }, select: { id: true, name: true, updatedAt: true } });
  const access = await db.jobPositionJournalAccess.findMany({
    where: { organizationId: orgId },
    orderBy: [{ jobPositionId: "asc" }, { templateId: "asc" }],
    select: { id: true, jobPositionId: true, templateId: true },
  });
  const items = await db.journalChecklistItem.findMany({
    where: { organizationId: orgId },
    orderBy: { id: "asc" },
    select: { id: true, roomId: true, label: true, category: true, archivedAt: true },
  });
  const staff = await db.user.findMany({
    where: { organizationId: orgId, passwordHash: "" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true, weeklyDaysOff: true, jobPositionId: true, positionTitle: true, journalAccessMigrated: true, journalAccess: { select: { templateCode: true } } },
  });
  return canon({ rooms, positions, access, items, staff });
}

/** Room and position links of the cabinet with an entity: their fingerprints. */
const versionedLinks = (cabinetId: string) =>
  db.directoryExchangeLink.findMany({
    where: { masterOrganizationId: cabinetId, entity: { in: ["room", "position"] }, entityId: { not: null } },
    select: { id: true, entity: true, organizationId: true, entityId: true, hash: true, groupId: true },
  });

/**
 * Rewrite room and position links to the form the exchange wrote before versions existed —
 * computed independently from the version-1 field lists: room {name, kind, sortOrder} + the
 * building's group; position {name}.
 */
async function rewriteToVersion1(cabinetId: string, orgFilter?: string[]) {
  const links = await versionedLinks(cabinetId);
  const buildingLinks = await db.directoryExchangeLink.findMany({
    where: { masterOrganizationId: cabinetId, entity: "building", entityId: { not: null } },
    select: { organizationId: true, entityId: true, groupId: true },
  });
  const buildingGroup = new Map(buildingLinks.map((link) => [`${link.organizationId}|${link.entityId}`, link.groupId]));
  let count = 0;
  for (const link of links) {
    if (orgFilter && !orgFilter.includes(link.organizationId)) continue;
    let hash: string;
    if (link.entity === "room") {
      const row = await db.room.findUniqueOrThrow({ where: { id: link.entityId! }, select: { name: true, kind: true, sortOrder: true, buildingId: true } });
      const parent = buildingGroup.get(`${link.organizationId}|${row.buildingId}`) ?? null;
      hash = hashFields({ name: row.name, kind: row.kind, sortOrder: row.sortOrder, "#parent": parent });
    } else {
      const row = await db.jobPosition.findUniqueOrThrow({ where: { id: link.entityId! }, select: { name: true } });
      hash = hashFields({ name: row.name, "#parent": null });
    }
    await db.directoryExchangeLink.update({ where: { id: link.id }, data: { hash } });
    count += 1;
  }
  return count;
}

const KITCHEN_A = {
  currentScope: ["Полы", "Столы"],
  generalScope: [{ label: "Окна", requirePhoto: true }],
  currentDays: 31,
  generalDays: 0,
  generalScheduleType: "monthly",
  generalMonthDays: ["15", "1"],
  detergent: "Хлорамин",
  requirePhoto: true,
  climateNorms: { temperature: { enabled: true, min: 18, max: 22 }, humidity: { enabled: false, min: null, max: null } },
};
const KITCHEN_B = {
  currentScope: ["Пол"],
  generalScope: [],
  currentDays: 127,
  detergent: "Ника",
};
const STORE_A = {
  currentScope: ["Стеллажи"],
  currentDays: 1,
  climateNorms: { temperature: { enabled: true, min: 10, max: 20 }, humidity: { enabled: true, min: 50, max: 70 } },
};

async function main() {
  /* ── аккаунт X: организации A и B, у них одно и то же, но графики и журналы разные ── */
  const a = await makeOrg("Первая");
  const x = await makeOwner(a.id, "x");
  const b = await makeOrg("Вторая", x.account.id);
  await join(x.owner.id, b.id);

  const cafeA = await db.building.create({ data: { organizationId: a.id, name: "Кафе на Ленина" } });
  const cafeB = await db.building.create({ data: { organizationId: b.id, name: "Кафе на Ленина" } });
  const kitchenA = await db.room.create({ data: { buildingId: cafeA.id, name: "Кухня", kind: "kitchen", sortOrder: 1, cleanerUserIds: [x.owner.id] } });
  await editRoom(a.id, kitchenA.id, KITCHEN_A);
  const storeA = await db.room.create({ data: { buildingId: cafeA.id, name: "Склад сухой", kind: "storage", sortOrder: 2 } });
  await editRoom(a.id, storeA.id, STORE_A);
  const kitchenB = await db.room.create({ data: { buildingId: cafeB.id, name: "Кухня", kind: "kitchen", sortOrder: 1 } });
  await editRoom(b.id, kitchenB.id, KITCHEN_B);

  const cookA = await db.jobPosition.create({ data: { organizationId: a.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  const cashierA = await db.jobPosition.create({ data: { organizationId: a.id, categoryKey: "staff", name: "Кассир", sortOrder: 2 } });
  const washerA = await db.jobPosition.create({ data: { organizationId: a.id, categoryKey: "staff", name: "Мойщик", sortOrder: 3 } });
  const cookB = await db.jobPosition.create({ data: { organizationId: b.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  const washerB = await db.jobPosition.create({ data: { organizationId: b.id, categoryKey: "staff", name: "Мойщик", sortOrder: 2 } });
  await setJournals(a.id, cookA.id, ["hygiene", "cleaning"]);
  await setJournals(a.id, cashierA.id, ["health_check"]);
  await setJournals(b.id, cookB.id, ["hygiene"]);
  await setJournals(b.id, washerB.id, ["cleaning"]);
  await createStaffMember(a.id, { jobPositionId: cookA.id, fullName: "Иванов Иван" });
  void washerA;

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
  check("setup: B received the room, the positions and the employee A has", (of(setup, b.id)?.objects.created ?? 0) >= 1 && (of(setup, b.id)?.staff.created ?? 0) >= 2, of(setup, b.id));

  /* ── состояние на момент выката: связи версии 1, записи B — как их завёл прежний обмен ── */
  console.log("--- the state at deploy time: version-1 links");
  const storeB = await room(b.id, "Склад сухой");
  // The old exchange created rooms with default schedules and positions without journals.
  await db.room.update({
    where: { id: storeB.id },
    data: {
      currentScope: [],
      generalScope: [],
      currentDays: 127,
      generalDays: 0,
      currentScheduleType: "weekly",
      generalScheduleType: "weekly",
      currentMonthDays: [],
      generalMonthDays: [],
      detergent: "",
      requirePhoto: false,
      climateNorms: Prisma.DbNull,
    },
  });
  await db.journalChecklistItem.deleteMany({ where: { organizationId: b.id, roomId: storeB.id } });
  const cashierB = await position(b.id, "Кассир");
  await setJournals(b.id, cashierB.id, []);
  const rewritten = await rewriteToVersion1(cabinet.id);
  check("setup: room and position links rewritten to version-1 fingerprints", rewritten === 10, rewritten);
  check(
    "setup: rooms and positions really differ between A and B in the new fields",
    !same(await schedule(kitchenA.id), await schedule(kitchenB.id)) &&
      !same(await schedule(storeA.id), await schedule(storeB.id)) &&
      !same(await journalsOf(cookA.id), await journalsOf(cookB.id)) &&
      !same(await journalsOf(cashierA.id), await journalsOf(cashierB.id)),
  );

  const beforeA = await snapshot(a.id);
  const beforeB = await snapshot(b.id);
  const first = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("AC1: the first exchange after the deploy creates and updates nothing", totals(first).created === 0 && totals(first).updated === 0, totals(first));
  check("AC1: A's rooms, schedules, positions, journal access, checklist items and staff are unchanged (update dates too)", (await snapshot(a.id)) === beforeA);
  check("AC1: B's rooms, schedules, positions, journal access, checklist items and staff are unchanged (update dates too)", (await snapshot(b.id)) === beforeB);
  const moved = await versionedLinks(cabinet.id);
  check("AC1: every room and position link moved to version 2", moved.length === 10 && moved.every((link) => link.hash.startsWith("v2:")), moved.map((link) => `${link.entity}:${link.hash.slice(0, 4)}`));
  const idle = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  const still = await versionedLinks(cabinet.id);
  check("AC1: the next run is empty and leaves the links as they are", totals(idle).created === 0 && totals(idle).updated === 0 && same(still, moved), totals(idle));

  /* ── после выката правка доходит ── */
  console.log("--- edits after the deploy reach the other organization");
  const itemsA0 = await checklist(a.id, kitchenA.id);
  await editRoom(b.id, kitchenB.id, {
    currentScope: ["Пол", "Плинтус"],
    generalScope: [{ label: "Потолок", requirePhoto: false }],
    currentDays: 63,
    generalDays: 64,
    generalScheduleType: "weekly",
    generalMonthDays: [],
    detergent: "Ника-2",
    requirePhoto: false,
    climateNorms: { temperature: { enabled: true, min: 16, max: 20 }, humidity: { enabled: true, min: 40, max: 60 } },
  });
  const roomEdit = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("AC4: B's room edit is one update in A", of(roomEdit, a.id)?.objects.updated === 1 && totals(roomEdit).updated === 1, of(roomEdit, a.id));
  check("AC4: A's kitchen has B's schedules, detergent, photo rule and climate norms", same(await schedule(kitchenA.id), await schedule(kitchenB.id)), {
    a: await schedule(kitchenA.id),
    b: await schedule(kitchenB.id),
  });
  const itemsA1 = await checklist(a.id, kitchenA.id);
  check(
    "AC4: A's checklist items of the kitchen were rebuilt from the new schedule",
    same(labels(itemsA1), ["current:Пол", "current:Плинтус", "general:Потолок"]) && itemsA1.every((item) => !itemsA0.some((old) => old.id === item.id)),
    labels(itemsA1),
  );
  check("AC4: people are not copied — A's kitchen keeps its own cleaner, B's has none", same((await room(a.id, "Кухня")).cleanerUserIds, [x.owner.id]) && (await room(b.id, "Кухня")).cleanerUserIds.length === 0);

  const itemsB0 = await checklist(b.id, kitchenB.id);
  await editRoom(a.id, kitchenA.id, { climateNorms: { temperature: { enabled: true, min: 15, max: 19 }, humidity: { enabled: true, min: 40, max: 60 } } });
  const climateEdit = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("AC4: A's climate norm reaches B", of(climateEdit, b.id)?.objects.updated === 1 && same((await schedule(kitchenB.id)).climateNorms, (await schedule(kitchenA.id)).climateNorms), (await schedule(kitchenB.id)).climateNorms);
  check("AC4: a norm-only edit does not rebuild B's checklist items", same(await checklist(b.id, kitchenB.id), itemsB0));

  await setJournals(a.id, cookA.id, ["hygiene", "cleaning", "med_books"]);
  const journalEdit = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("AC3: A's position journals reach B's position", same(await journalsOf(cookB.id), ["cleaning", "hygiene", "med_books"]) && of(journalEdit, b.id)?.staff.updated === 1, {
    b: await journalsOf(cookB.id),
    kinds: of(journalEdit, b.id),
  });
  const hired = await createStaffMember(a.id, { jobPositionId: cookA.id, fullName: "Петрова Анна" });
  check("setup: a new employee on «Повар» in A", hired.ok);
  await runDirectoryExchange(cabinet.id, { actor: x.actor });
  const petrovaB = await db.user.findFirst({ where: { organizationId: b.id, name: "Петрова Анна" } });
  check(
    "AC3: the employee created by the exchange in B gets the position's journals",
    Boolean(petrovaB) && petrovaB!.journalAccessMigrated === true && same(await userJournals(petrovaB!.id), ["cleaning", "hygiene", "med_books"]),
    petrovaB ? await userJournals(petrovaB.id) : null,
  );
  const handB = await createStaffMember(b.id, { jobPositionId: cookB.id, fullName: "Сидоров Пётр" });
  check("AC3: an employee added by hand in B on that position gets the same journals", handB.ok && same(await userJournals(handB.ok ? handB.user.id : ""), ["cleaning", "hygiene", "med_books"]));

  // A's «Мойщик» has no journals, B's has: A's rename must not erase B's list.
  await db.jobPosition.update({ where: { id: washerA.id }, data: { name: "Мойщик посуды" } });
  await runDirectoryExchange(cabinet.id, { actor: x.actor });
  const washerBAfter = await db.jobPosition.findUniqueOrThrow({ where: { id: washerB.id } });
  check("Р8.2: a rename from a position without journals renames B's position and keeps its journals", washerBAfter.name === "Мойщик посуды" && same(await journalsOf(washerB.id), ["cleaning"]), {
    name: washerBAfter.name,
    journals: await journalsOf(washerB.id),
  });
  const quiet = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("after the edits: an empty run", totals(quiet).created === 0 && totals(quiet).updated === 0, totals(quiet));

  /* ── компания другого аккаунта ── */
  console.log("--- a company of another account");
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
  check("F is linked", approved.status === "approved");
  const kitchenF = await room(f.id, "Кухня");
  check("AC4 (foreign): F's kitchen came with the schedules and climate norms", same(await schedule(kitchenF.id), await schedule(kitchenA.id)), await schedule(kitchenF.id));
  check("AC4 (foreign): F's kitchen has checklist items from the schedule", same(labels(await checklist(f.id, kitchenF.id)), ["current:Пол", "current:Плинтус", "general:Потолок"]), labels(await checklist(f.id, kitchenF.id)));
  check("AC4 (foreign): no people in F's room", kitchenF.cleanerUserIds.length === 0 && kitchenF.verifierUserIds.length === 0 && kitchenF.fillerUserIds.length === 0);
  const cookF = await position(f.id, "Повар");
  check("AC3 (foreign): F's positions have no journal access", (await db.jobPositionJournalAccess.count({ where: { organizationId: f.id } })) === 0 && Boolean(cookF));
  const ivanovF = await db.user.findFirst({ where: { organizationId: f.id, name: "Иванов Иван" } });
  check("AC3 (foreign): F's employees got no journals from the owner's positions", Boolean(ivanovF) && ivanovF!.journalAccessMigrated === false && (await userJournals(ivanovF!.id)).length === 0);
  const foreignLinks = await versionedLinks(cabinet.id);
  check(
    "Р8.0 (foreign): position links are restricted version 2 (f:v2:), room links version 2",
    foreignLinks.filter((link) => link.entity === "position").every((link) => link.hash.startsWith("f:v2:")) &&
      foreignLinks.filter((link) => link.entity === "room").every((link) => link.hash.startsWith("v2:")),
    foreignLinks.map((link) => `${link.entity}:${link.hash.slice(0, 5)}`),
  );

  await editRoom(a.id, kitchenA.id, { detergent: "Хлорамин Б", generalScope: ["Потолок", "Стены"] });
  const ownerEdit = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("AC4 (foreign): the owner's room edit reaches F and B", same(await schedule(kitchenF.id), await schedule(kitchenA.id)) && same(await schedule(kitchenB.id), await schedule(kitchenA.id)) && of(ownerEdit, f.id)?.objects.updated === 1);
  check("AC4 (foreign): F's general checklist items rebuilt", same(labels(await checklist(f.id, kitchenF.id)), ["current:Пол", "current:Плинтус", "general:Потолок", "general:Стены"]), labels(await checklist(f.id, kitchenF.id)));
  const cookBJournals = await journalsOf(cookB.id);
  await setJournals(a.id, cookA.id, ["hygiene", "cleaning", "med_books", "pest_control"]);
  const foreignJournals = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("AC3 (foreign): a journal edit is not passed to F", (await db.jobPositionJournalAccess.count({ where: { organizationId: f.id } })) === 0 && totals(foreignJournals).updated === 0, totals(foreignJournals));
  check("Р5: while another company shares «Сотрудники», journals are not exchanged at all (like phones)", same(await journalsOf(cookB.id), cookBJournals));

  // Version-1 links with a foreign member: positions were one field set before versions.
  const snapshotsF = [await snapshot(a.id), await snapshot(b.id), await snapshot(f.id)];
  const rewrittenF = await rewriteToVersion1(cabinet.id);
  const foreignFirst = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("AC1 (foreign): version-1 links with a company of another account — 0 created, 0 updated", rewrittenF >= 15 && totals(foreignFirst).created === 0 && totals(foreignFirst).updated === 0, { rewrittenF, totals: totals(foreignFirst) });
  check("AC1 (foreign): data of A, B and F unchanged", same([await snapshot(a.id), await snapshot(b.id), await snapshot(f.id)], snapshotsF));
  const foreignMoved = await versionedLinks(cabinet.id);
  check(
    "AC1 (foreign): position links moved to f:v2:, room links to v2:",
    foreignMoved.filter((link) => link.entity === "position").every((link) => link.hash.startsWith("f:v2:")) &&
      foreignMoved.filter((link) => link.entity === "room").every((link) => link.hash.startsWith("v2:")),
    foreignMoved.map((link) => `${link.entity}:${link.hash.slice(0, 5)}`),
  );

  /* ── разовый перенос с отменой ── */
  console.log("--- a one-off transfer and its undo");
  const c = await makeOrg("Третья", x.account.id);
  await join(x.owner.id, c.id);
  await transferOnce({ fromOrganizationId: a.id, toOrganizationId: c.id, selection: { objects: "all", staff: "all" }, actor: x.actor });
  const kitchenC = await room(c.id, "Кухня");
  check("transfer: C's kitchen came with A's schedule and norms", same(await schedule(kitchenC.id), await schedule(kitchenA.id)));
  check("transfer: C's kitchen has checklist items", (await checklist(c.id, kitchenC.id)).length === 4);
  check("transfer: C's «Повар» came with A's journals", same(await journalsOf((await position(c.id, "Повар")).id), await journalsOf(cookA.id)));
  const ivanovC = await db.user.findFirst({ where: { organizationId: c.id, name: "Иванов Иван" } });
  check("transfer: C's employee got the journals of the position", Boolean(ivanovC) && same(await userJournals(ivanovC!.id), await journalsOf(cookA.id)));
  const transferC = await db.directoryTransfer.findFirstOrThrow({ where: { toOrganizationId: c.id }, orderBy: { createdAt: "desc" } });
  const undoneC = await undoTransfer({ id: transferC.id, ownerUserId: x.owner.id, ownerName: x.owner.name });
  const keptPlaces = undoneC.kept.filter((item) => item.entity === "room" || item.entity === "position");
  check("transfer undo: rooms with schedules and positions with journals are undone, not kept as «used»", keptPlaces.length === 0, undoneC.kept);
  check(
    "transfer undo: C has no rooms and no positions left",
    (await db.room.count({ where: { building: { organizationId: c.id } } })) === 0 && (await db.jobPosition.count({ where: { organizationId: c.id } })) === 0,
  );

  // A transfer recorded before the deploy: version-1 fingerprints of rooms and positions.
  const d = await makeOrg("Четвёртая", x.account.id);
  await join(x.owner.id, d.id);
  await transferOnce({ fromOrganizationId: a.id, toOrganizationId: d.id, selection: { objects: "all", staff: "all" }, actor: x.actor });
  const transferD = await db.directoryTransfer.findFirstOrThrow({ where: { toOrganizationId: d.id }, orderBy: { createdAt: "desc" } });
  const createdJson = transferD.createdJson as { room: string[]; position: string[]; hashes: Record<string, Record<string, string>> };
  for (const id of createdJson.room) {
    const row = await db.room.findUniqueOrThrow({ where: { id }, select: { name: true, kind: true, sortOrder: true, buildingId: true } });
    createdJson.hashes.room[id] = hashFields({ name: row.name, kind: row.kind, sortOrder: row.sortOrder, "#parent": row.buildingId });
  }
  for (const id of createdJson.position) {
    const row = await db.jobPosition.findUniqueOrThrow({ where: { id }, select: { name: true } });
    createdJson.hashes.position[id] = hashFields({ name: row.name, "#parent": null });
  }
  await db.directoryTransfer.update({ where: { id: transferD.id }, data: { createdJson: createdJson as unknown as Prisma.InputJsonObject } });
  const undoneD = await undoTransfer({ id: transferD.id, ownerUserId: x.owner.id, ownerName: x.owner.name });
  check(
    "transfer undo (recorded before the deploy, version-1 fingerprints): rooms and positions are not «edited»",
    undoneD.kept.filter((item) => item.entity === "room" || item.entity === "position").length === 0 &&
      undoneD.undone.filter((item) => item.entity === "room").length === createdJson.room.length &&
      undoneD.undone.filter((item) => item.entity === "position").length === createdJson.position.length,
    undoneD,
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
  const leftItems = await db.journalChecklistItem.count({ where: { organizationId: { in: orgIds } } });
  console.log(`cleanup: organizations left ${left}, users left ${leftUsers}, accounts left ${leftAccounts}, links left ${leftLinks}, checklist items left ${leftItems}`);
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
