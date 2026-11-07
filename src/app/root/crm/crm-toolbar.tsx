"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MANUAL_LEAD_CHANNELS, crmChannelLabel } from "@/lib/crm/constants";
import { INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON, TEXTAREA } from "./crm-ui";

type CycleResult = {
  ok: boolean;
  sources: { source: string; created: number }[];
  mailboxes: { label: string; inbox: number; filtered: number; error?: string }[];
  reminders: { sent: number };
  errors: string[];
};

/** «Обновить сейчас»: тот же прогон, что крон каждые 5 минут. */
export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const response = await fetch("/api/root/crm/sync", { method: "POST" });
      const data = (await response.json().catch(() => null)) as CycleResult | null;
      if (!response.ok || !data) throw new Error();
      const created = data.sources.reduce((sum, item) => sum + item.created, 0);
      const mail = data.mailboxes.reduce((sum, item) => sum + item.inbox, 0);
      const description = [`Новых записей: ${created + mail}`, data.mailboxes.length ? `писем: ${mail}` : "почта не подключена", `напоминаний: ${data.reminders.sent}`].join(" · ");
      if (data.errors.length) toast.warning("Обновлено, но не всё", { description: data.errors.join("; ") });
      else toast.success("CRM обновлена", { description });
      router.refresh();
    } catch {
      toast.error("Не удалось обновить — попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={run} disabled={busy} className={SECONDARY_BUTTON} data-crm-sync>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      Обновить сейчас
    </button>
  );
}

/** Лид, которого нет ни в одном канале API: WhatsApp, VK, MAX, звонок. */
export function AddLeadButton({ primary = false }: { primary?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", company: "", phone: "", email: "", channel: "whatsapp", message: "" });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function save() {
    const response = await fetch("/api/root/crm/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!response.ok || !data?.id) {
      toast.error(data?.error ?? "Не удалось сохранить лид");
      return;
    }
    toast.success("Лид сохранён — вы ответственный");
    setOpen(false);
    router.push(`/root/crm/contacts/${data.id}`);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={primary ? PRIMARY_BUTTON : SECONDARY_BUTTON} data-crm-add-lead>
        <UserPlus className="size-4" />
        Добавить лид
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={save}
        title="Новый лид"
        description="Для обращений из WhatsApp, ВКонтакте, MAX, по телефону — того, что не приходит в CRM само. Если такой контакт уже есть (по телефону или почте), запись добавится в его переписку."
        icon={UserPlus}
        confirmLabel="Сохранить лид"
        cancelLabel="Отмена"
        confirmDisabled={!form.message.trim() || (!form.phone.trim() && !form.email.trim())}
      >
        <div className="grid gap-3 sm:grid-cols-2" data-crm-lead-form>
          <label className="block text-[13px] text-[#3c4053]">
            Откуда
            <select value={form.channel} onChange={set("channel")} className={`${INPUT} mt-1`} name="channel">
              {MANUAL_LEAD_CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {crmChannelLabel(channel)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[13px] text-[#3c4053]">
            Имя
            <input value={form.name} onChange={set("name")} className={`${INPUT} mt-1`} placeholder="Иван Петров" name="name" />
          </label>
          <label className="block text-[13px] text-[#3c4053]">
            Телефон
            <input value={form.phone} onChange={set("phone")} className={`${INPUT} mt-1`} placeholder="+7 900 000-00-00" inputMode="tel" name="phone" />
          </label>
          <label className="block text-[13px] text-[#3c4053]">
            Почта
            <input value={form.email} onChange={set("email")} className={`${INPUT} mt-1`} placeholder="ivan@cafe.ru" inputMode="email" name="email" />
          </label>
          <label className="block text-[13px] text-[#3c4053] sm:col-span-2">
            Компания
            <input value={form.company} onChange={set("company")} className={`${INPUT} mt-1`} placeholder="Кафе «Ромашка»" name="company" />
          </label>
          <label className="block text-[13px] text-[#3c4053] sm:col-span-2">
            Что написал или о чём просил
            <textarea value={form.message} onChange={set("message")} className={`${TEXTAREA} mt-1`} placeholder="Сколько стоит на 3 точки, нужен ли принтер…" name="message" />
          </label>
        </div>
      </ConfirmDialog>
    </>
  );
}
