import { db } from "@/lib/db";
import { parsePpkRecords, type ParsedPpkRecord } from "./records";
import { ppkWhere, type PpkScope } from "./scope";

/** Версии ППК и ХАССП-плана организации (все документы, по порядку записи). */
export async function loadDocVersions(scope: PpkScope): Promise<ParsedPpkRecord<"doc-versions">[]> {
  const rows = await db.ppkRecord.findMany({
    where: { ...ppkWhere(scope), block: "doc-versions" },
    select: { id: true, data: true, sortOrder: true, updatedAt: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return parsePpkRecords("doc-versions", rows);
}

/** Заседания группы ХАССП организации. */
export async function loadTeamMeetings(scope: PpkScope): Promise<ParsedPpkRecord<"team-meetings">[]> {
  const rows = await db.ppkRecord.findMany({
    where: { ...ppkWhere(scope), block: "team-meetings" },
    select: { id: true, data: true, sortOrder: true, updatedAt: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return parsePpkRecords("team-meetings", rows);
}
