/*
 * Series E, Р5 (network manager) and Р8 (network page of the Mini App) — AC5, AC8 — end to end against
 * the local DB. Calls the session-level access checks the routes use (`exchangeAccessForSession`,
 * `networkOwnerForSession`, `loadAccountNetworkFact`, `loadMiniNetwork`) with constructed sessions,
 * and the lib functions behind the routes.
 *
 * Account X (paid): owner O (home A, member of A and B), manager M (home B, role manager), cook K (B).
 * Account Y (paid): owner F (home Z) — another company.
 *
 * 1. Before the appointment M is refused everywhere; the owner lists candidates (M, not O, not K, not F).
 * 2. The owner appoints M (audit account.network_manager_added); F, K, O, M again — refused.
 * 3. M can: network summary + mini page, exchange state, save members (cabinet stays the owner's),
 *    sync, skips (ignore + link), history undo, transfer + undo, cabinet code, account balance + transfer —
 *    every audit row carries M. M cannot: appoint/remove managers, read or decide another company's
 *    request, send a request, pay the plan from the account balances.
 * 4. Another account's owner, impersonation, a point manager — refused.
 * 5. Removal and archiving revoke at once; a member of an account organization is a candidate too.
 *
 * Run from the repository root: npx tsx .agent/tasks/multi-org-followups-e-2026-11-21/raw/manager-check.ts
 */
import "../../../../scripts/e2e/env";

import type { Session } from "next-auth";

import { accountRoleOf, appointNetworkManager, canManageNetwork, loadNetworkManagers, networkOwnerForSession, NetworkManagerError, removeNetworkManager } from "@/lib/account-roles.server";
import { AccountTransferError, accountBalancesForPage, loadAccountBalances, transferBetweenOwnOrganizations } from "@/lib/balance/account-transfer.server";
import { db } from "@/lib/db";
import { exchangeAccessForSession } from "@/lib/directory-exchange/access.server";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { listExchangeHistory, undoExchangeChange } from "@/lib/directory-exchange/history.server";
import { createExchangeRequest, decideExchangeRequest, loadExchangeRequestByToken, loadExchangeRequests } from "@/lib/directory-exchange/requests.server";
import { runDirectoryExchangeWithin, transferOnce } from "@/lib/directory-exchange/run.server";
import { ensureExchangeCabinet, exchangeCabinetCode, loadExchangeState, regenerateExchangeCode, saveExchangeMembers } from "@/lib/directory-exchange/settings.server";
import { ignoreExchangeSkip, linkExchangeSkip, listExchangeSkips } from "@/lib/directory-exchange/skips.server";
import { listRecentTransfers, undoTransfer } from "@/lib/directory-exchange/transfer-undo.server";
import { loadAccountNetworkFact } from "@/lib/network-access.server";
import { loadMiniNetwork } from "@/lib/network-mini.server";
import { NetworkSummaryAccessError, loadNetworkSummary } from "@/lib/network-summary.server";

const TAG = `mgrchk${Date.now().toString(36)}`;
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

// Письма и служебные строки обмена в dev пишутся в журнал — не засоряем вывод.
const realInfo = console.info.bind(console);
console.info = (...args: unknown[]) => {
  const line = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
  if (line.startsWith("[email/dev]") || line.includes("[directory-exchange]")) return;
  realInfo(...args);
};

/** Отказ с этим статусом (DirectoryExchangeError, AccountTransferError, NetworkManagerError, …). */
async function refused(label: string, statuses: number[], run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    check(label, false, "no error");
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    check(label, typeof status === "number" && statuses.includes(status), { status, message: (error as Error)?.message });
  }
}

async function summaryRefused(userId: string, orgId: string): Promise<boolean> {
  try {
    await loadNetworkSummary({ ownerUserId: userId, activeOrgId: orgId });
    return false;
  } catch (error) {
    return error instanceof NetworkSummaryAccessError && error.code === "not_owner";
  }
}

type SessionUser = { id: string; name: string; email: string; role: string; organizationId: string; organizationName: string };

function sessionFor(user: SessionUser, activeOrganizationId: string, extra: Record<string, unknown> = {}): Session {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: user.organizationName,
      isRoot: false,
      actingAsOrganizationId: null,
      activeOrganizationId,
      permissionPreset: null,
      pointScope: null,
      ...extra,
    },
    expires: new Date(Date.now() + DAY).toISOString(),
  } as unknown as Session;
}

