/*
 * Load check of the directory exchange (series E, Р3). Not part of the nightly set (run-all.sh):
 * it takes minutes and builds ~150 000 rows. Run by hand against a local database:
 *
 *   npx tsx scripts/e2e/load-exchange.ts               # full size
 *   LOAD_SCALE=0.1 npx tsx scripts/e2e/load-exchange.ts  # a tenth of everything (smoke)
 *   LOAD_TRACE=1 npx tsx scripts/e2e/load-exchange.ts    # memory every 5 s; with NODE_OPTIONS=--expose-gc also the live heap
 *
 * One account, 20 organizations, one exchange cabinet with all four classic lists (products,
 * staff, objects, equipment). Spread round-robin over the organizations: 5 000 products, 500 staff
 * on 10 positions (every organization has the same 10 positions, so positions link instead of
 * being created), 50 buildings with 2 rooms each (rooms get their mirror areas, as in the UI), 2
 * areas per organization and 300 equipment. The account is on the legacy paid «Подписка» (no seat
 * or point limit): a paid tier is capped at 500 points, and the exchange gives every organization all
 * 50 buildings (20 × 50 = 1 000 points), so a capped tier would skip buildings for the limit.
 *
 * Measures the first exchange and an immediate second one (nothing changed): wall time and peak RSS
 * (`process.memoryUsage().rss` sampled every 100 ms; the process-lifetime peak from
 * `process.resourceUsage().maxRSS` is printed too). Targets: first ≤ 10 min (the exchange lock holds
 * for 10 minutes), second ≤ 60 s, RSS ≤ 1.5 GB. Then deletes everything it made with bulk deletes.
 */
import "./env";

import { ensureRoomMirrorArea } from "@/lib/area-building-sync";
import { db } from "@/lib/db";
import { runDirectoryExchange } from "@/lib/directory-exchange/run.server";
import { ensureExchangeCabinet } from "@/lib/directory-exchange/settings.server";
import { summaryTotals, type ExchangeSummary } from "@/lib/directory-exchange/summary";

const SCALE = Math.max(0.01, Math.min(1, Number(process.env.LOAD_SCALE ?? 1) || 1));
const scaled = (value: number, min = 1) => Math.max(min, Math.round(value * SCALE));

const TAG = `load${Date.now().toString(36)}`;
const ORGS = 20;
const PRODUCTS = scaled(5_000, ORGS);
const POSITIONS = 10;
const STAFF = scaled(500, ORGS);
const BUILDINGS = scaled(50, ORGS);
const ROOMS_PER_BUILDING = 2;
const AREAS_PER_ORG = 2;
const EQUIPMENT = scaled(300, ORGS);
const KINDS = ["products", "staff", "objects", "equipment"];

const FIRST_LIMIT_MS = 10 * 60_000;
const SECOND_LIMIT_MS = 60_000;
const RSS_LIMIT_BYTES = 1.5 * 1024 ** 3;
const DAY = 86_400_000;

