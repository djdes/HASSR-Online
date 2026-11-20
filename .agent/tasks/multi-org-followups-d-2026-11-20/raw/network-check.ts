/*
 * Series D, AC4 + AC8 against the local DB.
 * AC4 (item 4, «Сеть»): one account with three working organizations (one in its own 14 days, one locked
 * after them), a demo org and a master cabinet (excluded), balances, journal entries today and an exchange
 * member with lastSyncedAt → `loadNetworkSummary` returns the expected rows and totals; non-owner and foreign
 * owner are refused; the menu fact (`loadAccountNetworkFact`) and `visibleNav` show «Сеть» only to the owner
 * with 2+ organizations (not impersonating, not point-scoped).
 * AC8 (item 12): the daily billing job sends the org-trial reminder and also creates ONE bell notification for
 * the account owner in the home organization, link `/settings/subscription?addPoints=1`; a second run the same
 * day creates nothing; the 1-day stage is a separate notification. `addPointsTarget` → paid points + 1.
 */
import "dotenv/config";

import { readFileSync } from "node:fs";
import type { Session } from "next-auth";

import { db } from "@/lib/db";
import { ADD_POINTS_HREF, addPointsTarget, isAddPointsRequest } from "@/lib/add-points";
import { visibleNav, type NavFacts } from "@/lib/app-nav";
import { AUDIT_ACTIONS, loadAccountBilling, runBillingTransitionJob } from "@/lib/billing.server";
import { loadAccountNetworkFact } from "@/lib/network-access.server";
import { NetworkSummaryAccessError, loadNetworkSummary } from "@/lib/network-summary.server";
import { notificationPresenter } from "@/i18n/notification-messages";

const TAG = `netchk${Date.now().toString(36)}`;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const orgIds: string[] = [];
const accountIds: string[] = [];
let failed = 0;
let passed = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
}

/* Письма в dev не уходят, а пишутся в журнал — глушим его, считаем темы. */
const mailSubjects: string[] = [];
const originalInfo = console.info;
console.info = (...args: unknown[]) => {
  const line = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
  if (line.startsWith("[email/dev] Subject:")) mailSubjects.push(line.slice("[email/dev] Subject: ".length));
  if (line.startsWith("[email/dev]") || line.startsWith("[billing]") || line.startsWith("[telegram")) return;
  originalInfo(...args);
};

function sessionOf(user: { id: string; organizationId: string; role?: string }, extra: Record<string, unknown> = {}): Session {
  return {
    user: { id: user.id, organizationId: user.organizationId, role: user.role ?? "manager", isRoot: false, name: "Тест", email: `${user.id}@example.test`, ...extra },
    expires: new Date(Date.now() + DAY).toISOString(),
  } as unknown as Session;
}

async function refusal(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof NetworkSummaryAccessError) return error.code;
    throw error;
  }
}

const NAV_BASE: NavFacts = { checklists: true, settingsPermissions: true };
const networkItemVisible = (facts: NavFacts) =>
  (visibleNav({ role: "manager", permissionPreset: "admin" }, facts).find((section) => section.key === "company")?.menu ?? [])
    .flatMap((group) => group.items)
    .some((item) => item.id === "network");

