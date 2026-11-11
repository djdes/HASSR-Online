import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  allocateTransfer,
  buildLedger,
  daysInMonth,
  fillWeekdays,
  formatRub,
  normalizeValues,
  parseCell,
  parseMoney,
  periodOfDate,
  type LedgerPeriod,
  type PaymentPart,
  type TimesheetValues,
} from "@/lib/staff-timesheet";

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
  /** Все периоды за всё время — для общего долга и разнесения перевода. */
  ledger: LedgerPeriod[];
};

const partOf = (value: string): PaymentPart => (value === "final" ? "final" : "advance");

export async function loadTimesheet(month: string): Promise<TimesheetPersonRow[]> {
  await ensureSeed();
  const people = await db.staffTimesheetPerson.findMany({ where: { active: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  const ids = people.map((p) => p.id);
  // Все месяцы и выплаты: общий долг считается за всё время (строк немного —
  // по месяцу на человека).
  const [months, payments] = await Promise.all([
    db.staffTimesheetMonth.findMany({ where: { personId: { in: ids } } }),
    db.staffTimesheetPayment.findMany({ where: { personId: { in: ids } }, orderBy: { paidAt: "asc" } }),
  ]);
  return people.map((person) => {
    const ownMonths = months
      .filter((m) => m.personId === person.id)
      .map((m) => ({ month: m.month, values: normalizeValues(m.values) }));
    const ownPayments = payments.filter((p) => p.personId === person.id);
    return {
      id: person.id,
      name: person.name,
      ratePerHour: person.ratePerHour,
      values: ownMonths.find((m) => m.month === month)?.values ?? {},
      payments: ownPayments
        .filter((p) => p.month === month)
        .map((p) => ({ id: p.id, part: partOf(p.part), amountRub: p.amountRub, paidAt: p.paidAt.toISOString(), note: p.note })),
      ledger: buildLedger(
        ownMonths,
        ownPayments.map((p) => ({ month: p.month, part: partOf(p.part), amountRub: p.amountRub })),
        person.ratePerHour,
      ),
    };
  });
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

/**
 * Перевод любой суммы (2026-11-11): гасит самые старые долги первыми, в том
 * числе частично; что сверх долга — выплата за период даты перевода. Одна
 * запись на каждый погашенный период, у всех — общая пометка перевода.
 */
export async function addTimesheetTransfer(args: {
  personId: string;
  amountRub: number;
  paidAt: Date;
  /** Дата перевода «2026-11-20» — для остатка сверх долга. */
  date: string;
  note: string | null;
  createdById: string;
}): Promise<{ month: string; part: PaymentPart; amountRub: number }[]> {
  const row = await person(args.personId);
  if (!Number.isInteger(args.amountRub) || args.amountRub <= 0) throw new TimesheetError("Сумма перевода — больше нуля");
  const [months, payments] = await Promise.all([
    db.staffTimesheetMonth.findMany({ where: { personId: row.id } }),
    db.staffTimesheetPayment.findMany({ where: { personId: row.id } }),
  ]);
  const ledger = buildLedger(
    months.map((m) => ({ month: m.month, values: normalizeValues(m.values) })),
    payments.map((p) => ({ month: p.month, part: partOf(p.part), amountRub: p.amountRub })),
    row.ratePerHour,
  );
  const { parts, excess } = allocateTransfer(ledger, args.amountRub);
  const all = excess > 0 ? [...parts, { ...periodOfDate(args.date), amountRub: excess }] : parts;
  const label = `Перевод ${formatRub(args.amountRub)}`;
  const note = args.note?.trim() ? `${label} · ${args.note.trim()}` : label;
  await db.$transaction(
    all.map((part) =>
      db.staffTimesheetPayment.create({
        data: { personId: row.id, month: part.month, part: part.part, amountRub: part.amountRub, paidAt: args.paidAt, note, createdById: args.createdById },
      }),
    ),
  );
  return all;
}

/** «Заполнить будни»: пустые будни месяца до `lastDay` — по `hours` часов. */
export async function fillTimesheetWeekdays(args: { personId: string; month: string; hours: number; lastDay: number }): Promise<TimesheetValues> {
  await person(args.personId);
  const existing = await db.staffTimesheetMonth.findUnique({ where: { personId_month: { personId: args.personId, month: args.month } } });
  const values = fillWeekdays(normalizeValues(existing?.values), args.month, args.hours, Math.min(args.lastDay, daysInMonth(args.month)));
  const json = values as Prisma.InputJsonValue;
  await db.staffTimesheetMonth.upsert({
    where: { personId_month: { personId: args.personId, month: args.month } },
    create: { personId: args.personId, month: args.month, values: json },
    update: { values: json },
  });
  return values;
}
