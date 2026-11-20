// E2E copy of .agent/tasks/multi-org-followups-a-2026-11-20/raw/background-check.ts (series A); the task copy stays as that series' evidence.
/*
 * Series A, AC5: an exchange that runs longer than the wait answers `running: true`
 * and finishes in the background — the result lands in the members' `lastSyncJson`
 * and the request's `resultJson`, the requester's letter goes out after the end.
 * "Longer than the wait" is made by a zero wait (`waitMs: 0`): any real exchange
 * takes longer than that. A normal wait (8 s) still answers with the result.
 */
import "./env";

import { db } from "@/lib/db";
import { createExchangeRequest, decideExchangeRequest } from "@/lib/directory-exchange/requests.server";
import { EXCHANGE_WAIT_MS, runDirectoryExchangeWithin } from "@/lib/directory-exchange/run.server";
import { ensureExchangeCabinet, saveExchangeMembers } from "@/lib/directory-exchange/settings.server";
import { parseExchangeSummary, type ExchangeSummary } from "@/lib/directory-exchange/summary";

const TAG = `bgchk${Date.now().toString(36)}`;
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

/* Письма в dev не уходят, а пишутся в журнал — перехватываем его. */
const mailLog: string[] = [];
console.info = (...args: unknown[]) => {
  const line = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
  if (line.startsWith("[email/dev]")) mailLog.push(line);
};
const takeMail = () => mailLog.splice(0).join("\n");

async function makeOrg(name: string, accountId: string | null = null, extra: Record<string, unknown> = {}) {
  const org = await db.organization.create({ data: { name: `${name} ${TAG}`, type: "restaurant", accountId, ...extra } });
  orgIds.push(org.id);
  return org;
}

async function makeOwner(orgId: string, label: string, accountData: Record<string, unknown> = {}) {
  const owner = await db.user.create({
    data: { email: `${TAG}-${label}@example.test`, name: `Владелец ${label}`, passwordHash: "x", role: "manager", organizationId: orgId },
  });
  const account = await db.account.create({ data: { ownerUserId: owner.id, ...accountData } });
  accountIds.push(account.id);
  await db.organization.update({ where: { id: orgId }, data: { accountId: account.id } });
  await db.organizationMember.create({ data: { userId: owner.id, organizationId: orgId, role: "owner" } });
  return { owner, account, actor: { userId: owner.id, userName: owner.name } };
}

const products = async (orgId: string) =>
  (await db.product.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { name: "asc" } })).map((p) => p.name);
const createdFor = (summary: ExchangeSummary | null | undefined, orgId: string) =>
  summary?.organizations.find((organization) => organization.organizationId === orgId)?.kinds.products.created ?? 0;