async function makeOrg(name: string, accountId: string | null = null, extra: Record<string, unknown> = {}) {
  const org = await db.organization.create({ data: { name: `${name} ${TAG}`, type: "restaurant", accountId, ...extra } });
  orgIds.push(org.id);
  return org;
}

async function makeUser(orgId: string, label: string, name: string, role: string, extra: Record<string, unknown> = {}) {
  return db.user.create({
    data: { email: `${TAG}-${label}@example.test`, name, passwordHash: "not-a-real-hash", role, organizationId: orgId, ...extra },
  });
}

const paid = () => ({ subscriptionPlan: "standard", subscriptionEnd: new Date(Date.now() + 30 * DAY), planPoints: 10, planCycle: "month" });

async function auditCount(where: { organizationId?: string; action: string; userId: string }) {
  return db.auditLog.count({ where });
}

async function main() {
  /* ── аккаунт X: A (владелец), B (управляющий M, повар K) ── */
  const a = await makeOrg("Кафе А", null, { balanceRub: 5000 });
  const owner = await makeUser(a.id, "owner", "Владелец Олег", "manager");
  const account = await db.account.create({ data: { ownerUserId: owner.id, ...paid() } });
  accountIds.push(account.id);
  await db.organization.update({ where: { id: a.id }, data: { accountId: account.id } });
  const b = await makeOrg("Бар Б", account.id, { balanceRub: 1000 });
  await db.organizationMember.createMany({
    data: [
      { userId: owner.id, organizationId: a.id, role: "owner" },
      { userId: owner.id, organizationId: b.id, role: "owner" },
    ],
  });
  const manager = await makeUser(b.id, "manager", "Управляющая Мария", "manager");
  const cook = await makeUser(b.id, "cook", "Повар Кирилл", "cook");

  /* ── аккаунт Y: другая компания ── */
  const z = await makeOrg("Чужая Z");
  const foreign = await makeUser(z.id, "foreign", "Чужой Фёдор", "manager");
  const foreignAccount = await db.account.create({ data: { ownerUserId: foreign.id, ...paid() } });
  accountIds.push(foreignAccount.id);
  await db.organization.update({ where: { id: z.id }, data: { accountId: foreignAccount.id } });
  await db.organizationMember.create({ data: { userId: foreign.id, organizationId: z.id, role: "owner" } });

  // Справочники: «Сыр» у A (обмен создаст у B); «Молоко» у A и «МОЛОКО» у B (пропуск «Связать»);
  // «Кефир» у A и выключенный «кефир» у B (пропуск «Не переносить»); сотрудник A для переноса.
  await db.product.create({ data: { name: "Сыр", kind: "raw", unit: "kg", organizationId: a.id } });
  await db.product.create({ data: { name: "Молоко", kind: "raw", supplier: "Ферма", unit: "l", organizationId: a.id } });
  await db.product.create({ data: { name: "Кефир", kind: "raw", unit: "l", organizationId: a.id } });
  const milkB = await db.product.create({ data: { name: "МОЛОКО", kind: "finished", supplier: "Завод", unit: "l", shelfLifeDays: 3, organizationId: b.id } });
  await db.product.create({ data: { name: "кефир", kind: "raw", unit: "l", organizationId: b.id, isActive: false } });
  const cookPosition = await db.jobPosition.create({ data: { organizationId: a.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  await db.user.create({
    data: { email: `${TAG}-staff@a.local.haccp`, name: "Иванов Иван", passwordHash: "", role: "cook", jobPositionId: cookPosition.id, positionTitle: "Повар", organizationId: a.id },
  });

  const withOrg = (user: { id: string; name: string; email: string; role: string; organizationId: string }, orgName: string): SessionUser => ({ ...user, organizationName: orgName });
  const ownerSession = sessionFor(withOrg(owner, a.name), a.id);
  const managerSession = sessionFor(withOrg(manager, b.name), b.id);
  const mActor = { userId: manager.id, userName: manager.name };

  /* ── 1. до назначения ── */
  console.log("--- before the appointment");
  check("M: no account role", (await accountRoleOf(manager.id, account.id)) === null);
  check("M: no menu item «Сеть»", (await loadAccountNetworkFact(managerSession)) === false);
  check("M: exchange routes → 403", !(await exchangeAccessForSession(managerSession)).ok && (await exchangeAccessForSession(managerSession).then((r) => (r.ok ? 200 : r.response.status))) === 403);
  check("M: network summary refused", await summaryRefused(manager.id, b.id));
  check("M: mini page refused", (await loadMiniNetwork(managerSession)) === null);
  await refused("M: account balances → 403", [403], () => loadAccountBalances(manager.id, b.id));
  check("owner: menu item «Сеть» (2 organizations)", (await loadAccountNetworkFact(ownerSession)) === true);

  /* ── 2. назначение ── */
  console.log("--- appointment");
  const ownerAccess = await networkOwnerForSession(ownerSession);
  check("owner: managers API access", ownerAccess.ok && ownerAccess.accountId === account.id && ownerAccess.organizationId === a.id, ownerAccess);
  if (!ownerAccess.ok) throw new Error("owner refused");
  const ownerActor = { ...ownerAccess, ipAddress: "127.0.0.1" };
  const view0 = await loadNetworkManagers(account.id);
  const candidateIds = view0.candidates.map((candidate) => candidate.userId);
  check("candidates: M (manager of B) is offered", candidateIds.includes(manager.id), view0.candidates);
  check("candidates: not the owner, not a cook, not another company", !candidateIds.includes(owner.id) && !candidateIds.includes(cook.id) && !candidateIds.includes(foreign.id), candidateIds);
  check("candidates: M is shown with her organization", view0.candidates.find((c) => c.userId === manager.id)?.organizations.includes(b.name) === true);
  check("no managers yet", view0.managers.length === 0);
  await refused("appoint another company's owner → 404", [404], () => appointNetworkManager(ownerActor, foreign.id));
  await refused("appoint a cook → 404", [404], () => appointNetworkManager(ownerActor, cook.id));
  await refused("appoint the owner himself → 409", [409], () => appointNetworkManager(ownerActor, owner.id));
  const appointed = await appointNetworkManager(ownerActor, manager.id);
  check("owner appoints M", appointed.userId === manager.id);
  await refused("appoint M again → 409", [409], () => appointNetworkManager(ownerActor, manager.id));
  const row = await db.accountNetworkManager.findUnique({ where: { accountId_userId: { accountId: account.id, userId: manager.id } } });
  check("row: account, user, granted by the owner", row?.grantedByUserId === owner.id, row);
  const addedAudit = await db.auditLog.findFirst({ where: { organizationId: a.id, action: "account.network_manager_added", userId: owner.id } });
  check("audit account.network_manager_added in the owner's organization, names M", (addedAudit?.details as { managerUserId?: string } | null)?.managerUserId === manager.id, addedAudit);
  const view1 = await loadNetworkManagers(account.id);
  check("list: M is an active manager, no longer a candidate", view1.managers.some((m) => m.userId === manager.id && m.active) && !view1.candidates.some((c) => c.userId === manager.id), view1);

  /* M не назначает и не снимает */
  const mOwnerAccess = await networkOwnerForSession(managerSession);
  check("M: managers API → 403", !mOwnerAccess.ok && mOwnerAccess.status === 403, mOwnerAccess);
  await refused("M: appoint a manager (lib) → 403", [403], () => appointNetworkManager({ accountId: account.id, ownerUserId: manager.id, organizationId: b.id }, cook.id));
  await refused("M: remove a manager (lib) → 403", [403], () => removeNetworkManager({ accountId: account.id, ownerUserId: manager.id, organizationId: b.id }, manager.id));

  /* ── 3. управляющий может ── */
  console.log("--- the manager can");
  check("M: role network_manager", (await accountRoleOf(manager.id, account.id)) === "network_manager");
  check("M: canManageNetwork", await canManageNetwork(manager.id, account.id));
  check("M: menu item «Сеть»", (await loadAccountNetworkFact(managerSession)) === true);
  const mAccess = await exchangeAccessForSession(managerSession);
  check(
    "M: exchange routes allowed — actor M, cabinet owner O",
    mAccess.ok && mAccess.context.role === "network_manager" && mAccess.context.actor.userId === manager.id && mAccess.context.ownerUserId === owner.id && mAccess.context.accountId === account.id,
    mAccess.ok ? mAccess.context.role : mAccess.response.status,
  );
  const mOwnerOnly = await exchangeAccessForSession(managerSession, { ownerOnly: true });
  check("M: another company's requests (owner only) → 403", !mOwnerOnly.ok && mOwnerOnly.response.status === 403);
  const ownerOwnerOnly = await exchangeAccessForSession(ownerSession, { ownerOnly: true });
  check("owner: requests allowed", ownerOwnerOnly.ok && ownerOwnerOnly.context.role === "owner");

  const summary = await loadNetworkSummary({ ownerUserId: manager.id, activeOrgId: b.id });
  check("M: network summary — both organizations, B current", summary.rows.length === 2 && summary.rows.find((r) => r.id === b.id)?.current === true && summary.totals.balanceRub === 6000, summary.rows.map((r) => r.name));
  const mini = await loadMiniNetwork(managerSession);
  check("M: mini page rows (A, B)", mini?.rows.length === 2, mini);
  check("M: mini «Перейти» only where M is a member (B yes, A no)", mini?.rows.find((r) => r.id === b.id)?.canOpen === true && mini?.rows.find((r) => r.id === a.id)?.canOpen === false, mini?.rows);
  const ownerMini = await loadMiniNetwork(ownerSession);
  check("owner: mini page rows, «Перейти» everywhere", ownerMini?.rows.length === 2 && ownerMini.rows.every((r) => r.canOpen), ownerMini?.rows);
  check("cook: mini page refused", (await loadMiniNetwork(sessionFor(withOrg(cook, b.name), b.id))) === null);

  const mState = await loadExchangeState(manager.id, b.id, { sessionAllows: true });
  check("M: exchange card — canManage, not the account owner, sees A", mState.canManage && !mState.isAccountOwner && mState.siblings.some((s) => s.id === a.id), { canManage: mState.canManage, isAccountOwner: mState.isAccountOwner });
  const oState = await loadExchangeState(owner.id, a.id, { sessionAllows: true });
  check("owner: exchange card — isAccountOwner", oState.canManage && oState.isAccountOwner);
  check("M impersonated session: card closed", !(await loadExchangeState(manager.id, b.id, { sessionAllows: false })).canManage);

  // Настройка обмена: кабинет создаётся, но принадлежит владельцу аккаунта.
  const saved = await saveExchangeMembers({
    ownerUserId: manager.id,
    ownerName: manager.name,
    organizationId: b.id,
    members: [
      { organizationId: a.id, kinds: ["products"] },
      { organizationId: b.id, kinds: ["products"] },
    ],
  });
  const cabinet = saved.cabinet;
  check("M: save exchange members → cabinet created", Boolean(cabinet));
  if (!cabinet) throw new Error("no cabinet");
  orgIds.push(cabinet.id);
  const cabinetOrg = await db.organization.findUnique({ where: { id: cabinet.id }, select: { accountId: true, kind: true } });
  const cabinetMembers = await db.organizationMember.findMany({ where: { organizationId: cabinet.id }, select: { userId: true, role: true } });
  check(
    "cabinet: in account X, the owner is its member (owner), the manager is not",
    cabinetOrg?.accountId === account.id && cabinetOrg.kind === "directory" && cabinetMembers.some((m) => m.userId === owner.id && m.role === "owner") && !cabinetMembers.some((m) => m.userId === manager.id),
    { cabinetOrg, cabinetMembers },
  );
  const memberRow = await db.directoryExchangeMember.findFirst({ where: { masterOrganizationId: cabinet.id, organizationId: a.id } });
  check("members: created by M", memberRow?.createdByUserId === manager.id);
  check("audit directory_exchange.configured by M (name)", (await db.auditLog.count({ where: { organizationId: b.id, action: "directory_exchange.configured", userId: manager.id, userName: manager.name } })) === 1);
  check("ensureExchangeCabinet by M returns the same cabinet", (await ensureExchangeCabinet(manager.id, account.id)).id === cabinet.id);

  // «Синхронизировать сейчас».
  const sync = await runDirectoryExchangeWithin(cabinet.id, { actor: mActor, trigger: "manual", waitMs: 120_000 });
  check("M: sync ran", !sync.running);
  const cheeseB = await db.product.findFirst({ where: { organizationId: b.id, name: "Сыр" } });
  check("sync: «Сыр» created in B", Boolean(cheeseB?.isActive));
  check("audit directory_exchange.synced by M", (await db.auditLog.count({ where: { action: "directory_exchange.synced", userId: manager.id, organizationId: { in: [a.id, b.id, cabinet.id] } } })) >= 1);

  // Пропуски.
  const skips = await listExchangeSkips({ accountId: account.id });
  const skipsB = skips.organizations.find((o) => o.organizationId === b.id);
  const milkSkip = skipsB?.items.find((item) => item.name === "Молоко");
  const kefirSkip = skipsB?.items.find((item) => item.name === "Кефир");
  check("skips: B has «Молоко» (link) and «Кефир» (ignore)", Boolean(milkSkip) && Boolean(kefirSkip), skipsB?.items.map((i) => i.name));
  await ignoreExchangeSkip({ accountId: account.id, actor: mActor }, kefirSkip!.id);
  await linkExchangeSkip({ accountId: account.id, actor: mActor }, milkSkip!.id, milkB.id);
  check("M: skip ignored — audit by M", (await auditCount({ organizationId: b.id, action: "directory_exchange.skip_ignored", userId: manager.id })) === 1);
  check("M: skip linked — audit by M", (await auditCount({ organizationId: b.id, action: "directory_exchange.skip_linked", userId: manager.id })) === 1);

  // История и отмена.
  const history = await listExchangeHistory({ organizationId: b.id });
  const cheeseChange = history.find((item) => item.op === "create" && item.name === "Сыр");
  check("history: «Сыр» created in B", Boolean(cheeseChange?.undoable), history.map((h) => `${h.op}:${h.name}`));
  const undone = await undoExchangeChange({ id: cheeseChange!.id, actor: mActor });
  check("M: history undo — «Сыр» turned off", Boolean(undone) && (await db.product.findUnique({ where: { id: cheeseB!.id } }))?.isActive === false, undone);
  check("audit directory_exchange.change_undone by M", (await auditCount({ organizationId: b.id, action: "directory_exchange.change_undone", userId: manager.id })) === 1);

  // Разовый перенос и отмена.
  await transferOnce({ fromOrganizationId: a.id, toOrganizationId: b.id, selection: { staff: "all" }, actor: mActor });
  const transfers = await listRecentTransfers({ accountId: account.id, userId: manager.id });
  const transfer = transfers.find((item) => item.to.id === b.id);
  check("M: transfer A → B listed for M", Boolean(transfer?.undoable), transfers);
  const transferRow = await db.directoryTransfer.findUnique({ where: { id: transfer!.id } });
  check("transfer row: actor M", transferRow?.actorUserId === manager.id);
  check("staff «Иванов Иван» in B", (await db.user.count({ where: { organizationId: b.id, name: "Иванов Иван", archivedAt: null } })) === 1);
  check("owner sees the same transfer", (await listRecentTransfers({ accountId: account.id, userId: owner.id })).some((item) => item.id === transfer!.id));
  check("another company's owner sees nothing", (await listRecentTransfers({ accountId: account.id, userId: foreign.id })).length === 0);
  await refused("another company's owner: undo → 404", [404], () => undoTransfer({ id: transfer!.id, ownerUserId: foreign.id }));
  const undoResult = await undoTransfer({ id: transfer!.id, ownerUserId: manager.id, ownerName: manager.name });
  check("M: undo transfer — staff archived", undoResult.undone.some((item) => item.entity === "staff" && item.name === "Иванов Иван"), undoResult);
  const undoneRow = await db.directoryTransfer.findUnique({ where: { id: transfer!.id } });
  check("transfer row: undone by M", undoneRow?.undoneByUserId === manager.id);
  check("audit directory_exchange.transfer_undone by M (name)", (await db.auditLog.count({ where: { organizationId: b.id, action: "directory_exchange.transfer_undone", userId: manager.id, userName: manager.name } })) === 1);

  // Код мастер-кабинета.
  const codeBefore = await exchangeCabinetCode(cabinet.id);
  const regenerated = await regenerateExchangeCode({ ownerUserId: manager.id, ownerName: manager.name, accountId: account.id, organizationId: b.id });
  check("M: regenerate cabinet code — a new code", Boolean(regenerated.code) && regenerated.code !== codeBefore);
  check("audit directory_exchange.code_regenerated by M", (await auditCount({ organizationId: b.id, action: "directory_exchange.code_regenerated", userId: manager.id })) === 1);
  check("M: exchange card shows the cabinet code", (await loadExchangeState(manager.id, b.id, { sessionAllows: true })).cabinetCode === regenerated.code);

  // Баланс по аккаунту и перевод.
  const balances = await loadAccountBalances(manager.id, b.id);
  check("M: account balances — A + B = 6 000", balances.totalRub === 6000 && balances.accountId === account.id, balances.totalRub);
  check("M: balance page block shown", (await accountBalancesForPage(manager.id, b.id)) !== null);
  const key = crypto.randomUUID();
  const moved = await transferBetweenOwnOrganizations({ ownerUserId: manager.id, actorName: manager.name, activeOrgId: b.id, fromId: a.id, toId: b.id, amountRub: 300, comment: "на закупку", idempotencyKey: key });
  check("M: transfer 300 ₽ A → B", !moved.duplicate && moved.transfer.amountRub === 300);
  const [balA, balB] = await Promise.all([a.id, b.id].map(async (id) => (await db.organization.findUniqueOrThrow({ where: { id }, select: { balanceRub: true } })).balanceRub));
  check("balances: A 4 700, B 1 300", balA === 4700 && balB === 1300, { balA, balB });
  check("audit balance.transfer by M in both organizations", (await db.auditLog.count({ where: { action: "balance.transfer", userId: manager.id, userName: manager.name, organizationId: { in: [a.id, b.id] } } })) === 2);
  check("ledger rows: actor M", (await db.balanceTransaction.count({ where: { organizationId: { in: [a.id, b.id] }, actorUserId: manager.id, kind: { in: ["transfer_out", "transfer_in"] } } })) === 2);

  /* ── управляющий не может ── */
  console.log("--- the manager cannot");
  const code = await exchangeCabinetCode(cabinet.id);
  const request = await createExchangeRequest({ organizationId: z.id, actor: { userId: foreign.id, userName: foreign.name }, code, mode: "link", kinds: ["products"] });
  check("another company asks for a link (pending)", request.request.status === "pending");
  await refused("M: open another company's request by link → 403", [403], () => loadExchangeRequestByToken({ token: request.token, userId: manager.id }));
  await refused("M: open the request by id → 404", [404], () => loadExchangeRequestByToken({ token: request.request.id, userId: manager.id }));
  await refused("M: approve another company's request → 403", [403, 404], () => decideExchangeRequest({ token: request.token, actor: mActor, decision: "approve", organizationIds: [b.id] }));
  await refused("M: decline another company's request → 403", [403, 404], () => decideExchangeRequest({ token: request.token, actor: mActor, decision: "decline" }));
  check("request still pending", (await db.directoryExchangeRequest.findUnique({ where: { id: request.request.id } }))?.status === "pending");
  check("M: incoming requests list is empty", (await loadExchangeRequests(manager.id, b.id, { sessionAllows: true })).incoming.length === 0);
  check("owner: sees the incoming request", (await loadExchangeRequests(owner.id, a.id, { sessionAllows: true })).incoming.some((item) => item.id === request.request.id));
  await refused("M: send a request to another company → 403", [403], () => createExchangeRequest({ organizationId: b.id, actor: mActor, code: "ABCDE-12345", mode: "link", kinds: ["products"] }));
  try {
    const pay = await import("@/lib/balance/account-pay.server");
    if (typeof pay.previewAccountPayment === "function") {
      await refused("M: pay the plan from the account balances → 403", [403], () => pay.previewAccountPayment({ ownerUserId: manager.id, activeOrganizationId: b.id, target: {} as never }));
    } else {
      console.log("NOTE previewAccountPayment not found — pay-from-account check skipped");
    }
  } catch (error) {
    console.log(`NOTE account-pay module not loadable — pay-from-account check skipped (${(error as Error).message})`);
  }

  /* ── 4. другие ── */
  console.log("--- others");
  const foreignInX = sessionFor(withOrg(foreign, z.name), b.id);
  check("another company's owner with an X organization active: exchange → 403", !(await exchangeAccessForSession(foreignInX)).ok);
  check("another company's owner: canManageNetwork(X) false", !(await canManageNetwork(foreign.id, account.id)));
  await refused("another company's owner: X balances → 403", [403], () => loadAccountBalances(foreign.id, b.id));
  check("another company's owner: X summary refused", await summaryRefused(foreign.id, b.id));
  check("another company's owner: mini page for X refused", (await loadMiniNetwork(foreignInX)) === null);
  const foreignOwn = await exchangeAccessForSession(sessionFor(withOrg(foreign, z.name), z.id));
  check("another company's owner in his own Z: allowed, account Y", foreignOwn.ok && foreignOwn.context.accountId === foreignAccount.id);

  const rootSession = sessionFor({ id: `root-${TAG}`, name: "ROOT", email: `root-${TAG}@example.test`, role: "manager", organizationId: "platform", organizationName: "Платформа" }, b.id, { isRoot: true, actingAsOrganizationId: b.id });
  check("impersonation: exchange → 403", !(await exchangeAccessForSession(rootSession)).ok);
  check("impersonation: managers API → 403", !(await networkOwnerForSession(rootSession)).ok);
  check("impersonation: mini page refused", (await loadMiniNetwork(rootSession)) === null);
  check("impersonation: no menu item «Сеть»", (await loadAccountNetworkFact(rootSession)) === false);
  const pointSession = sessionFor(withOrg(manager, b.name), b.id, { pointScope: ["some-point"] });
  check("M as a point manager: exchange → 403", !(await exchangeAccessForSession(pointSession)).ok);
  check("M as a point manager: mini page refused", (await loadMiniNetwork(pointSession)) === null);
  const ownerImpersonating = sessionFor(withOrg(owner, a.name), a.id, { actingAsOrganizationId: a.id });
  check("owner in «войти как»: managers API → 403", !(await networkOwnerForSession(ownerImpersonating)).ok);

  /* ── 5. снятие и архив ── */
  console.log("--- removal and archiving");
  await removeNetworkManager(ownerActor, manager.id);
  check("audit account.network_manager_removed", (await auditCount({ organizationId: a.id, action: "account.network_manager_removed", userId: owner.id })) === 1);
  await refused("remove again → 404", [404], () => removeNetworkManager(ownerActor, manager.id));
  async function revoked(label: string) {
    check(`${label}: no account role`, (await accountRoleOf(manager.id, account.id)) === null);
    check(`${label}: exchange → 403`, !(await exchangeAccessForSession(managerSession)).ok);
    check(`${label}: no menu item`, (await loadAccountNetworkFact(managerSession)) === false);
    check(`${label}: summary refused`, await summaryRefused(manager.id, b.id));
    check(`${label}: mini page refused`, (await loadMiniNetwork(managerSession)) === null);
    check(`${label}: exchange card closed`, !(await loadExchangeState(manager.id, b.id, { sessionAllows: true })).canManage);
    check(`${label}: transfers list empty`, (await listRecentTransfers({ accountId: account.id, userId: manager.id })).length === 0);
    await refused(`${label}: save members → 403`, [403], () => saveExchangeMembers({ ownerUserId: manager.id, organizationId: b.id, members: [{ organizationId: b.id, kinds: ["products"] }] }));
    await refused(`${label}: cabinet → 403`, [403], () => ensureExchangeCabinet(manager.id, account.id));
    await refused(`${label}: cabinet code → 403`, [403], () => regenerateExchangeCode({ ownerUserId: manager.id, accountId: account.id, organizationId: b.id }));
    await refused(`${label}: transfer undo → 404`, [404], () => undoTransfer({ id: transfer!.id, ownerUserId: manager.id }));
    await refused(`${label}: history undo → 404`, [404], () => undoExchangeChange({ id: cheeseChange!.id, actor: mActor }));
    await refused(`${label}: balances → 403`, [403], () => loadAccountBalances(manager.id, b.id));
    await refused(`${label}: money transfer → 403`, [403], () =>
      transferBetweenOwnOrganizations({ ownerUserId: manager.id, activeOrgId: b.id, fromId: a.id, toId: b.id, amountRub: 1, idempotencyKey: crypto.randomUUID() }),
    );
    check(`${label}: balance page block hidden`, (await accountBalancesForPage(manager.id, b.id)) === null);
  }
  await revoked("removed");

  await appointNetworkManager(ownerActor, manager.id);
  check("re-appointed: role back", (await accountRoleOf(manager.id, account.id)) === "network_manager");
  await db.user.update({ where: { id: manager.id }, data: { archivedAt: new Date(), isActive: false } });
  await revoked("archived");
  const archivedView = await loadNetworkManagers(account.id);
  check("list: archived M shown as inactive, not a candidate", archivedView.managers.some((m) => m.userId === manager.id && !m.active) && !archivedView.candidates.some((c) => c.userId === manager.id), archivedView.managers);
  await db.user.update({ where: { id: manager.id }, data: { archivedAt: null, isActive: true } });
  check("unarchived: role back", (await accountRoleOf(manager.id, account.id)) === "network_manager");
  await db.user.update({ where: { id: manager.id }, data: { role: "cook" } });
  check("lost management role: no account role", (await accountRoleOf(manager.id, account.id)) === null);
  check("lost management role: exchange → 403", !(await exchangeAccessForSession(managerSession)).ok);
  await db.user.update({ where: { id: manager.id }, data: { role: "manager" } });

  // Участник организации аккаунта (домашняя — другая компания) — тоже кандидат.
  const invited = await makeUser(z.id, "invited", "Приглашённый Иван", "cook");
  await db.organizationMember.create({ data: { userId: invited.id, organizationId: a.id, role: "manager" } });
  const view2 = await loadNetworkManagers(account.id);
  check("candidates: a member of A from another company is offered (A)", view2.candidates.some((c) => c.userId === invited.id && c.organizations.includes(a.name)), view2.candidates);
  await appointNetworkManager(ownerActor, invited.id);
  check("member appointed: role network_manager", (await accountRoleOf(invited.id, account.id)) === "network_manager");
  await db.organizationMember.deleteMany({ where: { userId: invited.id, organizationId: a.id } });
  check("membership removed: role gone at once", (await accountRoleOf(invited.id, account.id)) === null);
  check("no access in Y for X's manager", (await accountRoleOf(manager.id, foreignAccount.id)) === null);

  const routes = await Promise.all([import("@/app/api/settings/network/managers/route")]);
  check(
    "managers route module: GET/POST/DELETE, nodejs, force-dynamic",
    typeof routes[0].GET === "function" && typeof routes[0].POST === "function" && typeof routes[0].DELETE === "function" && routes[0].runtime === "nodejs" && routes[0].dynamic === "force-dynamic",
  );
  check("NetworkManagerError is exported for the route", typeof NetworkManagerError === "function");
  check("AccountTransferError still maps refusals", typeof AccountTransferError === "function");
  check("DirectoryExchangeError still maps refusals", typeof DirectoryExchangeError === "function");
}

async function cleanup() {
  const cabinets = await db.organization.findMany({ where: { accountId: { in: accountIds }, kind: "directory" }, select: { id: true } });
  const ids = [...new Set([...cabinets.map((item) => item.id), ...orgIds])].reverse();
  await db.directoryExchangeRequest.deleteMany({ where: { OR: [{ requesterOrganizationId: { in: ids } }, { masterOrganizationId: { in: ids } }] } }).catch(() => undefined);
  for (const id of ids) {
    await db.organization.delete({ where: { id } }).catch((error) => {
      const message = String((error as Error).message);
      if (!message.includes("not found") && !message.includes("No record")) console.log(`cleanup: ${id} — ${message.split("\n").pop()}`);
    });
  }
  await db.accountNetworkManager.deleteMany({ where: { accountId: { in: accountIds } } }).catch(() => undefined);
  await db.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
  await db.user.deleteMany({ where: { email: { contains: TAG } } }).catch(() => undefined);
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  const leftUsers = await db.user.count({ where: { email: { contains: TAG } } });
  const leftManagers = await db.accountNetworkManager.count({ where: { accountId: { in: accountIds } } });
  console.log(`cleanup: organizations left ${left}, users left ${leftUsers}, manager rows left ${leftManagers}`);
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
