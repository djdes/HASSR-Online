import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { normalizeValues, parseCell, parseMoney, type PaymentPart, type TimesheetValues } from "@/lib/staff-timesheet";

/** Табель сотрудников платформы: чтение месяца, правка ячеек, выплаты. */

export class TimesheetError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Первый сотрудник табеля — Алексей, 600 ₽ в час (владелец, 2026-11-11). */
async function ensureSeed(): Promise<void> {
  if ((await db.staffTimesheetPerson.count()) > 0) return;
  const alexey = await db.user.findFirst({
    where: { name: { startsWith: "Алексей" }, isActive: true, archivedAt: null, OR: [{ platformSalesHead: true }, { platformSections: { isEmpty: false } }] },
    select: { id: true },
  });
  await db.staffTimesheetPerson.create({ data: { name: "Алексей", userId: alexey?.id ?? null, ratePerHour: 600 } });
}

export type TimesheetPersonRow = {
  id: string;
  name: string;
  ratePerHour: number;
  values: TimesheetValues;
  payments: { id: string; part: PaymentPart; amountRub: number; paidAt: string; note: string | null }[];
};

export async function loadTimesheet(month: string): Promise<TimesheetPersonRow[]> {
  await ensureSeed();
  const people = await db.staffTimesheetPerson.findMany({ where: { active: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  const ids = people.map((p) => p.id);
  const [months, payments] = await Promise.all([
    db.staffTimesheetMonth.findMany({ where: { personId: { in: ids }, month } }),
    db.staffTimesheetPayment.findMany({ where: { personId: { in: ids }, month }, orderBy: { paidAt: "asc" } }),
  ]);
  return people.map((person) => ({
    id: person.id,
    name: person.name,
    ratePerHour: person.ratePerHour,
    values: normalizeValues(months.find((m) => m.personId === person.id)?.values),
    payments: payments
      .filter((p) => p.personId === person.id)
      .map((p) => ({ id: p.id, part: p.part === "final" ? "final" : "advance", amountRub: p.amountRub, paidAt: p.paidAt.toISOString(), note: p.note })),
  }));
}

async function person(id: string) {
  const row = await db.staffTimesheetPerson.findUnique({ where: { id } });
  if (!row) throw new TimesheetError("Сотрудник не найден", 404);
  return row;
}

/** Ячейка дня («1».."31») или премия периода («p1»/«p2»). */
export async function setTimesheetCell(args: { personId: string; month: string; key: string; raw: string }): Promise<TimesheetValues> {
  await person(args.personId);
  const existing = await db.staffTimesheetMonth.findUnique({ where: { personId_month: { personId: args.personId, month: args.month } } });
  const values: Record<string, unknown> = { ...normalizeValues(existing?.values) };
  if (args.key === "p1" || args.key === "p2") {
    const money = parseMoney(args.raw);
    if (money === null) throw new TimesheetError("Премия или штраф — число рублей, например 1500 или -500");
    if (money) values[args.key] = money;
    else delete values[args.key];
  } else {
    const day = Number(args.key);
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new TimesheetError("Нет такого дня");
    const cell = parseCell(args.raw);
    if (cell === null) throw new TimesheetError("Часы от 0,25 до 24 или О — отпуск, Б — больничный, В — выходной");
    if (cell === undefined) delete values[args.key];
    else values[args.key] = cell;
  }
  const json = values as Prisma.InputJsonValue;
  await db.staffTimesheetMonth.upsert({
    where: { personId_month: { personId: args.personId, month: args.month } },
    create: { personId: args.personId, month: args.month, values: json },
    update: { values: json },
  });
  return normalizeValues(values);
}

export async function setPersonRate(personId: string, ratePerHour: number): Promise<void> {
  await person(personId);
  if (!Number.isInteger(ratePerHour) || ratePerHour < 0 || ratePerHour > 100_000) throw new TimesheetError("Ставка — целое число рублей в час");
  await db.staffTimesheetPerson.update({ where: { id: personId }, data: { ratePerHour } });
}

export async function addTimesheetPayment(args: {
  personId: string;
  month: string;
  part: PaymentPart;
  amountRub: number;
  paidAt: Date;
  note: string | null;
  createdById: string;
}): Promise<void> {
  await person(args.personId);
  if (!Number.isInteger(args.amountRub) || args.amountRub <= 0) throw new TimesheetError("Сумма выплаты — больше нуля");
  await db.staffTimesheetPayment.create({
    data: { personId: args.personId, month: args.month, part: args.part, amountRub: args.amountRub, paidAt: args.paidAt, note: args.note?.trim() || null, createdById: args.createdById },
  });
}

export async function deleteTimesheetPayment(id: string): Promise<void> {
  const deleted = await db.staffTimesheetPayment.deleteMany({ where: { id } });
  if (!deleted.count) throw new TimesheetError("Выплата не найдена", 404);
}
