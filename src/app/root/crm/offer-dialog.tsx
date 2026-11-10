"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgePercent, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { planPeriodPriceRub, type PaidTier, type PlanRates } from "@/lib/tariff-plans";
import { cn } from "@/lib/utils";
import { INPUT, SECONDARY_BUTTON, TEXTAREA } from "./crm-ui";

type Defaults = {
  organizationId: string;
  orgName: string;
  hasInn: boolean;
  toEmail: string;
  seats: number;
  pointsInUse: number;
  limit: number;
  rates: PlanRates;
  tier: PaidTier;
  cycle: "month" | "year";
  points: number;
  discountPercent: number;
  /** Условия согласованы — менять нельзя, только отправить. */
  locked: boolean;
  note: string;
  lifetime: boolean;
  validDays: number;
};

const TIERS: { id: PaidTier; label: string }[] = [
  { id: "standard", label: "Стандарт" },
  { id: "premium", label: "Премиум" },
  { id: "vip", label: "ВИП" },
];

const rub = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;

/**
 * «КП со скидкой» из задачи или сделки: тариф, период, точки и скидка.
 * В пределах лимита роли письмо уходит сразу (код скидки, счёт при ИНН),
 * больше — уходит на согласование тому, чей лимит покрывает.
 */
export function OfferButton({ organizationId, taskId, label = "КП со скидкой", compact }: { organizationId: string; taskId?: string | null; label?: string; compact?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [form, setForm] = useState<{ tier: PaidTier; cycle: "month" | "year"; points: number; discountPercent: number; toEmail: string; note: string; attachInvoice: boolean; lifetime: boolean; validDays: number } | null>(null);

  async function open() {
    setLoading(true);
    const params = new URLSearchParams({ organizationId, ...(taskId ? { taskId } : {}) });
    const response = await fetch(`/api/root/crm/offers?${params}`);
    const data = (await response.json().catch(() => null)) as (Defaults & { error?: string }) | null;
    setLoading(false);
    if (!response.ok || !data) {
      toast.error(data?.error ?? "Не получилось открыть форму");
      return;
    }
    setDefaults(data);
    setForm({ tier: data.tier, cycle: data.cycle, points: data.points, discountPercent: data.discountPercent, toEmail: data.toEmail, note: data.note, attachInvoice: data.hasInn, lifetime: data.lifetime, validDays: data.validDays });
  }

  async function submit() {
    if (!defaults || !form) return;
    const response = await fetch("/api/root/crm/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, taskId: taskId ?? null, ...form }),
    });
    const data = (await response.json().catch(() => null)) as { error?: string; status?: string; approverName?: string; code?: string | null; invoiceError?: string; note?: string } | null;
    if (!response.ok || !data) {
      toast.error(data?.error ?? "Не получилось отправить");
      return;
    }
    if (data.status === "approval") toast.success(`Скидка больше вашего лимита — ушло на согласование: ${data.approverName}`);
    else {
      toast.success(`КП отправлено${data.code ? `, код ${data.code}` : ""}`);
      if (data.invoiceError) toast.message(`Счёт не выставлен: ${data.invoiceError}`);
      if (data.note) toast.message(data.note);
    }
    setDefaults(null);
    router.refresh();
  }

  const full = defaults && form ? planPeriodPriceRub(defaults.rates, form.tier, form.cycle, form.points) : 0;
  const discounted = Math.round((full * (100 - (form?.discountPercent ?? 0))) / 100);
  const overLimit = Boolean(defaults && form && form.discountPercent > defaults.limit && !defaults.locked);
  const pointsLow = Boolean(defaults && form && form.points < defaults.pointsInUse);
  const field = "block text-[13px] text-[#3c4053]";

  return (
    <>
      <button type="button" onClick={open} disabled={loading} className={cn(SECONDARY_BUTTON, compact && "h-9 px-3 text-[13px]")} data-crm-offer-open>
        {loading ? <Loader2 className="size-4 animate-spin" /> : <BadgePercent className="size-4" />}
        {label}
      </button>
      {defaults && form ? (
        <ConfirmDialog
          open
          onClose={() => setDefaults(null)}
          onConfirm={submit}
          title={defaults.locked ? "Отправить согласованное КП" : "КП со скидкой"}
          description={`${defaults.orgName}: ${defaults.seats} сотр., ${defaults.pointsInUse} точ. в работе. Ваш лимит скидки — ${defaults.limit} %${defaults.locked ? "; условия согласованы — менять нельзя" : ", больше — уйдёт на согласование"}.`}
          icon={BadgePercent}
          confirmLabel={overLimit ? "На согласование" : "Отправить КП"}
          cancelLabel="Отмена"
          confirmDisabled={!form.toEmail.includes("@") || pointsLow}
        >
          <div className="grid gap-3 sm:grid-cols-2" data-crm-offer-form>
            <label className={field}>
              Тариф
              <select value={form.tier} disabled={defaults.locked} onChange={(event) => setForm({ ...form, tier: event.target.value as PaidTier })} className={`${INPUT} mt-1`} name="tier">
                {TIERS.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={field}>
              Период
              <select value={form.cycle} disabled={defaults.locked} onChange={(event) => setForm({ ...form, cycle: event.target.value as "month" | "year" })} className={`${INPUT} mt-1`} name="cycle">
                <option value="year">Год</option>
                <option value="month">Месяц</option>
              </select>
            </label>
            <label className={field}>
              Точек
              <input
                value={form.points}
                disabled={defaults.locked}
                onChange={(event) => setForm({ ...form, points: Math.max(1, Number(event.target.value.replace(/\D/g, "")) || 1) })}
                className={`${INPUT} mt-1`}
                inputMode="numeric"
                name="points"
              />
            </label>
            <label className={field}>
              Скидка, %
              <input
                value={form.discountPercent}
                disabled={defaults.locked}
                onChange={(event) => setForm({ ...form, discountPercent: Math.min(90, Number(event.target.value.replace(/\D/g, "")) || 0) })}
                className={`${INPUT} mt-1`}
                inputMode="numeric"
                name="discountPercent"
              />
            </label>
            <div className="rounded-2xl bg-[#f5f6ff] px-4 py-3 text-[13.5px] text-[#1f2a7a] sm:col-span-2" data-crm-offer-price>
              {form.discountPercent ? (
                <>
                  <span className="text-[#6f7282] line-through">{rub(full)}</span> → <strong>{rub(discounted)}</strong> {form.cycle === "year" ? "за год" : "за месяц"}
                  {form.cycle === "year" ? <span className="text-[#6f7282]"> · {rub(discounted / 12)} в месяц</span> : null}
                </>
              ) : (
                <>
                  <strong>{rub(full)}</strong> {form.cycle === "year" ? "за год" : "за месяц"}
                </>
              )}
              {overLimit ? <div className="mt-1 text-[12.5px] text-[#7a4a00]">Больше вашего лимита {defaults.limit} % — сначала согласование, потом отправите КП из задачи.</div> : null}
              {pointsLow ? <div className="mt-1 text-[12.5px] text-[#a13a32]">У клиента в работе {defaults.pointsInUse} точ. — меньше оплатить не получится.</div> : null}
            </div>
            <label className={cn(field, "sm:col-span-2")}>
              Кому
              <input value={form.toEmail} onChange={(event) => setForm({ ...form, toEmail: event.target.value.trim() })} className={`${INPUT} mt-1`} type="email" name="toEmail" placeholder="director@company.ru" />
            </label>
            <label className={cn(field, "sm:col-span-2")}>
              Текст письма (необязательно)
              <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} className={`${TEXTAREA} mt-1 min-h-[80px]`} name="note" placeholder="Как договорились по телефону — фиксируем скидку до конца недели." />
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[#3c4053]">
              <input type="checkbox" checked={form.attachInvoice} disabled={!defaults.hasInn} onChange={(event) => setForm({ ...form, attachInvoice: event.target.checked })} className="size-4 accent-[#5566f6]" />
              {defaults.hasInn ? "Приложить счёт со скидкой" : "Счёт — нет ИНН у организации"}
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[#3c4053]">
              <input type="checkbox" checked={form.lifetime} disabled={defaults.locked} onChange={(event) => setForm({ ...form, lifetime: event.target.checked })} className="size-4 accent-[#5566f6]" />
              Скидка на все продления
            </label>
          </div>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
