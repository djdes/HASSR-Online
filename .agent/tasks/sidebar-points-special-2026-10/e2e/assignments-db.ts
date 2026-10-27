/**
 * Проверка задачи 2 на e2e-базе (НЕ прод): назначение, правка целиком,
 * автовозврат, «Завершить сейчас», основная точка для уведомлений, QR.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable \
 *     npx tsx .agent/tasks/sidebar-points-special-2026-10/e2e/assignments-db.ts
 */
import assert from "node:assert/strict";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import {
  createPointAssignment,
  endPointAssignment,
  expirePointAssignments,
  loadActiveAssignments,
  reconcileAssignmentsAfterEdit,
} from "@/lib/point-assignments.server";
import { placeOfEvent } from "@/lib/place-recipients";
import { loadQrPointScope } from "@/lib/qr-point-roster";
import { listFillEmployees } from "@/lib/journal-fill";

if (!/localhost:5432\/wesetup_e2e/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Only the e2e database is allowed");
}

const log: Array<Record<string, unknown>> = [];
const step = (name: string, data: Record<string, unknown> = {}) => {
  log.push({ step: name, ...data });
  console.log("✔", name, JSON.stringify(data));
};

async function main() {
  const stamp = Date.now().toString(36);
  const org = await db.organization.create({
    data: { name: `PA e2e ${stamp}`, type: "restaurant", perLocationJournals: true, timezone: "Europe/Moscow" },
  });
  try {
    const [a, b, c] = await Promise.all(
      ["Точка А", "Точка Б", "Точка В"].map((name, index) =>
        db.building.create({ data: { organizationId: org.id, name, sortOrder: index } }),
      ),
    );
    const mk = (name: string, buildingIds: string[], role = "cook") =>
      db.user.create({
        data: {
          organizationId: org.id,
          name,
          email: `pa-${stamp}-${name.replace(/\W+/g, "").toLowerCase() || Math.random().toString(36).slice(2)}@e2e.local`,
          passwordHash: "x",
          role,
          buildingIds,
        },
      });
    const manager = await mk("Manager", [], "manager");
    const anna = await mk("Anna", [a.id]);
    const boris = await mk("Boris", [a.id]);
    const everywhere = await mk("Vera", []);
    const session = { user: { id: manager.id, name: "Manager", role: "manager", isRoot: false, pointScope: null } } as unknown as Session;

    // AC2.2 transfer
    const t1 = await createPointAssignment({ session, organizationId: org.id, userId: anna.id, buildingId: b.id, mode: "transfer", days: 3 });
    assert.ok(t1.ok);
    let annaRow = await db.user.findUniqueOrThrow({ where: { id: anna.id } });
    assert.deepEqual(annaRow.buildingIds, [b.id]);
    step("transfer a→b: buildingIds = [b]", { buildingIds: annaRow.buildingIds, returnKey: t1.ok ? t1.returnKey : null });

    // overlap rejected
    const overlap = await createPointAssignment({ session, organizationId: org.id, userId: anna.id, buildingId: c.id, mode: "extra", days: 1 });
    assert.equal(overlap.ok, false);
    step("second assignment for the same person rejected", { result: overlap });

    // everywhere rejected
    const ev = await createPointAssignment({ session, organizationId: org.id, userId: everywhere.id, buildingId: b.id, mode: "extra", days: 1 });
    assert.ok(!ev.ok && ev.code === "everywhere");
    step("'everywhere' employee rejected", { result: ev });

    // QR roster of point b marks Anna as substitute
    const scope = await loadQrPointScope(org.id, b.id);
    const roster = await listFillEmployees(org.id, { pointScope: scope });
    const annaOnQr = roster.find((person) => person.id === anna.id);
    assert.ok(annaOnQr?.positionTitle?.includes("Замена"));
    assert.ok(!roster.some((person) => person.id === boris.id));
    step("QR «Кто вы?» at point b lists Anna with «Замена», not Boris", { annaOnQr });

    // badge data
    const views = await loadActiveAssignments(org.id);
    assert.equal(views.get(anna.id)?.buildingName, "Точка Б");
    assert.deepEqual(views.get(anna.id)?.returnBuildingNames, ["Точка А"]);
    step("active assignment view for the badge", { view: views.get(anna.id) });

    // AC2.3 expiry: move endsAt to the past, sweep
    await db.userPointAssignment.updateMany({ where: { userId: anna.id, endedAt: null }, data: { endsAt: new Date(Date.now() - 1000) } });
    const swept = await expirePointAssignments();
    annaRow = await db.user.findUniqueOrThrow({ where: { id: anna.id } });
    assert.ok(swept.expired >= 1);
    assert.deepEqual(annaRow.buildingIds, [a.id]);
    const again = await expirePointAssignments({ organizationId: org.id });
    assert.equal(again.expired, 0);
    step("expiry restores [a]; second sweep is a no-op", { swept, again, buildingIds: annaRow.buildingIds });

    // extra + manual end
    const e1 = await createPointAssignment({ session, organizationId: org.id, userId: boris.id, buildingId: c.id, mode: "extra", days: 7 });
    assert.ok(e1.ok);
    let borisRow = await db.user.findUniqueOrThrow({ where: { id: boris.id } });
    assert.deepEqual(borisRow.buildingIds, [a.id, c.id]);
    const ended = await endPointAssignment({ organizationId: org.id, assignmentId: e1.ok ? e1.assignmentId : "", reason: "manual", session });
    borisRow = await db.user.findUniqueOrThrow({ where: { id: boris.id } });
    assert.deepEqual(borisRow.buildingIds, [a.id]);
    const endedTwice = await endPointAssignment({ organizationId: org.id, assignmentId: e1.ok ? e1.assignmentId : "", reason: "manual", session });
    assert.equal(endedTwice, null);
    step("extra a+c, «Завершить сейчас» → [a]; repeat is a no-op", { ended, endedTwice });

    // AC2.7 wholesale edit keeps / ends
    const e2 = await createPointAssignment({ session, organizationId: org.id, userId: boris.id, buildingId: b.id, mode: "extra", days: 7 });
    assert.ok(e2.ok);
    // edit keeps b (adds c permanently)
    await db.user.update({ where: { id: boris.id }, data: { buildingIds: [a.id, b.id, c.id] } });
    let kept = await reconcileAssignmentsAfterEdit({ organizationId: org.id, userId: boris.id, nextBuildingIds: [a.id, b.id, c.id], session });
    assert.equal(kept.length, 1);
    // edit drops b
    await db.user.update({ where: { id: boris.id }, data: { buildingIds: [a.id, c.id] } });
    kept = await reconcileAssignmentsAfterEdit({ organizationId: org.id, userId: boris.id, nextBuildingIds: [a.id, c.id], session });
    assert.equal(kept.length, 0);
    const e2row = await db.userPointAssignment.findUniqueOrThrow({ where: { id: e2.ok ? e2.assignmentId : "" } });
    assert.ok(e2row.endedAt);
    borisRow = await db.user.findUniqueOrThrow({ where: { id: boris.id } });
    assert.deepEqual(borisRow.buildingIds, [a.id, c.id]);
    step("wholesale edit keeping the temp point keeps it; dropping it ends it, edit wins", { buildingIds: borisRow.buildingIds });

    // AC2.5 main point in placeOfEvent
    assert.equal(await placeOfEvent(org.id, { userId: boris.id }), null);
    await db.user.update({ where: { id: boris.id }, data: { primaryBuildingId: c.id } });
    assert.equal(await placeOfEvent(org.id, { userId: boris.id }), c.id);
    step("placeOfEvent uses the main point for a person on 2 points", { place: c.id });

    // building deletion restores
    const t2 = await createPointAssignment({ session, organizationId: org.id, userId: anna.id, buildingId: c.id, mode: "transfer", days: 2 });
    assert.ok(t2.ok);
    const { endAssignmentsAtBuilding } = await import("@/lib/point-assignments.server");
    await endAssignmentsAtBuilding(org.id, c.id, session);
    annaRow = await db.user.findUniqueOrThrow({ where: { id: anna.id } });
    assert.deepEqual(annaRow.buildingIds, [a.id]);
    step("deleting the target point first returns transferred people", { buildingIds: annaRow.buildingIds });

    const audits = await db.auditLog.findMany({
      where: { organizationId: org.id, action: { startsWith: "staff.point_assignment." } },
      select: { action: true },
    });
    const actions = [...new Set(audits.map((row) => row.action))].sort();
    assert.deepEqual(actions, ["staff.point_assignment.create", "staff.point_assignment.end", "staff.point_assignment.expire"]);
    step("audit actions written", { actions, count: audits.length });
  } finally {
    await db.auditLog.deleteMany({ where: { organizationId: org.id } });
    await db.organization.delete({ where: { id: org.id } });
  }
}

main()
  .then(async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      ".agent/tasks/sidebar-points-special-2026-10/e2e/assignments-db.json",
      JSON.stringify({ ok: true, at: new Date().toISOString(), steps: log }, null, 2) + "\n",
    );
    await db.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
