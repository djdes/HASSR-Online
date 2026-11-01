// Подключение принтера на точке А с именем принтера точки Б (локальная wesetup_iso, prod-сборка на 3020).
// node .agent/tasks/point-isolation-audit-2026-11-01/raw/print-agent-name.mjs <out-file>
import pg from "pg";
import { base, check, fx, save } from "./http-lib.mjs";

const out = process.argv[2] ?? "print-agent-name.txt";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/wesetup_iso" });
await db.connect();
const res = await fetch(`${base}/api/print/agents/auth`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": "10.9.8.7" },
  body: JSON.stringify({ email: fx.users.headA.email, password: fx.password, deviceName: "Принтер Бета", agentVersion: "iso" }),
});
const body = await res.json().catch(() => ({}));
const agentB = (await db.query('select "revokedAt" from "PrintAgent" where id=$1', [fx.data.B.printAgent])).rows[0];
check("РТ А: новый принтер с именем принтера точки Б — принтер точки Б не отозван", agentB.revokedAt === null, `HTTP ${res.status} · revokedAt=${agentB.revokedAt?.toISOString?.() ?? agentB.revokedAt}`);
await db.query('update "PrintAgent" set "revokedAt"=null where id=$1', [fx.data.B.printAgent]);
if (body?.agentId) await db.query('delete from "PrintAgent" where id=$1', [body.agentId]);
await db.query(`delete from "PrintAgent" where name='Принтер Бета' and id<>$1 and "organizationId"=$2`, [fx.data.B.printAgent, fx.orgId]);
await db.end();
save(out);
