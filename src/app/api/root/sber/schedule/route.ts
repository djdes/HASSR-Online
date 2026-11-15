import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { saveSberSchedule } from "@/lib/sber/invoice-payments.server";
import { SBER_INTERVALS, type SberInterval } from "@/lib/sber/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().refine((n): n is SberInterval => (SBER_INTERVALS as readonly number[]).includes(n)),
});

/** PUT /api/root/sber/schedule — включить/выключить автосверку и выбрать интервал. */
export async function PUT(request: Request) {
  await requireRoot();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неверный интервал" }, { status: 400 });
  await saveSberSchedule({ enabled: parsed.data.enabled, intervalMinutes: parsed.data.intervalMinutes as SberInterval });
  return NextResponse.json({ ok: true });
}
