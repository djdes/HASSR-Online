/*
 * Series D, items Р2 (exchange runs + ROOT page), Р5 (exchange history with undo) and Р10 (undo of a
 * «Журналы» transfer) — AC2, AC5, AC6 — end to end against the local DB.
 *
 * 1. Runs (AC2): every exchange attempt leaves a `DirectoryExchangeRun` row — manual («Синхронизировать
 *    сейчас»), save in the background (`runDirectoryExchangeWithin` that did not finish in time: the row
 *    is completed when the exchange ends), busy (lock held), error (the cabinet stops being a cabinet),
 *    approval of another company's request; a failing recorder (unknown cabinet) does not change the
 *    exchange's own error. The ROOT overview lists them, the «only errors» filter, the cabinets with an
 *    error as the last run; the access rule is «Клиенты» with the «all clients» scope. Old rows pruned.
 * 2. History (AC5): creates and updates of an exchange are recorded per organization with the fields
 *    before and after and the run; listing — newest first, own source by name. Undo of an update brings
 *    the old value back in that organization only, the next exchange does not push it back, a later edit
 *    of the source comes again; journal settings likewise. Undo of a create: a product is turned off, an
 *    employee archived, a room deleted (with its mirror workshop) — and the exchange does not create
 *    them again; a position with staff stays («has_staff», 409, not marked undone). Repeat — 409;
 *    a manager who is not the account owner, the owner of another account — 404. A company of another
 *    account sees only «мастер-кабинет «…»» as the source and can undo its own changes; the cabinet
 *    owner cannot undo the company's changes.
 * 3. Journals transfer undo (AC6): the transfer keeps a snapshot of the recipient's settings; undo
 *    restores them; edited after the transfer — kept («edited»); an old transfer without a snapshot is
 *    still not undoable.
 */
import "dotenv/config";

import { db } from "@/lib/db";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { ExchangeChangeKeptError, parseChangeSnapshot } from "@/lib/directory-exchange/history";
import { listExchangeHistory, undoExchangeChange } from "@/lib/directory-exchange/history.server";
import { loadEntityRows } from "@/lib/directory-exchange/entities.server";
import { createExchangeRequest, decideExchangeRequest } from "@/lib/directory-exchange/requests.server";
import {
  runDirectoryExchange,
  runDirectoryExchangeWithin,
  transferOnce,
  withExchangeLock,
} from "@/lib/directory-exchange/run.server";
import { loadExchangeRunsOverview, pruneExchangeLogs } from "@/lib/directory-exchange/runs.server";
import { ensureExchangeCabinet, saveExchangeMembers } from "@/lib/directory-exchange/settings.server";
import { summaryTotals, type ExchangeSummary } from "@/lib/directory-exchange/summary";
import { listRecentTransfers, undoTransfer } from "@/lib/directory-exchange/transfer-undo.server";
import { canAccessPlatformPath, platformGateFor } from "@/lib/platform-access";

const TAG = `hchk${Date.now().toString(36)}`;
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

const totals = (summary: ExchangeSummary | null | undefined) => summaryTotals(summary ?? { organizations: [], notes: [] });
const of = (summary: ExchangeSummary | null | undefined, orgId: string) => summary?.organizations.find((o) => o.organizationId === orgId)?.kinds;
const sorted = (value: unknown) => (Array.isArray(value) ? [...value].map(String).sort() : value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function refused(fn: () => Promise<unknown>): Promise<DirectoryExchangeError | Error | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error as Error;
  }
}
const statusOf = (error: unknown) => (error instanceof DirectoryExchangeError ? `${error.status}:${error.code ?? ""}` : String((error as Error)?.message ?? error));

const runsOf = (cabinetId: string) =>
  db.directoryExchangeRun.findMany({ where: { masterOrganizationId: cabinetId }, orderBy: [{ startedAt: "asc" }, { id: "asc" }] });
const disabledOf = async (orgId: string) =>
  sorted((await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { disabledJournalCodes: true } })).disabledJournalCodes);
const product = (orgId: string, name: string) => db.product.findFirst({ where: { organizationId: orgId, name } });

