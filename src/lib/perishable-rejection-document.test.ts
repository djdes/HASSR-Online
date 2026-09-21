import assert from "node:assert/strict";
import test from "node:test";

import {
  addHoursToLocalDateTime,
  createPerishableRejectionRow,
  formatPerishableDateTime,
  formatPerishableExpiry,
  formatPerishableResponsible,
  normalizePerishableRejectionConfig,
  normalizePerishableTime,
} from "@/lib/perishable-rejection-document";

test("«+N часов» переносит срок через полночь, конец месяца и 29 февраля", () => {
  // Обычные сроки скоропорта от времени поступления.
  assert.deepEqual(addHoursToLocalDateTime("2026-09-19", "10:00", 12), {
    date: "2026-09-19",
    time: "22:00",
  });
  // Через полночь.
  assert.deepEqual(addHoursToLocalDateTime("2026-09-19", "22:30", 12), {
    date: "2026-09-20",
    time: "10:30",
  });
  assert.deepEqual(addHoursToLocalDateTime("2026-09-19", "08:40", 24), {
    date: "2026-09-20",
    time: "08:40",
  });
  // Конец месяца с 30 днями.
  assert.deepEqual(addHoursToLocalDateTime("2026-09-30", "20:00", 36), {
    date: "2026-10-02",
    time: "08:00",
  });
  // Конец года.
  assert.deepEqual(addHoursToLocalDateTime("2026-12-31", "23:00", 72), {
    date: "2027-01-03",
    time: "23:00",
  });
  // Невисокосный февраль: 28 → 1 марта.
  assert.deepEqual(addHoursToLocalDateTime("2026-02-28", "23:00", 12), {
    date: "2026-03-01",
    time: "11:00",
  });
  // Високосный 2028: 28 → 29 февраля, а не сразу март.
  assert.deepEqual(addHoursToLocalDateTime("2028-02-28", "12:00", 24), {
    date: "2028-02-29",
    time: "12:00",
  });
  assert.deepEqual(addHoursToLocalDateTime("2028-02-29", "18:00", 12), {
    date: "2028-03-01",
    time: "06:00",
  });
});

test("«+N часов» без времени поступления считает от полуночи, при битой дате — null", () => {
  assert.deepEqual(addHoursToLocalDateTime("2026-09-19", "", 36), {
    date: "2026-09-20",
    time: "12:00",
  });
  assert.equal(addHoursToLocalDateTime("", "10:00", 24), null);
  assert.equal(addHoursToLocalDateTime("19.09.2026", "10:00", 24), null);
  // 31 февраля Date молча переносит на март — такую дату не принимаем.
  assert.equal(addHoursToLocalDateTime("2026-02-31", "10:00", 24), null);
  assert.equal(addHoursToLocalDateTime("2026-09-19", "25:00", 24), null);
});

test("старые строки без времени срока читаются как раньше", () => {
  const legacyRow = {
    id: "row-1",
    arrivalDate: "2026-09-19",
    arrivalTime: "08:40",
    productName: "Сметана 20 %",
    expiryDate: "2026-09-21",
  };
  const config = normalizePerishableRejectionConfig({ rows: [legacyRow] });
  assert.equal(config.rows.length, 1);
  assert.equal(config.rows[0].expiryDate, "2026-09-21");
  assert.equal(config.rows[0].expiryTime, "");
  assert.equal(formatPerishableExpiry(config.rows[0]), "21.09.2026");

  // Новая строка с часом — час сохраняется и переживает нормализацию.
  const withTime = createPerishableRejectionRow({
    expiryDate: "2026-09-21",
    expiryTime: "8:05",
  });
  assert.equal(withTime.expiryTime, "08:05");
  const roundTripped = normalizePerishableRejectionConfig({ rows: [withTime] });
  assert.equal(roundTripped.rows[0].expiryTime, "08:05");
  assert.equal(formatPerishableExpiry(roundTripped.rows[0]), "21.09.2026 08:05");
});

test("время срока нормализуется, мусор отбрасывается", () => {
  assert.equal(normalizePerishableTime("9:5"), "");
  assert.equal(normalizePerishableTime("09:05"), "09:05");
  assert.equal(normalizePerishableTime("24:00"), "");
  assert.equal(normalizePerishableTime("12:60"), "");
  assert.equal(normalizePerishableTime(undefined), "");
  assert.equal(normalizePerishableTime(42), "");
});

test("дата+время в ячейке показываются по-русски и не теряются", () => {
  assert.equal(formatPerishableDateTime("2026-09-19", "08:40"), "19.09.2026 08:40");
  assert.equal(formatPerishableDateTime("2026-09-19", ""), "19.09.2026");
  // Старые строки со свободным текстом вместо даты показываем как есть.
  assert.equal(formatPerishableDateTime("вчера утром", ""), "вчера утром");
  assert.equal(formatPerishableDateTime("", "08:40"), "08:40");
  assert.equal(formatPerishableDateTime("", ""), "");
});

test("пустой срок не печатается, нестандартная дата не теряется", () => {
  assert.equal(formatPerishableExpiry({ expiryDate: "", expiryTime: "10:00" }), "");
  assert.equal(formatPerishableExpiry({ expiryDate: "до 21.09" }), "до 21.09");
});

/**
 * «Ответственное лицо (ФИО, должность)» хранится одной строкой. Должность
 * — самого человека из карточки: раньше подставлялась первая роль
 * «Управляющий», и повар подписывался управляющим.
 */
test("бракераж: «ФИО, должность» — должность из карточки человека", () => {
  assert.equal(
    formatPerishableResponsible({
      name: "Акулинина Е.В.",
      role: "cook",
      jobPosition: { name: "Кладовщик" },
    }),
    "Акулинина Е.В., Кладовщик"
  );
  assert.equal(
    formatPerishableResponsible({ name: "Репешко И.В.", role: "manager" }),
    "Репешко И.В., Управляющий"
  );
});
