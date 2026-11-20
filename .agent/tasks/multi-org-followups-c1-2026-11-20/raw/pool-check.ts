/*
 * Series C1, item 7 (Р7.1–Р7.4, AC3, AC4): the master cabinet's menu and raw materials for a
 * company of another account — a separate tick in the link request, a separate decision of the
 * cabinet owner, connection on approval, release on leave / disconnect, isolation in the pool.
 * Runs against the local DB; everything it creates is removed at the end.
 *
 *   npx tsx .agent/tasks/multi-org-followups-c1-2026-11-20/raw/pool-check.ts
 */
import "dotenv/config";

import { db } from "@/lib/db";
import { POOL_REQUEST_NOTE } from "@/lib/directory-exchange/request-letters";
import {
  POOL_CONNECTED_NOTE,
  POOL_NOT_CONNECTED_NOTE,
  createExchangeRequest,
  decideExchangeRequest,
  endExchangeRequest,
  loadExchangeRequestByToken,
  loadExchangeRequests,
} from "@/lib/directory-exchange/requests.server";
import { ensureExchangeCabinet, saveExchangeMembers } from "@/lib/directory-exchange/settings.server";
import type { ExchangeSummary } from "@/lib/directory-exchange/summary";
import { ensureServiceCode, getDishPoolInfo } from "@/lib/dish-pool";
import { MasterCorrectionError } from "@/lib/master-brakerage-correction";
import { FOREIGN_POOL_CABINET_MESSAGE, MasterCabinetError, createOrInviteMasterCabinet } from "@/lib/master-cabinet";
import { listPoolOrganizations, listPoolSharedItems, masterPoolCode, poolObjectId, replaceSharedItems } from "@/lib/master-directory";
import { connectPoolObjectByCode, disconnectPoolObject } from "@/lib/master-pool-connect";
import { listNameSuggestions, rememberNames } from "@/lib/name-suggestions-db";
import { loadOrgDirectory } from "@/lib/org-directory-db";
import { loadOrgMasterCabinets } from "@/lib/org-master-cabinets";

const TAG = `pchk${Date.now().toString(36)}`;
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
const realInfo = console.info.bind(console);
console.info = (...args: unknown[]) => {
  const line = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
  if (line.startsWith("[email/dev]")) mailLog.push(line);
  else if (process.env.POOL_CHECK_VERBOSE) realInfo(line);
};
const takeMail = () => mailLog.splice(0).join("\n");

const PAID = { subscriptionPlan: "standard", subscriptionEnd: new Date(Date.now() + 30 * DAY), planPoints: 5, planCycle: "month" };

async function makeOrg(name: string, accountId: string | null = null, extra: Record<string, unknown> = {}) {
  const org = await db.organization.create({ data: { name: `${name} ${TAG}`, type: "restaurant", accountId, ...extra } });
  orgIds.push(org.id);
  return org;
}

async function makeOwner(orgId: string, label: string, accountData: Record<string, unknown> = {}) {
  const owner = await db.user.create({
    data: { email: `${TAG}-${label}@example.test`, name: `Владелец ${label} ${TAG}`, passwordHash: "not-a-real-hash", role: "manager", organizationId: orgId },
  });
  const account = await db.account.create({ data: { ownerUserId: owner.id, ...accountData } });
  accountIds.push(account.id);
  await db.organization.update({ where: { id: orgId }, data: { accountId: account.id } });
  await db.organizationMember.create({ data: { userId: owner.id, organizationId: orgId, role: "owner" } });
  return { owner, account, actor: { userId: owner.id, userName: owner.name } };
}

type Party = Awaited<ReturnType<typeof makeOwner>>;

const linkedCode = async (orgId: string) => (await db.organization.findUnique({ where: { id: orgId }, select: { linkedServiceCode: true } }))?.linkedServiceCode ?? null;
const member = (masterOrganizationId: string, organizationId: string) =>
  db.directoryExchangeMember.findUnique({ where: { masterOrganizationId_organizationId: { masterOrganizationId, organizationId } } });
