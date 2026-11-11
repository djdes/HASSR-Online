"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, ChevronLeft, ChevronRight, Trash2, Wallet, WandSparkles } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  PART_LABELS,
  PERIOD1_LAST_DAY,
  TIMESHEET_STATUSES,
  allocateTransfer,
  computeMonth,
  daysInMonth,
  formatHours,
  formatRub,
  ledgerBalance,
  remaining,
  shiftMonth,
  unpaidPeriods,
  weekday,
  type PaymentPart,
  type TimesheetValues,
} from "@/lib/staff-timesheet";
import type { TimesheetPersonRow } from "@/lib/staff-timesheet.server";
import { cn } from "@/lib/utils";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const CARD = "rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";
const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const PRIMARY =
  "inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-50";

type TransferPart = { month: string; part: PaymentPart; amountRub: number };

async function post(body: unknown): Promise<{ ok: boolean; values?: TimesheetValues; parts?: TransferPart[]; error?: string }> {
  const response = await fetch("/api/root/timesheet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => null)) as { values?: TimesheetValues; parts?: TransferPart[]; error?: string } | null;
  if (!response.ok) {
    toast.error(data?.error ?? "Не получилось — попробуйте ещё раз");
    return { ok: false };
  }
  return { ok: true, values: data?.values, parts: data?.parts };
}

/** «Ноябрь 2026 · аванс» — подпись периода в общем долге. */
function periodTitle(month: string, part: PaymentPart): string {
  return `${monthTitle(month)} · ${part === "advance" ? "аванс" : "расчёт"}`;
}

/** Часы для «Заполнить будни». */
const FILL_HOURS = 8;

function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** Ячейка: показ значения, по клику — поле ввода; Enter/уход фокуса — сохранить, Esc — отмена. */
function EditableCell({ value, onSave, className, placeholder, align = "center" }: { value: string; onSave: (raw: string) => Promise<boolean>; className?: string; placeholder?: string; align?: "center" | "right" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  async function commit() {
    if (draft.trim() === value.trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const ok = await onSave(draft);
    setBusy(false);
    if (ok) setEditing(false);
  }
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
          if (event.key === "Escape") setEditing(false);
        }}
        className={cn("h-9 w-full min-w-0 rounded-lg border border-[#5566f6] bg-white px-1 text-[13px] tabular-nums outline-none ring-4 ring-[#5566f6]/15", align === "right" ? "text-right" : "text-center")}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={cn(
        "flex h-9 w-full items-center rounded-lg px-1 text-[13px] tabular-nums transition-colors duration-150 hover:bg-[#eef1ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
        align === "right" ? "justify-end" : "justify-center",
        className,
      )}
    >
      {value || <span className="text-[#c8ccdb]">{placeholder ?? "·"}</span>}
    </button>
  );
}

