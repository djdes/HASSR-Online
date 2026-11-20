/*
 * Series B, AC2 (item 10): account balance summary and transfers between own organizations.
 * One account with three working organizations (5 000 / 1 000 / 0 ₽) plus a demo org and a master
 * cabinet (excluded), a foreign account, and a manager who is not the account owner. Calls the lib
 * functions behind GET /api/balance/account and POST /api/balance/transfer, and the route error mapper.
 * Review fixes: the same key with other details → 409 idempotency_mismatch; no transfer into an
 * organization whose deletion is requested (out of it is fine); opposite transfers A→B and B→A
 * at the same time both go through (rows locked in id order, no deadlock).
 */
import "dotenv/config";

import { db } from "@/lib/db";
import { transferDedupeKeys } from "@/lib/balance/account-transfer";
import { accountTransferErrorResponse } from "@/lib/balance/account-transfer-access.server";
import {
  AccountTransferError,
  accountBalancesForPage,
  loadAccountBalances,
  transferBetweenOwnOrganizations,
} from "@/lib/balance/account-transfer.server";
import { transactionKindLabel } from "@/lib/balance/constants";

const TAG = `balchk${Date.now().toString(36)}`;
const orgIds: string[] = [];
const accountIds: string[] = [];
let failed = 0;
let passed = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
}

async function refusal(run: () => Promise<unknown>): Promise<AccountTransferError | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof AccountTransferError) return error;
    throw error;
  }
}

const balanceOf = async (id: string) => (await db.organization.findUniqueOrThrow({ where: { id }, select: { balanceRub: true } })).balanceRub;
const key = () => crypto.randomUUID();

async function org(name: string, data: Record<string, unknown> = {}) {
  const created = await db.organization.create({ data: { name: `${name} ${TAG}`, type: "restaurant", ...data } });
  orgIds.push(created.id);
  return created;
}

