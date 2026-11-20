/*
 * End-to-end check of the exchange with a foreign account (part 3) against the local DB,
 * extended for series A: bell and Telegram to the cabinet owner (AC4) and the first
 * exchange of a link that runs longer than the wait (AC5).
 * Series C1 copy: the one-company rule is gone — the expectations that encoded it now
 * check that a second company is linked and still does not get the first one's records.
 */
import "dotenv/config";

import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { EXCHANGE_KINDS } from "@/lib/directory-exchange/kinds";
import {
  CABINET_NOT_FOUND_MESSAGE,
  createExchangeRequest,
  decideExchangeRequest,
  endExchangeRequest,
  loadExchangeRequestByToken,
  loadExchangeRequests,
} from "@/lib/directory-exchange/requests.server";
import { runAllDirectoryExchanges, runDirectoryExchange, transferOnce, transferPreview } from "@/lib/directory-exchange/run.server";
import { ensureExchangeCabinet, loadExchangeState, saveExchangeMembers } from "@/lib/directory-exchange/settings.server";
import { summaryTotals, type ExchangeSummary } from "@/lib/directory-exchange/summary";
import { generateServiceCode } from "@/lib/dish-pool-code";
import { createAccountMasterCabinet } from "@/lib/master-cabinet";
import { createStaffMember } from "@/lib/staff-create";

const TAG = `fchk${Date.now().toString(36)}`;
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
const infoLog: string[] = [];
const realInfo = console.info.bind(console);
console.info = (...args: unknown[]) => {
  const line = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
  if (line.startsWith("[email/dev]")) mailLog.push(line);
  else infoLog.push(line);
};
const takeMail = () => mailLog.splice(0).join("\n");
const takeInfo = () => infoLog.splice(0).join("\n");

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
    },
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

const names = async (orgId: string) => ({
  products: (await db.product.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { name: "asc" } })).map((p) => p.name),
  positions: (await db.jobPosition.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } })).map((p) => `${p.categoryKey}:${p.name}`),
  staff: (await db.user.findMany({ where: { organizationId: orgId, passwordHash: "" }, orderBy: { name: "asc" } })).map((u) => u.name),
  buildings: (await db.building.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } })).map((b) => b.name),
  areas: (await db.area.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } })).map((a) => a.name),
  equipment: (await db.equipment.findMany({ where: { area: { organizationId: orgId } }, orderBy: { name: "asc" } })).map((e) => e.name),
});
const person = (orgId: string, name: string) => db.user.findFirst({ where: { organizationId: orgId, name } });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const totals = (summary: ExchangeSummary | undefined) => summaryTotals(summary ?? { organizations: [], notes: [] });
const of = (summary: ExchangeSummary | undefined, orgId: string) => summary?.organizations.find((o) => o.organizationId === orgId)?.kinds;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Отказ с нужным кодом ответа (и, если задан, текстом). */
async function refused(label: string, status: number, run: () => Promise<unknown>, message?: string): Promise<DirectoryExchangeError | null> {
  try {
    await run();
    check(label, false, "no error");
    return null;
  } catch (error) {
    const ok = error instanceof DirectoryExchangeError && error.status === status && (message === undefined || error.message === message);
    check(label, ok, error instanceof DirectoryExchangeError ? { status: error.status, message: error.message } : String(error));
    return error instanceof DirectoryExchangeError ? error : null;
  }
}

const auditCount = (organizationId: string, action: string, where: Record<string, unknown> = {}) =>
  db.auditLog.count({ where: { organizationId, action: `directory_exchange.${action}`, ...where } });

/** Запросы аккаунта «стареют» на месяц — чтобы суточный лимит не мешал следующим разделам. */
const ageRequests = (accountId: string) =>
  db.directoryExchangeRequest.updateMany({
    where: { requesterOrganization: { accountId } },
    data: { createdAt: new Date(Date.now() - 30 * DAY) },
  });

