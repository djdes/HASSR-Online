import { db } from "@/lib/db";
import { DEMO_SERVICE_KEY } from "@/lib/demo-request";
import { DEMO_SLOTS } from "@/lib/demo-slots";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Занятые слоты показа на горизонт записи (отменённые заявки время освобождают). */
export async function loadTakenDemoSlots(now: Date): Promise<Set<string>> {
  const rows = await db.serviceRequest.findMany({
    where: {
      serviceKey: DEMO_SERVICE_KEY,
      status: { not: "cancelled" },
      scheduledAt: { gte: now, lte: new Date(now.getTime() + (DEMO_SLOTS.workingDays + 9) * DAY_MS) },
    },
    select: { scheduledAt: true },
  });
  return new Set(rows.flatMap((row) => (row.scheduledAt ? [row.scheduledAt.toISOString()] : [])));
}