export function TimesheetBoard({ month, today, todayDate, people }: { month: string; today: number | null; todayDate: string; people: TimesheetPersonRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(people);
  // Новые данные с сервера (другой месяц, `router.refresh()` после выплаты) —
  // в таблицу: иначе `useState` держал первый загруженный месяц.
  const [source, setSource] = useState(people);
  if (source !== people) {
    setSource(people);
    setRows(people);
  }
  const [paying, setPaying] = useState<{ personId: string; name: string; part: PaymentPart; amount: string; date: string; note: string } | null>(null);
  const [removing, setRemoving] = useState<{ id: string; label: string } | null>(null);
  // Перевод на общий долг: сумма любая, гасит старые периоды первыми.
  const [transfer, setTransfer] = useState<{ personId: string; name: string; amount: string; date: string; note: string } | null>(null);
  const [filling, setFilling] = useState<string | null>(null);
  const currentMonth = todayDate.slice(0, 7);
  // До какого дня «Заполнить будни»: текущий месяц — по сегодня, прошлый — весь, будущий — нечего.
  const fillLastDay = month < currentMonth ? daysInMonth(month) : month === currentMonth ? Number(todayDate.slice(8, 10)) : 0;
  const dim = daysInMonth(month);
  const days = Array.from({ length: dim }, (_, i) => i + 1);

  const setValues = (personId: string, values: TimesheetValues) => setRows((current) => current.map((row) => (row.id === personId ? { ...row, values } : row)));

  async function saveCell(personId: string, key: string, raw: string): Promise<boolean> {
    const result = await post({ action: "cell", personId, month, key, value: raw });
    if (result.ok && result.values) setValues(personId, result.values);
    return result.ok;
  }

  async function saveRate(personId: string, raw: string): Promise<boolean> {
    const rate = Number(raw.replace(/\s/g, ""));
    if (!Number.isInteger(rate) || rate < 0) {
      toast.error("Ставка — целое число рублей в час");
      return false;
    }
    const result = await post({ action: "rate", personId, ratePerHour: rate });
    if (result.ok) setRows((current) => current.map((row) => (row.id === personId ? { ...row, ratePerHour: rate } : row)));
    return result.ok;
  }

  async function pay() {
    if (!paying) return;
    const amount = Number(paying.amount.replace(/\s/g, ""));
    const result = await post({ action: "pay", personId: paying.personId, month, part: paying.part, amountRub: amount, paidAt: paying.date, note: paying.note || null });
    if (!result.ok) return;
    toast.success(`Выплата ${formatRub(amount)} отмечена`);
    setPaying(null);
    router.refresh();
  }

  async function sendTransfer() {
    if (!transfer) return;
    const amount = Number(transfer.amount.replace(/\s/g, ""));
    const result = await post({ action: "transfer", personId: transfer.personId, amountRub: amount, paidAt: transfer.date, note: transfer.note || null });
    if (!result.ok) return;
    const parts = result.parts ?? [];
    toast.success(
      `Перевод ${formatRub(amount)} зачтён` + (parts.length ? `: ${parts.map((part) => `${periodTitle(part.month, part.part).toLowerCase()} — ${formatRub(part.amountRub)}`).join(", ")}` : ""),
    );
    setTransfer(null);
    router.refresh();
  }

  async function fillWeek(personId: string) {
    setFilling(personId);
    const result = await post({ action: "fill", personId, month, hours: FILL_HOURS, lastDay: fillLastDay });
    setFilling(null);
    if (result.ok && result.values) {
      setValues(personId, result.values);
      router.refresh();
    }
  }

  async function unpay() {
    if (!removing) return;
    const result = await post({ action: "unpay", paymentId: removing.id });
    if (!result.ok) return;
    toast.success("Выплата удалена");
    setRemoving(null);
    router.refresh();
  }

  const dayHead = (day: number) => {
    const wd = weekday(month, day);
    const weekend = wd === 0 || wd === 6;
    return (
      <th key={day} className={cn("w-10 min-w-10 border-b border-[#ececf4] px-0 py-1.5 text-center font-normal", weekend ? "bg-[#f5f6ff]" : "bg-white", day === PERIOD1_LAST_DAY + 1 && "border-l-2 border-l-[#dcdfed]", day === today && "text-[#3848c7]")}>
        <div className={cn("text-[12px] font-semibold tabular-nums", day === today ? "text-[#3848c7]" : "text-[#0b1024]")}>{day}</div>
        <div className={cn("text-[10.5px]", weekend ? "text-[#a13a32]" : "text-[#9b9fb3]")}>{WEEKDAYS[wd]}</div>
      </th>
    );
  };

  return (
    <div className="space-y-6">
      {rows.map((row) => {
        const balance = ledgerBalance(row.ledger);
        const open = unpaidPeriods(row.ledger);
        return (
          <section key={`debt-${row.id}`} className={cn(CARD, "p-5 sm:p-6")} data-timesheet-debt={row.name}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[13px] font-medium uppercase tracking-[0.12em] text-[#9b9fb3]">{row.name} · общий долг</div>
                <div className={cn("mt-1 text-[30px] font-semibold tabular-nums tracking-[-0.02em]", balance.debt > 0 ? "text-[#a13a32]" : "text-[#116b2a]")}>
                  {balance.debt > 0 ? formatRub(balance.debt) : balance.debt < 0 ? `Переплата ${formatRub(-balance.debt)}` : "Долга нет"}
                </div>
                <div className="mt-1 text-[13px] text-[#6f7282]">
                  За всё время начислено {formatRub(balance.due)}, выплачено {formatRub(balance.paid)}
                </div>
              </div>
              <button
                type="button"
                className={PRIMARY}
                onClick={() => setTransfer({ personId: row.id, name: row.name, amount: balance.debt > 0 ? String(balance.debt) : "", date: todayDate, note: "" })}
                data-timesheet-transfer
              >
                <ArrowRightLeft className="size-4" />
                Внести перевод
              </button>
            </div>
            {open.length ? (
              <ul className="mt-4 flex flex-wrap gap-2">
                {open.map((period) => (
                  <li key={`${period.month}-${period.part}`}>
                    <Link
                      href={`/root/timesheet?m=${period.month}`}
                      className={cn(
                        "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-[13px] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
                        period.month === month ? "border-[#5566f6]/40 bg-[#f5f6ff]" : "border-[#ececf4] bg-[#fafbff]",
                      )}
                    >
                      <span className="text-[#3c4053]">{periodTitle(period.month, period.part)}</span>
                      <span className="font-semibold tabular-nums text-[#a13a32]">{formatRub(period.left)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/root/timesheet?m=${shiftMonth(month, -1)}`} aria-label="Предыдущий месяц" className="flex size-10 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
          <ChevronLeft className="size-4" />
        </Link>
        <div className="min-w-[160px] text-center text-[17px] font-semibold text-[#0b1024]">{monthTitle(month)}</div>
        <Link href={`/root/timesheet?m=${shiftMonth(month, 1)}`} aria-label="Следующий месяц" className="flex size-10 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
          <ChevronRight className="size-4" />
        </Link>
      </div>

      <div className={cn(CARD, "overflow-x-auto")}>
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[170px] border-b border-r border-[#ececf4] bg-white px-4 py-1.5 text-left text-[12px] font-medium text-[#6f7282]">Сотрудник · ₽/час</th>
              {days.map(dayHead)}
              <th className="min-w-14 border-b border-l-2 border-[#ececf4] border-l-[#dcdfed] bg-[#fafbff] px-2 py-1.5 text-center text-[11px] font-medium text-[#6f7282]">1–15</th>
              <th className="min-w-14 border-b border-[#ececf4] bg-[#fafbff] px-2 py-1.5 text-center text-[11px] font-medium text-[#6f7282]">16–{dim}</th>
              <th className="min-w-14 border-b border-[#ececf4] bg-[#fafbff] px-2 py-1.5 text-center text-[11px] font-medium text-[#6f7282]">Часы</th>
              <th className="min-w-24 border-b border-[#ececf4] bg-[#fafbff] px-3 py-1.5 text-right text-[11px] font-medium text-[#6f7282]">К выплате</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th className="sticky left-0 z-10 border-r border-[#ececf4] bg-white px-4 py-1 text-left font-normal">
                  <div className="text-[14px] font-medium text-[#0b1024]">{row.name}</div>
                  <div className="flex items-center gap-1">
                    <div className="w-24">
                      <EditableCell value={String(row.ratePerHour)} onSave={(raw) => saveRate(row.id, raw)} align="right" className="justify-start text-[#6f7282]" />
                    </div>
                    {fillLastDay > 0 ? (
                      <button
                        type="button"
                        disabled={filling === row.id}
                        onClick={() => void fillWeek(row.id)}
                        title={`Пустые будни ${month === currentMonth ? "по сегодня" : "месяца"} — по ${FILL_HOURS} ч; заполненное не трогается`}
                        aria-label="Заполнить будни"
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] text-[#3848c7] transition-colors hover:bg-[#eef1ff] disabled:opacity-50"
                        data-timesheet-fill
                      >
                        <WandSparkles className="size-3.5" />
                        Будни по {FILL_HOURS}
                      </button>
                    ) : null}
                  </div>
                </th>
                {days.map((day) => {
                  const v = row.values[String(day)];
                  const wd = weekday(month, day);
                  return (
                    <td key={day} className={cn("border-[#ececf4] p-0.5", (wd === 0 || wd === 6) && "bg-[#f5f6ff]", day === today && "bg-[#eef1ff]", day === PERIOD1_LAST_DAY + 1 && "border-l-2 border-l-[#dcdfed]")}>
                      <EditableCell
                        value={v === undefined ? "" : typeof v === "number" ? formatHours(v) : v}
                        onSave={(raw) => saveCell(row.id, String(day), raw)}
                        className={typeof v === "string" ? "font-semibold text-[#a16d32]" : "text-[#0b1024]"}
                      />
                    </td>
                  );
                })}
                {(() => {
                  const t = computeMonth(row.values, row.ratePerHour, month);
                  return (
                    <>
                      <td className="border-l-2 border-[#ececf4] border-l-[#dcdfed] bg-[#fafbff] px-2 text-center tabular-nums text-[#3c4053]">{formatHours(t.period1.hours)}</td>
                      <td className="bg-[#fafbff] px-2 text-center tabular-nums text-[#3c4053]">{formatHours(t.period2.hours)}</td>
                      <td className="bg-[#fafbff] px-2 text-center font-semibold tabular-nums text-[#0b1024]">{formatHours(t.hours)}</td>
                      <td className="bg-[#fafbff] px-3 text-right font-semibold tabular-nums text-[#0b1024]">{formatRub(t.due)}</td>
                    </>
                  );
                })()}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="-mt-3 text-[12.5px] text-[#6f7282]">
        Нажмите на день, впишите часы и нажмите Enter. «Будни по {FILL_HOURS}» заполняет пустые будни, вписанное не меняет. Статусы: {Object.entries(TIMESHEET_STATUSES).map(([k, v]) => `${k} — ${v.toLowerCase()}`).join(", ")}. Пусто — стереть.
      </p>

      {rows.map((row) => {
        const totals = computeMonth(row.values, row.ratePerHour, month);
        const paid = (part: PaymentPart) => row.payments.filter((p) => p.part === part).reduce((sum, p) => sum + p.amountRub, 0);
        const periods: { part: PaymentPart; key: "p1" | "p2"; totals: typeof totals.period1 }[] = [
          { part: "advance", key: "p1", totals: totals.period1 },
          { part: "final", key: "p2", totals: totals.period2 },
        ];
        const paidTotal = paid("advance") + paid("final");
        return (
          <section key={row.id} className={cn(CARD, "p-5 sm:p-6")} data-timesheet-person={row.name}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-[18px] font-semibold text-[#0b1024]">
                {row.name} · {monthTitle(month).toLowerCase()}
              </h2>
              <div className="text-[13.5px] text-[#6f7282]">
                {formatHours(totals.hours)} ч × {formatRub(row.ratePerHour)} · к выплате <span className="font-semibold text-[#0b1024]">{formatRub(totals.due)}</span> · выплачено{" "}
                <span className="font-semibold text-[#116b2a]">{formatRub(paidTotal)}</span>
                {totals.due - paidTotal > 0 ? (
                  <>
                    {" "}
                    · осталось <span className="font-semibold text-[#a13a32]">{formatRub(totals.due - paidTotal)}</span>
                  </>
                ) : null}
              </div>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {periods.map(({ part, key, totals: t }) => {
                const left = remaining(t.due, paid(part));
                const list = row.payments.filter((p) => p.part === part);
                return (
                  <div key={part} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
                    <div className="text-[14px] font-semibold text-[#0b1024]">{PART_LABELS[part]}</div>
                    <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13.5px]">
                      <dt className="text-[#6f7282]">Часы</dt>
                      <dd className="text-right tabular-nums">{formatHours(t.hours)}</dd>
                      <dt className="text-[#6f7282]">Начислено по ставке</dt>
                      <dd className="text-right tabular-nums">{formatRub(t.earned)}</dd>
                      <dt className="self-center text-[#6f7282]">Премия (+) или штраф (−)</dt>
                      <dd className="w-28">
                        <EditableCell value={t.bonus ? String(t.bonus) : ""} placeholder="0" align="right" onSave={(raw) => saveCell(row.id, key, raw)} />
                      </dd>
                      <dt className="font-medium text-[#0b1024]">К выплате</dt>
                      <dd className="text-right font-semibold tabular-nums">{formatRub(t.due)}</dd>
                      <dt className="text-[#6f7282]">Выплачено</dt>
                      <dd className="text-right tabular-nums text-[#116b2a]">{formatRub(paid(part))}</dd>
                    </dl>
                    {list.length ? (
                      <ul className="mt-3 space-y-1.5">
                        {list.map((p) => (
                          <li key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-[13px]">
                            <span>
                              <span className="font-medium tabular-nums">{formatRub(p.amountRub)}</span>
                              <span className="text-[#6f7282]"> · {new Date(p.paidAt).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}{p.note ? ` · ${p.note}` : ""}</span>
                            </span>
                            <button type="button" aria-label="Удалить выплату" onClick={() => setRemoving({ id: p.id, label: `${formatRub(p.amountRub)} от ${new Date(p.paidAt).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}` })} className="rounded-lg p-1.5 text-[#9b9fb3] transition-colors hover:bg-[#fff4f2] hover:text-[#a13a32]">
                              <Trash2 className="size-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <button
                      type="button"
                      className={cn(PRIMARY, "mt-4")}
                      onClick={() => setPaying({ personId: row.id, name: row.name, part, amount: left ? String(left) : "", date: todayDate, note: "" })}
                      data-timesheet-pay={part}
                    >
                      <Wallet className="size-4" />
                      {left ? `Отметить оплату · ${formatRub(left)}` : "Отметить оплату"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {paying ? (
        <ConfirmDialog
          open
          onClose={() => setPaying(null)}
          onConfirm={pay}
          title={`Выплата: ${paying.name}`}
          description={`${PART_LABELS[paying.part]}, ${monthTitle(month).toLowerCase()}. Сумма подставлена — сколько осталось выплатить за период.`}
          icon={Wallet}
          confirmLabel="Отметить оплату"
          cancelLabel="Отмена"
          confirmDisabled={!(Number(paying.amount.replace(/\s/g, "")) > 0) || !paying.date}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[13px] text-[#3c4053]">
              Сумма, ₽
              <input value={paying.amount} onChange={(event) => setPaying({ ...paying, amount: event.target.value.replace(/[^\d]/g, "") })} className={`${INPUT} mt-1`} inputMode="numeric" />
            </label>
            <label className="block text-[13px] text-[#3c4053]">
              Дата оплаты
              <input type="date" value={paying.date} onChange={(event) => setPaying({ ...paying, date: event.target.value })} className={`${INPUT} mt-1`} />
            </label>
            <label className="block text-[13px] text-[#3c4053] sm:col-span-2">
              Комментарий
              <input value={paying.note} onChange={(event) => setPaying({ ...paying, note: event.target.value })} className={`${INPUT} mt-1`} placeholder="Перевод на карту, наличными…" />
            </label>
          </div>
        </ConfirmDialog>
      ) : null}

      {transfer
        ? (() => {
            const row = rows.find((item) => item.id === transfer.personId);
            const amount = Number(transfer.amount.replace(/\s/g, ""));
            const plan = row ? allocateTransfer(row.ledger, amount) : { parts: [], excess: 0 };
            return (
              <ConfirmDialog
                open
                onClose={() => setTransfer(null)}
                onConfirm={sendTransfer}
                title={`Перевод: ${transfer.name}`}
                description="Любая сумма, хоть часть долга: она закрывает самые старые периоды первыми. Сумма подставлена — весь долг."
                icon={ArrowRightLeft}
                confirmLabel="Зачесть перевод"
                cancelLabel="Отмена"
                confirmDisabled={!(amount > 0) || !transfer.date}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-[13px] text-[#3c4053]">
                    Сумма перевода, ₽
                    <input
                      autoFocus
                      value={transfer.amount}
                      onChange={(event) => setTransfer({ ...transfer, amount: event.target.value.replace(/[^\d]/g, "") })}
                      className={`${INPUT} mt-1`}
                      inputMode="numeric"
                      data-timesheet-transfer-amount
                    />
                  </label>
                  <label className="block text-[13px] text-[#3c4053]">
                    Дата перевода
                    <input type="date" value={transfer.date} onChange={(event) => setTransfer({ ...transfer, date: event.target.value })} className={`${INPUT} mt-1`} />
                  </label>
                  <label className="block text-[13px] text-[#3c4053] sm:col-span-2">
                    Комментарий
                    <input value={transfer.note} onChange={(event) => setTransfer({ ...transfer, note: event.target.value })} className={`${INPUT} mt-1`} placeholder="Перевод на карту, наличными…" />
                  </label>
                </div>
                {amount > 0 ? (
                  <div className="mt-4 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3 text-[13px]" data-timesheet-transfer-plan>
                    <div className="mb-1.5 font-medium text-[#0b1024]">Куда пойдут деньги</div>
                    <ul className="space-y-1">
                      {plan.parts.map((part) => (
                        <li key={`${part.month}-${part.part}`} className="flex justify-between gap-3">
                          <span className="text-[#3c4053]">{periodTitle(part.month, part.part)}</span>
                          <span className="font-semibold tabular-nums">{formatRub(part.amountRub)}</span>
                        </li>
                      ))}
                      {plan.excess > 0 ? (
                        <li className="flex justify-between gap-3">
                          <span className="text-[#3c4053]">Сверх долга — вперёд, за период даты перевода</span>
                          <span className="font-semibold tabular-nums text-[#116b2a]">{formatRub(plan.excess)}</span>
                        </li>
                      ) : null}
                    </ul>
                    {row && plan.excess === 0 ? (
                      <div className="mt-2 text-[#6f7282]">
                        Останется долга: <span className="font-semibold text-[#a13a32]">{formatRub(Math.max(0, ledgerBalance(row.ledger).debt - amount))}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </ConfirmDialog>
            );
          })()
        : null}

      {removing ? (
        <ConfirmDialog
          open
          onClose={() => setRemoving(null)}
          onConfirm={unpay}
          title="Удалить выплату?"
          description={`Отметка о выплате ${removing.label} пропадёт, остаток к выплате пересчитается.`}
          confirmLabel="Удалить"
          cancelLabel="Отмена"
          variant="danger"
        />
      ) : null}
    </div>
  );
}
