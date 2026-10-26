import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { INVOICE_VALID_DAYS } from "./build";
import { invoiceDeadline, lastFullMskDayBefore } from "./due";

/** Момент по Москве (UTC+3) — «2026-10-27 00:25». */
const msk = (local: string) => new Date(`${local.replace(" ", "T")}:00+03:00`);
const iso = (d: Date) => d.toISOString();

describe("срок оплаты счёта", () => {
  it("конец последнего полного дня по Москве перед концом срока", () => {
    assert.equal(iso(lastFullMskDayBefore(msk("2026-10-28 22:05"))), iso(new Date(msk("2026-10-28 00:00").getTime() - 1)));
    assert.equal(iso(lastFullMskDayBefore(msk("2026-10-28 00:25"))), iso(new Date(msk("2026-10-28 00:00").getTime() - 1)));
  });

  it("продление и новая подписка — обычные 7 дней", () => {
    const now = msk("2026-10-25 22:00");
    const week = new Date(now.getTime() + INVOICE_VALID_DAYS * 24 * 60 * 60 * 1000);
    for (const changeKind of ["renew", "new", null]) {
      assert.equal(iso(invoiceDeadline({ now, changeKind, termEnd: msk("2026-10-28 22:05") })), iso(week));
    }
  });

  it("доплата: до конца последнего полного дня перед концом срока", () => {
    const due = invoiceDeadline({ now: msk("2026-10-25 22:00"), changeKind: "upgrade", termEnd: msk("2026-10-28 22:05") });
    assert.equal(iso(due), iso(new Date(msk("2026-10-28 00:00").getTime() - 1)));
  });

  it("срок далеко — не дольше 7 дней", () => {
    const now = msk("2026-10-25 22:00");
    const due = invoiceDeadline({ now, changeKind: "switch", termEnd: msk("2026-11-20 12:00") });
    assert.equal(iso(due), iso(new Date(now.getTime() + INVOICE_VALID_DAYS * 24 * 60 * 60 * 1000)));
  });

  it("накануне вечером, срок кончается вечером — до конца срока (день окончания почти целый)", () => {
    const due = invoiceDeadline({ now: msk("2026-10-26 23:50"), changeKind: "upgrade", termEnd: msk("2026-10-27 23:55") });
    assert.equal(iso(due), iso(msk("2026-10-27 23:55")));
  });

  it("срок кончается рано утром или днём — дата в счёте должна быть верной целиком", () => {
    const early = invoiceDeadline({ now: msk("2026-10-26 00:05"), changeKind: "upgrade", termEnd: msk("2026-10-27 00:25") });
    assert.equal(iso(early), iso(new Date(msk("2026-10-27 00:00").getTime() - 1)));
    const midday = invoiceDeadline({ now: msk("2026-10-26 12:00"), changeKind: "switch", termEnd: msk("2026-10-27 13:00") });
    assert.equal(iso(midday), iso(new Date(msk("2026-10-27 00:00").getTime() - 1)));
  });
});
