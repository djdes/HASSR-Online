"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import type { LifecycleSettings } from "@/lib/lifecycle/plan";
import { INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../crm-ui";

type Person = { id: string; name: string };
type NumberKey = "approvalSeats" | "trialFirstWorkdays" | "trialSecondWorkdays" | "graceLastWorkdays" | "renewalEarlyDays" | "invoiceAheadWorkdays" | "winbackDays";

/** Настройки сценария «пробный и оплата»: кому задачи, кто согласует, сроки касаний и скидки. */
export function LifecycleSettingsForm({ settings, people }: { settings: LifecycleSettings; people: Person[] }) {
  const router = useRouter();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const num = (key: NumberKey) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: Number(event.target.value.replace(/\D/g, "")) || 0 }));
  const band = (index: number, key: "minSeats" | "percent") => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, discounts: current.discounts.map((item, i) => (i === index ? { ...item, [key]: Number(event.target.value.replace(/\D/g, "")) || 0 } : item)) }));

  async function save() {
    setBusy(true);
    const response = await fetch("/api/root/crm/tasks/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = (await response.json().catch(() => null)) as { error?: string; settings?: LifecycleSettings } | null;
    setBusy(false);
    if (!response.ok) {
      toast.error(data?.error ?? "Не получилось сохранить — попробуйте ещё раз");
      return;
    }
    if (data?.settings) setForm(data.settings);
    toast.success("Настройки сохранены — применятся завтра утром");
    router.refresh();
  }

  const field = "block text-[13px] leading-snug text-[#3c4053]";
  const numberInput = (key: NumberKey, label: string, hint?: string) => (
    <label className={field}>
      {label}
      <input value={form[key]} onChange={num(key)} className={`${INPUT} mt-1`} inputMode="numeric" name={key} />
      {hint ? <span className="mt-1 block text-[12px] text-[#9b9fb3]">{hint}</span> : null}
    </label>
  );
  return (
    <div className="mt-5 space-y-6" data-crm-lifecycle-form>
      <label className="flex items-center gap-3 text-[14px] text-[#0b1024]">
        <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} className="size-4 accent-[#5566f6]" name="enabled" />
        Сценарий включён: письма со счётом и задачи ставятся сами
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={field}>
          Кому задачи по умолчанию
          <select value={form.assigneeId ?? ""} onChange={(event) => setForm({ ...form, assigneeId: event.target.value || null })} className={`${INPUT} mt-1`} name="assigneeId">
            <option value="">РОП (общая очередь)</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[12px] text-[#9b9fb3]">У клиента с закреплённым менеджером задачи и письма идут от него.</span>
        </label>
        <label className={field}>
          Кто согласует скидку сверх лимита
          <select value={form.approverId ?? ""} onChange={(event) => setForm({ ...form, approverId: event.target.value || null })} className={`${INPUT} mt-1`} name="approverId">
            <option value="">Коммерческий директор, затем самый большой лимит</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[12px] text-[#9b9fb3]">Лимиты скидки ролей — в «Команде». Свою заявку никто не согласует сам.</span>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {numberInput("trialFirstWorkdays", "Первое письмо, рабочих дней до конца пробного")}
        {numberInput("trialSecondWorkdays", "Второе письмо, рабочих дней")}
        {numberInput("graceLastWorkdays", "«Последний шанс», рабочих дней до конца отсрочки")}
        {numberInput("approvalSeats", "Скидка через согласование — от сотрудников")}
        {numberInput("renewalEarlyDays", "Годовым — «оплатите заранее», дней")}
        {numberInput("invoiceAheadWorkdays", "Счёт на продление по безналу, рабочих дней")}
        {numberInput("winbackDays", "«Вернуть на платный» — дней на бесплатном")}
        <label className={field}>
          Счёт к письму пробного
          <select value={form.invoiceCycle} onChange={(event) => setForm({ ...form, invoiceCycle: event.target.value === "year" ? "year" : "month" })} className={`${INPUT} mt-1`} name="invoiceCycle">
            <option value="month">На месяц</option>
            <option value="year">На год</option>
          </select>
          <span className="mt-1 block text-[12px] text-[#9b9fb3]">В письме — обе цены и выгода за год.</span>
        </label>
      </div>
      <div>
        <div className="text-[13px] text-[#3c4053]">Скидка в КП по числу сотрудников (меньше первого порога — без скидки)</div>
        <div className="mt-2 flex flex-wrap gap-3">
          {form.discounts.map((item, index) => (
            <div key={index} className="flex items-center gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3 py-2 text-[13px] text-[#3c4053]">
              от
              <input value={item.minSeats} onChange={band(index, "minSeats")} className={`${INPUT} h-9 w-20`} inputMode="numeric" aria-label="Сотрудников от" />
              чел. —
              <input value={item.percent} onChange={band(index, "percent")} className={`${INPUT} h-9 w-16`} inputMode="numeric" aria-label="Скидка, %" />%
              <button type="button" onClick={() => setForm({ ...form, discounts: form.discounts.filter((_, i) => i !== index) })} className="rounded-full p-1 text-[#9b9fb3] hover:bg-white hover:text-[#a13a32]" aria-label="Убрать порог">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          {form.discounts.length < 6 ? (
            <button type="button" onClick={() => setForm({ ...form, discounts: [...form.discounts, { minSeats: (form.discounts.at(-1)?.minSeats ?? 0) + 10, percent: 0 }] })} className={SECONDARY_BUTTON}>
              <Plus className="size-4" />
              Порог
            </button>
          ) : null}
        </div>
      </div>
      <button type="button" onClick={save} disabled={busy} className={PRIMARY_BUTTON} data-crm-lifecycle-save>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        Сохранить настройки
      </button>
    </div>
  );
}
