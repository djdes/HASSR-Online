/*
 * End-to-end check of item 12 (undo of a one-time transfer, AC4) against the local DB:
 * the transfer records what it created (with mirror rooms and areas), the owner of the
 * target account undoes it within 7 days — used and edited records stay with reasons,
 * the rest is undone (products off, staff archived, equipment/areas/rooms/buildings/
 * positions deleted); a second undo is 409, an old transfer is 409, another account 404;
 * a cross-account transfer by an approved request carries requestId and the requester undoes it.
 * Review fixes: fingerprints of created records (an edited equipment tempMax and area name stay
 * as «правили после переноса»; old rows without fingerprints fall back), references from
 * document settings, checklists, kiosks, temperature incidents and old journal entries keep
 * records, the undo waits for the cabinet's exchange lock, and a deleted source keeps the row.
 *
 *   npx tsx .agent/tasks/multi-org-followups-b-2026-11-20/raw/transfer-undo-check.ts
 */
import "dotenv/config";

import { db } from "@/lib/db";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { EXCHANGE_ENTITIES, EXCHANGE_KINDS } from "@/lib/directory-exchange/kinds";
import { createExchangeRequest, decideExchangeRequest } from "@/lib/directory-exchange/requests.server";
import { transferOnce, withExchangeLock } from "@/lib/directory-exchange/run.server";
import { ensureExchangeCabinet, exchangeCabinetCode } from "@/lib/directory-exchange/settings.server";
import { parseExchangeSummary } from "@/lib/directory-exchange/summary";
import {
  parseTransferCreated,
  parseTransferHashes,
  parseUndoResult,
  type TransferUndoResult,
} from "@/lib/directory-exchange/transfer-undo";
import { listRecentTransfers, undoTransfer } from "@/lib/directory-exchange/transfer-undo.server";

const TAG = `tuchk${Date.now().toString(36)}`;
const DAY = 86_400_000;
const orgIds: string[] = [];
const accountIds: string[] = [];
const journalEntryIds: string[] = [];
const documentIds: string[] = [];
let failed = 0;
let passed = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
}

// Письма в dev пишутся в журнал — не засоряем вывод.
const realInfo = console.info.bind(console);
console.info = (...args: unknown[]) => {
  const line = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
  if (line.startsWith("[email/dev]") || line.includes("[directory-exchange]")) return;
  realInfo(...args);
};

async function makeOrg(name: string, accountId: string | null = null, extra: Record<string, unknown> = {}) {
  const org = await db.organization.create({ data: { name: `${name} ${TAG}`, type: "restaurant", accountId, ...extra } });
  orgIds.push(org.id);
  return org;
}

async function makeOwner(orgId: string, label: string, accountData: Record<string, unknown> = {}) {
  const owner = await db.user.create({
    data: { email: `${TAG}-${label}@example.test`, name: `Владелец ${label}`, passwordHash: "not-a-real-hash", role: "manager", organizationId: orgId },
  });
  const account = await db.account.create({ data: { ownerUserId: owner.id, ...accountData } });
  accountIds.push(account.id);
  await db.organization.update({ where: { id: orgId }, data: { accountId: account.id } });
  await db.organizationMember.create({ data: { userId: owner.id, organizationId: orgId, role: "owner" } });
  return { owner, account, actor: { userId: owner.id, userName: owner.name } };
}

async function join(ownerId: string, orgId: string) {
  await db.organizationMember.create({ data: { userId: ownerId, organizationId: orgId, role: "owner" } });
}

async function refused(label: string, status: number, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    check(label, false, "no error");
  } catch (error) {
    check(
      label,
      error instanceof DirectoryExchangeError && error.status === status,
      error instanceof DirectoryExchangeError ? { status: error.status, message: error.message } : String(error),
    );
  }
}

const sorted = (values: string[]) => [...values].sort((a, b) => a.localeCompare(b, "ru"));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const label = (items: Array<{ entity: string; name: string }>) => sorted(items.map((item) => `${item.entity}:${item.name}`));
const keptLabel = (result: TransferUndoResult) => sorted(result.kept.map((item) => `${item.entity}:${item.name}:${item.reason}`));
const undoneLabel = (result: TransferUndoResult) => sorted(result.undone.map((item) => `${item.entity}:${item.name}:${item.action}`));

