/*
 * End-to-end check of item 13 (new master cabinet code, AC5) against the local DB:
 * the old code (cabinet serviceCode) works before and after the first display, which
 * stores it in exchangeCode; after «Выдать новый код» only the new code is accepted
 * (the old one and the legacy menu-code paths give the common 404), while the pending
 * request, the approved link, the objects connected to the cabinet's menu and raw
 * materials (linkedServiceCode) and the menu pool itself stay as they were.
 *
 *   npx tsx .agent/tasks/multi-org-followups-b-2026-11-20/raw/cabinet-code-check.ts
 */
import "dotenv/config";

import { db } from "@/lib/db";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import {
  CABINET_NOT_FOUND_MESSAGE,
  createExchangeRequest,
  decideExchangeRequest,
} from "@/lib/directory-exchange/requests.server";
import {
  ensureExchangeCabinet,
  exchangeCabinetCode,
  loadExchangeState,
  regenerateExchangeCode,
  saveExchangeMembers,
} from "@/lib/directory-exchange/settings.server";
import { getDishPoolInfo, resolveDishPoolOrgIds } from "@/lib/dish-pool";
import { generateServiceCode, normalizeServiceCode } from "@/lib/dish-pool-code";

const TAG = `ccchk${Date.now().toString(36)}`;
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

/** Запросы аккаунта «стареют» — суточный лимит не мешает следующим шагам. */
const ageRequests = (accountId: string) =>
  db.directoryExchangeRequest.updateMany({
    where: { requesterOrganization: { accountId } },
    data: { createdAt: new Date(Date.now() - 30 * DAY) },
  });

