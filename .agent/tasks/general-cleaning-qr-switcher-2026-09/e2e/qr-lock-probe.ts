// Advisory-замок на настоящем Postgres (локальная e2e-база): SQL валиден,
// параллельные вызовы с одним ключом не пересекаются, занятый замок отдаёт acquired:false.
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
import { advisoryLockKey, withAdvisoryTryLock } from "../../../../src/lib/advisory-lock";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const client = db as unknown as PrismaClient;
  const key = advisoryLockKey("e2e-probe", "e2e-org-qr", String(Date.now()));
  let inside = 0;
  let maxInside = 0;
  const work = async () => {
    inside += 1;
    maxInside = Math.max(maxInside, inside);
    await sleep(300);
    inside -= 1;
    return true;
  };
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: 4 }, () => withAdvisoryTryLock(key, work, { client, delayMs: 50 })));
  const serialMs = Date.now() - started;
  // Замок держит «чужой» — короткое ожидание сдаётся.
  let busy: unknown = null;
  await withAdvisoryTryLock(key, async () => {
    busy = await withAdvisoryTryLock(key, async () => "never", { client, attempts: 3, delayMs: 20 });
    return null;
  }, { client });
  const out = {
    allAcquired: results.every((r) => r.acquired),
    maxInside,
    serialMs,
    busyResult: busy,
    pass: results.every((r) => r.acquired) && maxInside === 1 && serialMs >= 1100 && JSON.stringify(busy) === JSON.stringify({ acquired: false }),
  };
  console.log(JSON.stringify(out));
  fs.writeFileSync(path.join(HERE, "qr-lock-probe.json"), JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
