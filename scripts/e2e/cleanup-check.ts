// Moved here from .agent/tasks/multi-org-followups-e-2026-11-21/raw/cleanup-check.ts (series E); that file is now a wrapper that runs this one, and its logs stay as that series' evidence.
/*
 * Series E, Р4 + Р1 end to end against the local DB (run from the repository root):
 *
 *   npx tsx scripts/e2e/cleanup-check.ts
 *
 * Р4: crafted old and orphaned rows of DirectoryExchangeSkip / DirectoryExchangeRequest /
 * DirectoryTransfer are removed by `cleanupExchangeTables` and by the scheduled run
 * (`runAllDirectoryExchanges` returns the counts); fresh, still-exchanging, approved and young rows
 * survive. Р1: the alert decision behind the scheduled run (`alertExchangeProblems`) with a stubbed
 * sender — healthy cabinets send nothing; a failed cabinet and a cabinet without a successful run for
 * 24 h send one message (names, owner, link) and leave the AuditLog mark; the same Moscow day sends
 * nothing more; the next day sends again; a failed delivery leaves no mark. Times for the alert are
 * a month ahead so real marks and runs of today do not interfere; problems are limited to this
 * scenario's cabinets (the shared local DB may hold other cabinets).
 */
import "./env";

import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { EXCHANGE_ALERT_ACTION } from "@/lib/directory-exchange/alert";
import { alertExchangeProblems, type ExchangeAlertSender } from "@/lib/directory-exchange/alert.server";
import { cleanupExchangeTables } from "@/lib/directory-exchange/cleanup.server";
import { runAllDirectoryExchanges } from "@/lib/directory-exchange/run.server";
import { loadExchangeRunsOverview } from "@/lib/directory-exchange/runs.server";
import { ensureExchangeCabinet } from "@/lib/directory-exchange/settings.server";

const TAG = `clchk${Date.now().toString(36)}`;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const STARTED = new Date();
const PLATFORM = (process.env.PLATFORM_ORG_ID ?? "platform").trim();
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

async function makeOwner(orgId: string, label: string) {
  const owner = await db.user.create({
    data: { email: `${TAG}-${label}@example.test`, name: `Владелец ${label} ${TAG}`, passwordHash: "not-a-real-hash", role: "manager", organizationId: orgId },
  });
  const account = await db.account.create({ data: { ownerUserId: owner.id } });
  accountIds.push(account.id);
  await db.organization.update({ where: { id: orgId }, data: { accountId: account.id } });
  return { owner, account };
}

const ago = (days: number, from = new Date()) => new Date(from.getTime() - days * DAY);
/** Полдень того же дня по Москве (UTC+3, без перехода на летнее время). */
const moscowNoon = (at: Date) => {
  const msk = new Date(at.getTime() + 3 * HOUR);
  return new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), 12 - 3));
};

/* ───────────── Р4: уборка ───────────── */

type Rows = { skips: Record<string, string>; requests: Record<string, string>; transfers: Record<string, string> };

async function craftRows(input: {
  cabinetId: string;
  a: string;
  b: string;
  c: string;
  foreign: string;
  ownerId: string;
  label: string;
}): Promise<Rows> {
  const { cabinetId, a, b, c, foreign, ownerId, label } = input;
  const skip = async (organizationId: string, entity: string, lastSeenDays: number) => {
    const row = await db.directoryExchangeSkip.create({
      data: {
        masterOrganizationId: cabinetId,
        entity,
        groupId: randomUUID(),
        organizationId,
        sourceOrganizationId: a,
        sourceEntityId: randomUUID(),
        name: `Пропуск ${label} ${entity}`,
        reason: "conflict",
        firstSeenAt: ago(lastSeenDays + 5),
        lastSeenAt: ago(lastSeenDays),
      },
    });
    return row.id;
  };
  const skips = {
    freshA: await skip(a, "product", 0),
    youngA: await skip(a, "position", 29),
    oldA: await skip(a, "product", 31),
    untickedB: await skip(b, "staff", 0),
    keptB: await skip(b, "product", 1),
    goneC: await skip(c, "product", 0),
    noKindA: await skip(a, "equipment", 0),
  };

  const request = async (status: string, days: number, extra: { decidedDays?: number | null; expiresDays?: number } = {}) => {
    const row = await db.directoryExchangeRequest.create({
      data: {
        masterOrganizationId: cabinetId,
        requesterOrganizationId: foreign,
        requestedByUserId: ownerId,
        mode: "link",
        kinds: ["products"],
        tokenHash: `${TAG}-${label}-${randomUUID()}`,
        status,
        expiresAt: ago(extra.expiresDays ?? days - 7),
        decidedAt: extra.decidedDays === null ? null : ago(extra.decidedDays ?? days),
        createdAt: ago(days + 7),
      },
    });
    // `updatedAt` ставит Prisma сама — дата «последней правки» задаётся прямо в базе.
    await db.$executeRaw`UPDATE "DirectoryExchangeRequest" SET "updatedAt" = ${ago(days)} WHERE id = ${row.id}`;
    return row.id;
  };
  const requests = {
    declinedOld: await request("declined", 200),
    cancelledOld: await request("cancelled", 200, { decidedDays: null }),
    expiredOld: await request("expired", 190),
    pendingLongExpired: await request("pending", 200, { decidedDays: null, expiresDays: 190 }),
    declinedYoung: await request("declined", 100),
    approvedOld: await request("approved", 300),
    pendingFresh: await request("pending", 0, { decidedDays: null, expiresDays: -6 }),
  };

  const transfer = async (days: number) =>
    (await db.directoryTransfer.create({ data: { fromOrganizationId: b, toOrganizationId: a, createdJson: {}, createdAt: ago(days) } })).id;
  const transfers = { old: await transfer(181), young: await transfer(170), fresh: await transfer(0) };
  return { skips, requests, transfers };
}

