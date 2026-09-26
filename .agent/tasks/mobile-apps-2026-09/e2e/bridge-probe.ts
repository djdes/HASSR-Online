// Разведка для bridge-e2e.ts: полевые журналы (DynamicForm с текстовым полем).
import { db } from "./server-db";
import { hasDocumentFillUi } from "../../../../src/lib/journal-document-helpers";
async function main() {
  const tpls = await db.journalTemplate.findMany({ select: { code: true, fields: true } });
  const field = tpls.filter(
    (t) => !hasDocumentFillUi(t.code) && Array.isArray(t.fields) && (t.fields as { type?: string }[]).some((f) => f.type === "text" || f.type === "textarea")
  );
  console.log(field.map((t) => t.code).join(","));
  await db.$disconnect();
}
main();