async function main() {
  /* ── аккаунт 1 — заявитель, оплачен; несколько организаций (по запросу на организацию) ── */
  const r1 = await makeOrg("Заявитель-1");
  const one = await makeOwner(r1.id, "one", { subscriptionPlan: "standard", subscriptionEnd: new Date(Date.now() + 30 * DAY), planPoints: 20, planCycle: "month" });
  const requesters = [r1];
  for (let index = 2; index <= 16; index += 1) {
    const org = await makeOrg(`Заявитель-${index}`, one.account.id);
    await join(one.owner.id, org.id);
    requesters.push(org);
  }
  let next = 0;
  /** Запрос по коду от следующей свободной организации заявителя. */
  const ask = async (code: string) => {
    await ageRequests(one.account.id);
    const organization = requesters[next];
    next += 1;
    return { organization, ...(await createExchangeRequest({ organizationId: organization.id, actor: one.actor, code, mode: "link", kinds: ["products"] })) };
  };
  const works = async (label: string, code: string) => {
    try {
      const made = await ask(code);
      check(label, made.request.status === "pending", made.request);
      return made;
    } catch (error) {
      check(label, false, String(error));
      return null;
    }
  };
  const notFound = async (label: string, code: string) => {
    try {
      await ask(code);
      check(label, false, "request created");
    } catch (error) {
      check(
        label,
        error instanceof DirectoryExchangeError && error.status === 404 && error.message === CABINET_NOT_FOUND_MESSAGE,
        error instanceof DirectoryExchangeError ? { status: error.status, message: error.message } : String(error),
      );
    }
  };

  /* ── аккаунт 2 — владелец кабинета: своя организация, кабинет, подключённые к меню объекты ── */
  const s = await makeOrg("Владелец");
  const two = await makeOwner(s.id, "two");
  await db.product.create({ data: { name: "Молоко", organizationId: s.id } });
  const cabinet = await ensureExchangeCabinet(two.owner.id, two.account.id);
  orgIds.push(cabinet.id);
  const before = await db.organization.findUniqueOrThrow({ where: { id: cabinet.id }, select: { serviceCode: true, exchangeCode: true } });
  const oldCode = before.serviceCode!;
  check("setup: the cabinet has a menu code and no exchange code yet", Boolean(oldCode) && before.exchangeCode === null, before);
  // Подключение к меню и сырью кабинета: организация и точка с кодом кабинета.
  const connected = await makeOrg("Подключённая", two.account.id, { linkedServiceCode: oldCode });
  const point = await db.building.create({ data: { organizationId: s.id, name: `Точка ${TAG}`, linkedServiceCode: oldCode } });
  // Второй кабинет того же аккаунта: его код меню вёл к аккаунту (старый путь).
  const secondCode = generateServiceCode();
  const secondCabinet = await makeOrg("Второй кабинет", two.account.id, { kind: "directory", serviceCode: secondCode });
  await saveExchangeMembers({ ownerUserId: two.owner.id, ownerName: two.owner.name, organizationId: s.id, members: [{ organizationId: s.id, kinds: ["products"] }] });

  /* ── до первого показа ── */
  console.log("--- before the first display");
  const pending = await works("old code (serviceCode) works before the first display", oldCode);
  await works("old code typed in lower case with spaces works", oldCode.toLowerCase().replace("-", " "));
  await works("another cabinet's menu code of the account still leads to it (legacy path, not regenerated)", secondCode);

  /* ── первый показ ── */
  console.log("--- first display");
  const shown = await exchangeCabinetCode(cabinet.id);
  const afterShow = await db.organization.findUniqueOrThrow({ where: { id: cabinet.id }, select: { serviceCode: true, exchangeCode: true } });
  check("first display returns the old code", shown === oldCode, { shown, oldCode });
  check("first display stores it in exchangeCode; serviceCode unchanged", afterShow.exchangeCode === oldCode && afterShow.serviceCode === oldCode, afterShow);
  check("second display returns the same code", (await exchangeCabinetCode(cabinet.id)) === oldCode);
  const card = await loadExchangeState(two.owner.id, s.id);
  check("card state shows the same code", card.cabinetCode === oldCode, card.cabinetCode);
  const linked = await works("old code works after the first display", oldCode);

  // Подтверждённая связь по запросу.
  if (linked) {
    const token = await db.directoryExchangeRequest.findUniqueOrThrow({ where: { id: linked.request.id }, select: { id: true } });
    const decided = await decideExchangeRequest({
      token: linked.token,
      actor: two.actor,
      decision: "approve",
      allowedKinds: ["products"],
      organizationIds: [s.id],
      waitMs: 3_000,
    });
    check("a link request approved", decided.status === "approved" && Boolean(token), decided.status);
    await decided.notify().catch(() => undefined);
  }

  /* ── не владелец ── */
  try {
    await regenerateExchangeCode({ ownerUserId: one.owner.id, accountId: two.account.id, organizationId: r1.id });
    check("not the account owner: regenerate refused", false, "no error");
  } catch (error) {
    check("not the account owner: regenerate refused (403)", error instanceof DirectoryExchangeError && error.status === 403, String(error));
  }

  /* ── новый код ── */
  console.log("--- regenerate");
  const { code: newCode } = await regenerateExchangeCode({
    ownerUserId: two.owner.id,
    ownerName: two.owner.name,
    accountId: two.account.id,
    organizationId: s.id,
  });
  const afterNew = await db.organization.findUniqueOrThrow({ where: { id: cabinet.id }, select: { serviceCode: true, exchangeCode: true } });
  check("new code differs from the old one and looks like a code", newCode !== oldCode && normalizeServiceCode(newCode) === newCode, { newCode, oldCode });
  check("exchangeCode = new code; serviceCode (menu code) unchanged", afterNew.exchangeCode === newCode && afterNew.serviceCode === oldCode, afterNew);
  check(
    "the new code collides with no organization or point code",
    (await db.organization.count({ where: { OR: [{ serviceCode: newCode }, { linkedServiceCode: newCode }] } })) === 0 &&
      (await db.building.count({ where: { OR: [{ serviceCode: newCode }, { linkedServiceCode: newCode }] } })) === 0,
  );
  check("display now returns the new code", (await exchangeCabinetCode(cabinet.id)) === newCode);
  check("card state shows the new code", (await loadExchangeState(two.owner.id, s.id)).cabinetCode === newCode);
  const audit = await db.auditLog.findFirst({ where: { organizationId: s.id, action: "directory_exchange.code_regenerated" } });
  check(
    "audit: code_regenerated in the owner's organization, without the codes",
    Boolean(audit) && audit!.userId === two.owner.id && !JSON.stringify(audit!.details).includes(oldCode) && !JSON.stringify(audit!.details).includes(newCode),
    audit,
  );

  await notFound("old code after regenerate → the common 404", oldCode);
  await notFound("another cabinet's menu code after regenerate → the common 404", secondCode);
  await works("new code works", newCode);
  await works("new code typed in lower case works", newCode.toLowerCase());

  /* ── что не изменилось ── */
  console.log("--- nothing else changed");
  if (pending) {
    const row = await db.directoryExchangeRequest.findUniqueOrThrow({ where: { id: pending.request.id }, select: { status: true, masterOrganizationId: true } });
    check("the pending request made with the old code is still pending for the same cabinet", row.status === "pending" && row.masterOrganizationId === cabinet.id, row);
  }
  if (linked) {
    const member = await db.directoryExchangeMember.findUnique({
      where: { masterOrganizationId_organizationId: { masterOrganizationId: cabinet.id, organizationId: linked.organization.id } },
      select: { foreign: true, kinds: true },
    });
    const request = await db.directoryExchangeRequest.findUniqueOrThrow({ where: { id: linked.request.id }, select: { status: true } });
    check("the approved link is still there", member?.foreign === true && request.status === "approved", { member, request });
  }
  const connectedNow = await db.organization.findUniqueOrThrow({ where: { id: connected.id }, select: { linkedServiceCode: true } });
  const pointNow = await db.building.findUniqueOrThrow({ where: { id: point.id }, select: { linkedServiceCode: true } });
  check("connected organization keeps linkedServiceCode = the cabinet menu code", connectedNow.linkedServiceCode === oldCode, connectedNow);
  check("connected point keeps linkedServiceCode = the cabinet menu code", pointNow.linkedServiceCode === oldCode, pointNow);
  const pool = await resolveDishPoolOrgIds(connected.id);
  check("menu pool of the connected organization still includes the cabinet", pool.includes(cabinet.id) && pool.includes(connected.id), pool);
  const info = await getDishPoolInfo(connected.id);
  check("menu pool info still points to the cabinet's menu code", info.linkedCode === oldCode && info.poolSize >= 2, info);

  /* ── второй раз ── */
  const { code: thirdCode } = await regenerateExchangeCode({ ownerUserId: two.owner.id, accountId: two.account.id, organizationId: s.id });
  check("regenerate again gives yet another code", thirdCode !== newCode && thirdCode !== oldCode);
  await notFound("the previous new code stops working", newCode);
  await works("the latest code works", thirdCode);
  check(
    "two regenerations — two audit rows",
    (await db.auditLog.count({ where: { organizationId: s.id, action: "directory_exchange.code_regenerated" } })) === 2,
  );

  /* ── старый путь через код пула у кабинета постарше ── */
  console.log("--- legacy cabinet linked to a pool code");
  await ageRequests(one.account.id);
  const legacyOwnerOrg = await makeOrg("Пул-владелец");
  const four = await makeOwner(legacyOwnerOrg.id, "four");
  const poolCode = generateServiceCode();
  await db.organization.update({ where: { id: legacyOwnerOrg.id }, data: { serviceCode: poolCode } });
  const legacyCabinetCode = generateServiceCode();
  const legacyCabinet = await makeOrg("Кабинет постарше", four.account.id, { kind: "directory", serviceCode: legacyCabinetCode, linkedServiceCode: poolCode });
  await works("legacy: the pool code the cabinet is linked to works", poolCode);
  check("legacy: the display stores the cabinet's own code", (await exchangeCabinetCode(legacyCabinet.id)) === legacyCabinetCode);
  await works("legacy: the pool code still works after the first display (not regenerated)", poolCode);
  await regenerateExchangeCode({ ownerUserId: four.owner.id, accountId: four.account.id, organizationId: legacyOwnerOrg.id });
  await notFound("legacy: after regenerate the pool code → the common 404", poolCode);
  await notFound("legacy: after regenerate the cabinet's own menu code → the common 404", legacyCabinetCode);
  check(
    "legacy: the cabinet's pool link is untouched",
    (await db.organization.findUniqueOrThrow({ where: { id: legacyCabinet.id }, select: { linkedServiceCode: true } })).linkedServiceCode === poolCode,
  );
  void secondCabinet;
}

async function cleanup() {
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
  const leftRequests = await db.directoryExchangeRequest.count({ where: { OR: [{ requesterOrganizationId: { in: orgIds } }, { masterOrganizationId: { in: orgIds } }] } });
  console.log(`cleanup: organizations left ${left}, users left ${leftUsers}, requests left ${leftRequests}`);
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
