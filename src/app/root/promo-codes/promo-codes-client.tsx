"use client";

import { Loader2, Plus, Ticket } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { formatMskDateTime, mskInputToDate } from "@/lib/promo/promotions";
import { describeDiscount } from "@/lib/promo/rules";
import { cn } from "@/lib/utils";

export type PromoRow = {
  id: string;
  code: string;
  kind: "percent" | "fixed";
  value: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  newClientsOnly: boolean;
  note: string | null;
  paidUses: number;
};

const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const CARD = "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";

/** Дата по Москве: «01.10.2026». */
const mskDate = (iso: string) => formatMskDateTime(new Date(iso)).slice(0, 10);

/** Срок кода по Москве: начало дня «с» и конец дня «по» (23:59:59). */
function mskDayStart(date: string): string | null {
  return date ? mskInputToDate(`${date}T00:00`)?.toISOString() ?? null : null;
}
function mskDayEnd(date: string): string | null {
  const end = date ? mskInputToDate(`${date}T23:59`) : null;
  return end ? new Date(end.getTime() + 59_999).toISOString() : null;
}

const EMPTY_FORM = {
  code: "",
  kind: "percent" as "percent" | "fixed",
  value: "10",
  startsAt: "",
  endsAt: "",
  maxUses: "",
  newClientsOnly: false,
  note: "",
};

export function PromoCodesClient({ initial }: { initial: PromoRow[] }) {
  const [rows, setRows] = useState(initial);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const response = await fetch("/api/root/promo-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          kind: form.kind,
          value: Number(form.value),
          startsAt: mskDayStart(form.startsAt),
          endsAt: mskDayEnd(form.endsAt),
          maxUses: form.maxUses ? Number(form.maxUses) : null,
          newClientsOnly: form.newClientsOnly,
          note: form.note,
        }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string; code?: PromoRow } | null;
      if (!response.ok || !data?.code) throw new Error(data?.error ?? "Не удалось создать");
      setRows((prev) => [data.code!, ...prev]);
      setForm(EMPTY_FORM);
      toast.success(`Промокод ${data.code.code} создан`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: PromoRow) {
    const response = await fetch(`/api/root/promo-codes/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !row.active }),
    });
    if (!response.ok) {
      toast.error("Не удалось изменить");
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, active: !row.active } : r)));
    toast.success(row.active ? `${row.code} отключён` : `${row.code} включён`);
  }

  // Срок по Москве: «с 01.10.2026 по 31.10.2026», «до …», «без срока».
  const period = (row: PromoRow) =>
    row.startsAt && row.endsAt
      ? `с ${mskDate(row.startsAt)} по ${mskDate(row.endsAt)}`
      : row.endsAt
        ? `до ${mskDate(row.endsAt)}`
        : row.startsAt
          ? `с ${mskDate(row.startsAt)}`
          : "без срока";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className={CARD}>
        <div className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Коды · {rows.length}</div>
        {rows.length === 0 ? (
          <p className="text-[13.5px] text-[#9b9fb3]">Промокодов пока нет — создайте первый справа.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[13.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-[#9b9fb3]">
                  <th className="pb-2 pr-4 font-medium">Код</th>
                  <th className="pb-2 pr-4 font-medium">Скидка</th>
                  <th className="pb-2 pr-4 font-medium">Срок (МСК)</th>
                  <th className="pb-2 pr-4 font-medium">Оплат</th>
                  <th className="pb-2 pr-4 font-medium">Кому</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={cn("border-t border-[#f2f3f8]", !row.active && "opacity-60")}>
                    <td className="py-2.5 pr-4">
                      <span className="font-mono font-semibold text-[#0b1024]">{row.code}</span>
                      {row.note ? <div className="text-[12px] text-[#6f7282]">{row.note}</div> : null}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-4 tabular-nums text-[#0b1024]">{describeDiscount(row)}</td>
                    <td className="py-2.5 pr-4 text-[#6f7282]">{period(row)}</td>
                    <td className="whitespace-nowrap py-2.5 pr-4 tabular-nums text-[#6f7282]">
                      {row.paidUses}
                      {row.maxUses ? ` / ${row.maxUses}` : ""}
                    </td>
                    <td className="py-2.5 pr-4 text-[#6f7282]">{row.newClientsOnly ? "только новым" : "всем"}</td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => void toggle(row)}
                        className="inline-flex h-8 items-center rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                      >
                        {row.active ? "Отключить" : "Включить"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={cn(CARD, "lg:sticky lg:top-6 lg:self-start")}>
        <div className="mb-4 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          <Ticket className="size-4 text-[#5566f6]" />
          Новый промокод
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Код</span>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="WELCOME10" className={cn(INPUT, "font-mono")} maxLength={32} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Тип</span>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "percent" | "fixed" })} className={INPUT}>
                <option value="percent">Процент</option>
                <option value="fixed">Рубли</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{form.kind === "percent" ? "Процент" : "Сумма, ₽"}</span>
              <input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className={INPUT} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Действует с</span>
              <input type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className={INPUT} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">по (включительно)</span>
              <input type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} className={INPUT} />
            </label>
          </div>
          <div>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Лимит оплат</span>
              <input value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="без лимита" className={INPUT} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-[13.5px] text-[#3c4053]">
            <input type="checkbox" checked={form.newClientsOnly} onChange={(e) => setForm({ ...form, newClientsOnly: e.target.checked })} className="size-4 rounded border-[#dcdfed]" />
            Только новым клиентам (без оплаченных заказов)
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Заметка</span>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Для рассылки в сентябре" className={INPUT} maxLength={200} />
          </label>
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy || form.code.trim().length < 3 || !form.value}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Создать
          </button>
          <p className="text-[12px] leading-relaxed text-[#9b9fb3]">
            Клиент вводит код на странице оформления; скидка считается на сервере и попадает в
            сумму заказа, чек и УПД.
          </p>
        </div>
      </section>
    </div>
  );
}
