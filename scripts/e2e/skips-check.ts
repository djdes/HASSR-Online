// Moved here from .agent/tasks/multi-org-followups-b-2026-11-20/raw/skips-check.ts (series B); that file is now a wrapper that runs this one, and its logs stay as that series' evidence.
/*
 * End-to-end check of item 9 (AC1, rules Р9.1–Р9.3) against the local DB:
 * skipped creations become `DirectoryExchangeSkip` rows, repeated exchanges do
 * not duplicate them, «Не переносить» writes a tombstone, «Связать с …» links an
 * existing record with its own fingerprint, a record that appears later removes
 * the row, foreign participants are not reviewed, another account gets 404.
 *
 * Run: npx tsx scripts/e2e/skips-check.ts
 */
import "./env";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { loadEntityRows } from "@/lib/directory-exchange/entities.server";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { endExchangeRequest } from "@/lib/directory-exchange/requests.server";
import { runDirectoryExchange } from "@/lib/directory-exchange/run.server";
import { ensureExchangeCabinet, saveExchangeMembers } from "@/lib/directory-exchange/settings.server";
import { ignoreExchangeSkip, linkExchangeSkip, listExchangeSkips } from "@/lib/directory-exchange/skips.server";
import { summaryTotals, type ExchangeSummary } from "@/lib/directory-exchange/summary";

const TAG = `skchk${Date.now().toString(36)}`;
const orgIds: string[] = [];
const accountIds: string[] = [];
let failed = 0;
let passed = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
}

async function refused(label: string, status: number, run: () => Promise<unknown>) {
  try {
    await run();
    check(label, false, "no error");
  } catch (error) {
    check(label, error instanceof DirectoryExchangeError && error.status === status, (error as Error).message);
  }
}

async function makeOrg(name: string, accountId: string | null = null, extra: Record<string, unknown> = {}) {
  const org = await db.organization.create({ data: { name: `${name} ${TAG}`, type: "restaurant", accountId, ...extra } });
  orgIds.push(org.id);
  return org;
}

async function makeOwner(orgId: string, label: string, accountData: Record<string, unknown> = {}) {
  const owner = await db.user.create({
    data: {
      email: `${TAG}-${label}@example.test`,
      name: `Владелец ${label}`,
      passwordHash: "not-a-real-hash",
      role: "manager",
      organizationId: orgId,
      telegramChatId: `${TAG}-${label}`,
    },
  });
  const account = await db.account.create({ data: { ownerUserId: owner.id, ...accountData } });
  accountIds.push(account.id);
  await db.organization.update({ where: { id: orgId }, data: { accountId: account.id } });
  await db.organizationMember.create({ data: { userId: owner.id, organizationId: orgId, role: "owner" } });
  // `accountId` + `actor` — то, что маршрут передаёт в skips.server.ts из `requireExchangeOwner`.
  return { owner, account, accountId: account.id, actor: { userId: owner.id, userName: owner.name } };
}

async function person(orgId: string, positionId: string, name: string, extra: Record<string, unknown> = {}) {
  return db.user.create({
    data: {
      email: `${TAG}-${Math.random().toString(36).slice(2)}@a.local.haccp`,
      name,
      passwordHash: "",
      role: "cook",
      jobPositionId: positionId,
      positionTitle: "Повар",
      organizationId: orgId,
      ...extra,
    },
  });
}

const kindsOf = (summary: ExchangeSummary, orgId: string) => summary.organizations.find((o) => o.organizationId === orgId)?.kinds;
const skipRows = (masterOrganizationId: string, where: Prisma.DirectoryExchangeSkipWhereInput = {}) =>
  db.directoryExchangeSkip.findMany({ where: { masterOrganizationId, ...where }, orderBy: { id: "asc" } });
const rowsCount = async (masterOrganizationId: string, organizationId: string, entity: string, reason: string) =>
  (await skipRows(masterOrganizationId, { organizationId, entity, reason })).length;