async function main() {
  /* ── аккаунт X: A (источник) и B ── */
  const a = await makeOrg("Первая");
  const x = await makeOwner(a.id, "x");
  const b = await makeOrg("Вторая", x.account.id);
  await join(x.owner.id, b.id);
  // Руководитель B без владения аккаунтом.
  const managerB = await db.user.create({
    data: { email: `${TAG}-mgr@example.test`, name: "Управляющий Б", passwordHash: "not-a-real-hash", role: "manager", organizationId: b.id },
  });

  await db.product.createMany({
    data: [
      { name: "Молоко", kind: "raw", supplier: "Ферма", unit: "l", organizationId: a.id },
      { name: "Сыр", kind: "raw", unit: "kg", organizationId: a.id },
    ],
  });
  const cook = await db.jobPosition.create({ data: { organizationId: a.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  await db.user.create({
    data: { email: `${TAG}-s1@a.local.haccp`, name: "Иванов Иван", passwordHash: "", role: "cook", jobPositionId: cook.id, positionTitle: "Повар", organizationId: a.id },
  });
  const cafe = await db.building.create({ data: { organizationId: a.id, name: "Кафе", address: "Ленина, 1" } });
  await db.room.create({ data: { buildingId: cafe.id, name: "Склад", kind: "storage" } });
  await db.organization.update({ where: { id: a.id }, data: { disabledJournalCodes: ["health_check"], autoJournalCodes: [], journalAutomationJson: {} } });
  await db.organization.update({ where: { id: b.id }, data: { disabledJournalCodes: ["health_check"], autoJournalCodes: [], journalAutomationJson: {} } });

  const cabinet = await ensureExchangeCabinet(x.owner.id, x.account.id);
  orgIds.push(cabinet.id);
  await saveExchangeMembers({
    ownerUserId: x.owner.id,
    ownerName: x.owner.name,
    organizationId: a.id,
    members: [
      { organizationId: a.id, kinds: ["products", "staff", "objects", "journals"] },
      { organizationId: b.id, kinds: ["products", "staff", "objects", "journals"] },
    ],
  });

  /* ── Р2: журнал обменов ── */
  console.log("--- AC2: exchange runs");
  const first = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  let runs = await runsOf(cabinet.id);
  const firstRun = runs.at(-1);
  check("AC2 (manual): one row, trigger manual, status ok", runs.length === 1 && firstRun?.trigger === "manual" && firstRun.status === "ok", runs);
  check(
    "AC2 (manual): counters are the summary totals, finished, duration recorded, no error",
    Boolean(firstRun) &&
      firstRun!.created === totals(first).created &&
      firstRun!.updated === totals(first).updated &&
      firstRun!.skipped === totals(first).skippedLimit + totals(first).skippedConflict &&
      firstRun!.created > 0 &&
      firstRun!.finishedAt !== null &&
      (firstRun!.durationMs ?? -1) >= 0 &&
      firstRun!.error === null,
    { firstRun, totals: totals(first) },
  );

  // Сохранение настроек: обмен не уложился в ожидание (0 мс) — доходит в фоне, строка дописывается в конце.
  await db.product.update({ where: { id: (await product(a.id, "Сыр"))!.id }, data: { supplier: "Сырзавод" } });
  const background = await runDirectoryExchangeWithin(cabinet.id, { actor: x.actor, trigger: "save", waitMs: 0 });
  check("AC2 (background): the exchange went to the background", background.running === true);
  const done = background.running ? await background.done : null;
  runs = await runsOf(cabinet.id);
  const saveRun = runs.find((run) => run.trigger === "save");
  check(
    "AC2 (background): the row of the save is completed when the exchange ends (ok, counters, finished)",
    Boolean(saveRun) && saveRun!.status === "ok" && saveRun!.finishedAt !== null && saveRun!.updated === totals(done).updated && saveRun!.updated === 1,
    { saveRun, done: totals(done) },
  );

  // Кабинет занят: плановый обмен не ждёт — «занято».
  const busyError = await refused(() => withExchangeLock(cabinet.id, () => runDirectoryExchange(cabinet.id)));
  runs = await runsOf(cabinet.id);
  const busyRun = runs.at(-1);
  check("AC2 (busy): the exchange refused with 409 exchange_busy", statusOf(busyError) === "409:exchange_busy", statusOf(busyError));
  check(
    "AC2 (busy): row with trigger schedule, status busy, no counters, finished",
    busyRun?.trigger === "schedule" && busyRun.status === "busy" && busyRun.created === 0 && busyRun.finishedAt !== null && busyRun.error === null,
    busyRun,
  );

  // Ошибка: кабинет перестал быть кабинетом.
  await db.organization.update({ where: { id: cabinet.id }, data: { kind: "regular" } });
  const failure = await refused(() => runDirectoryExchange(cabinet.id));
  await db.organization.update({ where: { id: cabinet.id }, data: { kind: "directory" } });
  runs = await runsOf(cabinet.id);
  const errorRun = runs.at(-1);
  check("AC2 (error): the exchange's own error is thrown (404)", statusOf(failure).startsWith("404"), statusOf(failure));
  check(
    "AC2 (error): row with status error and a one-line message, no stack",
    errorRun?.status === "error" && errorRun.trigger === "schedule" && errorRun.error === "Мастер-кабинет не найден" && errorRun.finishedAt !== null,
    errorRun,
  );

  // Запись журнала не ломает обмен: кабинета нет — строку не записать, ошибка та же, что без журнала.
  const ghost = await refused(() => runDirectoryExchange(`missing-${TAG}`, { actor: x.actor }));
  check(
    "AC2 (recorder failure): an unknown cabinet — no row, the exchange's own 404",
    statusOf(ghost).startsWith("404") && (await db.directoryExchangeRun.count({ where: { masterOrganizationId: `missing-${TAG}` } })) === 0,
    statusOf(ghost),
  );

  // ROOT: последние обмены, фильтр ошибок, кабинеты с ошибкой.
  let overview = await loadExchangeRunsOverview();
  const listed = overview.runs.filter((run) => run.cabinet.id === cabinet.id);
  check(
    "AC2 (ROOT): recent runs list our four rows with the cabinet name and the owner",
    listed.length === 4 && listed.every((run) => run.cabinet.name === cabinet.name && run.cabinet.ownerName === x.owner.name && run.cabinet.ownerEmail === x.owner.email),
    listed.map((run) => [run.trigger, run.status, run.cabinet]),
  );
  const onlyErrors = await loadExchangeRunsOverview({ onlyErrors: true });
  check(
    "AC2 (ROOT): «only errors» keeps only error rows, ours among them",
    onlyErrors.runs.every((run) => run.status === "error") && onlyErrors.runs.some((run) => run.id === errorRun?.id),
  );
  const problem = overview.problems.find((item) => item.cabinet.id === cabinet.id);
  check("AC2 (ROOT): the cabinet is listed as «last run — error»", problem?.problem === "error" && problem.lastRun?.error === "Мастер-кабинет не найден" && problem.members === 2, problem);
  await runDirectoryExchange(cabinet.id, { actor: x.actor });
  overview = await loadExchangeRunsOverview();
  check("AC2 (ROOT): after a successful run the cabinet is no longer a problem", !overview.problems.some((item) => item.cabinet.id === cabinet.id));
  check(
    "AC2 (ROOT): access — «Клиенты», not for the «own clients» scope, not for other sections",
    platformGateFor("/root/directory-exchange") === "clients" &&
      canAccessPlatformPath({ superadmin: false, sections: ["clients"] }, "/root/directory-exchange?errors=1") &&
      !canAccessPlatformPath({ superadmin: false, sections: ["clients"], scope: "own" }, "/root/directory-exchange") &&
      !canAccessPlatformPath({ superadmin: false, sections: ["seo"] }, "/root/directory-exchange"),
  );

  /* ── Р5: история ── */
  console.log("--- AC5: history");
  const createdInB = await db.directoryExchangeChange.findMany({ where: { organizationId: b.id, op: "create" }, orderBy: { createdAt: "asc" } });
  const bFirst = of(first, b.id);
  check(
    "AC5: every create in B is a history row (products, position, employee, building, room)",
    createdInB.length === totals({ organizations: [{ organizationId: b.id, name: "", kinds: bFirst! }], notes: [] }).created &&
      same(createdInB.map((row) => row.entity).sort(), ["building", "position", "product", "product", "room", "staff"]),
    createdInB.map((row) => [row.entity, row.name]),
  );
  check(
    "AC5: create rows — source A, the first run, no «before», «after» with the fields",
    createdInB.every((row) => row.sourceOrganizationId === a.id && row.runId === firstRun?.id && row.beforeJson === null && row.masterOrganizationId === cabinet.id) &&
      parseChangeSnapshot(createdInB.find((row) => row.entity === "product" && row.name === "Молоко")?.afterJson)?.fields.supplier === "Ферма",
  );
  check("AC5: nothing recorded for A (it only gave)", (await db.directoryExchangeChange.count({ where: { organizationId: a.id } })) === 0);
  const cheeseUpdate = await db.directoryExchangeChange.findFirst({ where: { organizationId: b.id, op: "update", entity: "product" } });
  check(
    "AC5: the update (from the background save) — fields before and after",
    parseChangeSnapshot(cheeseUpdate?.beforeJson)?.fields.supplier === null && parseChangeSnapshot(cheeseUpdate?.afterJson)?.fields.supplier === "Сырзавод" && cheeseUpdate?.runId === saveRun?.id,
    cheeseUpdate,
  );

  // Правка в A → обновление в B; отмена возвращает прежнее только в B.
  const milkA = (await product(a.id, "Молоко"))!;
  await db.product.update({ where: { id: milkA.id }, data: { supplier: "Ферма-2" } });
  await runDirectoryExchange(cabinet.id, { actor: x.actor });
  const milkB = (await product(b.id, "Молоко"))!;
  check("AC5: A's edit reached B", milkB.supplier === "Ферма-2");
  const history = await listExchangeHistory({ organizationId: b.id });
  const milkChange = history[0];
  check(
    "AC5: list — newest first, the update of «Молоко» from A by name",
    milkChange?.entity === "product" && milkChange.op === "update" && milkChange.name === "Молоко" && milkChange.kind === "products" &&
      same(milkChange.from, { name: a.name, cabinet: false, foreign: false }) && milkChange.undoable,
    milkChange,
  );
  check(
    "AC5: list is sorted newest first",
    history.every((item, index) => index === 0 || item.createdAt <= history[index - 1].createdAt),
  );

  check("AC5 (owner only): a manager of B who does not own the account — 404", statusOf(await refused(() => undoExchangeChange({ id: milkChange.id, actor: { userId: managerB.id, userName: null } }))).startsWith("404"));
  const undoMilk = await undoExchangeChange({ id: milkChange.id, actor: x.actor });
  check("AC5: undo of the update — restored", undoMilk.op === "update" && undoMilk.action === "restored", undoMilk);
  check(
    "AC5: B's «Молоко» is back to «Ферма», A keeps «Ферма-2»",
    (await product(b.id, "Молоко"))?.supplier === "Ферма" && (await product(a.id, "Молоко"))?.supplier === "Ферма-2",
  );
  const milkLink = await db.directoryExchangeLink.findFirst({ where: { masterOrganizationId: cabinet.id, entity: "product", organizationId: b.id, entityId: milkB.id } });
  const milkRow = (await loadEntityRows("product", b.id)).find((row) => row.id === milkB.id);
  check("AC5: B's link carries the restored record's own fingerprint", Boolean(milkLink) && milkLink!.hash === milkRow?.hash, { link: milkLink?.hash, row: milkRow?.hash });
  const repeat = await refused(() => undoExchangeChange({ id: milkChange.id, actor: x.actor }));
  check("AC5: repeat undo — 409 change_undone", statusOf(repeat) === "409:change_undone", statusOf(repeat));
  const quiet = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check(
    "AC5: the next exchange does not push the restored value back (nothing updated, A and B keep their values)",
    totals(quiet).updated === 0 && (await product(a.id, "Молоко"))?.supplier === "Ферма-2" && (await product(b.id, "Молоко"))?.supplier === "Ферма",
    totals(quiet),
  );
  await db.product.update({ where: { id: milkA.id }, data: { supplier: "Ферма-3" } });
  await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("AC5: a later edit of the source comes again", (await product(b.id, "Молоко"))?.supplier === "Ферма-3");
  const undoneRow = await db.directoryExchangeChange.findUniqueOrThrow({ where: { id: milkChange.id } });
  check("AC5: the change is marked undone by the owner", undoneRow.undoneAt !== null && undoneRow.undoneByUserId === x.owner.id);
  const audit = await db.auditLog.findFirst({ where: { organizationId: b.id, action: "directory_exchange.change_undone", entityId: milkChange.id } });
  check("AC5: audit «directory_exchange.change_undone» in B", (audit?.details as { op?: string } | null)?.op === "update", audit?.details);

  // Изменение, которое потом правили, не отменяется.
  const cheeseChange = (await listExchangeHistory({ organizationId: b.id })).find((item) => item.id === cheeseUpdate?.id)!;
  await db.product.update({ where: { id: (await product(b.id, "Сыр"))!.id }, data: { unit: "g" } });
  const editedAfter = await refused(() => undoExchangeChange({ id: cheeseChange.id, actor: x.actor }));
  check(
    "AC5: an update edited afterwards stays (409 change_kept «edited»), not marked undone",
    editedAfter instanceof ExchangeChangeKeptError && editedAfter.reason === "edited" && (await db.directoryExchangeChange.findUniqueOrThrow({ where: { id: cheeseChange.id } })).undoneAt === null,
    statusOf(editedAfter),
  );
  await runDirectoryExchange(cabinet.id, { actor: x.actor });

  // Настройки журналов: правка A → B; отмена возвращает прежние только в B.
  await db.organization.update({ where: { id: a.id }, data: { disabledJournalCodes: ["health_check", "pest_control"] } });
  await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("AC5 (journals): A's journals reached B", same(await disabledOf(b.id), ["health_check", "pest_control"]));
  const settingsChange = (await listExchangeHistory({ organizationId: b.id })).find((item) => item.entity === "journal_settings" && item.op === "update");
  check("AC5 (journals): the settings update is in B's history (no name, list «journals»)", settingsChange?.kind === "journals" && settingsChange.name === "", settingsChange);
  const undoSettings = await undoExchangeChange({ id: settingsChange!.id, actor: x.actor });
  check(
    "AC5 (journals): undo — B's previous settings back, A unchanged",
    undoSettings.action === "restored" && same(await disabledOf(b.id), ["health_check"]) && same(await disabledOf(a.id), ["health_check", "pest_control"]),
    { b: await disabledOf(b.id), a: await disabledOf(a.id) },
  );
  const settingsQuiet = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("AC5 (journals): the next exchange keeps B's restored settings", same(await disabledOf(b.id), ["health_check"]) && (of(settingsQuiet, b.id)?.journals.updated ?? -1) === 0);

  // Отмена созданного.
  const createdRows = await listExchangeHistory({ organizationId: b.id });
  const created = (entity: string, name: string) => createdRows.find((item) => item.op === "create" && item.entity === entity && item.name === name)!;
  const positionKept = await refused(() => undoExchangeChange({ id: created("position", "Повар").id, actor: x.actor }));
  check(
    "AC5 (create): a position with an employee stays (409 change_kept «has_staff»), not marked undone",
    positionKept instanceof ExchangeChangeKeptError && positionKept.reason === "has_staff" &&
      (await db.directoryExchangeChange.findUniqueOrThrow({ where: { id: created("position", "Повар").id } })).undoneAt === null &&
      (await db.jobPosition.count({ where: { organizationId: b.id, name: "Повар" } })) === 1,
    statusOf(positionKept),
  );
  const cheeseB = (await product(b.id, "Сыр"))!;
  const undoStaff = await undoExchangeChange({ id: created("staff", "Иванов Иван").id, actor: x.actor });
  check(
    "AC5 (create): the employee is archived",
    undoStaff.action === "archived" && (await db.user.findFirstOrThrow({ where: { organizationId: b.id, name: "Иванов Иван" } })).archivedAt !== null,
    undoStaff,
  );
  const roomB = await db.room.findFirstOrThrow({ where: { building: { organizationId: b.id }, name: "Склад" } });
  const mirrorBefore = await db.area.count({ where: { organizationId: b.id, name: "Склад" } });
  const roomMirror = await db.area.findFirst({ where: { organizationId: b.id, name: "Склад" }, select: { id: true } });
  check(
    "review #2: the room's create records the mirror workshop its creation made (afterJson.mirrorId)",
    Boolean(roomMirror) &&
      parseChangeSnapshot((await db.directoryExchangeChange.findUniqueOrThrow({ where: { id: created("room", "Склад").id } })).afterJson)?.mirrorId === roomMirror!.id,
  );
  const undoRoom = await undoExchangeChange({ id: created("room", "Склад").id, actor: x.actor });
  check(
    "AC5 (create): the room is deleted together with its mirror workshop",
    undoRoom.action === "deleted" && (await db.room.count({ where: { id: roomB.id } })) === 0 && mirrorBefore === 1 && (await db.area.count({ where: { organizationId: b.id, name: "Склад" } })) === 0,
    { undoRoom, mirrorBefore },
  );
  const roomLink = await db.directoryExchangeLink.findFirst({ where: { masterOrganizationId: cabinet.id, entity: "room", organizationId: b.id, groupId: created("room", "Склад") ? (await db.directoryExchangeChange.findUniqueOrThrow({ where: { id: created("room", "Склад").id } })).groupId : "" } });
  check("AC5 (create): the room's link in B is a tombstone", roomLink !== null && roomLink.entityId === null, roomLink);
  // «Сыр» правили (unit «g» выше) — остаётся; «Молоко» тоже правилось обменом — остаётся.
  const cheeseKept = await refused(() => undoExchangeChange({ id: created("product", "Сыр").id, actor: x.actor }));
  check("AC5 (create): a product edited after the exchange stays («edited»)", cheeseKept instanceof ExchangeChangeKeptError && cheeseKept.reason === "edited", statusOf(cheeseKept));
  const afterUndo = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check(
    "AC5 (create): the next exchange creates nothing again in B (room, employee)",
    (of(afterUndo, b.id)?.objects.created ?? -1) === 0 &&
      (of(afterUndo, b.id)?.staff.created ?? -1) === 0 &&
      (await db.room.count({ where: { building: { organizationId: b.id }, name: "Склад" } })) === 0 &&
      (await db.user.count({ where: { organizationId: b.id, name: "Иванов Иван", archivedAt: null } })) === 0,
    of(afterUndo, b.id),
  );
  check("AC5 (create): the cheese product is still active", (await db.product.findUniqueOrThrow({ where: { id: cheeseB.id } })).isActive);

  /* ── компания другого аккаунта ── */
  console.log("--- AC5: a company of another account");
  const code = (await db.organization.findUniqueOrThrow({ where: { id: cabinet.id }, select: { serviceCode: true } })).serviceCode!;
  const f = await makeOrg("Компания-F");
  const fo = await makeOwner(f.id, "f");
  const request = await createExchangeRequest({ organizationId: f.id, actor: fo.actor, code, mode: "link", kinds: ["products"] });
  const approved = await decideExchangeRequest({
    token: request.token,
    actor: x.actor,
    decision: "approve",
    allowedKinds: ["products"],
    organizationIds: [a.id, b.id],
    waitMs: 120_000,
  });
  check("AC2 (approval): approved", approved.status === "approved");
  const approvalRun = (await runsOf(cabinet.id)).find((run) => run.trigger === "approval");
  check("AC2 (approval): the approval exchange is recorded with trigger approval", approvalRun?.status === "ok" && approvalRun.created > 0, approvalRun);
  const fHistory = await listExchangeHistory({ organizationId: f.id });
  check(
    "AC5 (foreign): F's history — the owner's products, source only «мастер-кабинет «…»»",
    fHistory.length >= 2 && fHistory.every((item) => item.from.cabinet && item.from.foreign && item.from.name === cabinet.name),
    fHistory.map((item) => [item.name, item.from]),
  );
  const fJson = JSON.stringify(fHistory);
  check("AC5 (foreign): no name or id of the owner's organizations in F's history", !fJson.includes(a.name) && !fJson.includes(b.name) && !fJson.includes(a.id) && !fJson.includes(b.id));
  const fMilk = fHistory.find((item) => item.name === "Молоко" && item.op === "create")!;
  check("AC5 (foreign): the cabinet owner cannot undo F's change — 404", statusOf(await refused(() => undoExchangeChange({ id: fMilk.id, actor: x.actor }))).startsWith("404"));
  const fUndo = await undoExchangeChange({ id: fMilk.id, actor: fo.actor });
  check(
    "AC5 (foreign): F's owner undoes the create in F — the product is turned off, A and B keep theirs",
    fUndo.action === "deactivated" && (await product(f.id, "Молоко"))?.isActive === false && (await product(a.id, "Молоко"))?.isActive === true && (await product(b.id, "Молоко"))?.isActive === true,
    fUndo,
  );
  const fAudit = await db.auditLog.findFirst({ where: { organizationId: f.id, action: "directory_exchange.change_undone" } });
  const fDetails = JSON.stringify(fAudit?.details ?? {});
  check("AC5 (foreign): F's audit has no cabinet id or owner's organizations", Boolean(fAudit) && fDetails.includes("crossAccount") && !fDetails.includes(cabinet.id) && !fDetails.includes(a.id), fAudit?.details);
  const fNext = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("AC5 (foreign): the next exchange does not create «Молоко» in F again", (of(fNext, f.id)?.products.created ?? -1) === 0 && (await db.product.count({ where: { organizationId: f.id, name: "Молоко", isActive: true } })) === 0);

  /* ── правки по ревью ── */
  console.log("--- review #2: only the mirror the creation made is removed");
  const cafeB = await db.building.findFirstOrThrow({ where: { organizationId: b.id, name: "Кафе" } });
  // B заводит цех «Мойка» руками; A добавляет помещения «Мойка» и «Кладовая».
  const handArea = await db.area.create({ data: { organizationId: b.id, name: "Мойка", buildingId: cafeB.id } });
  await db.room.createMany({ data: [{ buildingId: cafe.id, name: "Мойка", kind: "other" }, { buildingId: cafe.id, name: "Кладовая", kind: "storage" }] });
  await runDirectoryExchange(cabinet.id, { actor: x.actor });
  const roomChange = async (name: string) =>
    db.directoryExchangeChange.findFirstOrThrow({ where: { organizationId: b.id, entity: "room", op: "create", name } });
  const washChange = await roomChange("Мойка");
  const pantryChange = await roomChange("Кладовая");
  const pantryMirror = await db.area.findFirst({ where: { organizationId: b.id, name: "Кладовая" } });
  check(
    "review #2: a room matched to a hand-made same-name workshop records no mirror; a new mirror is recorded",
    parseChangeSnapshot(washChange.afterJson)?.mirrorId === undefined &&
      Boolean(pantryMirror) &&
      parseChangeSnapshot(pantryChange.afterJson)?.mirrorId === pantryMirror!.id,
    { wash: washChange.afterJson, pantry: pantryChange.afterJson },
  );
  const undoWash = await undoExchangeChange({ id: washChange.id, actor: x.actor });
  check(
    "review #2: undo of that room deletes the room but keeps B's hand-made workshop",
    undoWash.action === "deleted" &&
      (await db.room.count({ where: { building: { organizationId: b.id }, name: "Мойка" } })) === 0 &&
      (await db.area.count({ where: { id: handArea.id } })) === 1,
  );
  // Изменение до отметки (без mirrorId): зеркало не трогается.
  const { mirrorId: _mirror, ...oldAfter } = pantryChange.afterJson as Record<string, unknown>;
  await db.directoryExchangeChange.update({ where: { id: pantryChange.id }, data: { afterJson: oldAfter as object } });
  const undoPantry = await undoExchangeChange({ id: pantryChange.id, actor: x.actor });
  check(
    "review #2: an old change without a recorded mirror deletes the room only, the workshop stays",
    undoPantry.action === "deleted" &&
      (await db.room.count({ where: { building: { organizationId: b.id }, name: "Кладовая" } })) === 0 &&
      (await db.area.count({ where: { id: pantryMirror!.id } })) === 1,
  );

  // Р: одна организация в двух кабинетах. Аккаунт P: X и Y в своём кабинете CA (товары и
  // оборудование); X ещё и участник кабинета CB компании Q (товары).
  console.log("--- review #1/#2: an organization in two cabinets; an area's mirror room");
  const xOrg = await makeOrg("Икс");
  const p = await makeOwner(xOrg.id, "p");
  const yOrg = await makeOrg("Игрек", p.account.id);
  await join(p.owner.id, yOrg.id);
  await db.product.create({ data: { name: "Хлеб", kind: "raw", supplier: "Пекарня", unit: "pcs", organizationId: xOrg.id } });
  await db.area.create({ data: { organizationId: xOrg.id, name: "Цех заготовки" } });
  const pointY = await db.building.create({ data: { organizationId: yOrg.id, name: "Точка Игрек" } });
  const ca = await ensureExchangeCabinet(p.owner.id, p.account.id);
  orgIds.push(ca.id);
  await saveExchangeMembers({
    ownerUserId: p.owner.id,
    ownerName: p.owner.name,
    organizationId: xOrg.id,
    members: [
      { organizationId: xOrg.id, kinds: ["products", "equipment"] },
      { organizationId: yOrg.id, kinds: ["products", "equipment"] },
    ],
  });
  await runDirectoryExchange(ca.id, { actor: p.actor });
  const areaY = await db.area.findFirst({ where: { organizationId: yOrg.id, name: "Цех заготовки" } });
  const mirrorRoomY = await db.room.findFirst({ where: { buildingId: pointY.id, name: "Цех заготовки" } });
  const areaChange = await db.directoryExchangeChange.findFirst({ where: { organizationId: yOrg.id, entity: "area", op: "create" } });
  check(
    "review #2: Y got the workshop on its only point with a mirror room, recorded in the change",
    Boolean(areaY) && areaY!.buildingId === pointY.id && Boolean(mirrorRoomY) && parseChangeSnapshot(areaChange?.afterJson)?.mirrorId === mirrorRoomY!.id,
    areaChange?.afterJson,
  );
  const undoArea = await undoExchangeChange({ id: areaChange!.id, actor: p.actor });
  check(
    "review #2: undo of the created workshop removes its mirror room too (both unused)",
    undoArea.action === "deleted" && (await db.area.count({ where: { id: areaY!.id } })) === 0 && (await db.room.count({ where: { id: mirrorRoomY!.id } })) === 0,
    undoArea,
  );
  const caAgain = await runDirectoryExchange(ca.id, { actor: p.actor });
  check("review #2: the workshop is not created in Y again", (of(caAgain, yOrg.id)?.equipment.created ?? -1) === 0 && (await db.area.count({ where: { organizationId: yOrg.id, name: "Цех заготовки" } })) === 0);

  const qOrg = await makeOrg("Компания-Q");
  const q = await makeOwner(qOrg.id, "q");
  await db.product.create({ data: { name: "Хлеб", kind: "raw", supplier: "Пекарня", unit: "pcs", organizationId: qOrg.id } });
  const cb = await ensureExchangeCabinet(q.owner.id, q.account.id);
  orgIds.push(cb.id);
  const cbCode = (await db.organization.findUniqueOrThrow({ where: { id: cb.id }, select: { serviceCode: true } })).serviceCode!;
  const join2 = await createExchangeRequest({ organizationId: xOrg.id, actor: p.actor, code: cbCode, mode: "link", kinds: ["products"] });
  const joined = await decideExchangeRequest({ token: join2.token, actor: q.actor, decision: "approve", allowedKinds: ["products"], organizationIds: [qOrg.id], waitMs: 120_000 });
  check("review #1: X joined company Q's cabinet CB", joined.status === "approved");
  const qBread = (await product(qOrg.id, "Хлеб"))!;
  await db.product.update({ where: { id: qBread.id }, data: { supplier: "Пекарня-2" } });
  await runDirectoryExchange(cb.id, { actor: q.actor });
  check("review #1: Q's edit reached X through CB", (await product(xOrg.id, "Хлеб"))?.supplier === "Пекарня-2");
  await runDirectoryExchange(ca.id, { actor: p.actor });
  check("review #1: CA spread it from X to Y", (await product(yOrg.id, "Хлеб"))?.supplier === "Пекарня-2");
  const cbChange = (await listExchangeHistory({ organizationId: xOrg.id })).find((item) => item.op === "update" && item.name === "Хлеб");
  check("review #1: X's history has the update from CB (cabinet label)", Boolean(cbChange) && cbChange!.from.cabinet && cbChange!.from.name === cb.name, cbChange);
  const undoBread = await undoExchangeChange({ id: cbChange!.id, actor: p.actor });
  check("review #1: undo at X restores «Пекарня» in X only", undoBread.action === "restored" && (await product(xOrg.id, "Хлеб"))?.supplier === "Пекарня" && (await product(yOrg.id, "Хлеб"))?.supplier === "Пекарня-2");
  const xBread = (await product(xOrg.id, "Хлеб"))!;
  const xRowHash = (await loadEntityRows("product", xOrg.id)).find((row) => row.id === xBread.id)?.hash;
  const xLinks = await db.directoryExchangeLink.findMany({ where: { organizationId: xOrg.id, entity: "product", entityId: xBread.id } });
  check(
    "review #1: X's links in both cabinets carry the restored record's fingerprint",
    xLinks.length === 2 && new Set(xLinks.map((link) => link.masterOrganizationId)).size === 2 && xLinks.every((link) => link.hash === xRowHash),
    xLinks.map((link) => [link.masterOrganizationId === ca.id ? "CA" : "CB", link.hash === xRowHash]),
  );
  const caQuiet = await runDirectoryExchange(ca.id, { actor: p.actor });
  const cbQuiet = await runDirectoryExchange(cb.id, { actor: q.actor });
  check(
    "review #1: the next CA and CB exchanges push nothing — Y keeps «Пекарня-2», X «Пекарня», Q «Пекарня-2»",
    totals(caQuiet).updated === 0 &&
      totals(cbQuiet).updated === 0 &&
      (await product(yOrg.id, "Хлеб"))?.supplier === "Пекарня-2" &&
      (await product(xOrg.id, "Хлеб"))?.supplier === "Пекарня" &&
      (await product(qOrg.id, "Хлеб"))?.supplier === "Пекарня-2",
    { ca: totals(caQuiet), cb: totals(cbQuiet) },
  );

  /* ── очистка ── */
  console.log("--- AC2: pruning");
  const oldRun = await db.directoryExchangeRun.create({ data: { masterOrganizationId: cabinet.id, trigger: "schedule", status: "ok", startedAt: new Date(Date.now() - 91 * DAY) } });
  const keptRun = await db.directoryExchangeRun.create({ data: { masterOrganizationId: cabinet.id, trigger: "schedule", status: "ok", startedAt: new Date(Date.now() - 89 * DAY) } });
  const oldChange = await db.directoryExchangeChange.create({
    data: { masterOrganizationId: cabinet.id, organizationId: b.id, entity: "product", entityId: "x", groupId: "g", op: "create", name: "старое", createdAt: new Date(Date.now() - 31 * DAY) },
  });
  const freshChange = await db.directoryExchangeChange.create({
    data: { masterOrganizationId: cabinet.id, organizationId: b.id, entity: "product", entityId: "y", groupId: "g", op: "create", name: "свежее", createdAt: new Date(Date.now() - 29 * DAY) },
  });
  await pruneExchangeLogs(new Date());
  check(
    "AC2/AC5: runs older than 90 days and changes older than 30 days are deleted, newer ones stay",
    (await db.directoryExchangeRun.count({ where: { id: oldRun.id } })) === 0 &&
      (await db.directoryExchangeRun.count({ where: { id: keptRun.id } })) === 1 &&
      (await db.directoryExchangeChange.count({ where: { id: oldChange.id } })) === 0 &&
      (await db.directoryExchangeChange.count({ where: { id: freshChange.id } })) === 1,
  );
  const expired = await db.directoryExchangeChange.create({
    data: { masterOrganizationId: cabinet.id, organizationId: b.id, entity: "product", entityId: cheeseB.id, groupId: "g", op: "create", name: "Сыр", createdAt: new Date(Date.now() - 31 * DAY) },
  });
  check("AC5: a change older than 30 days is not undone (409)", statusOf(await refused(() => undoExchangeChange({ id: expired.id, actor: x.actor }))) === "409:change_expired");
  check("AC5: a change older than 30 days is not listed", !(await listExchangeHistory({ organizationId: b.id })).some((item) => item.id === expired.id));

  /* ── Р10: отмена переноса «Журналов» ── */
  console.log("--- AC6: journals transfer undo");
  const c = await makeOrg("Третья", x.account.id);
  await join(x.owner.id, c.id);
  await db.organization.update({ where: { id: c.id }, data: { disabledJournalCodes: ["cleaning"], autoJournalCodes: [], journalAutomationJson: {} } });
  await transferOnce({ fromOrganizationId: a.id, toOrganizationId: c.id, selection: { journals: "all" }, actor: x.actor });
  check("AC6: the transfer replaced C's journal settings", same(await disabledOf(c.id), ["health_check", "pest_control"]));
  const cRow = await db.directoryTransfer.findFirstOrThrow({ where: { toOrganizationId: c.id } });
  const before = (cRow.createdJson as { before?: { journal_settings?: Record<string, { disabledJournalCodes?: string }> } }).before;
  check("AC6: the transfer keeps a snapshot of C's previous settings", before?.journal_settings?.[c.id]?.disabledJournalCodes === JSON.stringify(["cleaning"]), cRow.createdJson);
  const cListed = (await listRecentTransfers({ accountId: x.account.id, userId: x.owner.id })).find((item) => item.to.id === c.id);
  check(
    "AC6: listed as «Журналы: replaced», undoable, not «cannot be undone»",
    Boolean(cListed) && same(cListed!.replacedKinds, ["journals"]) && same(cListed!.fixedKinds, []) && !cListed!.onlyFixed && cListed!.undoable,
    cListed,
  );
  const cUndo = await undoTransfer({ id: cRow.id, ownerUserId: x.owner.id, ownerName: x.owner.name });
  check(
    "AC6: undo restores C's previous settings",
    same(cUndo.undone.map((item) => [item.entity, item.action]), [["journal_settings", "restored"]]) && cUndo.kept.length === 0 && same(await disabledOf(c.id), ["cleaning"]),
    { cUndo, disabled: await disabledOf(c.id) },
  );

  const d = await makeOrg("Четвёртая", x.account.id);
  await join(x.owner.id, d.id);
  await db.organization.update({ where: { id: d.id }, data: { disabledJournalCodes: ["cleaning"], autoJournalCodes: [], journalAutomationJson: {} } });
  await transferOnce({ fromOrganizationId: a.id, toOrganizationId: d.id, selection: { journals: "all" }, actor: x.actor });
  await db.organization.update({ where: { id: d.id }, data: { disabledJournalCodes: ["med_books"] } });
  const dRow = await db.directoryTransfer.findFirstOrThrow({ where: { toOrganizationId: d.id } });
  const dUndo = await undoTransfer({ id: dRow.id, ownerUserId: x.owner.id, ownerName: x.owner.name });
  check(
    "AC6: edited after the transfer — kept with «edited», D's own edit stays",
    dUndo.undone.length === 0 && same(dUndo.kept.map((item) => [item.entity, item.reason]), [["journal_settings", "edited"]]) && same(await disabledOf(d.id), ["med_books"]),
    { dUndo, disabled: await disabledOf(d.id) },
  );

  const e = await makeOrg("Пятая", x.account.id);
  await join(x.owner.id, e.id);
  await db.organization.update({ where: { id: e.id }, data: { disabledJournalCodes: ["cleaning"], autoJournalCodes: [], journalAutomationJson: {} } });
  await transferOnce({ fromOrganizationId: a.id, toOrganizationId: e.id, selection: { journals: "all" }, actor: x.actor });
  const eRow = await db.directoryTransfer.findFirstOrThrow({ where: { toOrganizationId: e.id } });
  // Перенос до серии D: снимка нет.
  const { before: _dropped, ...legacy } = eRow.createdJson as Record<string, unknown>;
  await db.directoryTransfer.update({ where: { id: eRow.id }, data: { createdJson: legacy as object } });
  const eListed = (await listRecentTransfers({ accountId: x.account.id, userId: x.owner.id })).find((item) => item.to.id === e.id);
  check("AC6: an old transfer without a snapshot — «cannot be undone», no undo", Boolean(eListed) && same(eListed!.fixedKinds, ["journals"]) && eListed!.onlyFixed && !eListed!.undoable, eListed);
  check(
    "AC6: an old transfer without a snapshot — undo refused 409",
    statusOf(await refused(() => undoTransfer({ id: eRow.id, ownerUserId: x.owner.id, ownerName: x.owner.name }))) === "409:transfer_not_undoable" &&
      same(await disabledOf(e.id), ["health_check", "pest_control"]),
  );
}

async function cleanup() {
  const cabinets = await db.organization.findMany({ where: { accountId: { in: accountIds }, kind: "directory" }, select: { id: true } });
  const ids = [...new Set([...cabinets.map((item) => item.id), ...orgIds])].reverse();
  await db.platformSetting.deleteMany({ where: { key: { in: ids.map((id) => `org-journal-controls:${id}`) } } });
  for (const id of ids) {
    await db.organization.delete({ where: { id } }).catch((error) => {
      if (!String((error as Error).message).includes("not found") && !String((error as Error).message).includes("No record")) console.log(`cleanup: ${id} — ${(error as Error).message.split("\n").pop()}`);
    });
  }
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  const leftUsers = await db.user.count({ where: { email: { contains: TAG } } });
  const leftRuns = await db.directoryExchangeRun.count({ where: { masterOrganizationId: { in: ids } } });
  const leftChanges = await db.directoryExchangeChange.count({ where: { OR: [{ organizationId: { in: ids } }, { masterOrganizationId: { in: ids } }] } });
  console.log(`cleanup: organizations left ${left}, users left ${leftUsers}, runs left ${leftRuns}, changes left ${leftChanges}`);
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