async function main() {
  const now = new Date();
  const templates = await db.journalTemplate.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, code: true } });
  if (templates.length < 3) throw new Error("need at least 3 active journal templates (run the seed)");
  const [t1, t2, t3] = templates;
  const allCodes = templates.map((tpl) => tpl.code);
  const disabledExcept = (...keep: { code: string }[]) => allCodes.filter((code) => !keep.some((tpl) => tpl.code === code));

  // Аккаунт «Стандарт» на 1 точку, оплачен на месяц вперёд.
  const created = new Date(now.getTime() - 40 * DAY);
  const home = await db.organization.create({
    data: { name: `Первая ${TAG}`, type: "restaurant", createdAt: created, balanceRub: 5000, disabledJournalCodes: disabledExcept(t1, t2) },
  });
  orgIds.push(home.id);
  const owner = await db.user.create({
    data: { email: `${TAG}-owner@example.test`, name: "Владелец", passwordHash: "x", role: "manager", organizationId: home.id },
  });
  const account = await db.account.create({
    data: {
      ownerUserId: owner.id,
      createdAt: created,
      subscriptionPlan: "standard",
      subscriptionEnd: new Date(now.getTime() + 30 * DAY),
      planPoints: 1,
      planCycle: "month",
    },
  });
  accountIds.push(account.id);
  await db.organization.update({ where: { id: home.id }, data: { accountId: account.id } });
  // В своих 14 днях: 2,5 дня до конца (напоминание за 3 дня).
  const trialOrg = await db.organization.create({
    data: {
      name: `Вторая ${TAG}`,
      type: "restaurant",
      accountId: account.id,
      balanceRub: 1200,
      createdAt: new Date(now.getTime() - 11 * DAY - 12 * HOUR),
      trialEndsAt: new Date(now.getTime() + 2 * DAY + 12 * HOUR),
      disabledJournalCodes: disabledExcept(t1, t2, t3),
    },
  });
  orgIds.push(trialOrg.id);
  // Свои 14 дней прошли, точку забрала первая — закрыта.
  const lockedOrg = await db.organization.create({
    data: {
      name: `Третья ${TAG}`,
      type: "restaurant",
      accountId: account.id,
      balanceRub: 0,
      createdAt: new Date(now.getTime() - 20 * DAY),
      trialEndsAt: new Date(now.getTime() - 6 * DAY),
      disabledJournalCodes: disabledExcept(t1),
    },
  });
  orgIds.push(lockedOrg.id);
  // Не входят: демо и мастер-кабинет того же аккаунта.
  const demo = await db.organization.create({ data: { name: `Демо ${TAG}`, type: "restaurant", accountId: account.id, isDemo: true, balanceRub: 777 } });
  orgIds.push(demo.id);
  const master = await db.organization.create({ data: { name: `Кабинет ${TAG}`, type: "restaurant", accountId: account.id, kind: "directory", balanceRub: 999 } });
  orgIds.push(master.id);

  // Журналы сегодня: первая 2 из 2, вторая 1 из 3, третья 0 из 1.
  await db.journalEntry.createMany({
    data: [
      { templateId: t1.id, organizationId: home.id, filledById: owner.id, data: {} },
      { templateId: t2.id, organizationId: home.id, filledById: owner.id, data: {} },
      { templateId: t1.id, organizationId: trialOrg.id, filledById: owner.id, data: {} },
    ],
  });
  // Обмен справочниками: первая — участник с прошедшим обменом, вторая — без обмена.
  const syncedAt = new Date(now.getTime() - 3 * HOUR);
  await db.directoryExchangeMember.createMany({
    data: [
      { masterOrganizationId: master.id, organizationId: home.id, kinds: ["products"], lastSyncedAt: syncedAt },
      { masterOrganizationId: master.id, organizationId: trialOrg.id, kinds: ["products"], lastSyncedAt: null },
    ],
  });

  // ---- AC4: сводка
  const summary = await loadNetworkSummary({ ownerUserId: owner.id, activeOrgId: home.id, now });
  const byId = new Map(summary.rows.map((row) => [row.id, row]));
  console.log(`rows: ${JSON.stringify(summary.rows.map((row) => ({ name: row.name, current: row.current, journals: row.journals, status: row.journalStatus, balance: row.balanceRub, trial: row.trial.state, exchange: row.lastExchangeAt })))}`);
  console.log(`totals: ${JSON.stringify(summary.totals)} plan: ${JSON.stringify(summary.plan)}`);
  check("summary lists exactly the three working organizations (no demo, no master cabinet), oldest first",
    summary.rows.map((row) => row.id).join(",") === [home.id, lockedOrg.id, trialOrg.id].join(","), summary.rows.map((row) => row.name));
  check("active organization is marked current", byId.get(home.id)?.current === true && byId.get(trialOrg.id)?.current === false);
  check("journals today: first 2/2 done", JSON.stringify(byId.get(home.id)?.journals) === JSON.stringify({ done: 2, total: 2 }) && byId.get(home.id)?.journalStatus === "done");
  check("journals today: second 1/3 partial", JSON.stringify(byId.get(trialOrg.id)?.journals) === JSON.stringify({ done: 1, total: 3 }) && byId.get(trialOrg.id)?.journalStatus === "partial");
  check("journals today: third 0/1 not started", JSON.stringify(byId.get(lockedOrg.id)?.journals) === JSON.stringify({ done: 0, total: 1 }) && byId.get(lockedOrg.id)?.journalStatus === "none");
  check("balances per organization 5 000 / 1 200 / 0", byId.get(home.id)?.balanceRub === 5000 && byId.get(trialOrg.id)?.balanceRub === 1200 && byId.get(lockedOrg.id)?.balanceRub === 0);
  check("total balance = 6 200 (demo 777 and cabinet 999 not counted)", summary.totals.balanceRub === 6200, summary.totals);
  check("organizations with unfilled journals today = 2 of 3", summary.totals.withUnfilled === 2 && summary.totals.organizations === 3, summary.totals);
  const trialCell = byId.get(trialOrg.id)?.trial;
  check("own 14 days: second in force through the last free day", trialCell?.state === "trial" && trialCell.lastDay.getTime() === trialOrg.trialEndsAt!.getTime() - 1, trialCell);
  check("own 14 days: third closed, first — none", byId.get(lockedOrg.id)?.trial.state === "locked" && byId.get(home.id)?.trial.state === "none");
  check("last exchange: first = member lastSyncedAt, second — never", byId.get(home.id)?.lastExchangeAt?.getTime() === syncedAt.getTime() && byId.get(trialOrg.id)?.lastExchangeAt === null);
  check("account plan: Standard, 1 point", JSON.stringify(summary.plan) === JSON.stringify({ kind: "paid", tier: "standard", points: 1 }), summary.plan);

  // ---- AC4: отказы и пункт меню
  const manager = await db.user.create({
    data: { email: `${TAG}-manager@example.test`, name: "Управляющий", passwordHash: "x", role: "manager", organizationId: home.id },
  });
  check("non-owner manager of the organization → refused (not_owner)", (await refusal(() => loadNetworkSummary({ ownerUserId: manager.id, activeOrgId: home.id, now }))) === "not_owner");
  const foreignHome = await db.organization.create({ data: { name: `Чужая ${TAG}`, type: "restaurant" } });
  orgIds.push(foreignHome.id);
  const foreignOwner = await db.user.create({
    data: { email: `${TAG}-foreign@example.test`, name: "Чужой", passwordHash: "x", role: "manager", organizationId: foreignHome.id },
  });
  const foreignAccount = await db.account.create({ data: { ownerUserId: foreignOwner.id } });
  accountIds.push(foreignAccount.id);
  await db.organization.update({ where: { id: foreignHome.id }, data: { accountId: foreignAccount.id } });
  check("owner of another account looking from this organization → refused (not_owner)", (await refusal(() => loadNetworkSummary({ ownerUserId: foreignOwner.id, activeOrgId: home.id, now }))) === "not_owner");
  check("single-organization account → refused (single_org)", (await refusal(() => loadNetworkSummary({ ownerUserId: foreignOwner.id, activeOrgId: foreignHome.id, now }))) === "single_org");

  const ownerFact = await loadAccountNetworkFact(sessionOf({ id: owner.id, organizationId: home.id }));
  const ownerFromOther = await loadAccountNetworkFact(sessionOf({ id: owner.id, organizationId: home.id }, { activeOrganizationId: trialOrg.id }));
  const managerFact = await loadAccountNetworkFact(sessionOf({ id: manager.id, organizationId: home.id }));
  const singleFact = await loadAccountNetworkFact(sessionOf({ id: foreignOwner.id, organizationId: foreignHome.id }));
  const impersonatingFact = await loadAccountNetworkFact(sessionOf({ id: owner.id, organizationId: home.id }, { actingAsOrganizationId: home.id }));
  const pointFact = await loadAccountNetworkFact(sessionOf({ id: owner.id, organizationId: home.id }, { pointScope: ["building-1"] }));
  const cookFact = await loadAccountNetworkFact(sessionOf({ id: owner.id, organizationId: home.id, role: "cook" }));
  check("menu fact: owner with 3 organizations → true (also from another own organization)", ownerFact === true && ownerFromOther === true);
  check("menu fact: non-owner manager → false", managerFact === false);
  check("menu fact: single-organization owner → false", singleFact === false);
  check("menu fact: impersonating / point-scoped / no full access → false", !impersonatingFact && !pointFact && !cookFact);
  check("menu: «Сеть» visible with the owner's fact, absent with the single-org owner's fact",
    networkItemVisible({ ...NAV_BASE, accountNetwork: ownerFact }) && !networkItemVisible({ ...NAV_BASE, accountNetwork: singleFact }));

  // ---- AC8: напоминание → колокольчик
  const bells = () =>
    db.notification.findMany({ where: { userId: owner.id, kind: AUDIT_ACTIONS.orgTrialReminder }, orderBy: { createdAt: "asc" } });
  await runBillingTransitionJob({ now });
  const firstBells = await bells();
  const letters = mailSubjects.splice(0).filter((subject) => subject.includes(trialOrg.name));
  console.log(`bell after the first run: ${JSON.stringify(firstBells.map((row) => ({ org: row.organizationId, dedupeKey: row.dedupeKey, title: row.title, linkHref: row.linkHref, linkLabel: row.linkLabel, messageKey: row.messageKey, messageParams: row.messageParams, items: row.items })))}`);
  check("reminder letter 3 days before went out once", letters.length === 1 && letters[0].startsWith("Через 3 дня"), letters);
  const bell = firstBells[0];
  check("one bell notification for the account owner", firstBells.length === 1, firstBells.length);
  check("bell lives in the owner's home organization", bell?.organizationId === home.id);
  check("bell link is /settings/subscription?addPoints=1 with «Добавить точку»", bell?.linkHref === ADD_POINTS_HREF && bell?.linkLabel === "Добавить точку" && bell?.linkLabelKey === "addPoint");
  check("bell title names the organization", bell?.title === `Бесплатные дни организации «${trialOrg.name}» заканчиваются` && bell?.messageKey === "orgTrialEnding");
  check("bell dedupe key: organization + trialEndsAt + stage 3", bell?.dedupeKey === `billing.org_trial:${trialOrg.id}:${trialOrg.trialEndsAt!.toISOString()}:3`);
  const items = (bell?.items ?? []) as Array<{ label?: string; labelKey?: string; labelParams?: { day?: string } }>;
  check("bell item carries the last free day", items.length === 1 && items[0].labelKey === "orgTrialLastDay" && /^Последний бесплатный день — \d+ \S+$/.test(items[0].label ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(items[0].labelParams?.day ?? ""), items);
  if (bell) {
    const en = (await notificationPresenter("en")).row({ ...bell, items: items.map((item) => ({ label: item.label ?? "", ...item })) });
    console.log(`bell in English: ${en.title} | ${en.items[0]?.label} | ${en.linkLabel}`);
    check("bell is presented in the reader's language", en.title.includes(trialOrg.name) && en.title !== bell.title && en.linkLabel === "Add a location");
  }

  const bellUpdatedAt = bell?.updatedAt?.getTime?.() ?? null;
  await runBillingTransitionJob({ now });
  const secondBells = await bells();
  check("second run the same day: no new bell, the old one untouched, no letter",
    secondBells.length === 1 && (secondBells[0].updatedAt?.getTime?.() ?? null) === bellUpdatedAt && mailSubjects.splice(0).filter((s) => s.includes(trialOrg.name)).length === 0);

  await runBillingTransitionJob({ now: new Date(now.getTime() + 2 * DAY) });
  const thirdBells = await bells();
  check("1 day before: a separate bell «Завтра закончатся …» (stage 1)",
    thirdBells.length === 2 && thirdBells.some((row) => row.dedupeKey.endsWith(":1") && row.title.startsWith("Завтра закончатся бесплатные дни организации")), thirdBells.map((row) => row.title));

  // Письмо и Telegram ведут туда же (кнопка «Добавить точку»).
  const source = readFileSync("src/lib/billing.server.ts", "utf8");
  const reminderFn = source.slice(source.indexOf("async function sendOrgTrialReminder"), source.indexOf("export function orgTrialBellDedupeKey"));
  check("letter button and Telegram button use ADD_POINTS_HREF",
    reminderFn.includes("const payUrl = `${APP_URL}${ADD_POINTS_HREF}`") && reminderFn.includes("buttonHref: ADD_POINTS_HREF"));

  // ---- AC8: ссылка открывает выбор с +1 точкой
  const billing = await loadAccountBilling(home.id, now);
  const paidPoints = billing?.state.kind === "paid" && billing.state.paidTier && billing.state.paidTier !== "legacy" ? billing.state.planPoints : null;
  const target = addPointsTarget({ requested: isAddPointsRequest("1"), paidPoints, pointsInUse: billing?.state.pointsInUse ?? 1 });
  check("addPoints=1 on this account → plan picker opens with 1 + 1 = 2 points", target === 2, { paidPoints, target });
  check("no addPoints param → page as usual", addPointsTarget({ requested: isAddPointsRequest(undefined), paidPoints, pointsInUse: 1 }) === null);
}

async function cleanup() {
  await db.journalEntry.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => undefined);
  await db.notification.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => undefined);
  await db.directoryExchangeMember.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => undefined);
  await db.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => undefined);
  for (const id of [...orgIds].reverse()) await db.organization.delete({ where: { id } }).catch(() => undefined);
  await db.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
  await db.user.deleteMany({ where: { email: { contains: TAG } } }).catch(() => undefined);
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  console.log(`cleanup: organizations left ${left}`);
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
  });
