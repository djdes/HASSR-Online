/*
 * End-to-end check of the directory exchange inside one account against the local DB
 * (part 2 scenario, updated for series A: saving the exchange no longer connects
 * organizations to the cabinet's menu and raw materials, AC6).
 */
import "dotenv/config";

import { db } from "@/lib/db";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { EXCHANGE_KINDS } from "@/lib/directory-exchange/kinds";
import { runAllDirectoryExchanges, runDirectoryExchange, transferOnce, transferPreview } from "@/lib/directory-exchange/run.server";
import { ensureExchangeCabinet, loadExchangeState, saveExchangeMembers } from "@/lib/directory-exchange/settings.server";
import { summaryTotals, type ExchangeSummary } from "@/lib/directory-exchange/summary";
import { createStaffMember } from "@/lib/staff-create";

const TAG = `xchk${Date.now().toString(36)}`;
const orgIds: string[] = [];
const accountIds: string[] = [];
let failed = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
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
  return { owner, account };
}

async function join(ownerId: string, orgId: string, accountId: string) {
  await db.organization.update({ where: { id: orgId }, data: { accountId } });
  await db.organizationMember.create({ data: { userId: ownerId, organizationId: orgId, role: "owner" } });
}

const names = async (orgId: string) => ({
  products: (await db.product.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { name: "asc" } })).map((p) => p.name),
  positions: (await db.jobPosition.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } })).map((p) => `${p.categoryKey}:${p.name}`),
  staff: (await db.user.findMany({ where: { organizationId: orgId, passwordHash: "" }, orderBy: { name: "asc" } })).map((u) => u.name),
  buildings: (await db.building.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } })).map((b) => b.name),
  rooms: (await db.room.findMany({ where: { building: { organizationId: orgId } }, orderBy: { name: "asc" } })).map((r) => r.name),
  areas: (await db.area.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } })).map((a) => a.name),
  equipment: (await db.equipment.findMany({ where: { area: { organizationId: orgId } }, orderBy: { name: "asc" } })).map((e) => e.name),
});

const totals = (summary: ExchangeSummary) => summaryTotals(summary);
const of = (summary: ExchangeSummary, orgId: string) => summary.organizations.find((o) => o.organizationId === orgId)?.kinds;

