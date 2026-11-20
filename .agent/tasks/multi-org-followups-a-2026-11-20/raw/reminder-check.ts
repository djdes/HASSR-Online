/*
 * Series A, AC2: reminders 3 days and 1 day before an organization's own 14 days end,
 * sent by the daily billing job (the letter is written to the dev log), once per stage;
 * nothing while the account itself is in its trial.
 */
import "dotenv/config";

import { db } from "@/lib/db";
import { AUDIT_ACTIONS, runBillingTransitionJob } from "@/lib/billing.server";

const TAG = `remchk${Date.now().toString(36)}`;
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

/* Письма в dev не уходят, а пишутся в журнал — перехватываем его. */
const mailLog: string[] = [];
console.info = (...args: unknown[]) => {
  const line = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
  if (line.startsWith("[email/dev]")) mailLog.push(line);
};
/** Письма (по строке темы) об организации; `to` — адрес из строки «не отправлено на …» перед темой. */
const mailsAbout = (name: string) => {
  const lines = mailLog.splice(0);
  const letters: Array<{ to: string; subject: string }> = [];
  let to = "";
  for (const line of lines) {
    const recipient = /не отправлено на (\S+?)\.?$/.exec(line);
    if (recipient) to = recipient[1];
    if (line.startsWith("[email/dev] Subject:") && line.includes(name)) letters.push({ to, subject: line.slice("[email/dev] Subject: ".length) });
  }
  return letters;
};

async function makeAccount(label: string, accountData: Record<string, unknown>, createdAt: Date) {
  const home = await db.organization.create({ data: { name: `Основная ${label} ${TAG}`, type: "restaurant", createdAt } });
  orgIds.push(home.id);
  const owner = await db.user.create({
    data: { email: `${TAG}-${label}@example.test`, name: "Владелец", passwordHash: "x", role: "manager", organizationId: home.id },
  });
  const account = await db.account.create({ data: { ownerUserId: owner.id, createdAt, ...accountData } });
  accountIds.push(account.id);
  await db.organization.update({ where: { id: home.id }, data: { accountId: account.id } });
  return { home, owner, account };
}

const reminders = (organizationId: string) =>
  db.auditLog.findMany({ where: { organizationId, action: AUDIT_ACTIONS.orgTrialReminder }, select: { details: true } });

async function main() {
  const now = new Date();
  const paid = await makeAccount(
    "paid",
    { subscriptionPlan: "standard", subscriptionEnd: new Date(now.getTime() + 30 * DAY), planPoints: 1, planCycle: "month" },
    new Date(now.getTime() - 40 * DAY),
  );
  const second = await db.organization.create({
    data: {
      name: `Вторая ${TAG}`,
      type: "restaurant",
      accountId: paid.account.id,
      createdAt: new Date(now.getTime() - 11 * DAY - 12 * HOUR),
      trialEndsAt: new Date(now.getTime() + 2 * DAY + 12 * HOUR),
    },
  });
  orgIds.push(second.id);

  await runBillingTransitionJob({ now });
  const first = mailsAbout(second.name);
  const afterFirst = await reminders(second.id);
  console.log(`letter 3 days before: ${JSON.stringify(first)}`);
  check(
    "3 days before: one letter «Через 3 дня закончатся бесплатные дни организации …» to the account owner",
    first.length === 1 && first[0].subject.startsWith("Через 3 дня закончатся бесплатные дни организации") && first[0].to === paid.owner.email,
    first,
  );
  check("3 days before: one AuditLog mark with stage 3", afterFirst.length === 1 && (afterFirst[0].details as { stage?: number }).stage === 3, afterFirst);

  await runBillingTransitionJob({ now });
  check("second run the same day: no letter, no new mark", mailsAbout(second.name).length === 0 && (await reminders(second.id)).length === 1);

  const later = new Date(now.getTime() + 2 * DAY);
  await runBillingTransitionJob({ now: later });
  const tomorrow = mailsAbout(second.name);
  const afterSecond = await reminders(second.id);
  console.log(`letter 1 day before: ${JSON.stringify(tomorrow)}`);
  check(
    "1 day before: the second letter «Завтра закончатся бесплатные дни организации …»",
    tomorrow.length === 1 && tomorrow[0].subject.startsWith("Завтра закончатся бесплатные дни организации"),
    tomorrow,
  );
  check("1 day before: two marks in total, stages 3 and 1", afterSecond.map((row) => (row.details as { stage?: number }).stage).sort().join(",") === "1,3", afterSecond);

  // Аккаунт в своём пробном периоде: организация после срока не закроется — напоминать не о чем.
  const trial = await makeAccount("trial", {}, now);
  const trialOrg = await db.organization.create({
    data: {
      name: `Пробная ${TAG}`,
      type: "restaurant",
      accountId: trial.account.id,
      createdAt: now,
      trialEndsAt: new Date(now.getTime() + 2 * DAY + 12 * HOUR),
    },
  });
  orgIds.push(trialOrg.id);
  await runBillingTransitionJob({ now });
  check("account in its own trial: no letter, no mark", mailsAbout(trialOrg.name).length === 0 && (await reminders(trialOrg.id)).length === 0);

  const dry = await runBillingTransitionJob({ now: new Date(now.getTime() + 2 * DAY), dryRun: true });
  check(
    "dry run reports and sends nothing",
    mailsAbout(second.name).length === 0 && (await reminders(second.id)).length === 2 && typeof dry.orgTrialReminded === "number",
  );
}

async function cleanup() {
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