async function survivors(rows: Rows) {
  const [skips, requests, transfers] = await Promise.all([
    db.directoryExchangeSkip.findMany({ where: { id: { in: Object.values(rows.skips) } }, select: { id: true } }),
    db.directoryExchangeRequest.findMany({ where: { id: { in: Object.values(rows.requests) } }, select: { id: true } }),
    db.directoryTransfer.findMany({ where: { id: { in: Object.values(rows.transfers) } }, select: { id: true } }),
  ]);
  const alive = new Set([...skips, ...requests, ...transfers].map((row) => row.id));
  const names = (group: Record<string, string>) => Object.entries(group).filter(([, id]) => alive.has(id)).map(([name]) => name).sort();
  return { skips: names(rows.skips), requests: names(rows.requests), transfers: names(rows.transfers) };
}

const EXPECTED = {
  skips: ["freshA", "keptB", "youngA"],
  requests: ["approvedOld", "declinedYoung", "pendingFresh"],
  transfers: ["fresh", "young"],
};

async function cleanupPart() {
  console.log("--- Р4: cleanup");
  const a = await makeOrg("Чистка A");
  const { owner, account } = await makeOwner(a.id, "clean");
  const b = await makeOrg("Чистка B", account.id);
  const c = await makeOrg("Чистка C", account.id);
  const foreignOrg = await makeOrg("Чужая");
  const cabinet = await ensureExchangeCabinet(owner.id, account.id);
  orgIds.push(cabinet.id);
  // A — продукты и сотрудники; B — только продукты (сотрудников сняли); C из обмена вышла.
  await db.directoryExchangeMember.createMany({
    data: [
      { masterOrganizationId: cabinet.id, organizationId: a.id, kinds: ["products", "staff"] },
      { masterOrganizationId: cabinet.id, organizationId: b.id, kinds: ["products"] },
    ],
  });
  const base = { cabinetId: cabinet.id, a: a.id, b: b.id, c: c.id, foreign: foreignOrg.id, ownerId: owner.id };

  const first = await craftRows({ ...base, label: "1" });
  const counts = await cleanupExchangeTables(new Date());
  console.log("cleanupExchangeTables:", JSON.stringify(counts));
  const left = await survivors(first);
  check("skips: unseen 30+ days, unticked list, member gone, list not exchanged — removed; fresh and 29-day-old kept", JSON.stringify(left.skips) === JSON.stringify(EXPECTED.skips), left.skips);
  check("requests: declined/cancelled/expired 180+ days and long-expired pending — removed; approved, young, open kept", JSON.stringify(left.requests) === JSON.stringify(EXPECTED.requests), left.requests);
  check("transfers: older than 180 days removed, 170 days and fresh kept", JSON.stringify(left.transfers) === JSON.stringify(EXPECTED.transfers), left.transfers);
  check("counts cover this scenario's rows (4 skips, 4 requests, 1 transfer)", counts.skips >= 4 && counts.requests >= 4 && counts.transfers >= 1, counts);
  const again = await cleanupExchangeTables(new Date());
  const leftAgain = await survivors(first);
  check("second cleanup keeps the survivors", JSON.stringify(leftAgain) === JSON.stringify(EXPECTED), { again, leftAgain });

  // Плановый обмен убирает сам и возвращает числа.
  const second = await craftRows({ ...base, label: "2" });
  const batch = await runAllDirectoryExchanges();
  console.log("runAllDirectoryExchanges:", JSON.stringify({ cabinets: batch.cabinets, errors: batch.errors.length, cleanup: batch.cleanup, alert: batch.alert }));
  const leftBatch = await survivors(second);
  check("scheduled run removes the same rows and keeps the same", JSON.stringify(leftBatch) === JSON.stringify(EXPECTED), leftBatch);
  check(
    "scheduled run reports cleanup counts and the alert status",
    batch.cleanup.skips >= 4 && batch.cleanup.requests >= 4 && batch.cleanup.transfers >= 1 && typeof batch.alert?.status === "string",
    { cleanup: batch.cleanup, alert: batch.alert },
  );
}