async function main() {
  const a = await org("Кафе А", { balanceRub: 5000 });
  const owner = await db.user.create({ data: { email: `owner-${TAG}@example.test`, name: "Владелец", passwordHash: "x", role: "owner", organizationId: a.id } });
  const manager = await db.user.create({ data: { email: `manager-${TAG}@example.test`, name: "Управляющий", passwordHash: "x", role: "manager", organizationId: a.id } });
  const account = await db.account.create({ data: { ownerUserId: owner.id, subscriptionPlan: "standard" } });
  accountIds.push(account.id);
  await db.organization.update({ where: { id: a.id }, data: { accountId: account.id } });
  const b = await org("Бар Б", { balanceRub: 1000, accountId: account.id });
  const c = await org("Столовая В", { balanceRub: 0, accountId: account.id });
  const demo = await org("Демо", { balanceRub: 777, accountId: account.id, isDemo: true });
  const cabinet = await org("Кабинет", { balanceRub: 555, accountId: account.id, kind: "directory" });

  const foreign = await org("Чужая", { balanceRub: 100 });
  const foreignOwner = await db.user.create({ data: { email: `foreign-${TAG}@example.test`, name: "Чужой", passwordHash: "x", role: "owner", organizationId: foreign.id } });
  const foreignAccount = await db.account.create({ data: { ownerUserId: foreignOwner.id } });
  accountIds.push(foreignAccount.id);
  await db.organization.update({ where: { id: foreign.id }, data: { accountId: foreignAccount.id } });

  // --- summary
  const summary = await loadAccountBalances(owner.id, a.id);
  const ids = summary.organizations.map((row) => row.id);
  check("summary lists the three working organizations of the account", ids.length === 3 && [a.id, b.id, c.id].every((id) => ids.includes(id)), ids);
  check("summary excludes the demo organization and the master cabinet", !ids.includes(demo.id) && !ids.includes(cabinet.id));
  check("summary total = 5 000 + 1 000 + 0 = 6 000", summary.totalRub === 6000, summary.totalRub);
  check("summary total equals the sum of listed balances", summary.totalRub === summary.organizations.reduce((s, r) => s + r.balanceRub, 0));
  check("active organization is marked", summary.organizations.find((row) => row.id === a.id)?.active === true && summary.organizations.filter((row) => row.active).length === 1);
  check("page block: shown to the owner with 2+ organizations", (await accountBalancesForPage(owner.id, a.id)) !== null);
  check("page block: hidden from a manager who is not the owner", (await accountBalancesForPage(manager.id, a.id)) === null);

  // --- transfer
  const k1 = key();
  const first = await transferBetweenOwnOrganizations({ ownerUserId: owner.id, actorName: "Владелец", activeOrgId: a.id, fromId: a.id, toId: b.id, amountRub: 1500, comment: "на тариф", idempotencyKey: k1 });
  check("transfer A → B 1 500 ₽ succeeds (not a duplicate)", first.duplicate === false && first.transfer.amountRub === 1500 && first.transfer.fromId === a.id && first.transfer.toId === b.id, first);
  check("A balance 5 000 → 3 500", (await balanceOf(a.id)) === 3500);
  check("B balance 1 000 → 2 500", (await balanceOf(b.id)) === 2500);
  const after = await loadAccountBalances(owner.id, a.id);
  check("account total unchanged after transfer (6 000)", after.totalRub === 6000, after.totalRub);

  const keys = transferDedupeKeys(account.id, k1);
  const rows = await db.balanceTransaction.findMany({ where: { dedupeKey: { in: [keys.out, keys.in] } } });
  const outRow = rows.find((row) => row.dedupeKey === keys.out);
  const inRow = rows.find((row) => row.dedupeKey === keys.in);
  check("history A: transfer_out −1 500 with its label", outRow?.organizationId === a.id && outRow.kind === "transfer_out" && outRow.amount === -1500 && transactionKindLabel(outRow.kind) === "Перевод в другую организацию", outRow);
  check("history B: transfer_in +1 500 with its label", inRow?.organizationId === b.id && inRow.kind === "transfer_in" && inRow.amount === 1500 && transactionKindLabel(inRow.kind) === "Перевод из другой организации", inRow);
  check("history rows name the other organization and carry the comment", Boolean(outRow?.description.includes("Бар Б") && outRow.description.includes("на тариф") && inRow?.description.includes("Кафе А")), [outRow?.description, inRow?.description]);
  check("history rows record the actor", outRow?.actorUserId === owner.id && inRow?.actorUserId === owner.id);

  const audits = await db.auditLog.findMany({ where: { action: "balance.transfer", organizationId: { in: [a.id, b.id] } } });
  const detail = (row: (typeof audits)[number]) => row.details as Record<string, unknown>;
  check("audit balance.transfer written in both organizations", audits.length === 2 && audits.some((r) => r.organizationId === a.id) && audits.some((r) => r.organizationId === b.id), audits.length);
  check(
    "audit details: actor, from/to, amount, comment",
    audits.every((r) => r.userId === owner.id && detail(r).fromOrganizationId === a.id && detail(r).toOrganizationId === b.id && detail(r).amountRub === 1500 && detail(r).comment === "на тариф"),
    audits.map(detail),
  );

  // --- same idempotency key: no second debit
  const again = await transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: a.id, toId: b.id, amountRub: 1500, comment: "на тариф", idempotencyKey: k1 });
  check("same key again → the earlier result, duplicate: true", again.duplicate === true && again.transfer.amountRub === 1500 && again.transfer.fromId === a.id, again);
  const otherTo = await refusal(() => transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: a.id, toId: c.id, amountRub: 900, idempotencyKey: k1 }));
  const otherAmount = await refusal(() => transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: a.id, toId: b.id, amountRub: 1000, idempotencyKey: k1 }));
  const otherWay = await refusal(() => transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: b.id, toId: a.id, amountRub: 1500, idempotencyKey: k1 }));
  check(
    "same key with another destination, amount or direction → 409 idempotency_mismatch",
    [otherTo, otherAmount, otherWay].every((error) => error?.status === 409 && error.code === "idempotency_mismatch"),
    [otherTo, otherAmount, otherWay].map((error) => error && { status: error.status, code: error.code }),
  );
  const mismatchBody = (await accountTransferErrorResponse(otherTo).json()) as { code?: string };
  check("route mapper: 409 { code: idempotency_mismatch }", mismatchBody.code === "idempotency_mismatch", mismatchBody);
  check("balances unchanged by repeats (A 3 500, B 2 500, C 0)", (await balanceOf(a.id)) === 3500 && (await balanceOf(b.id)) === 2500 && (await balanceOf(c.id)) === 0);
  check("still exactly two ledger rows and two audit rows for the key", (await db.balanceTransaction.count({ where: { dedupeKey: { in: [keys.out, keys.in] } } })) === 2 && (await db.auditLog.count({ where: { action: "balance.transfer", organizationId: { in: [a.id, b.id, c.id] } } })) === 2);

  const k2 = key();
  const parallel = await Promise.all(
    [0, 1, 2].map(() => transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: b.id, toId: c.id, amountRub: 500, idempotencyKey: k2 })),
  );
  check("three parallel requests with one key → one transfer, two duplicates", parallel.filter((r) => !r.duplicate).length === 1 && parallel.filter((r) => r.duplicate).length === 2, parallel.map((r) => r.duplicate));
  check("parallel: B debited once (2 500 → 2 000), C credited once (0 → 500)", (await balanceOf(b.id)) === 2000 && (await balanceOf(c.id)) === 500);

  // --- refusals
  const foreignTo = await refusal(() => transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: a.id, toId: foreign.id, amountRub: 10, idempotencyKey: key() }));
  check("to a foreign organization → 404", foreignTo?.status === 404 && foreignTo.code === "not_found", foreignTo);
  const foreignFrom = await refusal(() => transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: foreign.id, toId: a.id, amountRub: 10, idempotencyKey: key() }));
  check("from a foreign organization → 404", foreignFrom?.status === 404, foreignFrom);
  const toDemo = await refusal(() => transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: a.id, toId: demo.id, amountRub: 10, idempotencyKey: key() }));
  const toCabinet = await refusal(() => transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: cabinet.id, toId: a.id, amountRub: 10, idempotencyKey: key() }));
  check("demo organization and master cabinet → 404", toDemo?.status === 404 && toCabinet?.status === 404);
  check("foreign balance untouched (100)", (await balanceOf(foreign.id)) === 100);

  const notOwnerSummary = await refusal(() => loadAccountBalances(manager.id, a.id));
  const notOwnerTransfer = await refusal(() => transferBetweenOwnOrganizations({ ownerUserId: manager.id, activeOrgId: a.id, fromId: a.id, toId: b.id, amountRub: 10, idempotencyKey: key() }));
  check("manager who is not the owner: summary → 403", notOwnerSummary?.status === 403 && notOwnerSummary.code === "not_owner", notOwnerSummary);
  check("manager who is not the owner: transfer → 403", notOwnerTransfer?.status === 403, notOwnerTransfer);
  const otherOwnerHere = await refusal(() => loadAccountBalances(foreignOwner.id, a.id));
  check("owner of another account, active in this one → 403", otherOwnerHere?.status === 403, otherOwnerHere);

  const tooMuch = await refusal(() => transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: a.id, toId: b.id, amountRub: 3501, idempotencyKey: key() }));
  check("more than the balance (3 501 > 3 500) → 409 insufficient", tooMuch?.status === 409 && tooMuch.code === "insufficient" && tooMuch.params?.balanceRub === 3500, tooMuch);
  check("balances unchanged after the refusal", (await balanceOf(a.id)) === 3500 && (await balanceOf(b.id)) === 2000);
  const sameOrg = await refusal(() => transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: a.id, toId: a.id, amountRub: 10, idempotencyKey: key() }));
  const badAmount = await refusal(() => transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: a.id, toId: b.id, amountRub: 10.5, idempotencyKey: key() }));
  check("same organization and fractional amount → 400", sameOrg?.status === 400 && badAmount?.status === 400);

  const mapped = accountTransferErrorResponse(tooMuch);
  const body = (await mapped.json()) as { code?: string; params?: { balanceRub?: number } };
  check("route mapper: 409 { code: insufficient, params }", mapped.status === 409 && body.code === "insufficient" && body.params?.balanceRub === 3500, body);
  check("route mapper: 404 and 403 statuses", accountTransferErrorResponse(foreignTo).status === 404 && accountTransferErrorResponse(notOwnerSummary).status === 403);

  // --- organization whose deletion is requested: gives money, does not receive it
  const closing = await org("Закрывается", { balanceRub: 300, accountId: account.id, deletionRequestedAt: new Date() });
  const flagged = await loadAccountBalances(owner.id, a.id);
  check(
    "summary flags the organization whose deletion is requested (others not)",
    flagged.organizations.find((row) => row.id === closing.id)?.deletionRequested === true &&
      flagged.organizations.filter((row) => row.deletionRequested).length === 1,
    flagged.organizations.map((row) => [row.name, row.deletionRequested]),
  );
  const intoClosing = await refusal(() => transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: a.id, toId: closing.id, amountRub: 100, idempotencyKey: key() }));
  check(
    "transfer INTO an organization being deleted → 409 deleting with its name",
    intoClosing?.status === 409 && intoClosing.code === "deleting" && intoClosing.params?.name === closing.name,
    intoClosing && { status: intoClosing.status, code: intoClosing.code, message: intoClosing.message },
  );
  check("refused: balances unchanged (A 3 500, closing 300)", (await balanceOf(a.id)) === 3500 && (await balanceOf(closing.id)) === 300);
  const closingBody = (await accountTransferErrorResponse(intoClosing).json()) as { code?: string; params?: { name?: string } };
  check("route mapper: 409 { code: deleting, params: { name } }", closingBody.code === "deleting" && closingBody.params?.name === closing.name, closingBody);
  const outOfClosing = await transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: closing.id, toId: a.id, amountRub: 300, idempotencyKey: key() });
  check(
    "transfer OUT of an organization being deleted is allowed (closing 300 → 0, A 3 500 → 3 800)",
    !outOfClosing.duplicate && (await balanceOf(closing.id)) === 0 && (await balanceOf(a.id)) === 3800,
    outOfClosing,
  );

  // --- opposite transfers at the same moment: both go through, no deadlock
  const [aBefore, bBefore] = [await balanceOf(a.id), await balanceOf(b.id)];
  const opposite = await Promise.allSettled(
    Array.from({ length: 4 }, () => [
      transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: a.id, toId: b.id, amountRub: 10, idempotencyKey: key() }),
      transferBetweenOwnOrganizations({ ownerUserId: owner.id, activeOrgId: a.id, fromId: b.id, toId: a.id, amountRub: 10, idempotencyKey: key() }),
    ]).flat(),
  );
  const oppositeFailed = opposite.filter((item): item is PromiseRejectedResult => item.status === "rejected");
  check(
    "4 × (A→B and B→A) at once: all 8 transfers succeed",
    oppositeFailed.length === 0 && opposite.every((item) => item.status === "fulfilled" && !item.value.duplicate),
    oppositeFailed.map((item) => String(item.reason).slice(0, 200)),
  );
  check("opposite transfers: A and B balances back where they were", (await balanceOf(a.id)) === aBefore && (await balanceOf(b.id)) === bBefore);

  // --- ledger invariant: balance = start + sum of ledger rows
  for (const [row, start] of [[a, 5000], [b, 1000], [c, 0], [closing, 300]] as const) {
    const sum = await db.balanceTransaction.aggregate({ where: { organizationId: row.id }, _sum: { amount: true } });
    check(`ledger invariant for ${row.name}`, (await balanceOf(row.id)) === start + (sum._sum.amount ?? 0));
  }
}

async function cleanup() {
  for (const id of [...orgIds].reverse()) await db.organization.delete({ where: { id } }).catch(() => undefined);
  await db.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
  await db.user.deleteMany({ where: { email: { contains: TAG } } }).catch(() => undefined);
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  const leftRows = await db.balanceTransaction.count({ where: { organizationId: { in: orgIds } } });
  const leftAudit = await db.auditLog.count({ where: { organizationId: { in: orgIds } } });
  console.log(`cleanup: organizations left ${left}, ledger rows left ${leftRows}, audit rows left ${leftAudit}`);
}

main()
  .catch((error) => {
    failed += 1;
    console.error("FAIL script crashed", error);
  })
  .finally(async () => {
    await cleanup();
    console.log(`TOTAL: ${passed} PASS, ${failed} FAIL`);
    await db.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
