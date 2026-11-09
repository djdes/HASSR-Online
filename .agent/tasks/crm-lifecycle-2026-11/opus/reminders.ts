import "dotenv/config";
import { db } from "../../../../src/lib/db";
import { runTaskReminders } from "../../../../src/lib/crm/lifecycle/tasks.server";
const now = new Date(process.argv[2]);
runTaskReminders(now).then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); process.exit(process.exitCode ?? 0); });
