import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { isMonthKey } from "@/lib/staff-timesheet";
import {
  TimesheetError,
  addTimesheetPayment,
  addTimesheetTransfer,
  deleteTimesheetPayment,
  fillTimesheetWeekdays,
  setPersonRate,
  setTimesheetCell,
} from "@/lib/staff-timesheet.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const month = z.string().refine(isMonthKey, "Месяц в виде 2026-11");

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cell"), personId: z.string().min(1), month, key: z.string().regex(/^(p1|p2|[1-9]|[12]\d|3[01])$/), value: z.string().max(20) }),
  z.object({ action: z.literal("rate"), personId: z.string().min(1), ratePerHour: z.number().int().min(0).max(100_000) }),
  z.object({
    action: z.literal("pay"),
    personId: z.string().min(1),
    month,
    part: z.enum(["advance", "final"]),
    amountRub: z.number().int().positive().max(10_000_000),
    paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().max(300).nullish(),
  }),
  z.object({ action: z.literal("unpay"), paymentId: z.string().min(1) }),
  z.object({
    action: z.literal("transfer"),
    personId: z.string().min(1),
    amountRub: z.number().int().positive().max(10_000_000),
    paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().max(300).nullish(),
  }),
  z.object({
    action: z.literal("fill"),
    personId: z.string().min(1),
    month,
    hours: z.number().min(0.25).max(24).multipleOf(0.25),
    lastDay: z.number().int().min(1).max(31),
  }),
]);

/** POST /api/root/timesheet — табель: ячейка, ставка, выплата, перевод на общий долг, «заполнить будни», удаление выплаты (только владелец платформы). */
export async function POST(request: Request) {
  const session = await requireRoot();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректный запрос" }, { status: 400 });
  const body = parsed.data;
  try {
    if (body.action === "cell") {
      const values = await setTimesheetCell({ personId: body.personId, month: body.month, key: body.key, raw: body.value });
      return NextResponse.json({ ok: true, values });
    }
    if (body.action === "rate") await setPersonRate(body.personId, body.ratePerHour);
    if (body.action === "pay") {
      await addTimesheetPayment({
        personId: body.personId,
        month: body.month,
        part: body.part,
        amountRub: body.amountRub,
        // Полдень по Москве — дата не съедет при показе.
        paidAt: new Date(`${body.paidAt}T12:00:00+03:00`),
        note: body.note ?? null,
        createdById: session.user.id,
      });
    }
    if (body.action === "unpay") await deleteTimesheetPayment(body.paymentId);
    if (body.action === "transfer") {
      const parts = await addTimesheetTransfer({
        personId: body.personId,
        amountRub: body.amountRub,
        paidAt: new Date(`${body.paidAt}T12:00:00+03:00`),
        date: body.paidAt,
        note: body.note ?? null,
        createdById: session.user.id,
      });
      return NextResponse.json({ ok: true, parts });
    }
    if (body.action === "fill") {
      const values = await fillTimesheetWeekdays({ personId: body.personId, month: body.month, hours: body.hours, lastDay: body.lastDay });
      return NextResponse.json({ ok: true, values });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TimesheetError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[timesheet] failed", error);
    return NextResponse.json({ error: "Не получилось — попробуйте ещё раз" }, { status: 500 });
  }
}
