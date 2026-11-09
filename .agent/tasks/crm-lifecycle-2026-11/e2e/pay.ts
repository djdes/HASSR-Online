import "dotenv/config";
import { markInvoicePaid } from "../../../../src/lib/invoices/service";
const id = Number(process.argv[2]);
markInvoicePaid(id, null).then((r) => { console.log(r.ok ? `paid ${id}` : r.error); process.exit(0); });
