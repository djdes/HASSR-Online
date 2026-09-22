// Кто держит advisory-lock крона outbox (9523847) в e2e-базе.
import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
async function main() {
  const rows = await db.$queryRaw<Array<{ pid: number; granted: boolean; objid: number; mode: string; state: string | null; backend_start: Date; application_name: string }>>`
    SELECT l.pid, l.granted, l.objid::int AS objid, l.mode, a.state, a.backend_start, a.application_name
    FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE l.locktype = 'advisory' AND l.objid = 9523847`;
  console.log(JSON.stringify(rows, null, 2));
}
main().finally(() => db.$disconnect());