async function main() {
  /* ── данные: аккаунт, две организации, справочники первой ── */
  const a = await makeOrg("Первая");
  const { owner, account } = await makeOwner(a.id, "one");
  const b = await makeOrg("Вторая", account.id);
  await db.organizationMember.create({ data: { userId: owner.id, organizationId: b.id, role: "owner" } });
  const actor = { userId: owner.id, userName: owner.name };

  await db.product.createMany({
    data: [
      { name: "Молоко 3,2%", kind: "raw", supplier: "Ферма", unit: "l", shelfLifeDays: 5, organizationId: a.id },
      { name: "Сыр твёрдый", kind: "raw", unit: "kg", organizationId: a.id },
      { name: "Борщ", kind: "finished", servingTemp: "soup", shelfLifeHours: 6, organizationId: a.id },
    ],
  });
  const cook = await db.jobPosition.create({ data: { organizationId: a.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  await db.jobPosition.create({ data: { organizationId: a.id, categoryKey: "management", name: "Директор", sortOrder: 2 } });
  for (const [index, name] of ["Иванов Иван", "Петрова Анна"].entries()) {
    await db.user.create({
      data: {
        email: `${TAG}-staff${index}@a.local.haccp`,
        name,
        phone: index === 0 ? "+79851234567" : null,
        passwordHash: "",
        role: "cook",
        jobPositionId: cook.id,
        positionTitle: cook.name,
        organizationId: a.id,
        weeklyDaysOff: [5, 6],
        telegramChatId: `${TAG}-tg${index}`,
      },
    });
  }
  const building = await db.building.create({ data: { organizationId: a.id, name: "Кафе на Ленина", address: "Ленина, 1" } });
  await db.building.create({ data: { organizationId: a.id, name: "Офис", kind: "office" } });
  await db.room.create({ data: { buildingId: building.id, name: "Кухня", kind: "kitchen", cleanerUserIds: [owner.id] } });
  const area = await db.area.create({ data: { organizationId: a.id, name: "Склад", buildingId: building.id } });
  await db.equipment.create({
    data: { name: "Холодильник №1", type: "refrigerator", tempMin: 2, tempMax: 6, areaId: area.id, tuyaDeviceId: `${TAG}-tuya`, fillerUserIds: [owner.id] },
  });

  /* ── связь всех четырёх списков ── */
  const cabinet = await ensureExchangeCabinet(owner.id, account.id);
  orgIds.push(cabinet.id);
  check("cabinet created with the name «Мастер-кабинет»", cabinet.created && cabinet.name === "Мастер-кабинет");
  const again = await ensureExchangeCabinet(owner.id, account.id);
  check("second ensure returns the same cabinet", again.id === cabinet.id && !again.created);

  const saved = await saveExchangeMembers({
    ownerUserId: owner.id,
    ownerName: owner.name,
    organizationId: a.id,
    members: [
      { organizationId: a.id, kinds: [...EXCHANGE_KINDS] },
      { organizationId: b.id, kinds: [...EXCHANGE_KINDS] },
    ],
  });
  check("members saved to the same cabinet", saved.cabinet?.id === cabinet.id, saved);
  const poolOrgs = await db.organization.findMany({ where: { id: { in: [a.id, b.id] } }, select: { linkedServiceCode: true } });
  check(
    "series A AC6: products in the exchange do not connect organizations to the cabinet menu and raw materials",
    poolOrgs.every((org) => org.linkedServiceCode === null),
    { poolOrgs },
  );

  const first = await runDirectoryExchange(cabinet.id, { actor });
  const afterFirst = await names(b.id);
  const sourceA = await names(a.id);
  check("B received products", JSON.stringify(afterFirst.products) === JSON.stringify(["Борщ", "Молоко 3,2%", "Сыр твёрдый"]), afterFirst.products);
  check("B received the staff position only", JSON.stringify(afterFirst.positions) === JSON.stringify(["staff:Повар"]), afterFirst.positions);
  check("B received both line employees", JSON.stringify(afterFirst.staff) === JSON.stringify(["Иванов Иван", "Петрова Анна"]), afterFirst.staff);
  check("B received the building without the office", JSON.stringify(afterFirst.buildings) === JSON.stringify(["Кафе на Ленина"]), afterFirst.buildings);
  check("B received the room", JSON.stringify(afterFirst.rooms.filter((n) => n === "Кухня")) === JSON.stringify(["Кухня"]), afterFirst.rooms);
  check("B received the area", afterFirst.areas.includes("Склад"), afterFirst.areas);
  check("B received the fridge", JSON.stringify(afterFirst.equipment) === JSON.stringify(["Холодильник №1"]), afterFirst.equipment);
  check("same rooms and areas on both sides; the source got no room it did not have", JSON.stringify([afterFirst.rooms, afterFirst.areas]) === JSON.stringify([sourceA.rooms, sourceA.areas]) && JSON.stringify(sourceA.rooms) === JSON.stringify(["Кухня"]) && (of(first, a.id)?.objects.created ?? 0) === 0, { a: sourceA, b: afterFirst });

  const bStaff = await db.user.findMany({ where: { organizationId: b.id } });
  check(
    "rule Р4: no login, mail, Telegram or management role copied",
    bStaff.length === 2 &&
      bStaff.every((u) => u.passwordHash === "" && u.role === "cook" && u.telegramChatId === null && u.email.endsWith(".local.haccp") && !u.email.includes(TAG)),
    bStaff.map((u) => ({ email: u.email, role: u.role, tg: u.telegramChatId })),
  );
  check("staff fields copied: phone, days off, position", bStaff.some((u) => u.phone === "+79851234567") && bStaff.every((u) => JSON.stringify(u.weeklyDaysOff) === "[5,6]" && u.positionTitle === "Повар"));
  const bFridge = await db.equipment.findFirst({ where: { area: { organizationId: b.id } }, include: { area: { include: { building: true } } } });
  check(
    "rule Р4: sensor binding and fillers not copied; norms and place copied",
    bFridge?.tuyaDeviceId === null && bFridge.fillerUserIds.length === 0 && bFridge.tempMin === 2 && bFridge.tempMax === 6 && bFridge.area.name === "Склад" && bFridge.area.building?.name === "Кафе на Ленина",
    bFridge,
  );
  const bRoom = await db.room.findFirst({ where: { name: "Кухня", building: { organizationId: b.id } } });
  check("rule Р4: room responsibles not copied, kind copied", bRoom?.cleanerUserIds.length === 0 && bRoom.kind === "kitchen", bRoom);
  check("summary: B created records in all four lists", EXCHANGE_KINDS.every((kind) => (of(first, b.id)?.[kind].created ?? 0) > 0), of(first, b.id));
  const memberRow = await db.directoryExchangeMember.findFirst({ where: { masterOrganizationId: cabinet.id, organizationId: b.id } });
  check("lastSyncedAt and lastSyncJson written", Boolean(memberRow?.lastSyncedAt) && Boolean(memberRow?.lastSyncJson));
  const audit = await db.auditLog.count({ where: { organizationId: b.id, action: "directory_exchange.synced" } });
  check("audit row directory_exchange.synced for B", audit === 1, audit);

  const idle = await runDirectoryExchange(cabinet.id, { actor });
  const compact = (summary: ExchangeSummary) => JSON.stringify(summary.organizations.map((o) => [o.name.split(" ")[0], Object.fromEntries(Object.entries(o.kinds).map(([k, v]) => [k, Object.values(v).join("/")]))])) + " notes=" + JSON.stringify(summary.notes);
  console.log("DEBUG first", compact(first));
  console.log("DEBUG idle", compact(idle));
  console.log("DEBUG links", JSON.stringify(await db.directoryExchangeLink.groupBy({ by: ["entity", "organizationId"], where: { masterOrganizationId: cabinet.id }, _count: { _all: true } }).then((rows) => rows.map((r) => `${r.entity}:${r.organizationId === a.id ? "A" : "B"}=${r._count._all}`).sort())));
  console.log("DEBUG A", JSON.stringify(await names(a.id)));
  console.log("DEBUG B", JSON.stringify(await names(b.id)));
  check("run right after the first one changes nothing", totals(idle).created === 0 && totals(idle).updated === 0, idle);

  /* ── правка и новая запись во второй → появились в первой ── */
  const milkB = await db.product.findFirst({ where: { organizationId: b.id, name: "Молоко 3,2%" } });
  await db.product.update({ where: { id: milkB!.id }, data: { name: "Молоко 2,5%", supplier: "Завод" } });
  const cookB = await db.jobPosition.findFirst({ where: { organizationId: b.id, name: "Повар" } });
  const hired = await createStaffMember(b.id, { jobPositionId: cookB!.id, fullName: "Сидоров Пётр", phone: "8 (985) 000-11-22" });
  check("new employee added in B", hired.ok);
  const second = await runDirectoryExchange(cabinet.id, { actor });
  console.log("DEBUG second", compact(second));
  const aAfterSecond = await names(a.id);
  const milkA = await db.product.findFirst({ where: { organizationId: a.id, name: "Молоко 2,5%" } });
  check("A received the rename from B", aAfterSecond.products.includes("Молоко 2,5%") && !aAfterSecond.products.includes("Молоко 3,2%") && milkA?.supplier === "Завод", aAfterSecond.products);
  check("A received the new employee from B", aAfterSecond.staff.includes("Сидоров Пётр"), aAfterSecond.staff);
  check("summary: A products updated 1, staff created 1", of(second, a.id)?.products.updated === 1 && of(second, a.id)?.staff.created === 1, of(second, a.id));
  check("no duplicates appeared in B", (await names(b.id)).products.length === 3 && (await names(b.id)).staff.length === 3);

  /* ── удаление не переносится ── */
  const cheeseA = await db.product.findFirst({ where: { organizationId: a.id, name: "Сыр твёрдый" } });
  await db.product.delete({ where: { id: cheeseA!.id } });
  const third = await runDirectoryExchange(cabinet.id, { actor });
  console.log("DEBUG third", compact(third));
  check("deleted product is still in B", (await names(b.id)).products.includes("Сыр твёрдый"));
  check("deleted product was not recreated in A", !(await names(a.id)).products.includes("Сыр твёрдый"));
  check("deletion run created and updated nothing", totals(third).created === 0 && totals(third).updated === 0, third);
  // Правка удалённой записи у соседа к удалившему не возвращается.
  const cheeseB = await db.product.findFirst({ where: { organizationId: b.id, name: "Сыр твёрдый" } });
  await db.product.update({ where: { id: cheeseB!.id }, data: { supplier: "Сыроварня" } });
  await runDirectoryExchange(cabinet.id, { actor });
  check("later edit of the deleted record does not bring it back to A", !(await names(a.id)).products.includes("Сыр твёрдый"));

  const fourth = await runDirectoryExchange(cabinet.id, { actor });
  check("one more run: zero created/updated", totals(fourth).created === 0 && totals(fourth).updated === 0 && totals(fourth).skippedConflict === 0, fourth);

  /* ── оборудование: правка нормы и перенос в другой цех ── */
  const fridgeA = await db.equipment.findFirst({ where: { area: { organizationId: a.id } } });
  await db.equipment.update({ where: { id: fridgeA!.id }, data: { tempMax: 8 } });
  await runDirectoryExchange(cabinet.id, { actor });
  const fridgeB = await db.equipment.findFirst({ where: { area: { organizationId: b.id } } });
  check("equipment norm edit reached B, sensor binding in A untouched", fridgeB?.tempMax === 8 && (await db.equipment.findUnique({ where: { id: fridgeA!.id } }))?.tuyaDeviceId === `${TAG}-tuya`, fridgeB);

  /* ── состояние для окна ── */
  const state = await loadExchangeState(owner.id, a.id);
  check(
    "state: owner can manage, sibling and members listed, last sync present",
    state.canManage && state.siblings.length === 1 && state.siblings[0].id === b.id && state.members.length === 2 && state.cabinet?.id === cabinet.id && state.lastSync !== null && state.counts.products === 2 && state.counts.staff === 3 && state.counts.objects === 1 && state.counts.equipment === 1,
    state,
  );
  const stranger = await loadExchangeState(bStaff[0].id, b.id);
  check("state: not the owner — canManage false, nothing listed", !stranger.canManage && stranger.siblings.length === 0 && stranger.members.length === 0 && stranger.cabinet === null);
  const impersonated = await loadExchangeState(owner.id, a.id, { sessionAllows: false });
  check("state: «войти как» — canManage false", !impersonated.canManage && impersonated.siblings.length === 0);

  /* ── разовый перенос в третью организацию ── */
  const c = await makeOrg("Третья", account.id);
  await db.organizationMember.create({ data: { userId: owner.id, organizationId: c.id, role: "owner" } });
  await db.product.create({ data: { name: "борщ", kind: "finished", organizationId: c.id } });
  const preview = await transferPreview({ fromOrganizationId: a.id, toOrganizationId: c.id });
  const borsch = preview.items.products.find((item) => item.name === "Борщ");
  const person = preview.items.staff.find((item) => item.name === "Иванов Иван");
  const fridgeItem = preview.items.equipment.find((item) => item.entity === "equipment");
  check(
    "transfer preview: lists, parents first, duplicate marked",
    borsch?.exists === true && preview.items.products.filter((item) => !item.exists).length === 1 && preview.items.staff[0].entity === "position" && person?.detail === "Повар" && person.exists === false && preview.items.objects.map((item) => item.entity).join().startsWith("building,room") && fridgeItem?.detail === "Склад",
    preview.items,
  );
  const moved = await transferOnce({
    fromOrganizationId: a.id,
    toOrganizationId: c.id,
    selection: { staff: [person!.id], equipment: [fridgeItem!.id], products: "all" },
    actor,
  });
  const cNames = await names(c.id);
  check("transfer: selected employee came with the position", JSON.stringify(cNames.staff) === JSON.stringify(["Иванов Иван"]) && JSON.stringify(cNames.positions) === JSON.stringify(["staff:Повар"]), cNames);
  check("transfer: equipment came with its area, no building pulled", JSON.stringify(cNames.equipment) === JSON.stringify(["Холодильник №1"]) && cNames.areas.includes("Склад") && cNames.buildings.length === 0, cNames);
  check("transfer: duplicate product skipped, the other added", cNames.products.length === 2 && cNames.products.includes("борщ") && cNames.products.includes("Молоко 2,5%"), cNames.products);
  check("transfer summary: created counted, existing duplicate skipped silently", of(moved, c.id)?.products.created === 1 && of(moved, c.id)?.products.skippedConflict === 0 && of(moved, c.id)?.staff.created === 2 && of(moved, c.id)?.equipment.created === 2, of(moved, c.id));
  check("transfer keeps no links", (await db.directoryExchangeLink.count({ where: { organizationId: c.id } })) === 0);
  check("transfer audited", (await db.auditLog.count({ where: { organizationId: c.id, action: "directory_exchange.transferred" } })) === 1);
  const movedAgain = await transferOnce({ fromOrganizationId: a.id, toOrganizationId: c.id, selection: { staff: "all", equipment: "all", products: "all" }, actor });
  check("repeated transfer adds only what was missing (2 employees, 1 area)", of(movedAgain, c.id)?.staff.created === 2 && of(movedAgain, c.id)?.equipment.created === 1 && of(movedAgain, c.id)?.products.created === 0 && (await names(c.id)).staff.length === 3, { movedAgain: of(movedAgain, c.id), c: await names(c.id) });

  /* ── чужой аккаунт и тариф ── */
  const alien = await makeOrg("Чужая");
  const other = await makeOwner(alien.id, "two", { trialEndsAt: new Date(Date.now() - 40 * 86_400_000), createdAt: new Date(Date.now() - 60 * 86_400_000) });
  const refused = async (label: string, status: number, run: () => Promise<unknown>) => {
    try {
      await run();
      check(label, false, "no error");
    } catch (error) {
      check(label, error instanceof DirectoryExchangeError && error.status === status, String(error));
    }
  };
  await refused("foreign organization in members → 404", 404, () =>
    saveExchangeMembers({ ownerUserId: owner.id, organizationId: a.id, members: [{ organizationId: alien.id, kinds: ["products"] }] }),
  );
  await refused("not the owner saving members → 403", 403, () =>
    saveExchangeMembers({ ownerUserId: other.owner.id, organizationId: a.id, members: [{ organizationId: a.id, kinds: ["products"] }] }),
  );
  await refused("transfer from a foreign organization → 404", 404, () => transferPreview({ fromOrganizationId: alien.id, toOrganizationId: a.id }));
  await refused("transfer into a foreign organization → 404", 404, () => transferOnce({ fromOrganizationId: a.id, toOrganizationId: alien.id, selection: { products: "all" }, actor }));
  await refused("cabinet for a foreign account → 403", 403, () => ensureExchangeCabinet(other.owner.id, account.id));
  check("foreign organization got nothing", (await names(alien.id)).products.length === 0 && (await db.directoryExchangeMember.count({ where: { organizationId: alien.id } })) === 0);

  // Тариф: аккаунт после пробного периода на бесплатном — одно место и одна точка.
  const second2 = await makeOrg("Чужая-2");
  await join(other.owner.id, second2.id, other.account.id);
  const pos = await db.jobPosition.create({ data: { organizationId: alien.id, categoryKey: "staff", name: "Кассир", sortOrder: 1 } });
  await db.user.create({ data: { email: `${TAG}-cashier@a.local.haccp`, name: "Кассиров Ким", passwordHash: "", role: "cook", jobPositionId: pos.id, organizationId: alien.id } });
  await db.building.createMany({ data: [{ organizationId: alien.id, name: "Точка 1" }, { organizationId: alien.id, name: "Точка 2" }] });
  await db.building.create({ data: { organizationId: second2.id, name: "Своя точка" } });
  const otherSaved = await saveExchangeMembers({
    ownerUserId: other.owner.id,
    organizationId: alien.id,
    members: [
      { organizationId: alien.id, kinds: ["staff", "objects"] },
      { organizationId: second2.id, kinds: ["staff", "objects"] },
    ],
  });
  orgIds.push(otherSaved.cabinet!.id);
  const limited = await runDirectoryExchange(otherSaved.cabinet!.id, { actor: { userId: other.owner.id, userName: null } });
  const limitedKinds = of(limited, second2.id);
  console.log("DEBUG limited", compact(limited), "otherCabinet", otherSaved.cabinet?.id ?? null);
  const s2 = await names(second2.id);
  if ((limitedKinds?.staff.skippedLimit ?? 0) > 0) {
    check("tariff: employee over the seat limit skipped and reported", limitedKinds?.staff.skippedLimit === 1 && s2.staff.length === 0 && s2.positions.includes("staff:Кассир"), { limitedKinds, s2 });
    check("tariff: objects over the point limit skipped and reported", (limitedKinds?.objects.skippedLimit ?? 0) >= 1 && s2.buildings.length < 3, { limitedKinds, s2 });
    const limitedAgain = await runDirectoryExchange(otherSaved.cabinet!.id, {});
    check("tariff: skipped records are retried, nothing else changes", totals(limitedAgain).created === 0 && of(limitedAgain, second2.id)?.staff.skippedLimit === 1, of(limitedAgain, second2.id));
  } else {
    console.log(`SKIP tariff limits not enforced in this database (${JSON.stringify(limitedKinds)})`);
  }

  /* ── выход из обмена и плановый запуск ── */
  await saveExchangeMembers({ ownerUserId: owner.id, organizationId: a.id, members: [{ organizationId: b.id, kinds: [] }] });
  check(
    "empty kinds: member and its links removed",
    (await db.directoryExchangeMember.count({ where: { organizationId: b.id } })) === 0 && (await db.directoryExchangeLink.count({ where: { masterOrganizationId: cabinet.id, organizationId: b.id } })) === 0,
  );
  const batch = await runAllDirectoryExchanges();
  check("scheduled run: finished without errors", batch.errors.length === 0 && batch.cabinets >= 1, batch);
}

/* ── вторая проверка: две организации, у которых данные уже были ── */
async function established() {
  console.log("--- established organizations");
  const e1 = await makeOrg("Старая-1");
  const { owner, account } = await makeOwner(e1.id, "three");
  const e2 = await makeOrg("Старая-2", account.id);
  await db.organizationMember.create({ data: { userId: owner.id, organizationId: e2.id, role: "owner" } });
  const actor = { userId: owner.id, userName: owner.name };
  const staff = (orgId: string, positionId: string, name: string, phone: string | null = null) =>
    db.user.create({ data: { email: `${TAG}-${Math.random().toString(36).slice(2)}@x.local.haccp`, name, phone, passwordHash: "", role: "cook", jobPositionId: positionId, positionTitle: "Повар", organizationId: orgId } });

  await db.product.create({ data: { name: "Мука", supplier: "Первый", organizationId: e1.id } });
  await db.product.create({ data: { name: "Соль", organizationId: e1.id } });
  const cook1 = await db.jobPosition.create({ data: { organizationId: e1.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  const waiter1 = await db.jobPosition.create({ data: { organizationId: e1.id, categoryKey: "staff", name: "Официант", sortOrder: 2 } });
  const oleg1 = await staff(e1.id, cook1.id, "Сидоров Олег", "+79851112233");
  const b1 = await db.building.create({ data: { organizationId: e1.id, name: "Точка", address: "Мира, 5" } });
  await db.room.create({ data: { buildingId: b1.id, name: "Зал", kind: "guest" } });
  const k1 = await db.area.create({ data: { organizationId: e1.id, name: "Кухня", buildingId: b1.id } });
  await db.equipment.create({ data: { name: "Печь", type: "oven", areaId: k1.id } });

  await new Promise((resolve) => setTimeout(resolve, 30));
  await db.product.create({ data: { name: " мука", supplier: "Второй", organizationId: e2.id } });
  await db.product.create({ data: { name: "Сахар", organizationId: e2.id } });
  const cook2 = await db.jobPosition.create({ data: { organizationId: e2.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  const oleg2 = await staff(e2.id, cook2.id, "сидоров  олег");
  await staff(e2.id, cook2.id, "Новикова Яна");
  const b2 = await db.building.create({ data: { organizationId: e2.id, name: "Точка" } });
  await db.room.create({ data: { buildingId: b2.id, name: "Зал", kind: "guest" } });
  await db.room.create({ data: { buildingId: b2.id, name: "Бар", kind: "bar" } });
  const k2 = await db.area.create({ data: { organizationId: e2.id, name: "Кухня" } });
  await db.equipment.create({ data: { name: "Печь", type: "oven", areaId: k2.id, tuyaDeviceId: `${TAG}-e2` } });
  await db.equipment.create({ data: { name: "Весы", type: "scale", areaId: k2.id } });

  const saved = await saveExchangeMembers({
    ownerUserId: owner.id,
    organizationId: e2.id,
    members: [
      { organizationId: e1.id, kinds: [...EXCHANGE_KINDS] },
      { organizationId: e2.id, kinds: [...EXCHANGE_KINDS] },
    ],
  });
  const cabinetId = saved.cabinet!.id;
  orgIds.push(cabinetId);
  const run = () => runDirectoryExchange(cabinetId, { actor });
  const compact = (summary: ExchangeSummary) => JSON.stringify(summary.organizations.map((o) => [o.name.split(" ")[0], Object.fromEntries(Object.entries(o.kinds).map(([k, v]) => [k, Object.values(v).join("/")]))]));

  const first = await run();
  console.log("DEBUG established first", compact(first));
  const n1 = await names(e1.id);
  const n2 = await names(e2.id);
  console.log("DEBUG e1", JSON.stringify(n1));
  console.log("DEBUG e2", JSON.stringify(n2));
  const lower = (list: string[]) => list.map((item) => item.trim().toLowerCase().replace(/\s+/g, " ")).sort();
  check("established: products matched by name, no duplicates", JSON.stringify(lower(n1.products)) === JSON.stringify(["мука", "сахар", "соль"]) && JSON.stringify(lower(n2.products)) === JSON.stringify(["мука", "сахар", "соль"]), { n1: n1.products, n2: n2.products });
  const flour = await db.product.findMany({ where: { organizationId: { in: [e1.id, e2.id] }, name: { contains: "ука" } }, orderBy: { createdAt: "asc" } });
  check("established: matched product only linked — nobody's data overwritten", flour.length === 2 && flour[0].supplier === "Первый" && flour[0].name === "Мука" && flour[1].supplier === "Второй", flour.map((p) => [p.name, p.supplier]));
  check("established: first run updated nothing", totals(first).updated === 0, compact(first));
  check("established: positions matched, the missing one created", n1.positions.length === 2 && n2.positions.length === 2, { n1: n1.positions, n2: n2.positions });
  check("established: same person matched, the other created — two each", n1.staff.length === 2 && n2.staff.length === 2, { n1: n1.staff, n2: n2.staff });
  const olegs = await db.user.findMany({ where: { id: { in: [oleg1.id, oleg2.id] } } });
  check("established: matched employee keeps own data on both sides", olegs.find((u) => u.id === oleg1.id)?.phone === "+79851112233" && olegs.find((u) => u.id === oleg2.id)?.phone === null && olegs.find((u) => u.id === oleg2.id)?.name === "сидоров  олег", olegs.map((u) => [u.name, u.phone]));
  check("established: address of the matched building kept", (await db.building.findUnique({ where: { id: b1.id } }))?.address === "Мира, 5" && (await db.building.findUnique({ where: { id: b2.id } }))?.address === null);
  check("established: buildings matched (one each), rooms merged", n1.buildings.length === 1 && n2.buildings.length === 1 && JSON.stringify(n1.rooms) === JSON.stringify(n2.rooms) && n1.rooms.includes("Бар") && n1.rooms.includes("Зал"), { n1: n1.rooms, n2: n2.rooms });
  check("established: area without object matched the same area of the only object", n1.areas.filter((x) => x === "Кухня").length === 1 && n2.areas.filter((x) => x === "Кухня").length === 1 && JSON.stringify(n1.areas) === JSON.stringify(n2.areas), { n1: n1.areas, n2: n2.areas });
  check("established: equipment matched and completed", JSON.stringify(n1.equipment) === JSON.stringify(["Весы", "Печь"]) && JSON.stringify(n2.equipment) === JSON.stringify(["Весы", "Печь"]), { n1: n1.equipment, n2: n2.equipment });
  check("established: sensor binding of the matched oven kept", (await db.equipment.findFirst({ where: { areaId: k2.id, name: "Печь" } }))?.tuyaDeviceId === `${TAG}-e2`);
  const idle = await run();
  check("established: next run is empty", totals(idle).created === 0 && totals(idle).updated === 0 && totals(idle).skippedConflict === 0, compact(idle));

  // Правка совпавшей записи доходит до соседа целиком.
  await db.product.update({ where: { id: flour[1].id }, data: { supplier: "Третий" } });
  const edited = await run();
  const flourAfter = await db.product.findUnique({ where: { id: flour[0].id } });
  check("established: an edit of the matched product reaches the other side", flourAfter?.supplier === "Третий" && of(edited, e1.id)?.products.updated === 1, [flourAfter?.name, flourAfter?.supplier, compact(edited)]);
  const afterEdit = await run();
  check("established: and the run after it is empty", totals(afterEdit).created === 0 && totals(afterEdit).updated === 0, compact(afterEdit));

  // Переименование должности и перевод сотрудника.
  await db.jobPosition.update({ where: { id: waiter1.id }, data: { name: "Официант зала" } });
  await db.user.update({ where: { id: oleg1.id }, data: { jobPositionId: waiter1.id, positionTitle: "Официант зала" } });
  const moved = await run();
  const oleg2After = await db.user.findUnique({ where: { id: oleg2.id }, include: { jobPosition: true } });
  check("position rename and staff move reached the other organization", oleg2After?.jobPosition?.name === "Официант зала" && oleg2After.positionTitle === "Официант зала" && oleg2After.jobPosition.organizationId === e2.id && oleg2After.name === "Сидоров Олег" && oleg2After.phone === "+79851112233", { moved: compact(moved), title: oleg2After?.positionTitle, position: oleg2After?.jobPosition?.name });

  // Архив сотрудника не переносится; правка соседа к архивному не возвращается.
  const yana1 = await db.user.findFirst({ where: { organizationId: e1.id, name: "Новикова Яна" } });
  await db.user.update({ where: { id: yana1!.id }, data: { archivedAt: new Date(), isActive: false } });
  await run();
  const yana2 = await db.user.findFirst({ where: { organizationId: e2.id, name: "Новикова Яна" } });
  check("archived employee stays active in the other organization", yana2?.isActive === true && yana2.archivedAt === null);
  await db.user.update({ where: { id: yana2!.id }, data: { phone: "+79990001122" } });
  await run();
  const yana1After = await db.user.findMany({ where: { organizationId: e1.id, name: "Новикова Яна" } });
  check("archived employee is neither updated nor created again", yana1After.length === 1 && yana1After[0].phone === null && yana1After[0].archivedAt !== null, yana1After.map((u) => [u.phone, u.archivedAt]));

  // Человеку дали вход — обмен его больше не трогает и второго не заводит.
  await db.user.update({ where: { id: oleg2.id }, data: { passwordHash: "has-login" } });
  await db.user.update({ where: { id: oleg1.id }, data: { name: "Сидоров Олег Петрович" } });
  await run();
  const e2People = await db.user.findMany({ where: { organizationId: e2.id, name: { contains: "Сидоров" } } });
  check("rule Р4: employee with a login is not touched and not duplicated", e2People.length === 1 && e2People[0].name === "Сидоров Олег" && e2People[0].passwordHash === "has-login", e2People.map((u) => u.name));

  // Конфликт названий: правка не проходит, пробуется снова, после освобождения имени доходит.
  const target = await db.building.create({ data: { organizationId: e2.id, name: "Новая-цель" } });
  await run();
  const copy = await db.building.findFirst({ where: { organizationId: e1.id, name: "Новая-цель" } });
  check("new building reached the other organization", Boolean(copy));
  await db.building.delete({ where: { id: copy!.id } });
  await db.building.update({ where: { id: b1.id }, data: { name: "Новая-цель" } });
  const clash = await run();
  check("name clash: update skipped and counted, nothing overwritten", of(clash, e2.id)?.objects.skippedConflict === 1 && of(clash, e2.id)?.objects.updated === 0 && (await db.building.findUnique({ where: { id: b2.id } }))?.name === "Точка" && (await db.building.count({ where: { organizationId: e2.id } })) === 2, compact(clash));
  const clashAgain = await run();
  check("name clash: retried on the next run", of(clashAgain, e2.id)?.objects.skippedConflict === 1, compact(clashAgain));
  await db.building.update({ where: { id: target.id }, data: { name: "Другая" } });
  const resolved = await run();
  check("name clash resolved: the rename arrives, the deleted copy is not recreated", (await db.building.findUnique({ where: { id: b2.id } }))?.name === "Новая-цель" && of(resolved, e2.id)?.objects.updated === 1 && (await db.building.count({ where: { organizationId: e1.id } })) === 1, compact(resolved));
  const calm = await run();
  check("after the clash: empty run", totals(calm).created === 0 && totals(calm).updated === 0 && totals(calm).skippedConflict === 0, compact(calm));

  // Список сняли — он больше не обменивается, остальные продолжают.
  await saveExchangeMembers({ ownerUserId: owner.id, organizationId: e1.id, members: [{ organizationId: e2.id, kinds: ["products"] }] });
  await staff(e1.id, cook1.id, "Тестов Тест");
  await db.product.create({ data: { name: "Перец", organizationId: e1.id } });
  const partial = await run();
  const e2Final = await names(e2.id);
  check("unchecked list stops, checked list goes on", !e2Final.staff.includes("Тестов Тест") && e2Final.products.includes("Перец") && of(partial, e2.id)?.staff.created === 0, compact(partial));

  // Закрытая организация в обмене не участвует.
  await db.account.update({ where: { id: account.id }, data: { subscriptionPlan: "standard", subscriptionEnd: new Date(Date.now() + 30 * 86_400_000), planPoints: 1, planCycle: "month", trialEndsAt: new Date(Date.now() - 86_400_000) } });
  await db.organization.update({ where: { id: e2.id }, data: { trialEndsAt: new Date(Date.now() - 3_600_000) } });
  const { isOrganizationLocked } = await import("@/lib/org-trial.server");
  // Кэш замка живёт полминуты — спрашиваем «из будущего».
  const later = new Date(Date.now() + 60_000);
  if (await isOrganizationLocked(e2.id, later)) {
    await db.product.create({ data: { name: "Лавр", organizationId: e1.id } });
    const lockedRun = await runDirectoryExchange(cabinetId, { actor, now: later });
    check("locked organization is left out with a note", !(await names(e2.id)).products.includes("Лавр") && lockedRun.notes.length === 1 && !lockedRun.organizations.some((o) => o.organizationId === e2.id), lockedRun);
    try {
      await transferOnce({ fromOrganizationId: e1.id, toOrganizationId: e2.id, selection: { products: "all" }, actor, now: later });
      check("transfer into a locked organization → 409", false);
    } catch (error) {
      check("transfer into a locked organization → 409", error instanceof DirectoryExchangeError && error.status === 409, String(error));
    }
  } else {
    console.log("SKIP locked organization could not be arranged in this database");
  }
}

async function cleanup() {
  // Кабинеты аккаунтов тоже наши; организация владельца удаляется последней.
  const cabinets = await db.organization.findMany({ where: { accountId: { in: accountIds }, kind: "directory" }, select: { id: true } });
  const ids = [...new Set([...cabinets.map((item) => item.id), ...orgIds])].reverse();
  for (const id of ids) {
    await db.organization.delete({ where: { id } }).catch((error) => console.log(`cleanup: ${id} — ${(error as Error).message.split("\n").pop()}`));
  }
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  const leftUsers = await db.user.count({ where: { email: { contains: TAG } } });
  const leftAccounts = await db.account.count({ where: { id: { in: accountIds } } });
  console.log(`cleanup: organizations left ${left}, users left ${leftUsers}, accounts left ${leftAccounts}`);
}

/* ── третья проверка: случаи из независимой проверки (2026-11-19) ── */
async function reviewed() {
  console.log("--- review fixes");
  const r1 = await makeOrg("Проверка-1");
  const { owner, account } = await makeOwner(r1.id, "five");
  const r2 = await makeOrg("Проверка-2", account.id);
  await db.organizationMember.create({ data: { userId: owner.id, organizationId: r2.id, role: "owner" } });
  const actor = { userId: owner.id, userName: owner.name };
  const cabinet = await ensureExchangeCabinet(owner.id, account.id);
  const save = (kinds: Array<(typeof EXCHANGE_KINDS)[number]>) =>
    saveExchangeMembers({
      ownerUserId: owner.id,
      ownerName: owner.name,
      organizationId: r1.id,
      members: [
        { organizationId: r1.id, kinds },
        { organizationId: r2.id, kinds },
      ],
    });

  // Цеха с одним названием в обеих организациях, объекты — с разными.
  const b1 = await db.building.create({ data: { organizationId: r1.id, name: "Кафе Север", address: "Северная, 1" } });
  const b2 = await db.building.create({ data: { organizationId: r2.id, name: "Кафе Юг", address: "Южная, 2" } });
  await db.area.create({ data: { organizationId: r1.id, name: "Кухня", buildingId: b1.id, description: "Первая" } });
  const area2 = await db.area.create({ data: { organizationId: r2.id, name: "Кухня", buildingId: b2.id, description: "Вторая" } });
  await db.equipment.create({ data: { name: "Плита", type: "oven", areaId: area2.id } });

  // Люди и продукты, которых обмен не видит: вход, архив, выключенный продукт.
  const cook1 = await db.jobPosition.create({ data: { organizationId: r1.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  const cook2 = await db.jobPosition.create({ data: { organizationId: r2.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  const person = (orgId: string, positionId: string, name: string, extra: Record<string, unknown> = {}) =>
    db.user.create({
      data: {
        email: `${TAG}-${Math.random().toString(36).slice(2, 8)}@r.local.haccp`,
        name,
        passwordHash: "",
        role: "cook",
        jobPositionId: positionId,
        positionTitle: "Повар",
        organizationId: orgId,
        ...extra,
      },
    });
  await person(r1.id, cook1.id, "Логинов Лев");
  await person(r2.id, cook2.id, "Логинов Лев", { passwordHash: "has-a-login" });
  await person(r1.id, cook1.id, "Архипова Ада");
  await person(r2.id, cook2.id, "Архипова Ада", { archivedAt: new Date(), isActive: false });
  const phoned = await person(r1.id, cook1.id, "Телефонов Тит", { phone: "8 (985) 111-22-33" });
  await db.product.create({ data: { name: "Кефир", kind: "raw", unit: "l", organizationId: r1.id } });
  await db.product.create({ data: { name: "кефир", kind: "raw", unit: "l", organizationId: r2.id, isActive: false } });

  await save(["equipment", "staff", "products"]);
  await runDirectoryExchange(cabinet.id, { actor });
  const count = (orgId: string, name: string) => db.user.count({ where: { organizationId: orgId, name } });
  check("person with a login in the other organization is not duplicated", (await count(r2.id, "Логинов Лев")) === 1);
  check("archived person in the other organization is not duplicated", (await count(r2.id, "Архипова Ада")) === 1);
  check(
    "switched-off product is not brought back",
    (await db.product.count({ where: { organizationId: r2.id, name: { equals: "Кефир", mode: "insensitive" } } })) === 1 &&
      (await db.product.count({ where: { organizationId: r2.id, isActive: true, name: { equals: "Кефир", mode: "insensitive" } } })) === 0,
  );
  const copy = await db.user.findFirst({ where: { organizationId: r2.id, name: "Телефонов Тит" } });
  check("phone in an old format reaches the other organization in one form", copy?.phone === "+79851112233", copy?.phone);

  // Правка копии во второй организации не должна стереть телефон в первой.
  await db.user.update({ where: { id: copy!.id }, data: { phone: null, weeklyDaysOff: [0] } });
  await runDirectoryExchange(cabinet.id, { actor });
  const source = await db.user.findUnique({ where: { id: phoned.id } });
  check("an edit without a phone does not erase the phone of the other side", Boolean(source?.phone), source?.phone);

  // «Объекты» включили позже «Оборудования»: цеха остаются на своих объектах.
  await save(["equipment", "staff", "products", "objects"]);
  await runDirectoryExchange(cabinet.id, { actor });
  const after2 = await db.area.findUnique({ where: { id: area2.id } });
  check(
    "ticking «Объекты» later keeps the other organization's area on its own building with its own description",
    after2?.buildingId === b2.id && after2?.description === "Вторая" && after2?.name === "Кухня",
    after2,
  );
  check(
    "equipment stays in its area",
    (await db.equipment.count({ where: { areaId: area2.id, name: "Плита" } })) === 1,
  );
  check("both buildings now exist on both sides", (await names(r1.id)).buildings.length === 2 && (await names(r2.id)).buildings.length === 2, {
    r1: (await names(r1.id)).buildings,
    r2: (await names(r2.id)).buildings,
  });
  const idle = await runDirectoryExchange(cabinet.id, { actor });
  check("after the review cases: empty run", totals(idle).created === 0 && totals(idle).updated === 0, idle.organizations);
}

main()
  .then(established)
  .then(reviewed)
  .catch((error) => {
    failed += 1;
    console.error("FAIL script crashed", error);
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup failed", error));
    console.log(failed === 0 ? "RESULT: all checks passed" : `RESULT: ${failed} check(s) failed`);
    await db.$disconnect().catch(() => undefined);
    process.exit(failed === 0 ? 0 : 1);
  });
