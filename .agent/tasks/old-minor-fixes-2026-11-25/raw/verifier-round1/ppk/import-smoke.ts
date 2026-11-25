import { db } from "@/lib/db";
import { compareRevisions as newCompare } from "../../../../../../src/lib/ppk/revisions.server";
import { compareRevisions as oldCompare } from "./old-revisions.server";
async function main() {
  console.log(typeof newCompare, typeof oldCompare, newCompare === oldCompare);
  console.log(await db.ppkRevision.count());
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