/* ───────────── Р1: тревога ───────────── */

async function alertPart() {
  console.log("--- Р1: alert");
  const p1 = await makeOrg("Тревога 1");
  const { owner, account } = await makeOwner(p1.id, "alert");
  await db.user.update({ where: { id: owner.id }, data: { contactEmail: `${TAG}-owner@example.ru` } });
  const p2 = await makeOrg("Тревога 2", account.id);
  const cabinet = async (name: string) => {
    const org = await makeOrg(name, account.id, { kind: "directory" });
    // Два участника без списков: кабинет «с обменом» для журнала, а сам обмен ничего не делает.
    await db.directoryExchangeMember.createMany({
      data: [
        { masterOrganizationId: org.id, organizationId: p1.id, kinds: [] },
        { masterOrganizationId: org.id, organizationId: p2.id, kinds: [] },
      ],
    });
    return org;
  };
  const healthy = await cabinet("Кабинет здоровый");
  const broken = await cabinet("Кабинет со сбоем");
  const stale = await cabinet("Кабинет без успеха");
  const mine = new Set([healthy.id, broken.id, stale.id]);

  // Время тревоги — через месяц: сегодняшние отметки и обмены ей не мешают. В полдень по Москве:
  // «тот же день + 2 часа» не должен переходить московскую полночь — сценарий, начатый в 22–24 МСК,
  // иначе падал на «same day» и «next day» (PR #298, запуск в 23:14 МСК).
  const T = moscowNoon(new Date(STARTED.getTime() + 30 * DAY));
  const run = (masterOrganizationId: string, status: string, at: Date, error: string | null = null) =>
    db.directoryExchangeRun.create({ data: { masterOrganizationId, trigger: "schedule", status, startedAt: at, finishedAt: at, durationMs: 10, error } });
  await run(healthy.id, "ok", new Date(T.getTime() - 1 * HOUR));
  await run(broken.id, "ok", new Date(T.getTime() - 30 * HOUR));
  await run(broken.id, "error", new Date(T.getTime() - 2 * HOUR), "Invalid `db.room.create()` invocation");
  await run(stale.id, "ok", new Date(T.getTime() - 50 * HOUR));
  await run(stale.id, "busy", new Date(T.getTime() - 3 * HOUR));

  const sent: string[] = [];
  const stub: ExchangeAlertSender = async (text) => {
    sent.push(text);
    return true;
  };
  const problemsAt = async (now: Date, only: ReadonlySet<string>) =>
    (await loadExchangeRunsOverview({ now, limit: 1 })).problems.filter((problem) => only.has(problem.cabinet.id));
  const marks = () => db.auditLog.findMany({ where: { organizationId: PLATFORM, action: EXCHANGE_ALERT_ACTION, createdAt: { gte: T } }, orderBy: { createdAt: "asc" } });

  // Нормальная ночь: у здорового кабинета успешный обмен час назад — ничего.
  const quiet = await alertExchangeProblems({ now: T, problems: await problemsAt(T, new Set([healthy.id])), send: stub });
  check("healthy night: nothing sent, no mark", quiet.status === "healthy" && sent.length === 0 && (await marks()).length === 0, { quiet, sent: sent.length });

  // Сбой и «сутки без успеха»: одно сообщение.
  const problems = await problemsAt(T, mine);
  check(
    "journal problems: the failed cabinet (error) and the one without success for 24 h (no_success); healthy is not there",
    problems.length === 2 &&
      problems.some((problem) => problem.cabinet.id === broken.id && problem.problem === "error") &&
      problems.some((problem) => problem.cabinet.id === stale.id && problem.problem === "no_success"),
    problems.map((problem) => [problem.cabinet.name, problem.problem]),
  );
  const loud = await alertExchangeProblems({ now: T, problems, send: stub, appUrl: "https://wesetup.example" });
  const text = sent[0] ?? "";
  check("problems: one message sent", loud.status === "sent" && loud.cabinets === 2 && sent.length === 1, { loud, sent: sent.length });
  check(
    "message: count, cabinet names with owner, the error, link to /root/directory-exchange",
    text.startsWith("<b>Обмен справочниками: 2 кабинета с проблемой</b>") &&
      text.includes(`Кабинет со сбоем ${TAG} — Владелец alert ${TAG} · ${TAG}-owner@example.ru: ошибка «Invalid \`db.room.create()\` invocation»`) &&
      text.includes(`Кабинет без успеха ${TAG}`) &&
      text.indexOf("Кабинет со сбоем") < text.indexOf("Кабинет без успеха") &&
      !text.includes("Кабинет здоровый") &&
      text.includes('<a href="https://wesetup.example/root/directory-exchange">'),
    text,
  );
  const afterFirst = await marks();
  check(
    "mark in the platform's AuditLog with the cabinets",
    afterFirst.length === 1 && (afterFirst[0].details as { cabinets?: number } | null)?.cabinets === 2,
    afterFirst.map((mark) => mark.details),
  );

  // Тот же день по Москве — больше ничего.
  const later = new Date(T.getTime() + 2 * HOUR);
  const repeat = await alertExchangeProblems({ now: later, problems: await problemsAt(later, mine), send: stub });
  check("same day: nothing more", repeat.status === "already_sent" && sent.length === 1 && (await marks()).length === 1, repeat);

  // Следующие сутки — снова одно сообщение; упавший в этом прогоне кабинет добавляется как ошибка.
  const next = new Date(T.getTime() + DAY);
  const nextDay = await alertExchangeProblems({ now: next, problems: await problemsAt(next, mine), failedCabinetIds: [healthy.id], send: stub });
  check(
    "next day: sent again, the cabinet that failed in this run is listed",
    nextDay.status === "sent" && sent.length === 2 && sent[1].includes(`Кабинет здоровый ${TAG}`) && (await marks()).length === 2,
    { nextDay, sent: sent.length },
  );

  // Не дошло — отметки нет, следующий вызов в тот же день пробует снова.
  const third = new Date(T.getTime() + 2 * DAY);
  const failing: ExchangeAlertSender = async () => false;
  const lost = await alertExchangeProblems({ now: third, problems: await problemsAt(third, mine), send: failing });
  const retry = await alertExchangeProblems({ now: new Date(third.getTime() + HOUR), problems: await problemsAt(third, mine), send: stub });
  check("failed delivery: no mark, the next call retries", lost.status === "not_delivered" && retry.status === "sent" && (await marks()).length === 3, { lost, retry });
}