async function main() {
  /* ── аккаунт после пробного периода: одно место; две организации ── */
  const a = await makeOrg("Первая");
  const one = await makeOwner(a.id, "one", {
    trialEndsAt: new Date(Date.now() - 40 * 86_400_000),
    createdAt: new Date(Date.now() - 60 * 86_400_000),
  });
  const b = await makeOrg("Вторая", one.account.id);
  await db.organizationMember.create({ data: { userId: one.owner.id, organizationId: b.id, role: "owner" } });

  // Продукты: «Молоко» сырьё у A и «МОЛОКО» готовое у B (разные ключи, одно название — видимая запись для «Связать»);
  // «Кефир» и «Сметана» у B выключены (скрытые — только «Не переносить»).
  const milkA = await db.product.create({ data: { name: "Молоко", kind: "raw", supplier: "Ферма", unit: "l", organizationId: a.id } });
  await db.product.create({ data: { name: "Кефир", kind: "raw", unit: "l", organizationId: a.id } });
  await db.product.create({ data: { name: "Сметана", kind: "raw", unit: "kg", organizationId: a.id } });
  const milkB = await db.product.create({
    data: { name: "МОЛОКО", kind: "finished", supplier: "Завод", unit: "l", shelfLifeDays: 3, organizationId: b.id },
  });
  const kefirB = await db.product.create({ data: { name: "кефир", kind: "raw", unit: "l", organizationId: b.id, isActive: false } });
  const creamB = await db.product.create({ data: { name: "Сметана", kind: "raw", unit: "kg", organizationId: b.id, isActive: false } });
  // Сотрудники: двое линейных у A (место тарифа одно); «Сидоров Пётр» у B — с входом (скрыт, совпадение ФИО).
  const cookA = await db.jobPosition.create({ data: { organizationId: a.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  for (const name of ["Иванов Иван", "Петрова Анна", "Сидоров Пётр"]) await person(a.id, cookA.id, name);
  await db.user.create({
    data: { email: `${TAG}-login@example.test`, name: "Сидоров Пётр", passwordHash: "has-a-login", role: "cook", organizationId: b.id },
  });

  const cabinet = await ensureExchangeCabinet(one.owner.id, one.account.id);
  orgIds.push(cabinet.id);
  await saveExchangeMembers({
    ownerUserId: one.owner.id,
    organizationId: a.id,
    members: [
      { organizationId: a.id, kinds: ["products", "staff"] },
      { organizationId: b.id, kinds: ["products", "staff"] },
    ],
  });

  /* ── первый обмен: пропуски записаны ── */
  const first = await runDirectoryExchange(cabinet.id, { actor: one.actor });
  const bKinds = kindsOf(first, b.id);
  const aKinds = kindsOf(first, a.id);
  const rows1 = await skipRows(cabinet.id);
  console.log(
    "DEBUG rows after first",
    JSON.stringify(rows1.map((row) => [row.organizationId === a.id ? "A" : "B", row.entity, row.name, row.reason])),
    "B",
    JSON.stringify(bKinds),
  );
  const bProductConflicts = rows1.filter((row) => row.organizationId === b.id && row.entity === "product" && row.reason === "conflict");
  check(
    "conflict rows written for B: «Молоко», «Кефир», «Сметана» (inactive or other kind with the same name)",
    JSON.stringify(bProductConflicts.map((row) => row.name).sort()) === JSON.stringify(["Кефир", "Молоко", "Сметана"]),
    bProductConflicts.map((row) => row.name),
  );
  check(
    "conflict row written for a person with a login and the same full name",
    rows1.some((row) => row.organizationId === b.id && row.entity === "staff" && row.reason === "conflict" && row.name === "Сидоров Пётр"),
  );
  const limitRows = rows1.filter((row) => row.organizationId === b.id && row.entity === "staff" && row.reason === "limit");
  check("limit rows written for staff over the seat limit", limitRows.length >= 1, { limitRows: limitRows.length, bKinds });
  check(
    "rows match the summary counters (B products, B staff, A products)",
    bKinds?.products.skippedConflict === bProductConflicts.length &&
      bKinds?.staff.skippedLimit === limitRows.length &&
      bKinds?.staff.skippedConflict === (await rowsCount(cabinet.id, b.id, "staff", "conflict")) &&
      aKinds?.products.skippedConflict === (await rowsCount(cabinet.id, a.id, "product", "conflict")),
    { bKinds, aKinds },
  );
  const milkRowB = bProductConflicts.find((row) => row.name === "Молоко")!;
  check(
    "row carries source organization and record",
    milkRowB.sourceOrganizationId === a.id && milkRowB.sourceEntityId === milkA.id && milkRowB.lastSeenAt.getTime() >= milkRowB.firstSeenAt.getTime(),
    milkRowB,
  );
  check(
    "the other direction: A has a conflict row for B's «МОЛОКО»",
    rows1.some((row) => row.organizationId === a.id && row.entity === "product" && row.name === "МОЛОКО" && row.sourceEntityId === milkB.id),
  );

  /* ── повторный обмен: строки не дублируются, lastSeenAt сдвигается ── */
  await new Promise((resolve) => setTimeout(resolve, 20));
  await runDirectoryExchange(cabinet.id, { actor: one.actor });
  const rows2 = await skipRows(cabinet.id);
  const sameIds = JSON.stringify(rows1.map((row) => row.id)) === JSON.stringify(rows2.map((row) => row.id));
  const moved = rows2.every((row) => {
    const before = rows1.find((item) => item.id === row.id)!;
    return row.lastSeenAt.getTime() > before.lastSeenAt.getTime() && row.firstSeenAt.getTime() === before.firstSeenAt.getTime();
  });
  check("second exchange: same rows, no duplicates", sameIds && rows2.length === rows1.length, { before: rows1.length, after: rows2.length });
  check("second exchange: lastSeenAt moved, firstSeenAt kept", moved);

  /* ── список для окна ── */
  const list = await listExchangeSkips({ accountId: one.account.id });
  const listB = list.organizations.find((organization) => organization.organizationId === b.id);
  const listA = list.organizations.find((organization) => organization.organizationId === a.id);
  const item = (name: string) => listB?.items.find((entry) => entry.name === name);
  check("list: grouped by organization with the total", list.total === rows2.length && Boolean(listA) && Boolean(listB), { total: list.total });
  check(
    "list: «Молоко» offers B's «МОЛОКО» (visible, same name, other kind)",
    JSON.stringify(item("Молоко")?.candidates.map((candidate) => candidate.id)) === JSON.stringify([milkB.id]) && item("Молоко")?.kind === "products",
    item("Молоко"),
  );
  check(
    "list: hidden records are not offered (inactive product, person with a login), limit rows have no candidates",
    item("Кефир")?.candidates.length === 0 &&
      item("Сидоров Пётр")?.candidates.length === 0 &&
      listB!.items.filter((entry) => entry.reason === "limit").every((entry) => entry.candidates.length === 0),
  );
  check(
    "list: A's «МОЛОКО» offers A's «Молоко»",
    JSON.stringify(listA?.items.find((entry) => entry.name === "МОЛОКО")?.candidates.map((candidate) => candidate.id)) === JSON.stringify([milkA.id]),
  );

  /* ── отказы ── */
  const kefirRow = bProductConflicts.find((row) => row.name === "Кефир")!;
  await refused("link to a record that is not a candidate (inactive product) → 404", 404, () =>
    linkExchangeSkip(one, kefirRow.id, kefirB.id),
  );
  await refused("link to a record of another organization → 404", 404, () => linkExchangeSkip(one, milkRowB.id, milkA.id));
  await refused("link on a limit row → 409", 409, () => linkExchangeSkip(one, limitRows[0].id, milkB.id));
  await refused("unknown row → 404", 404, () => ignoreExchangeSkip(one, "no-such-skip"));

  /* ── «Не переносить» ── */
  await ignoreExchangeSkip(one, kefirRow.id);
  const kefirLink = await db.directoryExchangeLink.findUnique({
    where: {
      masterOrganizationId_entity_groupId_organizationId: { masterOrganizationId: cabinet.id, entity: "product", groupId: kefirRow.groupId, organizationId: b.id },
    },
  });
  check("ignore: tombstone link written (entityId null)", kefirLink !== null && kefirLink.entityId === null, kefirLink);
  check("ignore: row removed", (await db.directoryExchangeSkip.count({ where: { id: kefirRow.id } })) === 0);
  check(
    "ignore: audit directory_exchange.skip_ignored in B",
    (await db.auditLog.count({ where: { organizationId: b.id, action: "directory_exchange.skip_ignored", userId: one.owner.id } })) === 1,
  );
  const third = await runDirectoryExchange(cabinet.id, { actor: one.actor });
  check(
    "ignore: next exchange does not retry (no row, no second «Кефир», one conflict fewer)",
    (await skipRows(cabinet.id, { organizationId: b.id, name: "Кефир" })).length === 0 &&
      (await db.product.count({ where: { organizationId: b.id, name: { equals: "кефир", mode: "insensitive" } } })) === 1 &&
      kindsOf(third, b.id)?.products.skippedConflict === bProductConflicts.length - 1,
    kindsOf(third, b.id)?.products,
  );

  /* ── «Связать с …» ── */
  const milkBefore = await db.product.findUniqueOrThrow({ where: { id: milkB.id } });
  const oldGroup = await db.directoryExchangeLink.findFirst({
    where: { masterOrganizationId: cabinet.id, entity: "product", organizationId: b.id, entityId: milkB.id },
  });
  await linkExchangeSkip(one, milkRowB.id, milkB.id);
  const milkLink = await db.directoryExchangeLink.findUnique({
    where: {
      masterOrganizationId_entity_groupId_organizationId: { masterOrganizationId: cabinet.id, entity: "product", groupId: milkRowB.groupId, organizationId: b.id },
    },
  });
  const ownHash = (await loadEntityRows("product", b.id)).find((row) => row.id === milkB.id)?.hash;
  check("link: link written to B's «МОЛОКО» with its own fingerprint", milkLink?.entityId === milkB.id && milkLink.hash === ownHash, { milkLink, ownHash });
  check("link: row removed", (await db.directoryExchangeSkip.count({ where: { id: milkRowB.id } })) === 0);
  const oldAfter = oldGroup ? await db.directoryExchangeLink.findUnique({ where: { id: oldGroup.id } }) : null;
  check(
    "link: the record's own lonely group is released, A's row for it is gone",
    Boolean(oldGroup) &&
      oldAfter?.entityId === null &&
      (await skipRows(cabinet.id, { organizationId: a.id, name: "МОЛОКО" })).length === 0,
    { oldGroup, oldAfter },
  );
  check(
    "link: audit directory_exchange.skip_linked in B",
    (await db.auditLog.count({ where: { organizationId: b.id, action: "directory_exchange.skip_linked", userId: one.owner.id } })) === 1,
  );
  const fourth = await runDirectoryExchange(cabinet.id, { actor: one.actor });
  const milkAfter = await db.product.findUniqueOrThrow({ where: { id: milkB.id } });
  const sameData = (x: typeof milkBefore, y: typeof milkBefore) =>
    x.name === y.name && x.kind === y.kind && x.supplier === y.supplier && x.shelfLifeDays === y.shelfLifeDays && x.isActive === y.isActive;
  check("link: next exchange leaves B's record data unchanged", sameData(milkBefore, milkAfter), { milkBefore, milkAfter });
  check(
    "link: next exchange creates and updates no products, no «Молоко» rows anywhere",
    (kindsOf(fourth, a.id)?.products.created ?? 0) + (kindsOf(fourth, b.id)?.products.created ?? 0) === 0 &&
      summaryTotals(fourth).updated === 0 &&
      (await skipRows(cabinet.id, { entity: "product", name: { in: ["Молоко", "МОЛОКО"] } })).length === 0 &&
      (await db.product.count({ where: { organizationId: { in: [a.id, b.id] }, name: { equals: "молоко", mode: "insensitive" } } })) === 2,
    { fourth: fourth.organizations.map((o) => o.kinds.products) },
  );
  await db.product.update({ where: { id: milkA.id }, data: { name: "Молоко 3,2%", supplier: "Ферма-2" } });
  await runDirectoryExchange(cabinet.id, { actor: one.actor });
  const milkEdited = await db.product.findUniqueOrThrow({ where: { id: milkB.id } });
  check(
    "link: a later edit of the source reaches the linked record",
    milkEdited.name === "Молоко 3,2%" && milkEdited.supplier === "Ферма-2" && milkEdited.kind === "raw",
    { name: milkEdited.name, supplier: milkEdited.supplier, kind: milkEdited.kind },
  );

  /* ── запись появилась позже — строка ушла ── */
  const creamRow = bProductConflicts.find((row) => row.name === "Сметана")!;
  await db.product.update({ where: { id: creamB.id }, data: { isActive: true } });
  const limitName = limitRows[0].name;
  const cookB = await db.jobPosition.findFirst({ where: { organizationId: b.id, categoryKey: "staff", name: "Повар" } });
  if (cookB) await person(b.id, cookB.id, limitName);
  await runDirectoryExchange(cabinet.id, { actor: one.actor });
  check("re-activated product in B: its row is gone", (await db.directoryExchangeSkip.count({ where: { id: creamRow.id } })) === 0);
  check(
    "employee added in B by hand: the limit row is gone",
    Boolean(cookB) && (await db.directoryExchangeSkip.count({ where: { id: limitRows[0].id } })) === 0,
    { cookB: Boolean(cookB) },
  );

  /* ── участник другой компании и другой аккаунт ── */
  const f = await makeOrg("Чужая");
  const three = await makeOwner(f.id, "three");
  await db.product.create({ data: { name: "Творог", kind: "raw", unit: "kg", organizationId: a.id } });
  await db.product.create({ data: { name: "творог", kind: "raw", unit: "kg", organizationId: f.id, isActive: false } });
  await db.directoryExchangeMember.create({
    data: { masterOrganizationId: cabinet.id, organizationId: f.id, kinds: ["products"], foreign: true, createdByUserId: one.owner.id },
  });
  await runDirectoryExchange(cabinet.id, { actor: one.actor });
  const foreignRows = await skipRows(cabinet.id, { organizationId: f.id });
  check("foreign participant: its own skip rows are written («Творог»)", foreignRows.some((row) => row.name === "Творог" && row.reason === "conflict"));
  const listAfter = await listExchangeSkips({ accountId: one.account.id });
  check(
    "foreign participant: not listed for the cabinet owner",
    !listAfter.organizations.some((organization) => organization.organizationId === f.id) && listAfter.total === (await skipRows(cabinet.id, { organizationId: { in: [a.id, b.id] } })).length,
    listAfter.organizations.map((organization) => organization.name),
  );
  await refused("foreign participant's row cannot be ignored by the cabinet owner → 404", 404, () => ignoreExchangeSkip(one, foreignRows[0].id));
  // У другого аккаунта свой кабинет: отказ идёт от строки чужого кабинета, а не от «кабинета нет».
  const threeCabinet = await ensureExchangeCabinet(three.owner.id, three.account.id);
  orgIds.push(threeCabinet.id);
  const otherList = await listExchangeSkips({ accountId: three.account.id });
  check("another account sees nothing", otherList.total === 0 && otherList.organizations.length === 0);
  const someRow = (await skipRows(cabinet.id, { organizationId: b.id }))[0];
  await refused("another account: ignore → 404", 404, () => ignoreExchangeSkip(three, someRow.id));
  await refused("another account: link → 404", 404, () => linkExchangeSkip(three, someRow.id, milkB.id));
  check("rows untouched by refused calls", (await db.directoryExchangeSkip.count({ where: { id: someRow.id } })) === 1);

  /* ── участник уходит — его строки тоже ── */
  const disconnected = await endExchangeRequest({ id: f.id, organizationId: a.id, accountId: one.account.id, actor: one.actor });
  check(
    "foreign member disconnected: its rows are gone",
    disconnected.action === "disconnected" && (await skipRows(cabinet.id, { organizationId: f.id })).length === 0,
    disconnected,
  );
  await saveExchangeMembers({ ownerUserId: one.owner.id, organizationId: a.id, members: [{ organizationId: b.id, kinds: [] }] });
  check("B leaves the exchange: its rows are gone", (await skipRows(cabinet.id, { organizationId: b.id })).length === 0);
  check("list after B left has no B", !(await listExchangeSkips({ accountId: one.account.id })).organizations.some((o) => o.organizationId === b.id));
}

async function cleanup() {
  const cabinets = await db.organization.findMany({ where: { accountId: { in: accountIds }, kind: "directory" }, select: { id: true } });
  const ids = [...new Set([...cabinets.map((item) => item.id), ...orgIds])].reverse();
  for (const id of ids) {
    await db.organization.delete({ where: { id } }).catch((error) => console.log(`cleanup: ${id} — ${(error as Error).message.split("\n").pop()}`));
  }
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  const leftUsers = await db.user.count({ where: { email: { contains: TAG } } });
  const leftAccounts = await db.account.count({ where: { id: { in: accountIds } } });
  const leftSkips = await db.directoryExchangeSkip.count({ where: { organizationId: { in: orgIds } } });
  console.log(`cleanup: organizations left ${left}, users left ${leftUsers}, accounts left ${leftAccounts}, skip rows left ${leftSkips}`);
}

main()
  .catch((error) => {
    failed += 1;
    console.error("FAIL script crashed", error);
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup failed", error));
    console.log(`TOTAL: ${passed} passed, ${failed} failed`);
    console.log(failed === 0 ? "RESULT: all checks passed" : `RESULT: ${failed} check(s) failed`);
    await db.$disconnect().catch(() => undefined);
    process.exit(failed === 0 ? 0 : 1);
  });