async function main() {
  /* ── данные ── */
  // Аккаунт 1 — заявитель, оплачен («Стандарт», 2 точки).
  const r1 = await makeOrg("Заявитель", null, { inn: "7707083893" });
  const one = await makeOwner(r1.id, "one", { subscriptionPlan: "standard", subscriptionEnd: new Date(Date.now() + 30 * DAY), planPoints: 2, planCycle: "month" });
  const r2 = await makeOrg("Заявитель-2", one.account.id);
  await join(one.owner.id, r2.id);
  // Руководитель заявителя без прав владельца аккаунта.
  const manager1 = await db.user.create({
    data: { email: `${TAG}-mgr@example.test`, name: "Руководитель без прав", passwordHash: "x", role: "manager", organizationId: r1.id },
  });

  // Аккаунт 2 — владелец кабинета: организация с данными и вторая своя организация.
  const s = await makeOrg("Источник");
  const two = await makeOwner(s.id, "two");
  const s2 = await makeOrg("Источник-2", two.account.id);
  await join(two.owner.id, s2.id);

  await db.product.createMany({
    data: [
      { name: "Молоко 3,2%", kind: "raw", supplier: "Ферма", unit: "l", shelfLifeDays: 5, organizationId: s.id },
      { name: "Сыр твёрдый", kind: "raw", unit: "kg", organizationId: s.id },
      { name: "Борщ", kind: "finished", servingTemp: "soup", shelfLifeHours: 6, organizationId: s.id },
    ],
  });
  const cook = await db.jobPosition.create({ data: { organizationId: s.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  for (const [index, name] of ["Иванов Иван", "Петрова Анна"].entries()) {
    await db.user.create({
      data: {
        email: `${TAG}-staff${index}@s.local.haccp`,
        name,
        phone: index === 0 ? "+79851234567" : null,
        passwordHash: "",
        role: "cook",
        jobPositionId: cook.id,
        positionTitle: cook.name,
        organizationId: s.id,
        weeklyDaysOff: [5, 6],
      },
    });
  }
  const building = await db.building.create({ data: { organizationId: s.id, name: "Кафе на Ленина", address: "Ленина, 1" } });
  const area = await db.area.create({ data: { organizationId: s.id, name: "Склад", buildingId: building.id } });
  await db.equipment.create({ data: { name: "Холодильник №1", type: "refrigerator", tempMin: 2, tempMax: 6, areaId: area.id } });

  const cabinet = await ensureExchangeCabinet(two.owner.id, two.account.id);
  orgIds.push(cabinet.id);
  const code = (await db.organization.findUnique({ where: { id: cabinet.id }, select: { serviceCode: true } }))!.serviceCode!;
  await saveExchangeMembers({
    ownerUserId: two.owner.id,
    ownerName: two.owner.name,
    organizationId: s.id,
    members: [
      { organizationId: s.id, kinds: [...EXCHANGE_KINDS] },
      { organizationId: s2.id, kinds: ["products", "staff"] },
    ],
  });
  await runDirectoryExchange(cabinet.id, { actor: two.actor });
  check("setup: the owner's second organization got staff WITH the phone (exchange inside an account)", (await person(s2.id, "Иванов Иван"))?.phone === "+79851234567");

  // Аккаунт 3 — посторонний, в пробном периоде.
  const t = await makeOrg("Посторонний");
  const three = await makeOwner(t.id, "three");

  /* ── Р1: кто может запросить ── */
  console.log("--- who may ask");
  const ask = (orgId: string, actor: { userId: string; userName: string | null }, over: Record<string, unknown> = {}) =>
    createExchangeRequest({ organizationId: orgId, actor, code, mode: "link", kinds: ["products", "staff", "objects"], ...over });

  await refused("trial account: request by code → 402", 402, () => ask(t.id, three.actor));
  await refused("trial account: a wrong code is the same 402 — nothing learnt about the code", 402, () => ask(t.id, three.actor, { code: "ZZZZZ-ZZZZZ" }));
  await db.account.update({ where: { id: three.account.id }, data: { createdAt: new Date(Date.now() - 90 * DAY), trialEndsAt: new Date(Date.now() - 60 * DAY) } });
  await refused("free account (trial over): request by code → 402", 402, () => ask(t.id, three.actor));
  check("refused accounts created no request rows", (await db.directoryExchangeRequest.count({ where: { requesterOrganizationId: t.id } })) === 0);

  await refused("paid account: malformed code → 404 with the common text", 404, () => ask(r1.id, one.actor, { code: "нет такого" }), CABINET_NOT_FOUND_MESSAGE);
  await refused("paid account: unknown code → the same 404", 404, () => ask(r1.id, one.actor, { code: "ZZZZZ-ZZZZZ" }), CABINET_NOT_FOUND_MESSAGE);
  const demoCode = generateServiceCode();
  const demoCabinet = await makeOrg("Демо-кабинет", two.account.id, { kind: "directory", isDemo: true, serviceCode: demoCode });
  await refused("paid account: demo cabinet code → the same 404", 404, () => ask(r1.id, one.actor, { code: demoCode }), CABINET_NOT_FOUND_MESSAGE);
  await db.organization.delete({ where: { id: demoCabinet.id } });
  const plainCode = generateServiceCode();
  await db.organization.update({ where: { id: s2.id }, data: { serviceCode: plainCode } });
  await refused("paid account: code of an ordinary organization (not a cabinet) → the same 404", 404, () => ask(r1.id, one.actor, { code: plainCode }), CABINET_NOT_FOUND_MESSAGE);
  await db.organization.update({ where: { id: s2.id }, data: { serviceCode: null } });

  const ownCabinet = await ensureExchangeCabinet(one.owner.id, one.account.id);
  orgIds.push(ownCabinet.id);
  const ownCode = (await db.organization.findUnique({ where: { id: ownCabinet.id }, select: { serviceCode: true } }))!.serviceCode!;
  await refused("paid account: own cabinet code → 409", 409, () => ask(r1.id, one.actor, { code: ownCode }));
  await refused("paid account: no lists → 400", 400, () => ask(r1.id, one.actor, { kinds: [] }));
  await refused("paid account: unknown mode → 400", 400, () => ask(r1.id, one.actor, { mode: "sync" }));
  await refused("not the account owner → 403", 403, () => ask(r1.id, { userId: manager1.id, userName: manager1.name }));
  await refused("owner of another account asking for a foreign organization → 403", 403, () => ask(r1.id, three.actor));
  check("no refusal above created a request", (await db.directoryExchangeRequest.count({ where: { requesterOrganization: { accountId: one.account.id } } })) === 0);

  /* ── Р4 (до подтверждения): чужие данные недоступны ── */
  await refused("before approval: transfer preview of a foreign organization → 404", 404, () => transferPreview({ fromOrganizationId: s.id, toOrganizationId: r1.id }));
  await refused("before approval: one-off transfer from a foreign organization → 404", 404, () => transferOnce({ fromOrganizationId: s.id, toOrganizationId: r1.id, selection: { products: "all" }, actor: one.actor }));
  await refused("before approval: foreign organization as an exchange member → 404", 404, () => saveExchangeMembers({ ownerUserId: one.owner.id, organizationId: r1.id, members: [{ organizationId: s.id, kinds: ["products"] }] }));

  /* ── запрос: создан, ждёт, письмо владельцу ── */
  console.log("--- request created");
  takeMail();
  // Код вводят как придётся: строчными, без дефиса, с пробелами.
  const first = await ask(r1.id, one.actor, { code: `  ${code.replace("-", " ").toLowerCase()} ` });
  check("paid account: request created, pending", first.request.status === "pending" && first.request.mode === "link" && same(first.request.kinds, ["products", "staff", "objects"]), first.request);
  check(
    "response tells the requester the cabinet NAME and nothing else about the other account",
    same(Object.keys(first.request).sort(), ["cabinetName", "createdAt", "expiresAt", "id", "kinds", "mode", "status"]) && first.request.cabinetName === "Мастер-кабинет",
    first.request,
  );
  const row1 = await db.directoryExchangeRequest.findUnique({ where: { id: first.request.id } });
  check("only the SHA-256 of the token is stored", row1?.tokenHash === sha256(first.token) && !JSON.stringify(row1).includes(first.token) && first.token.length === 43);
  check("request expires in 7 days", Math.abs(new Date(first.request.expiresAt).getTime() - (new Date(first.request.createdAt).getTime() + 7 * DAY)) < 1000);
  check("request is addressed to the cabinet, asked by the owner of the paid account", row1?.masterOrganizationId === cabinet.id && row1?.requesterOrganizationId === r1.id && row1?.requestedByUserId === one.owner.id);

  // Серия A, AC4: у владельца кабинета привязан Telegram.
  await db.user.update({ where: { id: two.owner.id }, data: { telegramChatId: `${TAG}-two-chat` } });
  let threw = false;
  await first.notify().catch(() => (threw = true));
  const ownerMail = takeMail();
  const incomingKind = "directory_exchange.request_incoming";
  const ownerBell = await db.notification.findMany({ where: { userId: two.owner.id, kind: incomingKind } });
  check(
    "series A AC4: bell in the cabinet owner's home organization, linking to /exchange-request/<request id>, naming the requester",
    !threw &&
      ownerBell.length === 1 &&
      ownerBell[0].organizationId === two.owner.organizationId &&
      ownerBell[0].linkHref === `/exchange-request/${first.request.id}` &&
      ownerBell[0].linkLabel === "Открыть запрос" &&
      JSON.stringify(ownerBell[0].items).includes(r1.name) &&
      !JSON.stringify(ownerBell[0]).includes(first.token),
    ownerBell,
  );
  const telegram = await db.telegramLog.findMany({ where: { userId: two.owner.id, kind: incomingKind } });
  check(
    "series A AC4: Telegram message to the cabinet owner about the request (no bot locally — logged as failed)",
    telegram.length === 1 &&
      telegram[0].body.includes(r1.name) &&
      telegram[0].body.includes("Без вашего подтверждения ничего не передаётся") &&
      telegram[0].dedupeKey === `${incomingKind}:${first.request.id}` &&
      !telegram[0].body.includes(first.token),
    telegram,
  );
  check(
    "letter to the cabinet owner: his address, who asks (name, INN), the lists, the link with the raw token, 7 days",
    !threw &&
      ownerMail.includes(two.owner.email) &&
      ownerMail.includes(r1.name) &&
      ownerMail.includes("ИНН 7707083893") &&
      ownerMail.includes("Продукция, Сотрудники, Объекты") &&
      ownerMail.includes("7 дней") &&
      !ownerMail.includes(one.owner.email),
    ownerMail,
  );
  // Сама ссылка в журнале dev-режима не видна (теги вырезаны) — проверяем сборку письма напрямую.
  const { ownerRequestLetter } = await import("@/lib/directory-exchange/request-letters");
  const letter = ownerRequestLetter({ url: `http://localhost:3000/exchange-request/${first.token}`, mode: "link", kinds: ["products"], cabinetName: "К", requesterName: "<b>Х</b>", requesterInn: null, expiresAt: new Date() });
  check("letter body: link /exchange-request/<raw token>, foreign names escaped", letter.body.includes(`/exchange-request/${first.token}"`) && letter.body.includes("&lt;b&gt;Х&lt;/b&gt;") && !letter.body.includes("<b>Х"));

  // Владелец без рабочей почты: письмо пропускается, запрос жив.
  await db.user.update({ where: { id: two.owner.id }, data: { email: `${TAG}-two@x.local.haccp` } });
  takeInfo();
  threw = false;
  await first.notify().catch(() => (threw = true));
  check("synthetic address of the owner: letter skipped without throwing", !threw && takeMail() === "" && takeInfo().includes("request letter skipped"));
  await db.user.update({ where: { id: two.owner.id }, data: { email: two.owner.email } });
  check(
    "series A AC4: the same request does not make a second bell",
    (await db.notification.count({ where: { userId: two.owner.id, kind: incomingKind } })) === 1,
  );
  // Без привязанного Telegram — сообщение не шлётся, ошибки нет.
  await db.user.update({ where: { id: two.owner.id }, data: { telegramChatId: null } });
  const telegramBefore = await db.telegramLog.count({ where: { userId: two.owner.id, kind: incomingKind } });
  threw = false;
  await first.notify().catch(() => (threw = true));
  takeMail();
  check(
    "series A AC4: owner without Telegram — nothing sent, no error",
    !threw && (await db.telegramLog.count({ where: { userId: two.owner.id, kind: incomingKind } })) === telegramBefore,
  );

  check("audit on both sides: request_created", (await auditCount(r1.id, "request_created", { userId: one.owner.id })) === 1 && (await auditCount(cabinet.id, "request_created", { userId: null })) === 1);

  await refused("duplicate request to the same cabinet → 409", 409, () => ask(r1.id, one.actor));
  check("the duplicate created nothing", (await db.directoryExchangeRequest.count({ where: { requesterOrganizationId: r1.id } })) === 1);

  /* ── списки для окна и карточки ── */
  const listRequester = await loadExchangeRequests(one.owner.id, r1.id);
  check(
    "requester sees «pending»: cabinet name and the date, nothing incoming",
    listRequester.outgoing.length === 1 && listRequester.outgoing[0].id === first.request.id && listRequester.outgoing[0].cabinetName === "Мастер-кабинет" && listRequester.foreignLinks.length === 0 && listRequester.incoming.length === 0 && listRequester.foreignMembers.length === 0,
    listRequester,
  );
  const listOwner = await loadExchangeRequests(two.owner.id, s.id);
  check(
    "cabinet owner sees the incoming request with the requester's name",
    listOwner.incoming.length === 1 && listOwner.incoming[0].id === first.request.id && listOwner.incoming[0].requesterName === r1.name && listOwner.outgoing.length === 0 && same(Object.keys(listOwner.incoming[0]).sort(), ["createdAt", "expiresAt", "id", "kinds", "mode", "requesterName"]),
    listOwner,
  );
  const emptyList = (list: Awaited<ReturnType<typeof loadExchangeRequests>>) => list.outgoing.length + list.foreignLinks.length + list.incoming.length + list.foreignMembers.length === 0;
  check("a manager who is not the account owner sees nothing", emptyList(await loadExchangeRequests(manager1.id, r1.id)));
  check("«войти как» sees nothing", emptyList(await loadExchangeRequests(one.owner.id, r1.id, { sessionAllows: false })));
  check("a stranger sees nothing, even naming a foreign organization", emptyList(await loadExchangeRequests(three.owner.id, t.id)) && emptyList(await loadExchangeRequests(three.owner.id, s.id)) && emptyList(await loadExchangeRequests(three.owner.id, r1.id)));
  check("another organization of the requester's account shows no request of the first one", (await loadExchangeRequests(one.owner.id, r2.id)).outgoing.length === 0);

  /* ── страница запроса: только владелец аккаунта кабинета ── */
  console.log("--- token access");
  await refused("stranger with the raw token cannot read → 403", 403, () => loadExchangeRequestByToken({ token: first.token, userId: three.owner.id }));
  await refused("the requester himself with the raw token cannot read → 403", 403, () => loadExchangeRequestByToken({ token: first.token, userId: one.owner.id }));
  await refused("stranger with the request id → 404 (an id tells nothing)", 404, () => loadExchangeRequestByToken({ token: first.request.id, userId: three.owner.id }));
  await refused("the requester with his own request id → 404", 404, () => loadExchangeRequestByToken({ token: first.request.id, userId: one.owner.id }));
  await refused("unknown token → 404", 404, () => loadExchangeRequestByToken({ token: "A".repeat(43), userId: two.owner.id }));
  await refused("garbage instead of a token → 404", 404, () => loadExchangeRequestByToken({ token: "../../etc/passwd", userId: two.owner.id }));
  await refused("stranger cannot decide → 403", 403, () => decideExchangeRequest({ token: first.token, actor: three.actor, decision: "approve" }));
  await refused("the requester cannot approve his own request → 403", 403, () => decideExchangeRequest({ token: first.token, actor: one.actor, decision: "approve" }));
  await refused("the requester cannot decline by token either → 403", 403, () => decideExchangeRequest({ token: first.token, actor: one.actor, decision: "decline" }));
  check("after all refusals the request is still pending, nobody is a member", (await db.directoryExchangeRequest.findUnique({ where: { id: first.request.id } }))?.status === "pending" && (await db.directoryExchangeMember.count({ where: { organizationId: r1.id } })) === 0 && (await names(r1.id)).products.length === 0);

  const view = await loadExchangeRequestByToken({ token: first.token, userId: two.owner.id });
  check(
    "cabinet owner reads the request: who, INN, mode, lists, cabinet, his organizations (both already exchanging)",
    view.request.id === first.request.id && view.request.requesterName === r1.name && view.request.requesterInn === "7707083893" && view.request.mode === "link" && view.request.status === "pending" && same(view.request.kinds, ["products", "staff", "objects"]) && view.cabinet.id === cabinet.id && view.cabinet.name === "Мастер-кабинет" && view.sources.length === 2 && view.linkedIds.length === 2,
    view,
  );
  check("cabinet owner can open the request by its id too (the card has no token)", (await loadExchangeRequestByToken({ token: first.request.id, userId: two.owner.id })).request.id === first.request.id);

  /* ── подтверждение связи с суженным списком ── */
  console.log("--- approve link");
  // Правка телефона, не разошедшаяся по своим организациям до подтверждения.
  await db.user.update({ where: { id: (await person(s.id, "Петрова Анна"))!.id }, data: { phone: "+79850001122" } });
  await refused("approve with lists that were not requested → 400, still pending", 400, () => decideExchangeRequest({ token: first.token, actor: two.actor, decision: "approve", allowedKinds: ["equipment"] }));
  await refused("approve with an empty list → 400", 400, () => decideExchangeRequest({ token: first.token, actor: two.actor, decision: "approve", allowedKinds: [] }));

  const approved = await decideExchangeRequest({ token: first.token, actor: two.actor, decision: "approve", allowedKinds: ["staff", "equipment", "products"] });
  const member = await db.directoryExchangeMember.findFirst({ where: { masterOrganizationId: cabinet.id, organizationId: r1.id } });
  check("approved: member created with foreign = true and the narrowed lists (never wider than requested)", approved.status === "approved" && member?.foreign === true && same(member.kinds, ["products", "staff"]), member);
  const row1After = await db.directoryExchangeRequest.findUnique({ where: { id: first.request.id } });
  check("request row: approved, allowed lists, who decided, result stored", row1After?.status === "approved" && same(row1After.allowedKinds, ["products", "staff"]) && row1After.decidedByUserId === two.owner.id && Boolean(row1After.decidedAt) && Boolean(row1After.resultJson));

  const r1Names = await names(r1.id);
  check("requester received products", same(r1Names.products, ["Борщ", "Молоко 3,2%", "Сыр твёрдый"]), r1Names.products);
  check("requester received the position and both employees", same(r1Names.positions, ["staff:Повар"]) && same(r1Names.staff, ["Иванов Иван", "Петрова Анна"]), r1Names);
  check("lists that were not allowed did not come: no objects, no equipment", r1Names.buildings.length === 0 && r1Names.areas.length === 0 && r1Names.equipment.length === 0, r1Names);
  const r1Staff = await db.user.findMany({ where: { organizationId: r1.id, passwordHash: "" } });
  check("rule Р5: staff arrived WITHOUT phone and days off", r1Staff.length === 2 && r1Staff.every((u) => u.phone === null && u.weeklyDaysOff.length === 0 && u.positionTitle === "Повар"), r1Staff.map((u) => ({ name: u.name, phone: u.phone, off: u.weeklyDaysOff })));
  check("summary: the requester got records in the allowed lists only", (of(approved.summary, r1.id)?.products.created ?? 0) === 3 && (of(approved.summary, r1.id)?.staff.created ?? 0) === 3 && of(approved.summary, r1.id)?.objects.created === 0 && of(approved.summary, r1.id)?.equipment.created === 0, of(approved.summary, r1.id));
  check("the exchange before the switch delivered the pending phone edit inside the owner's account", (await person(s2.id, "Петрова Анна"))?.phone === "+79850001122");
  const ownerPhones = async () => [
    (await person(s.id, "Иванов Иван"))?.phone,
    (await person(s2.id, "Иванов Иван"))?.phone,
    JSON.stringify((await person(s.id, "Иванов Иван"))?.weeklyDaysOff),
    JSON.stringify((await person(s2.id, "Иванов Иван"))?.weeklyDaysOff),
  ];
  check("owner's employees keep their phones and days off", same(await ownerPhones(), ["+79851234567", "+79851234567", "[5,6]", "[5,6]"]), await ownerPhones());
  const staffLinks = await db.directoryExchangeLink.findMany({ where: { masterOrganizationId: cabinet.id, entity: "staff" } });
  check("all staff fingerprints are now the restricted variant (marked f:)", staffLinks.length === 6 && staffLinks.every((link) => link.hash.startsWith("f:")), staffLinks.map((l) => l.hash.slice(0, 4)));

  await refused("second decision → 409", 409, () => decideExchangeRequest({ token: first.token, actor: two.actor, decision: "decline" }));
  await refused("request while already a member → 409", 409, () => ask(r1.id, one.actor));

  check(
    "audit on both sides: request_approved; the approver's name is not written into the requester's journal",
    (await auditCount(cabinet.id, "request_approved", { userId: two.owner.id })) === 1 && (await auditCount(r1.id, "request_approved", { userId: null, userName: null })) === 1,
  );
  check("exchange audit in the requester's organization carries no foreign user", (await auditCount(r1.id, "synced", { userId: null })) === 1 && (await auditCount(r1.id, "synced", { userId: { not: null } })) === 0);

  takeMail();
  threw = false;
  await approved.notify().catch(() => (threw = true));
  const decisionMail = takeMail();
  const bell = await db.notification.findFirst({ where: { userId: one.owner.id, kind: "directory_exchange.request" } });
  check("decision: letter to the requester", !threw && decisionMail.includes(one.owner.email) && decisionMail.includes("подтверждён") && decisionMail.includes("Продукция, Сотрудники"), decisionMail);
  check("decision: notification in the requester's cabinet (owner and the other manager)", Boolean(bell) && bell!.organizationId === r1.id && bell!.title.includes("подтверждён") && (await db.notification.count({ where: { organizationId: r1.id, kind: "directory_exchange.request" } })) === 2, bell);

  /* ── обмен между аккаунтами: телефоны не трогаются ── */
  console.log("--- exchange across accounts");
  const idle1 = await runDirectoryExchange(cabinet.id, { actor: two.actor });
  const idle2 = await runDirectoryExchange(cabinet.id, {});
  check("two more runs change nothing", totals(idle1).created + totals(idle1).updated + totals(idle2).created + totals(idle2).updated === 0, [totals(idle1), totals(idle2)]);
  check("after two more runs the owner's phones are untouched and the requester still has none", same(await ownerPhones(), ["+79851234567", "+79851234567", "[5,6]", "[5,6]"]) && (await person(r1.id, "Иванов Иван"))?.phone === null);

  // Правки телефона и выходных у владельца, пока в списке чужая организация.
  await db.user.update({ where: { id: (await person(s.id, "Иванов Иван"))!.id }, data: { phone: "+79859990000" } });
  await db.user.update({ where: { id: (await person(s2.id, "Иванов Иван"))!.id }, data: { weeklyDaysOff: [0] } });
  const phoneRun = await runDirectoryExchange(cabinet.id, { actor: two.actor });
  check(
    "phone and days-off edits are neither sent nor compared while a foreign organization shares staff",
    totals(phoneRun).updated === 0 && same(await ownerPhones(), ["+79859990000", "+79851234567", "[5,6]", "[0]"]) && (await person(r1.id, "Иванов Иван"))?.phone === null,
    { run: totals(phoneRun), phones: await ownerPhones() },
  );

  // Правка у заявителя (другая компания) записи владельца не меняет (уточнение 2026-11-20).
  await db.user.update({ where: { id: (await person(r1.id, "Петрова Анна"))!.id }, data: { name: "Петрова Анна Сергеевна", phone: "+79853330000" } });
  const renameRun = await runDirectoryExchange(cabinet.id, { actor: two.actor });
  check(
    "a rename by the other company does not change the owner's records",
    totals(renameRun).updated === 0 && Boolean(await person(s.id, "Петрова Анна")) && Boolean(await person(s2.id, "Петрова Анна")) && !(await person(s.id, "Петрова Анна Сергеевна")),
    { run: totals(renameRun) },
  );
  const renameIdle = await runDirectoryExchange(cabinet.id, { actor: two.actor });
  check("and the ignored edit produces nothing on the next run", totals(renameIdle).created + totals(renameIdle).updated === 0, totals(renameIdle));
  // Та же правка у владельца доходит до всех; телефон и выходные между компаниями не ходят.
  await db.user.update({ where: { id: (await person(s.id, "Петрова Анна"))!.id }, data: { name: "Петрова Анна Сергеевна" } });
  const ownerRenameRun = await runDirectoryExchange(cabinet.id, { actor: two.actor });
  const renamedS = await person(s.id, "Петрова Анна Сергеевна");
  const renamedS2 = await person(s2.id, "Петрова Анна Сергеевна");
  const renamedR1 = await person(r1.id, "Петрова Анна Сергеевна");
  check(
    "a rename by the owner reaches his second organization; the other company keeps its own phone",
    of(ownerRenameRun, s2.id)?.staff.updated === 1 && renamedS2?.phone === "+79850001122" && same(renamedS2?.weeklyDaysOff, [5, 6]) && renamedR1?.phone === "+79853330000",
    { run: [of(ownerRenameRun, s2.id)?.staff, of(ownerRenameRun, r1.id)?.staff], s2: renamedS2?.phone, r1: renamedR1?.phone },
  );

  // Новый сотрудник заявителя с телефоном и новый продукт с каждой стороны.
  const cookR1 = await db.jobPosition.findFirst({ where: { organizationId: r1.id, name: "Повар" } });
  const hired = await createStaffMember(r1.id, { jobPositionId: cookR1!.id, fullName: "Сидоров Пётр", phone: "+79853334455", weeklyDaysOff: [1] });
  await db.product.create({ data: { name: "Кефир", kind: "raw", unit: "l", organizationId: s.id } });
  await db.product.create({ data: { name: "Хлеб", kind: "raw", unit: "kg", organizationId: r1.id } });
  await runDirectoryExchange(cabinet.id, { actor: two.actor });
  const hiredS = await person(s.id, "Сидоров Пётр");
  const hiredS2 = await person(s2.id, "Сидоров Пётр");
  check("requester's new employee appears at the owner WITHOUT phone and days off", hired.ok && hiredS?.phone === null && hiredS2?.phone === null && hiredS?.weeklyDaysOff.length === 0, { s: hiredS?.phone, s2: hiredS2?.phone });
  check("products travel both ways across accounts", (await names(r1.id)).products.includes("Кефир") && (await names(s.id)).products.includes("Хлеб") && (await names(s2.id)).products.includes("Хлеб"));
  check("equipment and objects still did not leak to the requester", (await names(r1.id)).equipment.length === 0 && (await names(r1.id)).buildings.length === 0);
  const quiet = await runDirectoryExchange(cabinet.id, { actor: two.actor });
  check("and the next run is empty again", totals(quiet).created + totals(quiet).updated === 0, totals(quiet));

  // Чужая организация на паузе выпадает из обмена, потом возвращается: состав полей
  // дважды меняется (полный ↔ «между аккаунтами») — и это не правка ничьих записей.
  const planBefore = (await db.organization.findUnique({ where: { id: r1.id }, select: { subscriptionPlan: true } }))!.subscriptionPlan;
  await db.organization.update({ where: { id: r1.id }, data: { subscriptionPlan: "paused" } });
  const pausedRun = await runDirectoryExchange(cabinet.id, { actor: two.actor });
  const fullAgain = await db.directoryExchangeLink.findMany({ where: { masterOrganizationId: cabinet.id, entity: "staff", organizationId: { in: [s.id, s2.id] }, entityId: { not: null } } });
  check(
    "foreign member on pause sits out; the owner's organizations go back to full fingerprints with nothing pushed between them",
    !pausedRun.organizations.some((o) => o.organizationId === r1.id) && totals(pausedRun).updated === 0 && totals(pausedRun).created === 0 && fullAgain.length === 6 && fullAgain.every((link) => !link.hash.startsWith("f:")) && same(await ownerPhones(), ["+79859990000", "+79851234567", "[5,6]", "[0]"]),
    { run: totals(pausedRun), phones: await ownerPhones(), links: fullAgain.map((l) => l.hash.slice(0, 2)) },
  );
  await db.organization.update({ where: { id: r1.id }, data: { subscriptionPlan: planBefore } });
  const backRun = await runDirectoryExchange(cabinet.id, { actor: two.actor });
  const restrictedAgain = await db.directoryExchangeLink.findMany({ where: { masterOrganizationId: cabinet.id, entity: "staff", entityId: { not: null } } });
  check(
    "foreign member is back: restricted fingerprints again, no record rewritten, no phone travelled",
    backRun.organizations.some((o) => o.organizationId === r1.id) && totals(backRun).updated === 0 && totals(backRun).created === 0 && restrictedAgain.length === 9 && restrictedAgain.every((link) => link.hash.startsWith("f:")) && same(await ownerPhones(), ["+79859990000", "+79851234567", "[5,6]", "[0]"]) && (await person(r1.id, "Иванов Иван"))?.phone === null && (await person(s.id, "Сидоров Пётр"))?.phone === null,
    { run: totals(backRun), phones: await ownerPhones(), links: restrictedAgain.map((l) => l.hash.slice(0, 2)) },
  );

  const ownerState = await loadExchangeState(two.owner.id, s.id);
  check("part 2 state of the owner lists only his own organizations as members", ownerState.members.length === 2 && ownerState.members.every((m) => m.organizationId !== r1.id));
  const ownerList = await loadExchangeRequests(two.owner.id, s.id);
  check("owner's card: the foreign member with its lists, no incoming left", ownerList.incoming.length === 0 && ownerList.foreignMembers.length === 1 && ownerList.foreignMembers[0].organizationId === r1.id && ownerList.foreignMembers[0].name === r1.name && same(ownerList.foreignMembers[0].kinds, ["products", "staff"]), ownerList);
  const requesterList = await loadExchangeRequests(one.owner.id, r1.id);
  check("requester's card: linked to the cabinet, nothing pending", requesterList.outgoing.length === 0 && requesterList.foreignLinks.length === 1 && requesterList.foreignLinks[0].cabinetName === "Мастер-кабинет" && same(requesterList.foreignLinks[0].kinds, ["products", "staff"]), requesterList);

  /* ── выход заявителя ── */
  console.log("--- leave");
  await refused("a stranger cannot end somebody's link → 404", 404, () => endExchangeRequest({ id: requesterList.foreignLinks[0].id, organizationId: t.id, accountId: three.account.id, actor: three.actor }));
  await refused("a stranger cannot end it by the request id or the organization id either → 404", 404, () => endExchangeRequest({ id: first.request.id, organizationId: t.id, accountId: three.account.id, actor: three.actor }));
  await refused("…nor by the organization id", 404, () => endExchangeRequest({ id: r1.id, organizationId: t.id, accountId: three.account.id, actor: three.actor }));
  const left = await endExchangeRequest({ id: requesterList.foreignLinks[0].id, organizationId: r1.id, accountId: one.account.id, actor: one.actor });
  check("requester leaves the exchange", left.action === "left" && (await db.directoryExchangeMember.count({ where: { organizationId: r1.id } })) === 0 && (await db.directoryExchangeLink.count({ where: { masterOrganizationId: cabinet.id, organizationId: r1.id } })) === 0);
  check("audit on both sides: request_left", (await auditCount(r1.id, "request_left", { userId: one.owner.id })) === 1 && (await auditCount(cabinet.id, "request_left", { userId: null })) === 1);
  await db.product.create({ data: { name: "Сметана", kind: "raw", unit: "kg", organizationId: s.id } });
  await db.product.create({ data: { name: "Соль", kind: "raw", unit: "kg", organizationId: r1.id } });
  const afterLeave = await runDirectoryExchange(cabinet.id, { actor: two.actor });
  check("after leaving the exchange stops in both directions; received data stays", !(await names(r1.id)).products.includes("Сметана") && !(await names(s.id)).products.includes("Соль") && (await names(r1.id)).products.includes("Кефир") && (await names(s2.id)).products.includes("Сметана"));
  check(
    "back inside the account: different phones and days off stay where they are — nothing pushed, nothing erased",
    totals(afterLeave).updated === 0 && same(await ownerPhones(), ["+79859990000", "+79851234567", "[5,6]", "[0]"]),
    { run: totals(afterLeave), phones: await ownerPhones() },
  );
  const linksBack = await db.directoryExchangeLink.findMany({ where: { masterOrganizationId: cabinet.id, entity: "staff" } });
  check("staff fingerprints are the full variant again", linksBack.length > 0 && linksBack.every((link) => !link.hash.startsWith("f:")), linksBack.map((l) => l.hash.slice(0, 4)));
  await db.user.update({ where: { id: renamedS!.id }, data: { phone: "+79857770000" } });
  const phoneAgain = await runDirectoryExchange(cabinet.id, { actor: two.actor });
  check("and a new phone edit travels inside the account as before", of(phoneAgain, s2.id)?.staff.updated === 1 && (await person(s2.id, "Петрова Анна Сергеевна"))?.phone === "+79857770000", of(phoneAgain, s2.id)?.staff);
  await refused("leaving twice → 409", 409, () => endExchangeRequest({ id: first.request.id, organizationId: r1.id, accountId: one.account.id, actor: one.actor }));

  /* ── отключение владельцем ── */
  console.log("--- disconnect");
  await ageRequests(one.account.id);
  const second = await ask(r1.id, one.actor, { kinds: ["products"] });
  check("a new request is possible after leaving", second.request.status === "pending");
  const approved2 = await decideExchangeRequest({ token: second.request.id, actor: two.actor, decision: "approve" });
  const member2 = await db.directoryExchangeMember.findFirst({ where: { organizationId: r1.id } });
  check("approve without a list means everything requested (opened by id)", approved2.status === "approved" && member2?.foreign === true && same(member2.kinds, ["products"]) && (await names(r1.id)).products.includes("Сметана") && (await names(s.id)).products.includes("Соль"));
  check("staff is exchanged with phones again while the foreign organization shares products only", (await db.directoryExchangeLink.findMany({ where: { masterOrganizationId: cabinet.id, entity: "staff" } })).every((link) => !link.hash.startsWith("f:")));
  await refused("the requester cannot disconnect himself through the owner's path of another organization → 404", 404, () => endExchangeRequest({ id: r1.id, organizationId: r2.id, accountId: one.account.id, actor: one.actor }));
  const disconnected = await endExchangeRequest({ id: r1.id, organizationId: s.id, accountId: two.account.id, actor: two.actor });
  check("cabinet owner disconnects the foreign member (by organization id)", disconnected.action === "disconnected" && (await db.directoryExchangeMember.count({ where: { organizationId: r1.id } })) === 0 && (await db.directoryExchangeLink.count({ where: { organizationId: r1.id } })) === 0);
  check("audit on both sides: request_disconnected", (await auditCount(cabinet.id, "request_disconnected", { userId: two.owner.id })) === 1 && (await auditCount(r1.id, "request_disconnected", { userId: null })) === 1);
  await db.product.create({ data: { name: "Перец", kind: "raw", unit: "kg", organizationId: s.id } });
  await runDirectoryExchange(cabinet.id, { actor: two.actor });
  check("after the disconnect the exchange stops", !(await names(r1.id)).products.includes("Перец"));
  check("own members of the cabinet are not touched by the disconnect", (await db.directoryExchangeMember.count({ where: { masterOrganizationId: cabinet.id } })) === 2);
  await refused("owner's path does not remove his OWN member → 404", 404, () => endExchangeRequest({ id: s2.id, organizationId: s.id, accountId: two.account.id, actor: two.actor }));
  check("…and the own member is still there", (await db.directoryExchangeMember.count({ where: { masterOrganizationId: cabinet.id, organizationId: s2.id } })) === 1);

  /* ── отклонение ── */
  console.log("--- decline");
  await ageRequests(one.account.id);
  const third = await ask(r1.id, one.actor, { kinds: ["equipment"] });
  await refused("cabinet owner cannot «cancel» a pending request through DELETE → 409", 409, () => endExchangeRequest({ id: third.request.id, organizationId: s.id, accountId: two.account.id, actor: two.actor }));
  const declined = await decideExchangeRequest({ token: third.token, actor: two.actor, decision: "decline" });
  check("declined: status, no member, nothing transferred", declined.status === "declined" && declined.summary === undefined && (await db.directoryExchangeRequest.findUnique({ where: { id: third.request.id } }))?.status === "declined" && (await db.directoryExchangeMember.count({ where: { organizationId: r1.id } })) === 0 && (await names(r1.id)).equipment.length === 0);
  check("audit on both sides: request_declined", (await auditCount(cabinet.id, "request_declined", { userId: two.owner.id })) === 1 && (await auditCount(r1.id, "request_declined", { userId: null })) === 1);
  takeMail();
  await declined.notify();
  check("decline: letter and notification to the requester", takeMail().includes("отклонён") && (await db.notification.count({ where: { userId: one.owner.id, kind: "directory_exchange.request", title: { contains: "отклонён" } } })) === 1);
  await refused("approve after a decline → 409", 409, () => decideExchangeRequest({ token: third.token, actor: two.actor, decision: "approve" }));
  await refused("cancel after a decline → 409", 409, () => endExchangeRequest({ id: third.request.id, organizationId: r1.id, accountId: one.account.id, actor: one.actor }));
  check("the declined request left the lists", (await loadExchangeRequests(one.owner.id, r1.id)).outgoing.length === 0 && (await loadExchangeRequests(two.owner.id, s.id)).incoming.length === 0);
  // После отказа — неделя паузы для той же компании (уточнение 2026-11-20); дальше отказ «состариваем».
  await refused("a new request right after the decline → 409", 409, () => ask(r1.id, one.actor, { kinds: ["products"] }));
  await db.directoryExchangeRequest.updateMany({ where: { id: third.request.id }, data: { decidedAt: new Date(Date.now() - 20 * DAY) } });

  /* ── отмена заявителем ── */
  console.log("--- cancel");
  await ageRequests(one.account.id);
  const fourth = await ask(r1.id, one.actor, { kinds: ["products"] });
  await refused("a stranger cannot cancel → 404", 404, () => endExchangeRequest({ id: fourth.request.id, organizationId: t.id, accountId: three.account.id, actor: three.actor }));
  await refused("another organization of the same account is not the requester → 404", 404, () => endExchangeRequest({ id: fourth.request.id, organizationId: r2.id, accountId: one.account.id, actor: one.actor }));
  const cancelled = await endExchangeRequest({ id: fourth.request.id, organizationId: r1.id, accountId: one.account.id, actor: one.actor });
  check("requester cancels the pending request", cancelled.action === "cancelled" && (await db.directoryExchangeRequest.findUnique({ where: { id: fourth.request.id } }))?.status === "cancelled");
  check("audit on both sides: request_cancelled", (await auditCount(r1.id, "request_cancelled", { userId: one.owner.id })) === 1 && (await auditCount(cabinet.id, "request_cancelled", { userId: null })) === 1);
  await refused("owner cannot approve a cancelled request → 409", 409, () => decideExchangeRequest({ token: fourth.token, actor: two.actor, decision: "approve" }));
  check("cancelled request: nobody became a member", (await db.directoryExchangeMember.count({ where: { organizationId: r1.id } })) === 0);

  /* ── истечение срока ── */
  console.log("--- expiry");
  await ageRequests(one.account.id);
  const eightDaysAgo = new Date(Date.now() - 8 * DAY);
  const fifth = await createExchangeRequest({ organizationId: r1.id, actor: one.actor, code, mode: "link", kinds: ["products"], now: eightDaysAgo });
  check("a request made 8 days ago is past its term", new Date(fifth.request.expiresAt).getTime() < Date.now());
  await refused("approve after the term → 409", 409, () => decideExchangeRequest({ token: fifth.token, actor: two.actor, decision: "approve" }));
  check("the expired request is marked on first touch and nobody became a member", (await db.directoryExchangeRequest.findUnique({ where: { id: fifth.request.id } }))?.status === "expired" && (await db.directoryExchangeMember.count({ where: { organizationId: r1.id } })) === 0);
  const sixthOld = await createExchangeRequest({ organizationId: r1.id, actor: one.actor, code, mode: "link", kinds: ["products"], now: eightDaysAgo });
  check("an expired request does not block a new one; stale ones are expired lazily when lists are read", sixthOld.request.status === "pending" && (await loadExchangeRequests(one.owner.id, r1.id)).outgoing.length === 0 && (await loadExchangeRequests(two.owner.id, s.id)).incoming.length === 0 && (await db.directoryExchangeRequest.findUnique({ where: { id: sixthOld.request.id } }))?.status === "expired");
  check("owner reading an expired request sees it expired", (await loadExchangeRequestByToken({ token: sixthOld.token, userId: two.owner.id })).request.status === "expired");
  await refused("cancel of an expired request → 409", 409, () => endExchangeRequest({ id: sixthOld.request.id, organizationId: r1.id, accountId: one.account.id, actor: one.actor }));

  /* ── разовый перенос ── */
  console.log("--- transfer");
  await ageRequests(one.account.id);
  const transfer = await createExchangeRequest({ organizationId: r2.id, actor: one.actor, code, mode: "transfer", kinds: ["staff", "equipment", "products"] });
  const transferView = await loadExchangeRequestByToken({ token: transfer.token, userId: two.owner.id });
  check("transfer request: the owner is offered only his own working organizations as a source", transferView.request.mode === "transfer" && same(transferView.sources.map((item) => item.id).sort(), [s.id, s2.id].sort()), transferView.sources);
  await refused("approve a transfer without a source → 400", 400, () => decideExchangeRequest({ token: transfer.token, actor: two.actor, decision: "approve" }));
  await refused("source from another account (the requester's own organization) → 404", 404, () => decideExchangeRequest({ token: transfer.token, actor: two.actor, decision: "approve", sourceOrganizationId: r1.id }));
  await refused("the cabinet itself is not a source → 404", 404, () => decideExchangeRequest({ token: transfer.token, actor: two.actor, decision: "approve", sourceOrganizationId: cabinet.id }));
  check("failed approvals leave the transfer request pending", (await db.directoryExchangeRequest.findUnique({ where: { id: transfer.request.id } }))?.status === "pending" && (await names(r2.id)).staff.length === 0);

  const sStaffBefore = JSON.stringify((await db.user.findMany({ where: { organizationId: s.id, passwordHash: "" }, orderBy: { name: "asc" } })).map((u) => [u.name, u.phone, u.weeklyDaysOff]));
  const moved = await decideExchangeRequest({ token: transfer.token, actor: two.actor, decision: "approve", allowedKinds: ["staff", "equipment"], sourceOrganizationId: s.id });
  const r2Names = await names(r2.id);
  check("transfer: staff with the position and equipment with its area came from the chosen source", moved.status === "approved" && same(r2Names.positions, ["staff:Повар"]) && same(r2Names.staff, ["Иванов Иван", "Петрова Анна Сергеевна", "Сидоров Пётр"]) && same(r2Names.equipment, ["Холодильник №1"]) && r2Names.areas.includes("Склад"), r2Names);
  check("transfer: the list that was not allowed did not come", r2Names.products.length === 0 && r2Names.buildings.length === 0, r2Names);
  const r2Staff = await db.user.findMany({ where: { organizationId: r2.id, passwordHash: "" } });
  check("transfer, rule Р5: staff without phone and days off", r2Staff.length === 3 && r2Staff.every((u) => u.phone === null && u.weeklyDaysOff.length === 0), r2Staff.map((u) => [u.name, u.phone, u.weeklyDaysOff]));
  check("transfer keeps no links and no membership", (await db.directoryExchangeLink.count({ where: { organizationId: r2.id } })) === 0 && (await db.directoryExchangeMember.count({ where: { organizationId: r2.id } })) === 0);
  const transferRow = await db.directoryExchangeRequest.findUnique({ where: { id: transfer.request.id } });
  check("transfer request row: approved, source and result stored", transferRow?.status === "approved" && transferRow.sourceOrganizationId === s.id && same(transferRow.allowedKinds, ["staff", "equipment"]) && Boolean(transferRow.resultJson) && of(moved.summary, r2.id)?.staff.created === 4 && of(moved.summary, r2.id)?.equipment.created === 2, of(moved.summary, r2.id));
  check("the source is untouched by the transfer", sStaffBefore === JSON.stringify((await db.user.findMany({ where: { organizationId: s.id, passwordHash: "" }, orderBy: { name: "asc" } })).map((u) => [u.name, u.phone, u.weeklyDaysOff])));
  check(
    "transfer audited on both sides; the owner's name is not written into the requester's journal",
    (await auditCount(r2.id, "transferred", { userId: null })) === 1 && (await auditCount(s.id, "transferred", { userId: two.owner.id })) === 1 && (await auditCount(r2.id, "request_approved", { userId: null })) === 1 && (await auditCount(cabinet.id, "request_approved", { userId: two.owner.id })) === 3,
  );
  await refused("a transfer cannot be «left» afterwards → 409", 409, () => endExchangeRequest({ id: transfer.request.id, organizationId: r2.id, accountId: one.account.id, actor: one.actor }));
  await refused("without the explicit option a cross-account transfer is still 404", 404, () => transferOnce({ fromOrganizationId: s.id, toOrganizationId: r2.id, selection: { products: "all" }, actor: two.actor }));
  await refused("…and so is the preview", 404, () => transferPreview({ fromOrganizationId: s.id, toOrganizationId: r2.id }));
  const again = await runDirectoryExchange(cabinet.id, { actor: two.actor });
  check("the cabinet's exchange knows nothing about the transfer target", !again.organizations.some((o) => o.organizationId === r2.id));

  /* ── суточный лимит ── */
  console.log("--- daily limit");
  await ageRequests(one.account.id);
  const before = await db.directoryExchangeRequest.count({ where: { requesterOrganization: { accountId: one.account.id } } });
  for (let index = 0; index < 5; index += 1) {
    const made = await ask(index % 2 === 0 ? r1.id : r2.id, one.actor, { kinds: ["products"] });
    await endExchangeRequest({ id: made.request.id, organizationId: index % 2 === 0 ? r1.id : r2.id, accountId: one.account.id, actor: one.actor });
  }
  const limited = await refused("sixth request of the day (cancelled ones count) → 429", 429, () => ask(r1.id, one.actor, { kinds: ["products"] }));
  check("the limit refusal carries its code and created nothing", limited?.code === "request_daily_limit" && (await db.directoryExchangeRequest.count({ where: { requesterOrganization: { accountId: one.account.id } } })) === before + 5);
  await refused("over the limit a wrong code is 429 too — nothing learnt", 429, () => ask(r1.id, one.actor, { code: "ZZZZZ-ZZZZZ" }));
  await ageRequests(one.account.id);
  const afterLimit = await ask(r1.id, one.actor, { kinds: ["products"] });
  check("a day later requests work again; refusals spent nothing", afterLimit.request.status === "pending");
  await endExchangeRequest({ id: afterLimit.request.id, organizationId: r1.id, accountId: one.account.id, actor: one.actor });

  /* ── закрытая организация ── */
  console.log("--- locked organization");
  // Две точки оплачены и заняты (Заявитель, Заявитель-2); у третьей свои 14 дней прошли — она закрыта.
  const r3 = await makeOrg("Заявитель-3", one.account.id, { trialEndsAt: new Date(Date.now() - DAY) });
  await join(one.owner.id, r3.id);
  await ageRequests(one.account.id);
  const lockedError = await refused("a locked organization cannot ask → 409", 409, () => ask(r3.id, one.actor, { kinds: ["products"] }));
  check("…with the «locked» code", lockedError?.code === "billing_org_locked", lockedError?.code);
  // Запрос, отправленный до закрытия: подтвердить его в закрытую организацию нельзя.
  const lockedRow = await db.directoryExchangeRequest.create({
    data: { masterOrganizationId: cabinet.id, requesterOrganizationId: r3.id, requestedByUserId: one.owner.id, mode: "transfer", kinds: ["products"], tokenHash: sha256(`${TAG}-locked`), expiresAt: new Date(Date.now() + DAY) },
  });
  await refused("a locked organization cannot be a transfer target → 409", 409, () => decideExchangeRequest({ token: lockedRow.id, actor: two.actor, decision: "approve", sourceOrganizationId: s.id }));
  await refused("…nor join an exchange", 409, async () => {
    await db.directoryExchangeRequest.update({ where: { id: lockedRow.id }, data: { mode: "link" } });
    await decideExchangeRequest({ token: lockedRow.id, actor: two.actor, decision: "approve" });
  });
  check("the request to the locked organization stays pending, nothing arrived", (await db.directoryExchangeRequest.findUnique({ where: { id: lockedRow.id } }))?.status === "pending" && (await names(r3.id)).products.length === 0 && (await db.directoryExchangeMember.count({ where: { organizationId: r3.id } })) === 0);
  const lockedCancel = await endExchangeRequest({ id: lockedRow.id, organizationId: r3.id, accountId: one.account.id, actor: one.actor });
  check("a locked organization can still cancel its request", lockedCancel.action === "cancelled");

  /* ── второй кабинет аккаунта ── */
  console.log("--- several cabinets");
  const extra = await createAccountMasterCabinet({ ownerUserId: two.owner.id, name: `Второй кабинет ${TAG}`, organizationIds: [] });
  orgIds.push(extra.id);
  await ageRequests(one.account.id);
  const viaExtra = await ask(r1.id, one.actor, { code: extra.code, kinds: ["products"] });
  const viaExtraRow = await db.directoryExchangeRequest.findUnique({ where: { id: viaExtra.request.id } });
  check("code of any cabinet of the account addresses its exchange cabinet (where the owner's organizations are)", viaExtraRow?.masterOrganizationId === cabinet.id && viaExtra.request.cabinetName === "Мастер-кабинет", viaExtra.request);
  await endExchangeRequest({ id: viaExtra.request.id, organizationId: r1.id, accountId: one.account.id, actor: one.actor });

  /* ── плановый обмен и маршруты ── */
  const batch = await runAllDirectoryExchanges();
  check("scheduled run: finished without errors", batch.errors.length === 0 && batch.cabinets >= 1, batch);
  const routes = await Promise.all([
    import("@/app/api/settings/directory-exchange/requests/route"),
    import("@/app/api/settings/directory-exchange/requests/[id]/route"),
    import("@/app/api/exchange-requests/[token]/route"),
  ]);
  check(
    "route modules load: handlers, nodejs runtime, force-dynamic",
    typeof routes[0].GET === "function" && typeof routes[0].POST === "function" && typeof routes[1].DELETE === "function" && typeof routes[2].GET === "function" && typeof routes[2].POST === "function" && routes.every((route) => route.runtime === "nodejs" && route.dynamic === "force-dynamic"),
  );
}

/* ── уточнения после независимой проверки (2026-11-20) ── */
async function reviewFixes() {
  console.log("--- review fixes (2026-11-20)");
  const paid = { subscriptionPlan: "standard", subscriptionEnd: new Date(Date.now() + 30 * DAY), planPoints: 3, planCycle: "month" };
  // Владелец кабинета.
  const o = await makeOrg("Владелец-Р");
  const owner = await makeOwner(o.id, "rown");
  const cabinet = await ensureExchangeCabinet(owner.owner.id, owner.account.id);
  orgIds.push(cabinet.id);
  const code = (await db.organization.findUnique({ where: { id: cabinet.id }, select: { serviceCode: true } }))!.serviceCode!;
  await saveExchangeMembers({ ownerUserId: owner.owner.id, ownerName: owner.owner.name, organizationId: o.id, members: [{ organizationId: o.id, kinds: [...EXCHANGE_KINDS] }] });
  const ownerCook = await db.jobPosition.create({ data: { organizationId: o.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  const ownerArea = await db.area.create({ data: { organizationId: o.id, name: "Холодный цех" } });
  await db.equipment.create({ data: { name: "Ларь", type: "freezer", tempMin: -24, tempMax: -18, areaId: ownerArea.id } });
  await db.product.create({ data: { name: "Творог", kind: "raw", unit: "kg", supplier: "Ферма владельца", organizationId: o.id } });
  const ownerPerson = await db.user.create({ data: { email: `${TAG}-rp1@o.local.haccp`, name: "Кузнецов Ким", phone: "+79851110000", passwordHash: "", role: "cook", jobPositionId: ownerCook.id, positionTitle: "Повар", organizationId: o.id } });

  // Компания B (оплачена) — однофамилец «Кузнецов Ким» со своим телефоном.
  const b = await makeOrg("Компания-B");
  const bo = await makeOwner(b.id, "rb", paid);
  const bCook = await db.jobPosition.create({ data: { organizationId: b.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  const bPerson = await db.user.create({ data: { email: `${TAG}-rp2@b.local.haccp`, name: "Кузнецов Ким", phone: "+79852220000", passwordHash: "", role: "cook", jobPositionId: bCook.id, positionTitle: "Повар", organizationId: b.id } });
  // Компания C (оплачена).
  const c = await makeOrg("Компания-C");
  const co = await makeOwner(c.id, "rc", paid);

  // Код старого кабинета (код пула в linkedServiceCode) тоже находит кабинет.
  const legacyCode = generateServiceCode();
  await db.organization.update({ where: { id: cabinet.id }, data: { linkedServiceCode: legacyCode } });
  const byLegacy = await createExchangeRequest({ organizationId: b.id, actor: bo.actor, code: legacyCode, mode: "link", kinds: ["products", "staff", "equipment"] });
  check("legacy cabinet code (pool code) finds the cabinet", byLegacy.request.cabinetName === (await db.organization.findUnique({ where: { id: cabinet.id } }))!.name);

  // Владелец открывает запрос по номеру из карточки; заявитель и посторонний — нет.
  const byId = await loadExchangeRequestByToken({ token: byLegacy.request.id, userId: owner.owner.id });
  check("owner opens the request by its id (without the letter)", byId.request.id === byLegacy.request.id);
  await refused("requester cannot open the request by id → 404", 404, () => loadExchangeRequestByToken({ token: byLegacy.request.id, userId: bo.owner.id }));
  await refused("another company cannot open the request by id → 404", 404, () => loadExchangeRequestByToken({ token: byLegacy.request.id, userId: co.owner.id }));

  // Подтверждение заново проверяет тариф заявителя.
  await db.account.update({ where: { id: bo.account.id }, data: { subscriptionEnd: new Date(Date.now() - DAY) } });
  await refused("approval while the requester is no longer paid → 409", 409, () => decideExchangeRequest({ token: byLegacy.request.id, actor: owner.actor, decision: "approve", allowedKinds: ["products", "staff", "equipment"] }));
  check("…and the request stays pending", (await db.directoryExchangeRequest.findUnique({ where: { id: byLegacy.request.id } }))?.status === "pending");
  await db.account.update({ where: { id: bo.account.id }, data: { subscriptionEnd: paid.subscriptionEnd } });
  await decideExchangeRequest({ token: byLegacy.request.id, actor: owner.actor, decision: "approve", allowedKinds: ["products", "staff", "equipment"] });

  // Однофамильцы разных компаний не сливаются.
  const kim = await db.user.findMany({ where: { name: "Кузнецов Ким", organizationId: { in: [o.id, b.id] } }, orderBy: { organizationId: "asc" } });
  const kimLinks = await db.directoryExchangeLink.findMany({ where: { masterOrganizationId: cabinet.id, entity: "staff", entityId: { in: [ownerPerson.id, bPerson.id] } } });
  check(
    "same-named people of two companies are not merged: one each, own phones, never in one group",
    kim.length === 2 && (await person(o.id, "Кузнецов Ким"))?.phone === "+79851110000" && (await person(b.id, "Кузнецов Ким"))?.phone === "+79852220000" && new Set(kimLinks.map((l) => l.groupId)).size === kimLinks.length,
    { kim: kim.map((u) => [u.organizationId === o.id ? "owner" : "B", u.phone]), groups: kimLinks.map((l) => l.groupId) },
  );
  const kimIdle = await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  check("…and repeated runs change nothing for them", totals(kimIdle).created + totals(kimIdle).updated === 0 && (await db.user.count({ where: { name: "Кузнецов Ким", organizationId: { in: [o.id, b.id] } } })) === 2, totals(kimIdle));

  // Правка компании B (нормы ларя, поставщик творога) записи владельца не меняет; правка владельца — меняет у B.
  const bFreezer = await db.equipment.findFirst({ where: { name: "Ларь", area: { organizationId: b.id } } });
  const bCurd = await db.product.findFirst({ where: { name: "Творог", organizationId: b.id } });
  check("B received the owner's freezer and product", Boolean(bFreezer) && Boolean(bCurd));
  await db.equipment.update({ where: { id: bFreezer!.id }, data: { tempMin: -10, tempMax: -5 } });
  await db.product.update({ where: { id: bCurd!.id }, data: { supplier: "Поставщик B" } });
  const bEditRun = await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  const ownerFreezer = await db.equipment.findFirst({ where: { name: "Ларь", areaId: ownerArea.id } });
  const ownerCurd = await db.product.findFirst({ where: { name: "Творог", organizationId: o.id } });
  check(
    "B's edits do not change the owner's freezer norms or product",
    totals(bEditRun).updated === 0 && ownerFreezer?.tempMin === -24 && ownerFreezer?.tempMax === -18 && ownerCurd?.supplier === "Ферма владельца",
    { run: totals(bEditRun), freezer: [ownerFreezer?.tempMin, ownerFreezer?.tempMax], curd: ownerCurd?.supplier },
  );
  const bEditIdle = await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  check("…and nothing is pending on the next run", totals(bEditIdle).created + totals(bEditIdle).updated === 0, totals(bEditIdle));
  await db.product.update({ where: { id: ownerCurd!.id }, data: { supplier: "Новая ферма" } });
  await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  check("the owner's later edit overwrites B's record", (await db.product.findUnique({ where: { id: bCurd!.id } }))?.supplier === "Новая ферма");

  // Одноразовый перенос кабинет не занимает: C получает копию, хотя кабинет связан с B.
  const cTransfer = await createExchangeRequest({ organizationId: c.id, actor: co.actor, code, mode: "transfer", kinds: ["products"] });
  await decideExchangeRequest({ token: cTransfer.token, actor: owner.actor, decision: "approve", allowedKinds: ["products"], sourceOrganizationId: o.id });
  check("a one-off transfer to another company still works while the cabinet is linked", (await names(c.id)).products.includes("Творог"));
  // Журнал заявителя не называет организацию-источник владельца.
  const cAudit = await db.auditLog.findMany({ where: { organizationId: c.id, action: { startsWith: "directory_exchange." } } });
  check(
    "the requester's journal names no organization of the owner and no source id",
    cAudit.length > 0 && cAudit.every((row) => !JSON.stringify(row.details).includes(o.id) && !JSON.stringify(row.details).includes("Владелец-Р")),
    cAudit.map((row) => [row.action, row.details]),
  );

  // Отказ — и неделя паузы для той же компании.
  const cBefore = JSON.stringify(await names(c.id));
  const cRequest = await createExchangeRequest({ organizationId: c.id, actor: co.actor, code, mode: "link", kinds: ["products"] });
  await decideExchangeRequest({ token: cRequest.token, actor: owner.actor, decision: "decline" });
  check("…C received nothing from the declined link", JSON.stringify(await names(c.id)) === cBefore && (await db.directoryExchangeMember.count({ where: { organizationId: c.id } })) === 0);
  const cool = await refused("a new request right after a decline → 409", 409, () => createExchangeRequest({ organizationId: c.id, actor: co.actor, code, mode: "link", kinds: ["products"] }));
  check("…code request_declined_recently with the date", cool?.code === "request_declined_recently" && /после \d+ \S+ \d{4}/.test(cool?.message ?? ""), cool?.message);

  // Серия C1: вторая компания связывается, пока первая связана, — и записей первой не получает.
  await db.product.create({ data: { name: "Кефир B", kind: "raw", unit: "l", organizationId: b.id } });
  await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  check("C1: the owner received B's own new product", (await names(o.id)).products.includes("Кефир B"));
  await db.directoryExchangeRequest.updateMany({ where: { requesterOrganizationId: c.id, status: "declined" }, data: { decidedAt: new Date(Date.now() - 20 * DAY) } });
  const cAgain = await createExchangeRequest({ organizationId: c.id, actor: co.actor, code, mode: "link", kinds: ["products"] });
  await decideExchangeRequest({ token: cAgain.token, actor: owner.actor, decision: "approve", allowedKinds: ["products"] });
  check(
    "C1: after the pause C is linked while B stays linked (no «cabinet busy»)",
    (await db.directoryExchangeMember.count({ where: { organizationId: c.id, foreign: true } })) === 1 && (await db.directoryExchangeMember.count({ where: { organizationId: b.id, foreign: true } })) === 1,
  );
  check(
    "C1: C received the owner's products but not B's",
    (await names(c.id)).products.includes("Творог") && !(await names(c.id)).products.includes("Кефир B"),
    (await names(c.id)).products,
  );

  // Выход B: после него ни участника, ни связей; обмен с B прекращён.
  const bLinks = (await loadExchangeRequests(bo.owner.id, b.id)).foreignLinks;
  await endExchangeRequest({ id: bLinks[0].id, organizationId: b.id, accountId: bo.account.id, actor: bo.actor });
  check("B leaves: no member and no link rows remain", (await db.directoryExchangeMember.count({ where: { organizationId: b.id } })) === 0 && (await db.directoryExchangeLink.count({ where: { organizationId: b.id } })) === 0);
  await runDirectoryExchange(cabinet.id, { actor: owner.actor });
  check("C1: after B left, C still does not get B's product (its group remembers B)", !(await names(c.id)).products.includes("Кефир B"));

  // Владелец, который обмен сам не настраивал: свою организацию он выбирает на странице.
  const o2 = await makeOrg("Владелец-2");
  const owner2 = await makeOwner(o2.id, "rown2");
  const cabinet2 = await ensureExchangeCabinet(owner2.owner.id, owner2.account.id);
  orgIds.push(cabinet2.id);
  const code2 = (await db.organization.findUnique({ where: { id: cabinet2.id }, select: { serviceCode: true } }))!.serviceCode!;
  await db.product.create({ data: { name: "Ряженка", kind: "raw", unit: "l", organizationId: o2.id } });
  const bReq = await createExchangeRequest({ organizationId: b.id, actor: bo.actor, code: code2, mode: "link", kinds: ["products"] });
  const view2 = await loadExchangeRequestByToken({ token: bReq.token, userId: owner2.owner.id });
  check("link request: the owner's organizations are offered, none preselected without an exchange", same(view2.sources.map((item) => item.id), [o2.id]) && view2.linkedIds.length === 0, view2);
  const noOwn = await refused("approving a link without an own organization → 400", 400, () => decideExchangeRequest({ token: bReq.token, actor: owner2.actor, decision: "approve", allowedKinds: ["products"] }));
  check("…code request_no_own_organization, request stays pending", noOwn?.code === "request_no_own_organization" && (await db.directoryExchangeRequest.findUnique({ where: { id: bReq.request.id } }))?.status === "pending");
  await refused("another company's organization passed as own → 404", 404, () => decideExchangeRequest({ token: bReq.token, actor: owner2.actor, decision: "approve", allowedKinds: ["products"], organizationIds: [b.id] }));
  await decideExchangeRequest({ token: bReq.token, actor: owner2.actor, decision: "approve", allowedKinds: ["products"], organizationIds: [o2.id] });
  const o2Member = await db.directoryExchangeMember.findUnique({ where: { masterOrganizationId_organizationId: { masterOrganizationId: cabinet2.id, organizationId: o2.id } } });
  check(
    "approved with the chosen own organization: it joined the exchange and products moved both ways",
    Boolean(o2Member) && o2Member!.foreign === false && o2Member!.kinds.includes("products") && (await names(b.id)).products.includes("Ряженка") && (await names(o2.id)).products.includes("Творог"),
    { member: o2Member?.kinds, b: (await names(b.id)).products, o2: (await names(o2.id)).products },
  );
}

async function cleanup() {
  await db.telegramLog.deleteMany({ where: { chatId: { contains: TAG } } });
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
  .then(reviewFixes)
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
