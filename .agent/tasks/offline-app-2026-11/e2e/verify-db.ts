// Reads what the offline end-to-end run left in the database and checks the
// record day and the "made without network" mark (AC10).
//   npx tsx .agent/tasks/offline-app-2026-11/e2e/verify-db.ts
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { db } from "@/lib/db";

const raw = path.resolve(__dirname, "../raw");
const context = JSON.parse(readFileSync(path.join(raw, "e2e-context.json"), "utf8")) as {
  yesterday2330: string;
  fridgeId: string;
  pinEmployeeId: string;
  userId: string;
  okTemp: number;
  badTemp: number;
  orgId: string;
  todayKey: string;
  pastDay: string;
};

async function main() {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const check = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  };
  const yesterdayKey = new Date(Date.parse(`${context.todayKey}T00:00:00Z`) - 24 * 3600 * 1000).toISOString().slice(0, 10);

  const coldEntries = await db.journalDocumentEntry.findMany({
    where: { document: { organizationId: context.orgId, template: { code: "cold_equipment_control" } }, employeeId: { in: [context.userId, context.pinEmployeeId] } },
    select: { employeeId: true, date: true, data: true },
    orderBy: { date: "asc" },
  });
  const flat = coldEntries.map((entry) => ({ employeeId: entry.employeeId, day: entry.date.toISOString().slice(0, 10), data: JSON.stringify(entry.data) }));
  const mine = flat.find((entry) => entry.employeeId === context.userId && entry.day === yesterdayKey);
  check("AC10 a reading made yesterday 23:30 lies in yesterday's row, not in the sync day", Boolean(mine && mine.data.includes(String(context.okTemp))), mine ? `${mine.day}: ${mine.data.slice(0, 160)}` : JSON.stringify(flat.map((entry) => [entry.employeeId === context.userId ? "account" : "pin-employee", entry.day])));
  const pinEntry = flat.find((entry) => entry.employeeId === context.pinEmployeeId && entry.day === context.todayKey);
  check("AC16 a reading confirmed by PIN offline is signed by that employee", Boolean(pinEntry && pinEntry.data.includes(String(context.badTemp))), pinEntry ? `${pinEntry.day}: ${pinEntry.data.slice(0, 200)}` : "no entry");

  const audits = await db.auditLog.findMany({
    where: { organizationId: context.orgId, action: "journal.qr_fill" },
    select: { userName: true, entity: true, details: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const offline = audits.filter((row) => (row.details as { offline?: unknown } | null)?.offline);
  const sample = offline.map((row) => {
    const details = row.details as { kind: string; dateKey: string; offline: { recordedAt: string; syncedAt: string; auth: string } };
    return { by: row.userName, kind: details.kind, dateKey: details.dateKey, recordedAt: details.offline.recordedAt, syncedAt: details.offline.syncedAt, auth: details.offline.auth };
  });
  check("AC10 audit log marks records made without network (when made, when received, how the author was confirmed)", sample.length >= 6 && sample.every((row) => row.recordedAt && row.syncedAt && row.auth), `${sample.length} of ${audits.length} audit rows`);
  const moved = sample.find((row) => row.recordedAt === context.yesterday2330);
  check("AC10 audit keeps the device time and the journal day of the moved record", Boolean(moved && moved.dateKey === yesterdayKey), JSON.stringify(moved));
  const byPin = sample.find((row) => row.auth === "pin");
  check("AC16 audit shows the PIN was checked on the device", Boolean(byPin), JSON.stringify(byPin));
  const past = sample.find((row) => row.dateKey === context.pastDay && row.kind === "journal");
  check("AC17 a past-day record is written to that day", Boolean(past), JSON.stringify(past));

  const brak = await db.journalDocument.findFirst({ where: { organizationId: context.orgId, template: { code: "finished_product" }, status: "active" }, select: { config: true } });
  check("AC7 brakerage row made without network is in the journal", JSON.stringify(brak?.config ?? {}).includes("Борщ (проверка без связи)"), "finished_product document config");

  writeFileSync(path.join(raw, "db-verification.json"), JSON.stringify({ checks, coldEntries: flat, offlineAudit: sample }, null, 2));
  await db.$disconnect();
  process.exit(checks.every((item) => item.ok) ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