async function main() {
  console.log(`--- wait is ${EXCHANGE_WAIT_MS} ms`);
  check("the wait is 8 seconds", EXCHANGE_WAIT_MS === 8_000);

  // Владелец кабинета: организация с продуктами и вторая своя.
  const s = await makeOrg("Источник");
  const two = await makeOwner(s.id, "two");
  await db.product.createMany({
    data: [
      { name: "Молоко 3,2%", kind: "raw", unit: "l", organizationId: s.id },
      { name: "Сыр твёрдый", kind: "raw", unit: "kg", organizationId: s.id },
    ],
  });
  const s2 = await makeOrg("Источник-2", two.account.id);
  await db.organizationMember.create({ data: { userId: two.owner.id, organizationId: s2.id, role: "owner" } });
  const cabinet = await ensureExchangeCabinet(two.owner.id, two.account.id);
  orgIds.push(cabinet.id);
  const code = (await db.organization.findUnique({ where: { id: cabinet.id }, select: { serviceCode: true } }))!.serviceCode!;
  await saveExchangeMembers({
    ownerUserId: two.owner.id,
    organizationId: s.id,
    members: [
      { organizationId: s.id, kinds: ["products"] },
      { organizationId: s2.id, kinds: ["products"] },
    ],
  });

  /* ── сохранение и «Синхронизировать сейчас»: долгий обмен ── */
  console.log("--- save / sync: a long exchange");
  const started = Date.now();
  const long = await runDirectoryExchangeWithin(cabinet.id, { actor: two.actor, waitMs: 0 });
  check("answer comes at once with running: true", long.running === true && Date.now() - started < 2_000, { running: long.running, ms: Date.now() - started });
  check("nothing is in the second organization yet at the answer", (await products(s2.id)).length === 0);
  const background = long.running ? await long.done : null;
  check("the background exchange finished with a result", createdFor(background, s2.id) === 2, background);
  check("its result is in the second organization", JSON.stringify(await products(s2.id)) === JSON.stringify(["Молоко 3,2%", "Сыр твёрдый"]));
  const member = await db.directoryExchangeMember.findUnique({
    where: { masterOrganizationId_organizationId: { masterOrganizationId: cabinet.id, organizationId: s2.id } },
    select: { lastSyncedAt: true, lastSyncJson: true },
  });
  check(
    "the card's source (lastSyncJson) holds the background result",
    Boolean(member?.lastSyncedAt) && createdFor(parseExchangeSummary(member?.lastSyncJson), s2.id) === 2,
    member,
  );

  /* ── короткий обмен — как раньше ── */
  console.log("--- save / sync: a short exchange");
  const quickStart = Date.now();
  const quick = await runDirectoryExchangeWithin(cabinet.id, { actor: two.actor });
  check(
    "a short exchange answers with its result (running: false)",
    quick.running === false && Array.isArray(quick.summary.organizations) && Date.now() - quickStart < EXCHANGE_WAIT_MS,
    { running: quick.running, ms: Date.now() - quickStart },
  );

  /* ── подтверждение связи с другой компанией: долгий первый обмен ── */
  console.log("--- link approval: a long first exchange");
  const r = await makeOrg("Заявитель", null, { inn: "7707083893" });
  const one = await makeOwner(r.id, "one", {
    subscriptionPlan: "standard",
    subscriptionEnd: new Date(Date.now() + 30 * DAY),
    planPoints: 1,
    planCycle: "month",
  });
  const request = await createExchangeRequest({ organizationId: r.id, actor: one.actor, code, mode: "link", kinds: ["products"] });
  takeMail();
  const decided = await decideExchangeRequest({
    token: request.token,
    actor: two.actor,
    decision: "approve",
    organizationIds: [s.id],
    waitMs: 0,
  });
  check("approval answers running: true without a summary", decided.status === "approved" && decided.running === true && decided.summary === undefined, decided);
  const row = await db.directoryExchangeRequest.findUnique({ where: { id: request.request.id } });
  check("request is approved right away; its result is not written yet", row?.status === "approved" && row.resultJson === null, row);
  check("no letter to the requester before the exchange ends", takeMail() === "");

  await decided.notify();
  const after = await db.directoryExchangeRequest.findUnique({ where: { id: request.request.id } });
  check("after the exchange: resultJson holds what the requester got", createdFor(parseExchangeSummary(after?.resultJson), r.id) === 2, after?.resultJson);
  check("after the exchange: the requester has the products", JSON.stringify(await products(r.id)) === JSON.stringify(["Молоко 3,2%", "Сыр твёрдый"]));
  const foreignMember = await db.directoryExchangeMember.findUnique({
    where: { masterOrganizationId_organizationId: { masterOrganizationId: cabinet.id, organizationId: r.id } },
    select: { lastSyncJson: true, foreign: true },
  });
  check(
    "after the exchange: the requester's card (its lastSyncJson) holds its own result only",
    foreignMember?.foreign === true &&
      createdFor(parseExchangeSummary(foreignMember.lastSyncJson), r.id) === 2 &&
      parseExchangeSummary(foreignMember.lastSyncJson)?.organizations.length === 1,
    foreignMember,
  );
  const letter = takeMail();
  check(
    "the requester's letter went out after the exchange, with what it got",
    letter.includes(one.owner.email) && letter.includes("добавлено записей — 2") && !letter.includes(two.owner.email),
    letter,
  );
}

async function cleanup() {
  const cabinets = await db.organization.findMany({ where: { accountId: { in: accountIds }, kind: "directory" }, select: { id: true } });
  for (const id of [...new Set([...cabinets.map((item) => item.id), ...orgIds])].reverse()) {
    await db.organization.delete({ where: { id } }).catch(() => undefined);
  }
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  const leftUsers = await db.user.count({ where: { email: { contains: TAG } } });
  const leftAccounts = await db.account.count({ where: { id: { in: accountIds } } });
  console.log(`cleanup: organizations left ${left}, users left ${leftUsers}, accounts left ${leftAccounts}`);
}

main()
  .catch((error) => {
    failed += 1;
    console.error("FAIL script crashed", error);
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup failed", error));
    console.log(`TOTAL: ${passed} PASS, ${failed} FAIL`);
    await db.$disconnect();
    process.exit(failed === 0 ? 0 : 1);
  });
