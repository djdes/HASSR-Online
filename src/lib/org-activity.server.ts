import { db } from "@/lib/db";

/** Есть ли в организации хоть одна запись — в обычных журналах или в журналах-документах. */
export async function organizationHasEntries(organizationId: string): Promise<boolean> {
  const [entry, documentEntry] = await Promise.all([
    db.journalEntry.findFirst({ where: { organizationId }, select: { id: true } }),
    db.journalDocumentEntry.findFirst({ where: { document: { organizationId } }, select: { id: true } }),
  ]);
  return Boolean(entry || documentEntry);
}