async function state(orgId: string) {
  return {
    activeProducts: sorted((await db.product.findMany({ where: { organizationId: orgId, isActive: true } })).map((p) => p.name)),
    inactiveProducts: sorted((await db.product.findMany({ where: { organizationId: orgId, isActive: false } })).map((p) => p.name)),
    activeStaff: sorted((await db.user.findMany({ where: { organizationId: orgId, passwordHash: "", isActive: true, archivedAt: null } })).map((u) => u.name)),
    archivedStaff: sorted((await db.user.findMany({ where: { organizationId: orgId, passwordHash: "", archivedAt: { not: null }, isActive: false } })).map((u) => u.name)),
    positions: sorted((await db.jobPosition.findMany({ where: { organizationId: orgId } })).map((p) => p.name)),
    buildings: sorted((await db.building.findMany({ where: { organizationId: orgId } })).map((b) => b.name)),
    rooms: sorted((await db.room.findMany({ where: { building: { organizationId: orgId } } })).map((r) => r.name)),
    areas: sorted((await db.area.findMany({ where: { organizationId: orgId } })).map((a) => a.name)),
    equipment: sorted((await db.equipment.findMany({ where: { area: { organizationId: orgId } } })).map((e) => e.name)),
  };
}

async function main() {
  const template = await db.journalTemplate.findFirst({ select: { id: true } });
  if (!template) throw new Error("no journal templates in the local DB — run the seed");

  /* ── аккаунт 1: источник A, получатели B и C (оплачен, точек хватает) ── */
  const a = await makeOrg("Источник");
  const one = await makeOwner(a.id, "one", {
    subscriptionPlan: "standard",
    subscriptionEnd: new Date(Date.now() + 30 * DAY),
    planPoints: 10,
    planCycle: "month",
  });
  const b = await makeOrg("Получатель", one.account.id);
  await join(one.owner.id, b.id);
  const c = await makeOrg("Получатель-2", one.account.id);
  await join(one.owner.id, c.id);

  await db.product.createMany({
    data: [
      { name: "Молоко 3,2%", kind: "raw", supplier: "Ферма", unit: "l", organizationId: a.id },
      { name: "Сыр твёрдый", kind: "raw", unit: "kg", organizationId: a.id },
      { name: "Борщ", kind: "finished", servingTemp: "soup", shelfLifeHours: 6, organizationId: a.id },
      { name: "Хлеб", kind: "raw", unit: "pcs", organizationId: a.id },
    ],
  });
  const cook = await db.jobPosition.create({ data: { organizationId: a.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  for (const [index, name] of ["Иванов Иван", "Петрова Анна"].entries()) {
    await db.user.create({
      data: {
        email: `${TAG}-staff${index}@a.local.haccp`,
        name,
        passwordHash: "",
        role: "cook",
        jobPositionId: cook.id,
        positionTitle: cook.name,
        organizationId: a.id,
      },
    });
  }
  const cafe = await db.building.create({ data: { organizationId: a.id, name: "Кафе на Ленина", address: "Ленина, 1" } });
  const bakery = await db.building.create({ data: { organizationId: a.id, name: "Пекарня", address: "Мира, 5" } });
  await db.room.create({ data: { buildingId: cafe.id, name: "Кухня", kind: "kitchen" } });
  const store = await db.area.create({ data: { organizationId: a.id, name: "Склад", buildingId: cafe.id } });
  const baking = await db.area.create({ data: { organizationId: a.id, name: "Выпечка", buildingId: bakery.id } });
  await db.equipment.createMany({
    data: [
      { name: "Холодильник №1", type: "refrigerator", tempMin: 2, tempMax: 6, areaId: store.id },
      { name: "Плита", type: "other", areaId: store.id },
      { name: "Печь", type: "other", areaId: baking.id },
    ],
  });

  /* ── T0: маленький перенос (один продукт) — потом «состарим» его ── */
  console.log("--- transfer records what it created");
  const bread = await db.product.findFirstOrThrow({ where: { organizationId: a.id, name: "Хлеб" } });
  await transferOnce({ fromOrganizationId: a.id, toOrganizationId: b.id, selection: { products: [bread.id] }, actor: one.actor });
  const t0 = await db.directoryTransfer.findFirst({ where: { toOrganizationId: b.id }, orderBy: { createdAt: "desc" } });
  check("T0: a single-product transfer is recorded", Boolean(t0) && parseTransferCreated(t0!.createdJson).product.length === 1, t0?.createdJson);

  /* ── T1: всё четыре списка A → B ── */
  const summary = await transferOnce({
    fromOrganizationId: a.id,
    toOrganizationId: b.id,
    selection: { products: "all", staff: "all", objects: "all", equipment: "all" },
    actor: one.actor,
  });
  const t1 = await db.directoryTransfer.findFirst({ where: { toOrganizationId: b.id, NOT: { id: t0!.id } }, orderBy: { createdAt: "desc" } });
  check("T1: the transfer row exists", Boolean(t1));
  if (!t1) throw new Error("no T1 row");
  check("T1: from A to B, actor = owner, no request", t1.fromOrganizationId === a.id && t1.toOrganizationId === b.id && t1.actorUserId === one.owner.id && t1.requestId === null, t1);
  const created = parseTransferCreated(t1.createdJson);
  const nameOf = async (entity: keyof typeof created) => {
    const ids = created[entity];
    switch (entity) {
      case "product":
        return sorted((await db.product.findMany({ where: { id: { in: ids }, organizationId: b.id } })).map((row) => row.name));
      case "position":
        return sorted((await db.jobPosition.findMany({ where: { id: { in: ids }, organizationId: b.id } })).map((row) => row.name));
      case "staff":
        return sorted((await db.user.findMany({ where: { id: { in: ids }, organizationId: b.id } })).map((row) => row.name));
      case "building":
        return sorted((await db.building.findMany({ where: { id: { in: ids }, organizationId: b.id } })).map((row) => row.name));
      case "room":
        return sorted((await db.room.findMany({ where: { id: { in: ids }, building: { organizationId: b.id } } })).map((row) => row.name));
      case "area":
        return sorted((await db.area.findMany({ where: { id: { in: ids }, organizationId: b.id } })).map((row) => row.name));
      case "equipment":
        return sorted((await db.equipment.findMany({ where: { id: { in: ids }, area: { organizationId: b.id } } })).map((row) => row.name));
    }
  };
  check("T1: created products (Хлеб already there — not recorded)", same(await nameOf("product"), sorted(["Молоко 3,2%", "Сыр твёрдый", "Борщ"])), await nameOf("product"));
  check("T1: created position and staff", same(await nameOf("position"), ["Повар"]) && same(await nameOf("staff"), sorted(["Иванов Иван", "Петрова Анна"])));
  check("T1: created buildings", same(await nameOf("building"), sorted(["Кафе на Ленина", "Пекарня"])), await nameOf("building"));
  check(
    "T1: rooms include the mirror rooms of the created areas",
    same(await nameOf("room"), sorted(["Кухня", "Склад", "Выпечка"])),
    await nameOf("room"),
  );
  check(
    "T1: areas include the mirror area of the created room",
    same(await nameOf("area"), sorted(["Кухня", "Склад", "Выпечка"])),
    await nameOf("area"),
  );
  check("T1: created equipment", same(await nameOf("equipment"), sorted(["Холодильник №1", "Плита", "Печь"])), await nameOf("equipment"));
  const t1Hashes = parseTransferHashes(t1.createdJson);
  check(
    "T1: a fingerprint is stored for every created record",
    EXCHANGE_ENTITIES.every((entity) => created[entity].every((id) => typeof t1Hashes[entity][id] === "string")),
    t1Hashes,
  );
  check(
    "T1: the source name is stored (same account)",
    t1.fromOrganizationName === a.name,
    t1.fromOrganizationName,
  );
  check(
    "T1: every created id is a record of B (nothing pre-existing recorded)",
    (await nameOf("room")).length === created.room.length && (await nameOf("area")).length === created.area.length,
  );
  check(
    "T1: the summary is stored and matches the returned one",
    same(parseExchangeSummary(t1.summaryJson)?.organizations[0]?.kinds, summary.organizations[0]?.kinds),
    t1.summaryJson,
  );

  const listed = await listRecentTransfers({ accountId: one.account.id, userId: one.owner.id });
  const listedT1 = listed.find((item) => item.id === t1.id);
  check(
    "list: T1 shown from A to B, undoable, with counts",
    Boolean(listedT1) &&
      listedT1!.undoable &&
      listedT1!.from.name === a.name &&
      !listedT1!.from.foreign &&
      listedT1!.to.id === b.id &&
      // Series C2: the counts also carry «Журналы» and «Чек-листы» (nothing transferred there).
      same(listedT1!.counts, { products: 3, staff: 3, objects: 3, equipment: 5, journals: 0, checklists: 0 }),
    listedT1,
  );

  /* ── используем и правим часть записей ── */
  const fridge = await db.equipment.findFirstOrThrow({ where: { area: { organizationId: b.id }, name: "Холодильник №1" } });
  const ivanov = await db.user.findFirstOrThrow({ where: { organizationId: b.id, name: "Иванов Иван" } });
  const kitchen = await db.room.findFirstOrThrow({ where: { building: { organizationId: b.id }, name: "Кухня" } });
  const entry = await db.journalEntry.create({
    data: { templateId: template.id, organizationId: b.id, equipmentId: fridge.id, filledById: ivanov.id, data: { temperature: 4 } },
  });
  journalEntryIds.push(entry.id);
  const document = await db.journalDocument.create({
    data: { templateId: template.id, organizationId: b.id, title: `Уборка ${TAG}`, dateFrom: new Date(), dateTo: new Date(Date.now() + DAY) },
  });
  documentIds.push(document.id);
  await db.journalDocumentEntry.create({
    data: { documentId: document.id, employeeId: one.owner.id, date: new Date(new Date().toDateString()), data: { rooms: [{ roomId: kitchen.id, done: true }] } },
  });
  await sleep(30);
  await db.product.updateMany({ where: { organizationId: b.id, name: "Сыр твёрдый" }, data: { supplier: "Сыроварня" } });

  /* ── чужой аккаунт 404 ── */
  console.log("--- access");
  const s = await makeOrg("Чужой источник");
  const two = await makeOwner(s.id, "two");
  await refused("another account: undo of T1 → 404", 404, () => undoTransfer({ id: t1.id, ownerUserId: two.owner.id }));
  await refused("unknown id → 404", 404, () => undoTransfer({ id: "no-such-transfer", ownerUserId: one.owner.id }));
  check(
    "another account: its list does not show T1",
    !(await listRecentTransfers({ accountId: two.account.id, userId: two.owner.id })).some((item) => item.id === t1.id),
  );
  check(
    "a non-owner user id: the account list is empty",
    (await listRecentTransfers({ accountId: one.account.id, userId: two.owner.id })).length === 0,
  );

  /* ── старше 7 дней — 409 ── */
  await db.directoryTransfer.update({ where: { id: t0!.id }, data: { createdAt: new Date(Date.now() - 8 * DAY) } });
  await refused("a transfer older than 7 days → 409", 409, () => undoTransfer({ id: t0!.id, ownerUserId: one.owner.id }));
  check("an old transfer is not listed", !(await listRecentTransfers({ accountId: one.account.id, userId: one.owner.id })).some((item) => item.id === t0!.id));
  check("the refused old transfer changed nothing", (await db.product.count({ where: { organizationId: b.id, name: "Хлеб", isActive: true } })) === 1);

  /* ── отмена T1: запись старого вида (без отпечатков) — прежнее поведение ── */
  console.log("--- undo");
  await db.directoryTransfer.update({ where: { id: t1.id }, data: { createdJson: parseTransferCreated(t1.createdJson) } });
  // Без отпечатка правка оборудования не видна — как до них: Плита отменяется.
  await db.equipment.updateMany({ where: { area: { organizationId: b.id }, name: "Плита" }, data: { tempMax: 99 } });
  check("T1 stored in the old format (no fingerprints)", Object.keys(parseTransferHashes((await db.directoryTransfer.findUniqueOrThrow({ where: { id: t1.id } })).createdJson).equipment).length === 0);
  const result = await undoTransfer({ id: t1.id, ownerUserId: one.owner.id, ownerName: one.owner.name });
  check(
    "undo (old row, fallback): undone — unused products off, unused staff archived, unused equipment/areas/rooms/building deleted",
    same(
      undoneLabel(result),
      sorted([
        "product:Молоко 3,2%:deactivated",
        "product:Борщ:deactivated",
        "staff:Петрова Анна:archived",
        "equipment:Плита:deleted",
        "equipment:Печь:deleted",
        "room:Выпечка:deleted",
        "area:Выпечка:deleted",
        "building:Пекарня:deleted",
      ]),
    ),
    undoneLabel(result),
  );
  check(
    "undo: kept with reasons — used, edited, non-empty, linked mirror, position with staff",
    same(
      keptLabel(result),
      sorted([
        "equipment:Холодильник №1:used",
        "staff:Иванов Иван:used",
        "product:Сыр твёрдый:edited",
        "room:Кухня:used",
        "area:Кухня:linked",
        "area:Склад:not_empty",
        "room:Склад:linked",
        "position:Повар:has_staff",
        "building:Кафе на Ленина:not_empty",
      ]),
    ),
    keptLabel(result),
  );
  const after = await state(b.id);
  check("B: active products — the edited one and the one from T0", same(after.activeProducts, sorted(["Сыр твёрдый", "Хлеб"])), after);
  check("B: products turned off, not deleted", same(after.inactiveProducts, sorted(["Молоко 3,2%", "Борщ"])), after.inactiveProducts);
  check("B: Петрова archived, Иванов active", same(after.archivedStaff, ["Петрова Анна"]) && same(after.activeStaff, ["Иванов Иван"]), after);
  check("B: equipment left — the used fridge", same(after.equipment, ["Холодильник №1"]), after.equipment);
  check("B: areas left — Кухня (mirror) and Склад", same(after.areas, sorted(["Кухня", "Склад"])), after.areas);
  check("B: rooms left — Кухня and Склад (mirror)", same(after.rooms, sorted(["Кухня", "Склад"])), after.rooms);
  check("B: buildings left — Кафе на Ленина; Пекарня deleted", same(after.buildings, ["Кафе на Ленина"]), after.buildings);
  check("B: position Повар stays (Иванов is on it)", same(after.positions, ["Повар"]), after.positions);
  check("B: the journal entry survived", (await db.journalEntry.count({ where: { id: entry.id } })) === 1);

  const stored = await db.directoryTransfer.findUniqueOrThrow({ where: { id: t1.id } });
  check("undoJson stored = returned result", same(parseUndoResult(stored.undoJson), result), stored.undoJson);
  check("undoneAt and undoneByUserId stored", Boolean(stored.undoneAt) && stored.undoneByUserId === one.owner.id, stored);
  const audit = await db.auditLog.findFirst({ where: { organizationId: b.id, action: "directory_exchange.transfer_undone", entityId: t1.id } });
  const auditKept = (audit?.details as { kept?: Array<{ reason: string }> } | null)?.kept ?? [];
  check("audit: transfer_undone in the target organization with kept reasons", Boolean(audit) && audit!.userId === one.owner.id && auditKept.length === 9, audit);
  const listedAfter = (await listRecentTransfers({ accountId: one.account.id, userId: one.owner.id })).find((item) => item.id === t1.id);
  check("list: T1 now undone, not undoable, with the result", Boolean(listedAfter?.undoneAt) && listedAfter!.undoable === false && same(listedAfter!.undo, result), listedAfter);

  await refused("second undo → 409", 409, () => undoTransfer({ id: t1.id, ownerUserId: one.owner.id }));

  /* ── перенос по подтверждённому запросу другой компании ── */
  console.log("--- cross-account transfer by an approved request");
  await db.product.create({ data: { name: "Кефир", kind: "raw", unit: "l", organizationId: s.id } });
  const barman = await db.jobPosition.create({ data: { organizationId: s.id, categoryKey: "staff", name: "Бармен", sortOrder: 1 } });
  await db.user.create({
    data: { email: `${TAG}-sid@s.local.haccp`, name: "Сидоров Пётр", phone: "+79851112233", passwordHash: "", role: "waiter", jobPositionId: barman.id, positionTitle: "Бармен", organizationId: s.id },
  });
  const bar = await db.building.create({ data: { organizationId: s.id, name: "Бар у моря" } });
  await db.room.create({ data: { buildingId: bar.id, name: "Зал", kind: "hall" } });
  const counter = await db.area.create({ data: { organizationId: s.id, name: "Бар-стойка", buildingId: bar.id } });
  await db.equipment.create({ data: { name: "Кофемашина", type: "other", areaId: counter.id } });
  const cabinet = await ensureExchangeCabinet(two.owner.id, two.account.id);
  orgIds.push(cabinet.id);
  const cabinetRow = await db.organization.findUniqueOrThrow({ where: { id: cabinet.id }, select: { name: true } });
  const code = await exchangeCabinetCode(cabinet.id);
  const asked = await createExchangeRequest({ organizationId: c.id, actor: one.actor, code, mode: "transfer", kinds: [...EXCHANGE_KINDS] });
  const decided = await decideExchangeRequest({
    token: asked.token,
    actor: two.actor,
    decision: "approve",
    allowedKinds: [...EXCHANGE_KINDS],
    sourceOrganizationId: s.id,
  });
  check("request approved", decided.status === "approved", decided.status);
  const t2 = await db.directoryTransfer.findFirst({ where: { toOrganizationId: c.id } });
  check("T2: recorded with the request id, from the foreign source", Boolean(t2) && t2!.requestId === asked.request.id && t2!.fromOrganizationId === s.id, t2);
  check("T2: the foreign source's name is not stored", t2!.fromOrganizationName === null, t2?.fromOrganizationName);
  if (!t2) throw new Error("no T2 row");
  const t2Created = parseTransferCreated(t2.createdJson);
  check(
    "T2: created ids recorded (product, position, staff, building, rooms, areas, equipment)",
    t2Created.product.length === 1 && t2Created.position.length === 1 && t2Created.staff.length === 1 && t2Created.building.length === 1 &&
      t2Created.room.length === 2 && t2Created.area.length === 2 && t2Created.equipment.length === 1,
    t2Created,
  );
  const requesterList = await listRecentTransfers({ accountId: one.account.id, userId: one.owner.id });
  const listedT2 = requesterList.find((item) => item.id === t2.id);
  check(
    "requester list: T2 from the other company shown by the cabinet name, never the source organization",
    Boolean(listedT2) && listedT2!.from.foreign && listedT2!.from.name === cabinetRow.name && !JSON.stringify(listedT2).includes(s.name),
    listedT2,
  );
  check("cabinet owner list: T2 not shown (it is not their organization)", !(await listRecentTransfers({ accountId: two.account.id, userId: two.owner.id })).some((item) => item.id === t2.id));
  await refused("cabinet owner (source side): undo of T2 → 404", 404, () => undoTransfer({ id: t2.id, ownerUserId: two.owner.id }));

  // Две отмены одновременно: проходит одна, вторая — 409.
  const settled = await Promise.allSettled([
    undoTransfer({ id: t2.id, ownerUserId: one.owner.id, ownerName: one.owner.name }),
    undoTransfer({ id: t2.id, ownerUserId: one.owner.id, ownerName: one.owner.name }),
  ]);
  const fulfilled = settled.filter((item): item is PromiseFulfilledResult<TransferUndoResult> => item.status === "fulfilled");
  const rejected = settled.filter((item): item is PromiseRejectedResult => item.status === "rejected");
  check(
    "concurrent undo: exactly one succeeds, the other is 409",
    fulfilled.length === 1 && rejected.length === 1 && rejected[0].reason instanceof DirectoryExchangeError && rejected[0].reason.status === 409,
    settled.map((item) => (item.status === "rejected" ? String(item.reason) : "ok")),
  );
  const t2Result = fulfilled[0]?.value;
  check("T2 undo: nothing kept", Boolean(t2Result) && t2Result!.kept.length === 0, t2Result?.kept);
  check(
    "T2 undo: everything undone",
    Boolean(t2Result) &&
      same(label(t2Result!.undone), sorted([
        "product:Кефир",
        "staff:Сидоров Пётр",
        "position:Бармен",
        "building:Бар у моря",
        "room:Зал",
        "room:Бар-стойка",
        "area:Зал",
        "area:Бар-стойка",
        "equipment:Кофемашина",
      ])),
    t2Result ? label(t2Result.undone) : null,
  );
  const cAfter = await state(c.id);
  check(
    "C after undo: product off, staff archived, no positions, buildings, rooms, areas or equipment",
    same(cAfter.activeProducts, []) && same(cAfter.inactiveProducts, ["Кефир"]) && same(cAfter.archivedStaff, ["Сидоров Пётр"]) &&
      same(cAfter.positions, []) && same(cAfter.buildings, []) && same(cAfter.rooms, []) && same(cAfter.areas, []) && same(cAfter.equipment, []),
    cAfter,
  );
  const sAfter = await state(s.id);
  check("the source S is untouched", same(sAfter.activeProducts, ["Кефир"]) && same(sAfter.equipment, ["Кофемашина"]) && same(sAfter.buildings, ["Бар у моря"]), sAfter);
  const cAudit = await db.auditLog.findFirst({ where: { organizationId: c.id, action: "directory_exchange.transfer_undone" } });
  check(
    "audit in C: transfer_undone, cross-account, without the source organization's name",
    Boolean(cAudit) && (cAudit!.details as { crossAccount?: boolean }).crossAccount === true && !JSON.stringify(cAudit!.details).includes(s.name),
    cAudit?.details,
  );
  // Источник другой компании удалён (SET NULL): перенос — всё ещё «из другой компании», по названию кабинета.
  await db.directoryTransfer.update({ where: { id: t2.id }, data: { fromOrganizationId: null } });
  const t2Orphan = (await listRecentTransfers({ accountId: one.account.id, userId: one.owner.id })).find((item) => item.id === t2.id);
  check(
    "T2 with the foreign source gone: still listed as another company by the cabinet name",
    Boolean(t2Orphan) && t2Orphan!.from.foreign && t2Orphan!.from.name === cabinetRow.name,
    t2Orphan?.from,
  );

  /* ── T3: отпечатки и ссылки ── */
  console.log("--- fingerprints and references");
  const d = await makeOrg("Получатель-3", one.account.id);
  await join(one.owner.id, d.id);
  const cabinetOne = await ensureExchangeCabinet(one.owner.id, one.account.id);
  orgIds.push(cabinetOne.id);
  // Фритюрница источника; у получателя журнал фритюра — создание сразу заводит в нём связь.
  await db.equipment.create({ data: { name: "Фритюрница", type: "fryer", areaId: store.id } });
  const fryerTemplate = await db.journalTemplate.findFirstOrThrow({ where: { code: "fryer_oil" }, select: { id: true } });
  const coldTemplate = await db.journalTemplate.findFirstOrThrow({ where: { code: "cold_equipment_control" }, select: { id: true } });
  const period = { dateFrom: new Date(), dateTo: new Date(Date.now() + DAY) };
  const fryerDoc = await db.journalDocument.create({
    data: { templateId: fryerTemplate.id, organizationId: d.id, title: `Фритюр ${TAG}`, status: "active", ...period },
  });
  documentIds.push(fryerDoc.id);
  await transferOnce({ fromOrganizationId: a.id, toOrganizationId: d.id, selection: { objects: "all", equipment: "all" }, actor: one.actor });
  const t3 = await db.directoryTransfer.findFirstOrThrow({ where: { toOrganizationId: d.id } });
  const t3Created = parseTransferCreated(t3.createdJson);
  const t3Hashes = parseTransferHashes(t3.createdJson);
  check(
    "T3: 2 buildings, 3 rooms, 3 areas, 4 equipment — each with a fingerprint",
    t3Created.building.length === 2 && t3Created.room.length === 3 && t3Created.area.length === 3 && t3Created.equipment.length === 4 &&
      EXCHANGE_ENTITIES.every((entity) => t3Created[entity].every((id) => typeof t3Hashes[entity][id] === "string")),
    { created: t3Created, hashes: t3Hashes },
  );
  const inD = (name: string) => db.equipment.findFirstOrThrow({ where: { area: { organizationId: d.id }, name } });
  const [dFridge, dStove, dOven, dFryer] = await Promise.all([inD("Холодильник №1"), inD("Плита"), inD("Печь"), inD("Фритюрница")]);
  const fryerConfig = async () => JSON.stringify((await db.journalDocument.findUniqueOrThrow({ where: { id: fryerDoc.id } })).config ?? null);
  check("T3: the new fryer is linked in the fryer journal settings by itself", (await fryerConfig()).includes(dFryer.id), await fryerConfig());

  // Правки без `updatedAt`: норма холодильника и название цеха.
  await db.equipment.update({ where: { id: dFridge.id }, data: { tempMax: 8 } });
  const dBaking = await db.area.findFirstOrThrow({ where: { organizationId: d.id, name: "Выпечка" } });
  await db.area.update({ where: { id: dBaking.id }, data: { name: "Выпечка и десерты" } });
  // Ссылки: настройки журнала холодильников (Плита), отклонение температуры (Печь),
  // чек-лист помещения (Кухня), старая запись журнала (помещение Склад), киоск (Пекарня).
  const coldDoc = await db.journalDocument.create({
    data: {
      templateId: coldTemplate.id,
      organizationId: d.id,
      title: `Холодильники ${TAG}`,
      ...period,
      config: { equipment: [{ id: "row-1", name: "Плита", sourceEquipmentId: dStove.id }] },
    },
  });
  documentIds.push(coldDoc.id);
  await db.temperatureDeviationIncident.create({
    data: { organizationId: d.id, subjectKey: `equipment:${dOven.id}`, subjectName: "Печь", equipmentId: dOven.id, firstValue: 300, lastValue: 300 },
  });
  const dKitchen = await db.room.findFirstOrThrow({ where: { building: { organizationId: d.id }, name: "Кухня" } });
  const dStoreRoom = await db.room.findFirstOrThrow({ where: { building: { organizationId: d.id }, name: "Склад" } });
  const dBakery = await db.building.findFirstOrThrow({ where: { organizationId: d.id, name: "Пекарня" } });
  await db.journalChecklistItem.create({ data: { organizationId: d.id, journalCode: "cleaning", roomId: dKitchen.id, label: "Протереть столы" } });
  await db.kioskDevice.create({ data: { organizationId: d.id, buildingId: dBakery.id, label: "Пекарня", secretHash: `${TAG}-kiosk`, createdById: one.owner.id } });
  const legacy = await db.journalEntry.create({
    data: { templateId: template.id, organizationId: d.id, filledById: one.owner.id, data: { roomId: dStoreRoom.id, note: "старая запись" } },
  });
  journalEntryIds.push(legacy.id);

  // Идёт обмен кабинета аккаунта — отмена ждёт замка и отказывает, ничего не меняя.
  const busy = await withExchangeLock(
    cabinetOne.id,
    () => undoTransfer({ id: t3.id, ownerUserId: one.owner.id }).then(() => null, (error: unknown) => error),
    { waitMs: 4_000 },
  );
  check(
    "undo while the account cabinet's exchange holds its lock → 409 exchange_busy",
    busy instanceof DirectoryExchangeError && busy.status === 409 && busy.code === "exchange_busy",
    busy instanceof Error ? { message: busy.message, code: (busy as DirectoryExchangeError).code } : busy,
  );
  check(
    "the refused undo changed nothing",
    (await db.directoryTransfer.findUniqueOrThrow({ where: { id: t3.id } })).undoneAt === null &&
      (await db.equipment.count({ where: { area: { organizationId: d.id } } })) === 4,
  );

  const t3Result = await undoTransfer({ id: t3.id, ownerUserId: one.owner.id, ownerName: one.owner.name });
  check(
    "T3 undo: edited tempMax and area name kept as «правили после переноса»; references keep records as used",
    same(
      keptLabel(t3Result),
      sorted([
        "equipment:Холодильник №1:edited",
        "area:Выпечка и десерты:edited",
        "equipment:Плита:used",
        "equipment:Печь:used",
        "room:Кухня:used",
        "room:Склад:used",
        "building:Пекарня:used",
        "area:Кухня:linked",
        "area:Склад:not_empty",
        "building:Кафе на Ленина:not_empty",
      ]),
    ),
    keptLabel(t3Result),
  );
  check(
    "T3 undo: the unused fryer (its automatic journal link does not count) and the unpaired room are undone",
    same(undoneLabel(t3Result), sorted(["equipment:Фритюрница:deleted", "room:Выпечка:deleted"])),
    undoneLabel(t3Result),
  );
  const dEquipment = sorted((await db.equipment.findMany({ where: { area: { organizationId: d.id } } })).map((row) => `${row.name}:${row.tempMax}`));
  check("D: equipment left with the edited norm", same(dEquipment, sorted(["Холодильник №1:8", "Плита:null", "Печь:null"])), dEquipment);
  check("D: the renamed area stays", (await db.area.count({ where: { id: dBaking.id, name: "Выпечка и десерты" } })) === 1);
  check("D: the fryer link left the fryer journal settings", !(await fryerConfig()).includes(dFryer.id), await fryerConfig());

  /* ── T4: источник удалён — запись получателя и отмена остаются ── */
  console.log("--- deleted source");
  const e = await makeOrg("Источник-удалённый", one.account.id);
  await db.product.create({ data: { name: "Сметана", kind: "raw", unit: "kg", organizationId: e.id } });
  await transferOnce({ fromOrganizationId: e.id, toOrganizationId: d.id, selection: { products: "all" }, actor: one.actor });
  const t4 = await db.directoryTransfer.findFirstOrThrow({ where: { toOrganizationId: d.id, fromOrganizationId: e.id } });
  await db.organization.delete({ where: { id: e.id } });
  const t4After = await db.directoryTransfer.findUnique({ where: { id: t4.id } });
  check(
    "deleting the source keeps the recipient's transfer row (source id null, name kept)",
    Boolean(t4After) && t4After!.fromOrganizationId === null && t4After!.fromOrganizationName === e.name,
    t4After,
  );
  const t4Listed = (await listRecentTransfers({ accountId: one.account.id, userId: one.owner.id })).find((item) => item.id === t4.id);
  check(
    "list: the deleted source is shown by its stored name, same account, undoable",
    Boolean(t4Listed) && t4Listed!.from.name === e.name && !t4Listed!.from.foreign && t4Listed!.undoable,
    t4Listed,
  );
  const t4Result = await undoTransfer({ id: t4.id, ownerUserId: one.owner.id, ownerName: one.owner.name });
  check("undo with the source deleted: the product is turned off", same(undoneLabel(t4Result), ["product:Сметана:deactivated"]), t4Result);
  const t4Audit = await db.auditLog.findFirst({ where: { organizationId: d.id, action: "directory_exchange.transfer_undone", entityId: t4.id } });
  check(
    "audit: the deleted source named by the stored name, id null",
    (t4Audit?.details as { fromOrganizationName?: string; fromOrganizationId?: string | null } | undefined)?.fromOrganizationName === e.name &&
      (t4Audit?.details as { fromOrganizationId?: string | null }).fromOrganizationId === null,
    t4Audit?.details,
  );
}

async function cleanup() {
  await db.journalEntry.deleteMany({ where: { id: { in: journalEntryIds } } }).catch(() => undefined);
  await db.journalDocument.deleteMany({ where: { id: { in: documentIds } } }).catch(() => undefined);
  const cabinets = await db.organization.findMany({ where: { accountId: { in: accountIds }, kind: "directory" }, select: { id: true } });
  const ids = [...new Set([...cabinets.map((item) => item.id), ...orgIds])].reverse();
  for (const id of ids) {
    await db.organization.delete({ where: { id } }).catch((error) => {
      const message = String((error as Error).message);
      if (!message.includes("not found") && !message.includes("No record")) console.log(`cleanup: ${id} — ${message.split("\n").pop()}`);
    });
  }
  await db.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  const leftUsers = await db.user.count({ where: { email: { contains: TAG } } });
  const leftTransfers = await db.directoryTransfer.count({ where: { OR: [{ toOrganizationId: { in: orgIds } }, { fromOrganizationId: { in: orgIds } }] } });
  console.log(`cleanup: organizations left ${left}, users left ${leftUsers}, transfers left ${leftTransfers}`);
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