const notes = (summary: ExchangeSummary | undefined) => summary?.notes ?? [];
/** Запросы аккаунта «стареют» на месяц — суточный лимит не мешает следующим разделам. */
const ageRequests = (accountId: string) =>
  db.directoryExchangeRequest.updateMany({ where: { requesterOrganization: { accountId } }, data: { createdAt: new Date(Date.now() - 30 * DAY) } });

async function main() {
  /* ── данные ── */
  // Владелец кабинета: своя организация «Владелец», кабинет обмена (он же — меню и сырьё).
  const o = await makeOrg("Владелец-П");
  const owner = await makeOwner(o.id, "own");
  const cabinet = await ensureExchangeCabinet(owner.owner.id, owner.account.id);
  orgIds.push(cabinet.id);
  const code = (await db.organization.findUnique({ where: { id: cabinet.id }, select: { serviceCode: true } }))!.serviceCode!;
  const poolCode = (await masterPoolCode(cabinet.id))!;
  await saveExchangeMembers({ ownerUserId: owner.owner.id, ownerName: owner.owner.name, organizationId: o.id, members: [{ organizationId: o.id, kinds: ["products"] }] });
  // «Добавить объект»: своя организация владельца получает меню и сырьё кабинета.
  await connectPoolObjectByCode({ masterOrgId: cabinet.id, code: await ensureServiceCode(o.id), confirm: true, actor: owner.actor });
  await replaceSharedItems(cabinet.id, "dish", [{ name: `Плов кабинета ${TAG}`, supplier: null, manufacturer: null }]);
  check("setup: the owner's organization is in the cabinet's pool", (await linkedCode(o.id)) === poolCode);

  const company = async (label: string) => {
    const org = await makeOrg(`Компания-${label}`);
    const party = await makeOwner(org.id, label.toLowerCase(), PAID);
    return { org, party };
  };
  const { org: a, party: ao } = await company("A");
  const { org: b, party: bo } = await company("B");
  const { org: c, party: co } = await company("C");
  const { org: d, party: dOwner } = await company("D");
  const { org: e, party: eo } = await company("E");

  const ask = (orgId: string, party: Party, over: Record<string, unknown> = {}) =>
    createExchangeRequest({ organizationId: orgId, actor: party.actor, code, mode: "link", kinds: ["products"], ...over });
  const approve = (token: string, over: Record<string, unknown> = {}) =>
    decideExchangeRequest({ token, actor: owner.actor, decision: "approve", allowedKinds: ["products"], organizationIds: [o.id], ...over });
  const leave = async (orgId: string, party: Party) => {
    const links = (await loadExchangeRequests(party.owner.id, orgId)).foreignLinks;
    return endExchangeRequest({ id: links[0].id, organizationId: orgId, accountId: party.account.id, actor: party.actor });
  };

  /* ── Р7.1: по умолчанию меню и сырьё не просят ── */
  console.log("--- a request without the menu and raw materials");
  const plain = await ask(a.id, ao, { withPool: undefined });
  await plain.notify();
  const plainMail = takeMail();
  check("the tick is off by default: the request stores withPool = false", (await db.directoryExchangeRequest.findUnique({ where: { id: plain.request.id } }))?.withPool === false);
  check("…the owner letter does not mention the menu and raw materials", plainMail.includes("Запрос на обмен справочниками") && !plainMail.includes(POOL_REQUEST_NOTE), plainMail.slice(0, 300));
  check("…the confirmation page shows no pool line", (await loadExchangeRequestByToken({ token: plain.token, userId: owner.owner.id })).request.withPool === false);
  const plainDecision = await approve(plain.token, { allowPool: true });
  const plainRow = await db.directoryExchangeRequest.findUnique({ where: { id: plain.request.id } });
  check(
    "approved (a stray allowPool is ignored): link without the pool, poolAllowed false, no pool note",
    plainDecision.status === "approved" && plainRow?.poolAllowed === false && (await member(cabinet.id, a.id))?.poolConnected === false && (await linkedCode(a.id)) === null && !notes(plainDecision.summary).some((n) => n.startsWith("Меню и сырьё")),
    { poolAllowed: plainRow?.poolAllowed, linked: await linkedCode(a.id), notes: notes(plainDecision.summary) },
  );
  await plainDecision.notify();
  check("…the requester's letter says nothing about the menu and raw materials", !takeMail().includes("Меню и сырьё"));
  await leave(a.id, ao);
  check("…A leaves: nothing about the pool changes", (await member(cabinet.id, a.id)) === null && (await linkedCode(a.id)) === null);
  await ageRequests(ao.account.id);

  /* ── просили, владелец не разрешил ── */
  console.log("--- asked for, not allowed");
  const transferPool = await createExchangeRequest({ organizationId: a.id, actor: ao.actor, code, mode: "transfer", kinds: ["products"], withPool: true });
  check("a transfer never asks for the pool even with withPool: true", (await db.directoryExchangeRequest.findUnique({ where: { id: transferPool.request.id } }))?.withPool === false);
  await endExchangeRequest({ id: transferPool.request.id, organizationId: a.id, accountId: ao.account.id, actor: ao.actor });
  const asked = await ask(a.id, ao, { withPool: true });
  await asked.notify();
  const askedMail = takeMail();
  check("the request stores withPool = true", (await db.directoryExchangeRequest.findUnique({ where: { id: asked.request.id } }))?.withPool === true);
  check("…the owner letter mentions the menu and raw materials", askedMail.includes(POOL_REQUEST_NOTE), askedMail.slice(0, 400));
  const bell = await db.notification.findFirst({ where: { dedupeKey: `directory_exchange.request_incoming:${asked.request.id}` } });
  check("…the owner's bell names it too", JSON.stringify(bell?.items ?? null).includes("меню и сырьё кабинета"), bell?.items);
  const askedView = await loadExchangeRequestByToken({ token: asked.token, userId: owner.owner.id });
  check("…the confirmation page shows the pool line", askedView.request.withPool === true);
  const notAllowed = await approve(asked.token);
  check(
    "approved without ticking the pool: the link exists, the organization is not in the pool",
    notAllowed.status === "approved" &&
      (await db.directoryExchangeRequest.findUnique({ where: { id: asked.request.id } }))?.poolAllowed === false &&
      (await member(cabinet.id, a.id))?.foreign === true &&
      (await member(cabinet.id, a.id))?.poolConnected === false &&
      (await linkedCode(a.id)) === null,
    { linked: await linkedCode(a.id), notes: notes(notAllowed.summary) },
  );
  const notAllowedAudit = await db.auditLog.findFirst({ where: { organizationId: a.id, action: "directory_exchange.request_approved", entityId: asked.request.id } });
  await notAllowed.notify();
  check("…the requester's letter: the owner did not connect the menu and raw materials", takeMail().includes("владелец не подключил"));
  check("…the requester's journal records the pool was asked for and not allowed", JSON.stringify(notAllowedAudit?.details).includes('"poolAllowed":false'), notAllowedAudit?.details);
  await leave(a.id, ao);
  await ageRequests(ao.account.id);

  /* ── просили и разрешили ── */
  console.log("--- asked for and allowed");
  const allowedReq = await ask(a.id, ao, { withPool: true });
  const allowed = await approve(allowedReq.token, { allowPool: true });
  const aMember = await member(cabinet.id, a.id);
  check(
    "allowed: A's organization is in the cabinet's pool, poolConnected, poolAllowed stored",
    (await linkedCode(a.id)) === poolCode && aMember?.poolConnected === true && (await db.directoryExchangeRequest.findUnique({ where: { id: allowedReq.request.id } }))?.poolAllowed === true,
    { linked: await linkedCode(a.id), poolCode, member: aMember?.poolConnected },
  );
  check("…the result says the menu and raw materials are connected", notes(allowed.summary).includes(POOL_CONNECTED_NOTE), notes(allowed.summary));
  await allowed.notify();
  check("…the requester's letter says they are connected", takeMail().includes("Меню и сырьё мастер-кабинета подключены"));
  check("…the cabinet lists A among its objects", (await listPoolOrganizations(cabinet.id)).some((item) => item.organizationId === a.id));
  check(
    "…the cabinet's shared menu resolves for A",
    (await listPoolSharedItems(a.id, "dish")).some((item) => item.name === `Плов кабинета ${TAG}`) && (await loadOrgDirectory(a.id, "dish")).includes(`Плов кабинета ${TAG}`),
  );
  const aAudit = await db.auditLog.findMany({ where: { organizationId: a.id } });
  const aAuditText = JSON.stringify(aAudit.map((row) => [row.action, row.userName, row.details]));
  check(
    "…A's journal: approval with poolConnected, no pool entry with the owner's name, no cabinet id",
    aAuditText.includes('"poolConnected":true') && !aAudit.some((row) => row.action.startsWith("master_directory.")) && !aAuditText.includes(owner.owner.name) && !aAuditText.includes(cabinet.id) && !aAuditText.includes(o.id),
    aAuditText.slice(0, 600),
  );
  check(
    "…the cabinet's journal has the object connection",
    (await db.auditLog.count({ where: { organizationId: cabinet.id, action: "master_directory.object_connected", entityId: a.id } })) === 1,
  );

  // B — вторая компания в том же пуле (изоляция).
  const bReq = await ask(b.id, bo, { withPool: true });
  await approve(bReq.token, { allowPool: true });
  check("B is connected to the same pool", (await linkedCode(b.id)) === poolCode && (await member(cabinet.id, b.id))?.poolConnected === true);

  /* ── Р7.4: изоляция ── */
  console.log("--- isolation in the pool");
  await rememberNames({ organizationId: a.id, scope: "dish", values: [`Блюдо А ${TAG}`] });
  await rememberNames({ organizationId: b.id, scope: "dish", values: [`Блюдо Б ${TAG}`] });
  await rememberNames({ organizationId: o.id, scope: "dish", values: [`Блюдо владельца ${TAG}`] });
  const aDishes = (await listNameSuggestions(a.id, "dish")).values;
  const bDishes = (await listNameSuggestions(b.id, "dish")).values;
  const oDishes = (await listNameSuggestions(o.id, "dish")).values;
  check(
    "A sees its own dishes, the owner's and the cabinet's menu — not B's",
    aDishes.includes(`Блюдо А ${TAG}`) && aDishes.includes(`Блюдо владельца ${TAG}`) && aDishes.includes(`Плов кабинета ${TAG}`) && !aDishes.includes(`Блюдо Б ${TAG}`),
    aDishes,
  );
  check("B does not see A's dishes", bDishes.includes(`Блюдо владельца ${TAG}`) && !bDishes.includes(`Блюдо А ${TAG}`), bDishes);
  check("the owner gets no dish names of the companies", oDishes.includes(`Блюдо владельца ${TAG}`) && !oDishes.includes(`Блюдо А ${TAG}`) && !oDishes.includes(`Блюдо Б ${TAG}`), oDishes);
  const aDirectory = await loadOrgDirectory(a.id, "dish");
  const oDirectory = await loadOrgDirectory(o.id, "dish");
  check(
    "the organization directory (dishes) keeps the same isolation",
    aDirectory.includes(`Блюдо владельца ${TAG}`) && !aDirectory.includes(`Блюдо Б ${TAG}`) && !oDirectory.includes(`Блюдо А ${TAG}`),
    { a: aDirectory, o: oDirectory },
  );
  const aView = await loadOrgMasterCabinets(a.id, ao.owner.id);
  const aCabinet = aView.cabinets.find((item) => item.id === cabinet.id);
  const aViewText = JSON.stringify(aView);
  check(
    "A's «Мастер-кабинет» page: the cabinet's name only — no operators, no object count",
    Boolean(aCabinet) && aCabinet!.limited && aCabinet!.objectsCount === null && aCabinet!.operators.length === 0 && aCabinet!.name === cabinet.name && !aViewText.includes(owner.owner.email) && !aViewText.includes(o.name) && !aViewText.includes(b.name),
    aCabinet,
  );
  check("…A's own organization is listed in that cabinet (it may disconnect itself)", (aCabinet?.objects.length ?? 0) === 1);
  const oView = await loadOrgMasterCabinets(o.id, owner.owner.id);
  const oCabinet = oView.cabinets.find((item) => item.id === cabinet.id);
  check("the owner's page is unchanged: count of objects (O, A, B) and not limited", oCabinet?.limited === false && oCabinet.objectsCount === 3, oCabinet && { limited: oCabinet.limited, count: oCabinet.objectsCount });
  const aPoolInfo = await getDishPoolInfo(a.id);
  check(
    "A's dish pool panel names the cabinet and counts only organizations whose dishes it sees",
    aPoolInfo.linkedOrganizationName === cabinet.name && aPoolInfo.poolSize === 3,
    aPoolInfo,
  );
  // Точка C, подключённая к этому пулу своим кодом: в пуле — кабинет, O, A, B и сама точка.
  const cPoint = await db.building.create({ data: { organizationId: c.id, name: `Точка C ${TAG}`, linkedServiceCode: poolCode } });
  const cPointInfo = await getDishPoolInfo(c.id, cPoint.id);
  check(
    "a point connected by its own code: the panel counts only its company's and the cabinet's objects (cabinet, O, the point)",
    cPointInfo.linkedOrganizationName === cabinet.name && cPointInfo.poolSize === 3,
    cPointInfo,
  );
  await db.building.delete({ where: { id: cPoint.id } });

  // «Создать кабинет / пригласить оператора» без кабинета из A: кабинет пула — владельца, другой компании.
  const membersBefore = await db.organizationMember.count({ where: { organizationId: cabinet.id } });
  let foreignInvite: unknown = null;
  try {
    await createOrInviteMasterCabinet({ organizationId: a.id, actorUserId: ao.owner.id, name: "Оператор А", email: `${TAG}-a-operator@example.test` });
  } catch (error) {
    foreignInvite = error;
  }
  check(
    "A's manager cannot create a cabinet in / invite into the owner's pool: 409, no membership, no invited person",
    foreignInvite instanceof MasterCabinetError &&
      foreignInvite.status === 409 &&
      foreignInvite.message === FOREIGN_POOL_CABINET_MESSAGE &&
      (await db.organizationMember.count({ where: { organizationId: cabinet.id } })) === membersBefore &&
      (await db.organizationMember.count({ where: { userId: ao.owner.id, organizationId: cabinet.id } })) === 0 &&
      (await db.user.count({ where: { email: `${TAG}-a-operator@example.test` } })) === 0 &&
      (await db.organization.count({ where: { kind: "directory", accountId: ao.account.id } })) === 0,
    foreignInvite instanceof Error ? foreignInvite.message : foreignInvite,
  );
  check("…the settings route refuses it too: A's page lists the cabinet as another company's", aView.cabinets.some((item) => item.limited));

  /* ── выход компании ── */
  console.log("--- leave and disconnect");
  // Точка A, подключённая к этому кабинету своим кодом, и точка в другом пуле.
  const aPoint = await db.building.create({ data: { organizationId: a.id, name: `Точка А ${TAG}`, linkedServiceCode: poolCode } });
  const aOtherPoint = await db.building.create({ data: { organizationId: a.id, name: `Точка А2 ${TAG}`, linkedServiceCode: "OTHER-POOL1" } });
  await leave(a.id, ao);
  const aPointAfter = await db.building.findUnique({ where: { id: aPoint.id } });
  const aOtherAfter = await db.building.findUnique({ where: { id: aOtherPoint.id } });
  check(
    "A leaves: the organization leaves this pool; its point connected by hand and another pool's point are untouched",
    (await member(cabinet.id, a.id)) === null && (await linkedCode(a.id)) === null && aPointAfter?.linkedServiceCode === poolCode && aOtherAfter?.linkedServiceCode === "OTHER-POOL1",
    { org: await linkedCode(a.id), point: aPointAfter?.linkedServiceCode, other: aOtherAfter?.linkedServiceCode },
  );
  const leftAudit = await db.auditLog.findFirst({ where: { organizationId: cabinet.id, action: "directory_exchange.request_left" }, orderBy: { createdAt: "desc" } });
  check("…the leave is journaled with poolDisconnected", JSON.stringify(leftAudit?.details).includes('"poolDisconnected":true'), leftAudit?.details);
  check("…A's hand-connected point still gets the cabinet's menu", (await listPoolSharedItems(a.id, "dish", aPoint.id)).some((item) => item.name === `Плов кабинета ${TAG}`));
  await db.building.update({ where: { id: aPoint.id }, data: { linkedServiceCode: null } });
  check("…once that point is unlinked by hand, the cabinet's menu no longer resolves for A", (await listPoolSharedItems(a.id, "dish")).length === 0);

  // Отключение владельцем.
  const bMember = await member(cabinet.id, b.id);
  await endExchangeRequest({ id: bMember!.id, organizationId: o.id, accountId: owner.account.id, actor: owner.actor });
  check("the owner disconnects B: B leaves the pool too", (await member(cabinet.id, b.id)) === null && (await linkedCode(b.id)) === null, await linkedCode(b.id));

  /* ── отказ подключения ── */
  console.log("--- a refused pool connection");
  // C уже получает меню и сырьё из кабинета своего аккаунта.
  const cCabinet = await ensureExchangeCabinet(co.owner.id, co.account.id);
  orgIds.push(cCabinet.id);
  await connectPoolObjectByCode({ masterOrgId: cCabinet.id, code: await ensureServiceCode(c.id), confirm: true, actor: co.actor });
  const cOwnPool = await linkedCode(c.id);
  const cReq = await ask(c.id, co, { withPool: true });
  const cDecision = await approve(cReq.token, { allowPool: true });
  const cNote = notes(cDecision.summary).find((note) => note.startsWith(POOL_NOT_CONNECTED_NOTE));
  check(
    "C is already in another cabinet's pool: the link exists, the pool is not changed, a note explains",
    cDecision.status === "approved" && (await member(cabinet.id, c.id))?.foreign === true && (await member(cabinet.id, c.id))?.poolConnected === false && (await linkedCode(c.id)) === cOwnPool && Boolean(cNote?.includes("другому мастер-кабинету")),
    { notes: notes(cDecision.summary), linked: await linkedCode(c.id) },
  );
  await cDecision.notify();
  const cMail = takeMail();
  check("…the requester's letter: not connected, without the reason", cMail.includes("подключить не удалось") && !cMail.includes("другому мастер-кабинету"), cMail.slice(0, 300));
  await leave(c.id, co);
  check("…C leaves: its own cabinet's pool stays", (await linkedCode(c.id)) === cOwnPool);

  /* ── подключение вручную обмен не снимает ── */
  console.log("--- a pool link made by hand");
  await connectPoolObjectByCode({ masterOrgId: cabinet.id, code: await ensureServiceCode(d.id), confirm: true, actor: owner.actor });
  const dReq = await ask(d.id, dOwner, { withPool: true });
  const dDecision = await approve(dReq.token, { allowPool: true });
  check(
    "D was connected by hand: approval is idempotent (connected, no error), poolConnected stays false",
    dDecision.status === "approved" && notes(dDecision.summary).includes(POOL_CONNECTED_NOTE) && (await member(cabinet.id, d.id))?.poolConnected === false && (await linkedCode(d.id)) === poolCode,
    notes(dDecision.summary),
  );
  await leave(d.id, dOwner);
  check("…D leaves the exchange: the hand-made pool link is kept", (await member(cabinet.id, d.id)) === null && (await linkedCode(d.id)) === poolCode);

  /* ── кабинет сам отключил объект, потом компания вышла ── */
  console.log("--- the cabinet disconnected the object meanwhile");
  const eReq = await ask(e.id, eo, { withPool: true });
  await approve(eReq.token, { allowPool: true });
  check("E is connected by the exchange", (await linkedCode(e.id)) === poolCode && (await member(cabinet.id, e.id))?.poolConnected === true);
  await disconnectPoolObject({ masterOrgId: cabinet.id, objectId: poolObjectId(e.id, null), actor: owner.actor });
  check(
    "…the cabinet disconnected E on «Подключённые объекты»: the exchange mark is dropped",
    (await linkedCode(e.id)) === null && (await member(cabinet.id, e.id))?.poolConnected === false,
  );
  // …и подключил снова вручную: это уже не подключение обмена.
  await connectPoolObjectByCode({ masterOrgId: cabinet.id, code: await ensureServiceCode(e.id), confirm: true, actor: owner.actor });
  check("…then reconnected E by hand: no exchange mark", (await linkedCode(e.id)) === poolCode && (await member(cabinet.id, e.id))?.poolConnected === false);
  let eLeft = true;
  try {
    await leave(e.id, eo);
  } catch (error) {
    eLeft = false;
    console.log("leave failed", error);
  }
  const eAudit = await db.auditLog.findFirst({ where: { organizationId: cabinet.id, action: "directory_exchange.request_left", entityId: eReq.request.id } });
  check(
    "…then E leaves: nothing breaks, the hand-made connection stays",
    eLeft && (await member(cabinet.id, e.id)) === null && (await linkedCode(e.id)) === poolCode && !JSON.stringify(eAudit?.details).includes("poolDisconnected"),
    eAudit?.details,
  );

  /* ── подключение и пометка — одна транзакция ── */
  console.log("--- the mark is written with the connection");
  const lone = await makeOrg("Одиночка");
  let refused = false;
  try {
    await connectPoolObjectByCode({
      masterOrgId: cabinet.id,
      code: await ensureServiceCode(lone.id),
      confirm: true,
      actor: owner.actor,
      cabinetAuditOnly: true,
      onConnected: async () => {
        throw new MasterCorrectionError("связь с компанией уже разорвана.");
      },
    });
  } catch (error) {
    refused = error instanceof MasterCorrectionError;
  }
  check(
    "a failing mark (the company already left) rolls the connection back",
    refused && (await linkedCode(lone.id)) === null && (await db.auditLog.count({ where: { organizationId: { in: [cabinet.id, lone.id] }, entityId: lone.id } })) === 0,
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
  const leftRequests = await db.directoryExchangeRequest.count({ where: { OR: [{ requesterOrganizationId: { in: orgIds } }, { masterOrganizationId: { in: orgIds } }] } });
  const leftMembers = await db.directoryExchangeMember.count({ where: { OR: [{ organizationId: { in: orgIds } }, { masterOrganizationId: { in: orgIds } }] } });
  console.log(`cleanup: organizations left ${left}, users left ${leftUsers}, accounts left ${leftAccounts}, requests left ${leftRequests}, members left ${leftMembers}`);
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
