/*
 * Series C1, item 6 (AC1, AC2): several companies of other accounts at one master cabinet
 * («star»), checked end to end against the local DB.
 *
 * The cabinet owner has two organizations (O1 with data, O2); companies A and B (paid
 * accounts) are linked by approved requests. Both get the owner's records; neither gets the
 * other's — by creation, by edit or by name match; a company's edit does not change the
 * owner's record; the owner's edit reaches both; a one-off transfer requested by B does not
 * give B records that came from A. Legacy groups without an origin get the organization of
 * their oldest record (without record dates — the cautious rule by links).
 */
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { loadEntityRows } from "@/lib/directory-exchange/entities.server";
import { EXCHANGE_KINDS, entityScope } from "@/lib/directory-exchange/kinds";
import { MIXED_ORIGIN } from "@/lib/directory-exchange/plan";
import { createExchangeRequest, decideExchangeRequest } from "@/lib/directory-exchange/requests.server";
import { runDirectoryExchange, transferPreview } from "@/lib/directory-exchange/run.server";
import { ensureExchangeCabinet, saveExchangeMembers } from "@/lib/directory-exchange/settings.server";
import { summaryTotals, type ExchangeSummary } from "@/lib/directory-exchange/summary";

const TAG = `mchk${Date.now().toString(36)}`;
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

/** Справочник организации: продукты, должности, сотрудники, объекты, цеха, оборудование — одним списком названий. */
async function all(orgId: string): Promise<string[]> {
  const [products, positions, staff, buildings, areas, equipment] = await Promise.all([
    db.product.findMany({ where: { organizationId: orgId, isActive: true }, select: { name: true } }),
    db.jobPosition.findMany({ where: { organizationId: orgId, categoryKey: "staff" }, select: { name: true } }),
    db.user.findMany({ where: { organizationId: orgId, passwordHash: "" }, select: { name: true } }),
    db.building.findMany({ where: { organizationId: orgId }, select: { name: true } }),
    db.area.findMany({ where: { organizationId: orgId }, select: { name: true } }),
    db.equipment.findMany({ where: { area: { organizationId: orgId } }, select: { name: true } }),
  ]);
  return [...products, ...positions, ...staff, ...buildings, ...areas, ...equipment].map((row) => row.name).sort();
}
const product = (orgId: string, name: string) => db.product.findFirst({ where: { organizationId: orgId, name } });
const totals = (summary: ExchangeSummary | undefined) => summaryTotals(summary ?? { organizations: [], notes: [] });
const missing = (have: string[], want: string[]) => want.filter((name) => !have.includes(name));
const present = (have: string[], banned: string[]) => banned.filter((name) => have.includes(name));

/** Данные организации: продукты, должность с сотрудником, объект → цех → оборудование. */
async function seed(
  orgId: string,
  data: {
    products: Array<{ name: string; supplier: string }>;
    positions: string[];
    staff: Array<{ name: string; position: string }>;
    building?: { name: string; area: string; equipment: string };
    looseArea?: { name: string; equipment: string; tempMin: number };
  },
) {
  for (const item of data.products) await db.product.create({ data: { name: item.name, kind: "raw", unit: "kg", supplier: item.supplier, organizationId: orgId } });
  const positionIds = new Map<string, string>();
  for (const [index, name] of data.positions.entries()) {
    const position = await db.jobPosition.create({ data: { organizationId: orgId, categoryKey: "staff", name, sortOrder: index + 1 } });
    positionIds.set(name, position.id);
  }
  for (const [index, person] of data.staff.entries()) {
    await db.user.create({
      data: {
        email: `${TAG}-${orgId.slice(-6)}-${index}@s.local.haccp`,
        name: person.name,
        passwordHash: "",
        role: "cook",
        jobPositionId: positionIds.get(person.position)!,
        positionTitle: person.position,
        organizationId: orgId,
      },
    });
  }
  if (data.building) {
    const building = await db.building.create({ data: { organizationId: orgId, name: data.building.name } });
    const area = await db.area.create({ data: { organizationId: orgId, name: data.building.area, buildingId: building.id } });
    await db.equipment.create({ data: { name: data.building.equipment, type: "refrigerator", tempMin: 2, tempMax: 6, areaId: area.id } });
  }
  if (data.looseArea) {
    const area = await db.area.create({ data: { organizationId: orgId, name: data.looseArea.name } });
    await db.equipment.create({ data: { name: data.looseArea.equipment, type: "freezer", tempMin: data.looseArea.tempMin, tempMax: -18, areaId: area.id } });
  }
}

