import { db } from "@/lib/db";
import { parsePpkRecords, type ParsedPpkRecord } from "./records";

/** Версии ППК и ХАССП-плана организации (все документы, по порядку записи). */
export async function loadDocVersions(organizationId: string): Promise<ParsedPpkRecord<"doc-versions">[]> {
  const rows = await db.ppkRecord.findMany({
    where: { organizationId, block: "doc-versions" },
    select: { id: true, data: true, sortOrder: true, updatedAt: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return parsePpkRecords("doc-versions", rows);
}

/** Заседания группы ХАССП организации. */
export async function loadTeamMeetings(organizationId: string): Promise<ParsedPpkRecord<"team-meetings">[]> {
  const rows = await db.ppkRecord.findMany({
    where: { organizationId, block: "team-meetings" },
    select: { id: true, data: true, sortOrder: true, updatedAt: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return parsePpkRecords("team-meetings", rows);
}