const orgIds: string[] = [];
let accountId: string | null = null;
let cabinetId: string | null = null;
let failed = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 ** 2)} MB`;
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

type Phase = { name: string; ms: number; peakRss: number; peakHeap: number; created?: number; updated?: number; skipped?: number };
const phases: Phase[] = [];
/** `LOAD_TRACE=1`: memory every 5 s (rss / heap used / external) — to see where a phase peaks. */
const TRACE = process.env.LOAD_TRACE === "1";

/** Wall time and peak RSS of one phase (RSS sampled every 100 ms while it runs). */
async function measure<T>(name: string, fn: () => Promise<T>): Promise<{ value: T; phase: Phase }> {
  let peak = process.memoryUsage().rss;
  let peakHeap = process.memoryUsage().heapUsed;
  let ticks = 0;
  const started = Date.now();
  const timer = setInterval(() => {
    const memory = process.memoryUsage();
    peak = Math.max(peak, memory.rss);
    peakHeap = Math.max(peakHeap, memory.heapUsed);
    ticks += 1;
    if (TRACE && ticks % 50 === 0) {
      // With `--expose-gc` the trace also shows the live heap after a full collection.
      const gc = (globalThis as { gc?: () => void }).gc;
      if (gc) {
        gc();
        console.log(`  [${name} +${sec(Date.now() - started)}] live heap after GC ${mb(process.memoryUsage().heapUsed)}`);
      }
      console.log(`  [${name} +${sec(Date.now() - started)}] rss ${mb(memory.rss)}, heap ${mb(memory.heapUsed)}, external ${mb(memory.external)}`);
    }
  }, 100);
  try {
    const value = await fn();
    const phase: Phase = { name, ms: Date.now() - started, peakRss: Math.max(peak, process.memoryUsage().rss), peakHeap };
    phases.push(phase);
    console.log(`${name}: ${sec(phase.ms)}, peak RSS ${mb(phase.peakRss)}, peak heap used ${mb(phase.peakHeap)}`);
    return { value, phase };
  } finally {
    clearInterval(timer);
  }
}

async function seed() {
  const now = Date.now();
  const first = await db.organization.create({ data: { name: `Сеть 1 ${TAG}`, type: "restaurant" } });
  orgIds.push(first.id);
  const owner = await db.user.create({
    data: { email: `${TAG}-owner@example.test`, name: "Владелец сети", passwordHash: "not-a-real-hash", role: "manager", organizationId: first.id },
  });
  const account = await db.account.create({
    data: {
      ownerUserId: owner.id,
      // Прежняя «Подписка»: оплачена, без лимита мест и точек.
      subscriptionPlan: "extended",
      subscriptionEnd: new Date(now + 365 * DAY),
      planCycle: "year",
      planPoints: 500,
    },
  });
  accountId = account.id;
  await db.organization.update({ where: { id: first.id }, data: { accountId: account.id } });
  for (let index = 2; index <= ORGS; index += 1) {
    const org = await db.organization.create({ data: { name: `Сеть ${index} ${TAG}`, type: "restaurant", accountId: account.id } });
    orgIds.push(org.id);
  }
  await db.organizationMember.createMany({ data: orgIds.map((organizationId) => ({ userId: owner.id, organizationId, role: "owner" })) });
  const orgOf = (index: number) => orgIds[index % ORGS];

  await db.product.createMany({
    data: Array.from({ length: PRODUCTS }, (_, index) => ({
      organizationId: orgOf(index),
      name: `Продукт ${index + 1}`,
      kind: "raw",
      unit: index % 3 === 0 ? "l" : "kg",
      supplier: `Поставщик ${index % 50}`,
      category: `Категория ${index % 20}`,
      shelfLifeDays: 3 + (index % 10),
    })),
  });

  const positionsByOrg = new Map<string, string[]>();
  for (const organizationId of orgIds) {
    const ids: string[] = [];
    for (let index = 0; index < POSITIONS; index += 1) {
      const position = await db.jobPosition.create({
        data: { organizationId, categoryKey: "staff", name: `Должность ${index + 1}`, sortOrder: index + 1 },
        select: { id: true },
      });
      ids.push(position.id);
    }
    positionsByOrg.set(organizationId, ids);
  }
  await db.user.createMany({
    data: Array.from({ length: STAFF }, (_, index) => {
      const organizationId = orgOf(index);
      const positionIndex = index % POSITIONS;
      return {
        email: `${TAG}-staff${index}@${organizationId}.local.haccp`,
        name: `Сотрудник ${index + 1}`,
        phone: `+7999${String(1_000_000 + index).slice(-7)}`,
        passwordHash: "",
        role: "cook",
        organizationId,
        jobPositionId: positionsByOrg.get(organizationId)![positionIndex],
        positionTitle: `Должность ${positionIndex + 1}`,
        weeklyDaysOff: [5, 6],
      };
    }),
  });

  const buildingsByOrg = new Map<string, string[]>();
  for (let index = 0; index < BUILDINGS; index += 1) {
    const organizationId = orgOf(index);
    const building = await db.building.create({
      data: { organizationId, name: `Объект ${index + 1}`, address: `Улица ${index + 1}, 1` },
      select: { id: true },
    });
    buildingsByOrg.set(organizationId, [...(buildingsByOrg.get(organizationId) ?? []), building.id]);
    for (let room = 1; room <= ROOMS_PER_BUILDING; room += 1) {
      const name = `Помещение ${index + 1}-${room}`;
      const created = await db.room.create({ data: { buildingId: building.id, name, kind: room === 1 ? "kitchen" : "storage" }, select: { id: true } });
      // Как POST /api/settings/rooms: помещение заводит цех-зеркало.
      await ensureRoomMirrorArea({ organizationId, room: { id: created.id, name, buildingId: building.id } });
    }
  }

  const areasByOrg = new Map<string, string[]>();
  for (const [orgIndex, organizationId] of orgIds.entries()) {
    const buildingId = buildingsByOrg.get(organizationId)?.[0] ?? null;
    const ids: string[] = [];
    for (let index = 1; index <= AREAS_PER_ORG; index += 1) {
      const area = await db.area.create({ data: { organizationId, name: `Цех ${orgIndex + 1}-${index}`, buildingId }, select: { id: true } });
      ids.push(area.id);
    }
    areasByOrg.set(organizationId, ids);
  }
  const TYPES = ["refrigerator", "freezer", "oven", "other"];
  await db.equipment.createMany({
    data: Array.from({ length: EQUIPMENT }, (_, index) => {
      const organizationId = orgOf(index);
      const type = TYPES[index % TYPES.length];
      const cold = type === "refrigerator" || type === "freezer";
      return {
        name: `Оборудование ${index + 1}`,
        type,
        serialNumber: `SN-${index + 1}`,
        tempMin: cold ? (type === "freezer" ? -24 : 2) : null,
        tempMax: cold ? (type === "freezer" ? -18 : 6) : null,
        areaId: areasByOrg.get(organizationId)![index % AREAS_PER_ORG],
      };
    }),
  });

  const cabinet = await ensureExchangeCabinet(owner.id, account.id);
  cabinetId = cabinet.id;
  await db.directoryExchangeMember.createMany({
    data: orgIds.map((organizationId) => ({ masterOrganizationId: cabinet.id, organizationId, kinds: KINDS, createdByUserId: owner.id })),
  });
  return { cabinetId: cabinet.id };
}

async function counts(organizationId: string) {
  const [products, staff, buildings, rooms, equipment] = await Promise.all([
    db.product.count({ where: { organizationId, isActive: true } }),
    db.user.count({ where: { organizationId, passwordHash: "", isActive: true } }),
    db.building.count({ where: { organizationId } }),
    db.room.count({ where: { building: { organizationId } } }),
    db.equipment.count({ where: { area: { organizationId } } }),
  ]);
  return { products, staff, buildings, rooms, equipment };
}

function record(phase: Phase, summary: ExchangeSummary) {
  const totals = summaryTotals(summary);
  phase.created = totals.created;
  phase.updated = totals.updated;
  phase.skipped = totals.skippedLimit + totals.skippedConflict;
  return totals;
}

async function main() {
  console.log(
    `load-exchange: scale ${SCALE}; ${ORGS} organizations, ${PRODUCTS} products, ${STAFF} staff on ${POSITIONS} positions, ` +
      `${BUILDINGS} buildings × ${ROOMS_PER_BUILDING} rooms, ${AREAS_PER_ORG} areas per organization, ${EQUIPMENT} equipment`,
  );
  const { value: seeded } = await measure("seed", seed);

  const first = await measure("first exchange", () => runDirectoryExchange(seeded.cabinetId, { trigger: "schedule" }));
  const firstTotals = record(first.phase, first.value);
  check(`first exchange within ${sec(FIRST_LIMIT_MS)} (${sec(first.phase.ms)})`, first.phase.ms <= FIRST_LIMIT_MS);
  check("first exchange skipped nothing (limits and names)", firstTotals.skippedLimit + firstTotals.skippedConflict === 0, firstTotals);

  const expected = {
    products: PRODUCTS,
    staff: STAFF,
    buildings: BUILDINGS,
    rooms: BUILDINGS * ROOMS_PER_BUILDING,
    equipment: EQUIPMENT,
  };
  const all = await Promise.all(orgIds.map(counts));
  const wrong = all.flatMap((got, index) => (JSON.stringify(got) === JSON.stringify(expected) ? [] : [{ org: index + 1, got }]));
  check("every organization has every record after the first exchange", wrong.length === 0, { expected, wrong: wrong.slice(0, 3) });

  const second = await measure("second exchange", () => runDirectoryExchange(seeded.cabinetId, { trigger: "schedule" }));
  const secondTotals = record(second.phase, second.value);
  check(`second exchange within ${sec(SECOND_LIMIT_MS)} (${sec(second.phase.ms)})`, second.phase.ms <= SECOND_LIMIT_MS);
  check("second exchange changes nothing", secondTotals.created === 0 && secondTotals.updated === 0, secondTotals);

  const peak = Math.max(...phases.map((phase) => phase.peakRss));
  check(`peak RSS within ${mb(RSS_LIMIT_BYTES)} (${mb(peak)})`, peak <= RSS_LIMIT_BYTES);

  const runs = await db.directoryExchangeRun.findMany({
    where: { masterOrganizationId: seeded.cabinetId },
    orderBy: { startedAt: "asc" },
    select: { status: true, durationMs: true, created: true },
  });
  // «Занято» — плановый обмен, запущенный рядом, пока шёл этот: не ошибка.
  const finished = runs.filter((run) => run.status !== "busy");
  check("both runs recorded as ok", finished.length === 2 && finished.every((run) => run.status === "ok"), runs);
}

function table() {
  const rows = [["phase", "wall time", "peak RSS", "peak heap", "created", "updated", "skipped"]];
  for (const phase of phases) {
    rows.push([
      phase.name,
      sec(phase.ms),
      mb(phase.peakRss),
      mb(phase.peakHeap),
      phase.created === undefined ? "" : String(phase.created),
      phase.updated === undefined ? "" : String(phase.updated),
      phase.skipped === undefined ? "" : String(phase.skipped),
    ]);
  }
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  console.log("");
  for (const row of rows) console.log(row.map((cell, column) => cell.padEnd(widths[column])).join("  "));
  console.log(`process peak RSS (resourceUsage.maxRSS): ${mb(process.resourceUsage().maxRSS * 1024)}`);
}

/** Bulk deletes: the big tables first, then the organizations (users, audit and the rest cascade), then the account. */
async function cleanup() {
  const started = Date.now();
  const cabinets = accountId
    ? (await db.organization.findMany({ where: { accountId, kind: "directory" }, select: { id: true } })).map((row) => row.id)
    : [];
  const masters = [...new Set([...(cabinetId ? [cabinetId] : []), ...cabinets])];
  if (masters.length > 0) {
    await db.directoryExchangeChange.deleteMany({ where: { masterOrganizationId: { in: masters } } });
    await db.directoryExchangeLink.deleteMany({ where: { masterOrganizationId: { in: masters } } });
    await db.directoryExchangeRun.deleteMany({ where: { masterOrganizationId: { in: masters } } });
  }
  if (orgIds.length > 0) {
    const organizationId = { in: orgIds };
    await db.product.deleteMany({ where: { organizationId } });
    await db.equipment.deleteMany({ where: { area: { organizationId } } });
    await db.room.deleteMany({ where: { building: { organizationId } } });
    await db.area.deleteMany({ where: { organizationId } });
    await db.building.deleteMany({ where: { organizationId } });
    await db.user.deleteMany({ where: { organizationId, passwordHash: "" } });
    await db.jobPosition.deleteMany({ where: { organizationId } });
  }
  // Owner organization last: the owner (and the account with it) goes with it.
  const ids = [...masters, ...orgIds.slice(1), ...orgIds.slice(0, 1)];
  for (const id of ids) {
    await db.organization.delete({ where: { id } }).catch((error) => console.log(`cleanup: ${id} — ${(error as Error).message.split("\n").pop()}`));
  }
  if (accountId) await db.account.deleteMany({ where: { id: accountId } });
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  const leftUsers = await db.user.count({ where: { email: { contains: TAG } } });
  const leftProducts = orgIds.length ? await db.product.count({ where: { organizationId: { in: orgIds } } }) : 0;
  console.log(`cleanup (${sec(Date.now() - started)}): organizations left ${left}, users left ${leftUsers}, products left ${leftProducts}`);
  check("cleanup removed everything", left === 0 && leftUsers === 0 && leftProducts === 0, { left, leftUsers, leftProducts });
}

main()
  .catch((error) => {
    failed += 1;
    console.error("FAIL script crashed", error);
  })
  .finally(async () => {
    table();
    await cleanup().catch((error) => {
      failed += 1;
      console.error("FAIL cleanup failed", error);
    });
    console.log(failed === 0 ? "RESULT: all checks passed" : `RESULT: ${failed} check(s) failed`);
    await db.$disconnect().catch(() => undefined);
    process.exit(failed === 0 ? 0 : 1);
  });