async function cleanup() {
  const cabinets = await db.organization.findMany({ where: { accountId: { in: accountIds }, kind: "directory" }, select: { id: true } });
  const ids = [...new Set([...cabinets.map((item) => item.id), ...orgIds])].reverse();
  for (const id of ids) {
    await db.organization.delete({ where: { id } }).catch((error) => console.log(`cleanup: ${id} — ${(error as Error).message.split("\n").pop()}`));
  }
  // Отметки тревоги этого прогона (и будущих дат сценария, и сегодняшняя от планового обмена).
  const marks = await db.auditLog.deleteMany({ where: { organizationId: PLATFORM, action: EXCHANGE_ALERT_ACTION, createdAt: { gte: STARTED } } });
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  const leftUsers = await db.user.count({ where: { email: { contains: TAG } } });
  console.log(`cleanup: organizations left ${left}, users left ${leftUsers}, alert marks removed ${marks.count}`);
  if (createdPlatform) {
    await db.organization.delete({ where: { id: PLATFORM } }).catch((error) => console.log(`cleanup: ${PLATFORM} — ${(error as Error).message.split("\n").pop()}`));
  }
}

// Отметка тревоги пишется в журнал действий организации платформы. На проде и в местной базе
// она есть (prisma/seed.ts), а в одноразовой базе CI сид без ROOT_EMAIL её не создаёт — заводим на
// время сценария и удаляем, только если завели сами.
let createdPlatform = false;
async function ensurePlatform() {
  if (await db.organization.findUnique({ where: { id: PLATFORM }, select: { id: true } })) return;
  await db.organization.create({ data: { id: PLATFORM, name: "WeSetup", type: "platform", subscriptionPlan: "platform" } });
  createdPlatform = true;
  console.log(`platform organization ${PLATFORM} created for this run`);
}

ensurePlatform()
  .then(cleanupPart)
  .then(alertPart)
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
