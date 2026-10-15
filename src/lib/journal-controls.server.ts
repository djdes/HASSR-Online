import { db } from "@/lib/db";
import { parseJournalControls, type JournalControls } from "@/lib/journal-controls";
import { SPECIAL_MODE_ERROR } from "@/lib/journal-controls";
import { NextResponse } from "next/server";

export async function rejectJournalAutomation(organizationId: string) {
  return (await getJournalControls(organizationId)).specialMode
    ? NextResponse.json({ error: SPECIAL_MODE_ERROR, code: "special_mode" }, { status: 403 })
    : null;
}

export async function getJournalControls(organizationId: string): Promise<JournalControls> {
  const row = await db.platformSetting.findUnique({ where: { key: `org-journal-controls:${organizationId}` }, select: { value: true } });
  return parseJournalControls(row?.value);
}

export async function updateJournalControls(organizationId: string, patch: Partial<JournalControls>): Promise<JournalControls> {
  return db.$transaction(async (tx) => {
    const key = `org-journal-controls:${organizationId}`;
    // Serializes updates to different journal flags within the same organization.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`;
    const row = await tx.platformSetting.findUnique({ where: { key }, select: { value: true } });
    const current = parseJournalControls(row?.value);
    const next = parseJournalControls({ ...current, ...patch,
      sensorCamera: { ...current.sensorCamera, ...patch.sensorCamera },
      brakerageSetup: { ...current.brakerageSetup, ...patch.brakerageSetup },
    });
    await tx.platformSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
    return next;
  });
}