const OWNER_RECORDS = ["Молоко", "Сыр общий", "Повар", "Иванов Иван", "Кафе центр", "Склад", "Холодильник №1"];
const A_RECORDS = ["Сметана A", "Сушист A", "Петров Пётр A", "Цех A", "Склад A", "Ларь A"];
const B_RECORDS = ["Йогурт B", "Бармен B", "Сидоров Сидор B", "Бар B", "Склад B", "Ларь B"];

async function main() {
  /* ── владелец кабинета: O1 с данными и O2 ── */
  const o1 = await makeOrg("Владелец-O1");
  const owner = await makeOwner(o1.id, "own");
  const o2 = await makeOrg("Владелец-O2", owner.account.id);
  await join(owner.owner.id, o2.id);
  await seed(o1.id, {
    products: [
      { name: "Молоко", supplier: "Ферма O" },
      { name: "Сыр общий", supplier: "Сыроварня O" },
    ],
    positions: ["Повар"],
    staff: [{ name: "Иванов Иван", position: "Повар" }],
    building: { name: "Кафе центр", area: "Склад", equipment: "Холодильник №1" },
  });
  const cabinet = await ensureExchangeCabinet(owner.owner.id, owner.account.id);
  orgIds.push(cabinet.id);
  const code = (await db.organization.findUnique({ where: { id: cabinet.id }, select: { serviceCode: true } }))!.serviceCode!;
  await saveExchangeMembers({
    ownerUserId: owner.owner.id,
    ownerName: owner.owner.name,
    organizationId: o1.id,
    members: [
      { organizationId: o1.id, kinds: [...EXCHANGE_KINDS] },
      { organizationId: o2.id, kinds: [...EXCHANGE_KINDS] },
    ],
  });
  await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  check("setup: O2 received the owner's records", missing(await all(o2.id), OWNER_RECORDS).length === 0, await all(o2.id));

  /* ── компании A и B: свои записи, часть названий совпадает между собой и с владельцем ── */
  const a1 = await makeOrg("Компания-A");
  const a = await makeOwner(a1.id, "ca");
  await seed(a1.id, {
    products: [
      { name: "Сметана A", supplier: "Завод A" },
      { name: "Общий хлеб", supplier: "Пекарня A" },
      { name: "Молоко", supplier: "Ферма A" },
    ],
    positions: ["Повар", "Сушист A"],
    staff: [{ name: "Петров Пётр A", position: "Сушист A" }],
    building: { name: "Цех A", area: "Склад A", equipment: "Ларь A" },
    looseArea: { name: "Общая кладовая", equipment: "Общий шкаф", tempMin: -20 },
  });
  const b1 = await makeOrg("Компания-B");
  const b = await makeOwner(b1.id, "cb");
  const b2 = await makeOrg("Компания-B-2", b.account.id);
  await join(b.owner.id, b2.id);
  await seed(b1.id, {
    products: [
      { name: "Йогурт B", supplier: "Завод B" },
      { name: "Общий хлеб", supplier: "Пекарня B" },
      { name: "Молоко", supplier: "Ферма B" },
    ],
    positions: ["Повар", "Бармен B"],
    staff: [{ name: "Сидоров Сидор B", position: "Бармен B" }],
    building: { name: "Бар B", area: "Склад B", equipment: "Ларь B" },
    looseArea: { name: "Общая кладовая", equipment: "Общий шкаф", tempMin: -22 },
  });

  const link = async (orgId: string, actor: { userId: string; userName: string | null }) => {
    const request = await createExchangeRequest({ organizationId: orgId, actor, code, mode: "link", kinds: [...EXCHANGE_KINDS] });
    return decideExchangeRequest({
      token: request.token,
      actor: owner.actor,
      decision: "approve",
      allowedKinds: [...EXCHANGE_KINDS],
      organizationIds: [o1.id, o2.id],
      waitMs: 120_000,
    });
  };
  console.log("--- linking A, then B (several companies at one cabinet)");
  const aApproved = await link(a1.id, a.actor);
  check("A is linked", aApproved.status === "approved");
  const bApproved = await link(b1.id, b.actor);
  check("B is linked while A stays linked — no «cabinet busy»", bApproved.status === "approved");
  check(
    "both companies are foreign members of the cabinet",
    (await db.directoryExchangeMember.count({ where: { masterOrganizationId: cabinet.id, foreign: true, organizationId: { in: [a1.id, b1.id] } } })) === 2,
  );
  const settle = await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  check("the cabinet's summary has no «second company did not take part» note", settle.notes.every((note) => !note.includes("с двумя компаниями")), settle.notes);

  /* ── AC1: обе получают записи владельца, ни одна — записей другой ── */
  console.log("--- creation");
  const [aAll, bAll, o1All, o2All] = await Promise.all([all(a1.id), all(b1.id), all(o1.id), all(o2.id)]);
  check("A received every owner's record", missing(aAll, OWNER_RECORDS).length === 0, missing(aAll, OWNER_RECORDS));
  check("B received every owner's record", missing(bAll, OWNER_RECORDS).length === 0, missing(bAll, OWNER_RECORDS));
  check("A has none of B's records", present(aAll, B_RECORDS).length === 0, present(aAll, B_RECORDS));
  check("B has none of A's records", present(bAll, A_RECORDS).length === 0, present(bAll, A_RECORDS));
  check("O1 received the records of both companies", missing(o1All, [...A_RECORDS, ...B_RECORDS]).length === 0, missing(o1All, [...A_RECORDS, ...B_RECORDS]));
  check("O2 received the records of both companies", missing(o2All, [...A_RECORDS, ...B_RECORDS]).length === 0, missing(o2All, [...A_RECORDS, ...B_RECORDS]));

  /* ── по совпадению названия ── */
  console.log("--- name match");
  const linkOf = (orgId: string, entityId: string) =>
    db.directoryExchangeLink.findFirst({ where: { masterOrganizationId: cabinet.id, organizationId: orgId, entityId } });
  const [aBread, bBread, o1Bread] = await Promise.all([product(a1.id, "Общий хлеб"), product(b1.id, "Общий хлеб"), product(o1.id, "Общий хлеб")]);
  const [aBreadLink, bBreadLink, o1BreadLink] = await Promise.all([linkOf(a1.id, aBread!.id), linkOf(b1.id, bBread!.id), linkOf(o1.id, o1Bread!.id)]);
  check(
    "same-named «Общий хлеб» of A and B: two groups, each started by its own company",
    Boolean(aBreadLink && bBreadLink) && aBreadLink!.groupId !== bBreadLink!.groupId && aBreadLink!.originOrganizationId === a1.id && bBreadLink!.originOrganizationId === b1.id,
    { a: [aBreadLink?.groupId, aBreadLink?.originOrganizationId], b: [bBreadLink?.groupId, bBreadLink?.originOrganizationId] },
  );
  check(
    "…the owner holds A's version (A linked first), B keeps its own",
    o1BreadLink?.groupId === aBreadLink?.groupId && o1Bread?.supplier === "Пекарня A" && bBread?.supplier === "Пекарня B" && aBread?.supplier === "Пекарня A",
    { o1: o1Bread?.supplier, b: bBread?.supplier },
  );
  const [aMilk, bMilk, o1Milk] = await Promise.all([product(a1.id, "Молоко"), product(b1.id, "Молоко"), product(o1.id, "Молоко")]);
  const milkLinks = await Promise.all([linkOf(a1.id, aMilk!.id), linkOf(b1.id, bMilk!.id), linkOf(o1.id, o1Milk!.id)]);
  check(
    "«Молоко» equal to the owner's: both companies joined the owner's group, nobody's data overwritten",
    new Set(milkLinks.map((item) => item?.groupId)).size === 1 && milkLinks.every((item) => item?.originOrganizationId === o1.id) && aMilk?.supplier === "Ферма A" && bMilk?.supplier === "Ферма B" && o1Milk?.supplier === "Ферма O",
    milkLinks.map((item) => [item?.groupId, item?.originOrganizationId]),
  );
  const bArea = await db.area.findFirst({ where: { organizationId: b1.id, name: "Общая кладовая" }, include: { equipment: true } });
  const aArea = await db.area.findFirst({ where: { organizationId: a1.id, name: "Общая кладовая" } });
  const [aAreaLink, bAreaLink] = await Promise.all([linkOf(a1.id, aArea!.id), linkOf(b1.id, bArea!.id)]);
  check(
    "same-named area of A and B: separate groups; B's area keeps only its own equipment",
    aAreaLink?.groupId !== bAreaLink?.groupId && bAreaLink?.originOrganizationId === b1.id && bArea!.equipment.length === 1,
    { a: aAreaLink?.groupId, b: bAreaLink?.groupId, equipment: bArea?.equipment.map((item) => item.name) },
  );
  // Цеха с одинаковым названием в организации допустимы: у владельца — оба, каждый в группе своей компании.
  const ownerAreas = await db.area.findMany({ where: { organizationId: o1.id, name: "Общая кладовая" }, include: { equipment: true } });
  const ownerAreaOrigins = await Promise.all(ownerAreas.map(async (area) => (await linkOf(o1.id, area.id))?.originOrganizationId));
  check(
    "the owner holds both same-named areas, each in its own company's group",
    ownerAreas.length === 2 && JSON.stringify([...ownerAreaOrigins].sort()) === JSON.stringify([a1.id, b1.id].sort()),
    { areas: ownerAreas.length, origins: ownerAreaOrigins },
  );
  const noOrigin = await db.directoryExchangeLink.count({ where: { masterOrganizationId: cabinet.id, originOrganizationId: null } });
  check("every link of the cabinet has an origin", noOrigin === 0, noOrigin);

  /* ── правки ── */
  console.log("--- edits");
  const idle = await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  check("a repeated run changes nothing", totals(idle).created + totals(idle).updated === 0, totals(idle));
  // Правка компании A: своё «Молоко» и полученный «Сыр общий» — у владельца и B ничего не меняется.
  const aCheese = await product(a1.id, "Сыр общий");
  await db.product.update({ where: { id: aMilk!.id }, data: { supplier: "Ферма A-2" } });
  await db.product.update({ where: { id: aCheese!.id }, data: { supplier: "Сыроварня A" } });
  const aEdit = await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  const after = async (name: string) => Promise.all([o1.id, o2.id, b1.id].map(async (id) => (await product(id, name))?.supplier));
  check(
    "A's edits change no record of the owner or of B",
    totals(aEdit).updated === 0 && JSON.stringify(await after("Молоко")) === JSON.stringify(["Ферма O", "Ферма O", "Ферма B"]) && JSON.stringify(await after("Сыр общий")) === JSON.stringify(["Сыроварня O", "Сыроварня O", "Сыроварня O"]),
    { run: totals(aEdit), milk: await after("Молоко"), cheese: await after("Сыр общий") },
  );
  // Правка владельца доходит до обеих компаний.
  await db.product.update({ where: { id: (await product(o1.id, "Сыр общий"))!.id }, data: { supplier: "Сыроварня O-2" } });
  await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  const cheeses = await Promise.all([o2.id, a1.id, b1.id].map(async (id) => (await product(id, "Сыр общий"))?.supplier));
  check("the owner's edit reaches O2, A and B", cheeses.every((supplier) => supplier === "Сыроварня O-2"), cheeses);
  // Правка владельцем записи, начатой A, доходит до A — и не создаёт её у B.
  await db.product.update({ where: { id: (await product(o1.id, "Сметана A"))!.id }, data: { supplier: "Завод O" } });
  await db.product.update({ where: { id: o1Bread!.id }, data: { supplier: "Пекарня O" } });
  const ownerEditOfA = await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  check(
    "the owner's edit of A's records reaches A; B neither gets them nor has its «Общий хлеб» changed",
    (await product(a1.id, "Сметана A"))?.supplier === "Завод O" && (await product(a1.id, "Общий хлеб"))?.supplier === "Пекарня O" && !(await all(b1.id)).includes("Сметана A") && (await product(b1.id, "Общий хлеб"))?.supplier === "Пекарня B",
    { run: totals(ownerEditOfA), bBread: (await product(b1.id, "Общий хлеб"))?.supplier },
  );
  // Новая запись B после связи — у владельца есть, у A нет.
  await db.product.create({ data: { name: "Кефир B", kind: "raw", unit: "l", supplier: "Завод B", organizationId: b1.id } });
  await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  check("a new record of B reaches the owner but not A", (await all(o1.id)).includes("Кефир B") && !(await all(a1.id)).includes("Кефир B"));
  const idle2 = await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  check("…and the next run changes nothing", totals(idle2).created + totals(idle2).updated === 0, totals(idle2));

  /* ── разовый перенос по запросу B ── */
  console.log("--- one-off transfer requested by B");
  const preview = await transferPreview({ fromOrganizationId: o1.id, toOrganizationId: b2.id, crossAccount: true, masterOrganizationId: cabinet.id });
  const previewNames = EXCHANGE_KINDS.flatMap((kind) => preview.items[kind].map((item) => item.name));
  check(
    "transfer preview for B: the owner's and B's records, none that came from A",
    missing(previewNames, [...OWNER_RECORDS, "Йогурт B", "Кефир B"]).length === 0 &&
      present(previewNames, [...A_RECORDS, "Общий хлеб"]).length === 0 &&
      previewNames.filter((name) => name === "Общая кладовая").length === 1 &&
      previewNames.filter((name) => name === "Общий шкаф").length === 1,
    previewNames,
  );
  const plainPreview = await transferPreview({ fromOrganizationId: o1.id, toOrganizationId: o2.id });
  check(
    "a transfer inside the owner's account still offers everything",
    missing(EXCHANGE_KINDS.flatMap((kind) => plainPreview.items[kind].map((item) => item.name)), [...A_RECORDS, ...B_RECORDS]).length === 0,
  );
  const transfer = await createExchangeRequest({ organizationId: b2.id, actor: b.actor, code, mode: "transfer", kinds: [...EXCHANGE_KINDS] });
  await decideExchangeRequest({ token: transfer.token, actor: owner.actor, decision: "approve", allowedKinds: [...EXCHANGE_KINDS], sourceOrganizationId: o1.id });
  const b2All = await all(b2.id);
  check("B's second organization received the owner's records by the transfer", missing(b2All, OWNER_RECORDS).length === 0, missing(b2All, OWNER_RECORDS));
  check("…and records that came from B itself", missing(b2All, ["Йогурт B", "Кефир B"]).length === 0, b2All);
  check(
    "…but nothing that came from A (by creation or by name)",
    present(b2All, [...A_RECORDS, "Общий хлеб"]).length === 0,
    present(b2All, [...A_RECORDS, "Общий хлеб"]),
  );
  const b2Areas = await db.area.findMany({ where: { organizationId: b2.id, name: "Общая кладовая" }, include: { equipment: true } });
  check(
    "…of the owner's two same-named areas B got only B's own (with B's equipment norms)",
    b2Areas.length === 1 && b2Areas[0].equipment.length === 1 && b2Areas[0].equipment[0].tempMin === -22,
    b2Areas.map((area) => area.equipment.map((item) => item.tempMin)),
  );

  /* ── AC2: группы без отметки (до C1): основатель — организация самой старой записи ── */
  console.log("--- legacy groups without an origin");
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
  /** Группа до C1: записи с заданной датой создания и связи без отметки. */
  const legacy = async (entity: "product" | "area", name: string, records: Array<[string, number]>) => {
    const groupId = randomUUID();
    for (const [organizationId, age] of records) {
      const id =
        entity === "product"
          ? (await db.product.create({ data: { name, kind: "raw", unit: "kg", supplier: "Старый", organizationId, createdAt: daysAgo(age) } })).id
          : (await db.area.create({ data: { name, organizationId } })).id;
      const row = (await loadEntityRows(entity, organizationId, () => null, entityScope(entity, "foreign"))).find((item) => item.id === id)!;
      await db.directoryExchangeLink.create({
        data: { masterOrganizationId: cabinet.id, entity, groupId, organizationId, entityId: id, hash: row.hash, originOrganizationId: null },
      });
    }
    return groupId;
  };
  const ownerCopiedToA = await legacy("product", "Легаси O→A", [[o1.id, 10], [a1.id, 5]]);
  const aCopiedToOwner = await legacy("product", "Легаси A→O", [[a1.id, 10], [o1.id, 5]]);
  const twoCompanies = await legacy("product", "Легаси AB", [[b1.id, 8], [o1.id, 5], [a1.id, 10]]);
  const ownerOnly = await legacy("product", "Легаси O", [[o1.id, 5], [o2.id, 10]]);
  // У цехов даты создания нет — осторожное правило: связи двух компаний → «смешанная».
  const undated = await legacy("area", "Легаси цех", [[o1.id, 0], [a1.id, 0], [b1.id, 0]]);
  const origins = async (groupId: string) =>
    [...new Set((await db.directoryExchangeLink.findMany({ where: { masterOrganizationId: cabinet.id, groupId } })).map((row) => row.originOrganizationId))];
  const legacyRun = await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  check("owner's record older than A's copy → the owner's group", JSON.stringify(await origins(ownerCopiedToA)) === JSON.stringify([o1.id]), await origins(ownerCopiedToA));
  check("A's record older than the owner's copy → A's group", JSON.stringify(await origins(aCopiedToOwner)) === JSON.stringify([a1.id]), await origins(aCopiedToOwner));
  check("two companies, A's record the oldest → A's group (not mixed)", JSON.stringify(await origins(twoCompanies)) === JSON.stringify([a1.id]), await origins(twoCompanies));
  check("owner's records only → the organization of the oldest one (O2)", JSON.stringify(await origins(ownerOnly)) === JSON.stringify([o2.id]), await origins(ownerOnly));
  check("no record dates (areas), two companies' links → «mixed»", JSON.stringify(await origins(undated)) === JSON.stringify([MIXED_ORIGIN]), await origins(undated));
  const [o2Now, aNow, bNow] = await Promise.all([all(o2.id), all(a1.id), all(b1.id)]);
  check("B receives the owner-founded legacy group already copied to A", bNow.includes("Легаси O→A"), bNow.filter((name) => name.startsWith("Легаси")));
  check("B does not receive the A-founded legacy group", !bNow.includes("Легаси A→O"));
  check("both companies received the owner's legacy group", aNow.includes("Легаси O") && bNow.includes("Легаси O"));
  check(
    "the owner's O2 received every legacy group",
    missing(o2Now, ["Легаси O→A", "Легаси A→O", "Легаси AB", "Легаси цех"]).length === 0,
    { o2: o2Now.filter((name) => name.startsWith("Легаси")), notes: legacyRun.notes },
  );
  check(
    "the origin is saved: no link of the cabinet without one",
    (await db.directoryExchangeLink.count({ where: { masterOrganizationId: cabinet.id, originOrganizationId: null } })) === 0,
  );
  // Группа A, в которой есть запись B: правка владельца доходит до O2 и A, но не до B.
  await db.product.update({ where: { id: (await product(o1.id, "Легаси AB"))!.id }, data: { supplier: "Новый" } });
  await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  const edited = await Promise.all([o2.id, a1.id, b1.id].map(async (id) => (await product(id, "Легаси AB"))?.supplier));
  check("A's legacy group: the owner's edit reaches O2 and A, not B", JSON.stringify(edited) === JSON.stringify(["Новый", "Новый", "Старый"]), edited);
  const before = await db.directoryExchangeLink.findMany({ where: { masterOrganizationId: cabinet.id }, orderBy: { id: "asc" }, select: { id: true, originOrganizationId: true, hash: true, entityId: true } });
  const again = await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  const afterLinks = await db.directoryExchangeLink.findMany({ where: { masterOrganizationId: cabinet.id }, orderBy: { id: "asc" }, select: { id: true, originOrganizationId: true, hash: true, entityId: true } });
  check(
    "a second run changes nothing: no records, no links, no origins",
    totals(again).created + totals(again).updated === 0 && JSON.stringify(before) === JSON.stringify(afterLinks),
    totals(again),
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
