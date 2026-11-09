import "dotenv/config";
import { db } from "../../../../src/lib/db";
import { markInvoicePaid } from "../../../../src/lib/invoices/service";
const id = Number(process.argv[2]);
markInvoicePaid(id, null).then((r) => console.log(JSON.stringify(r).slice(0, 300))).catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); process.exit(process.exitCode ?? 0); });
