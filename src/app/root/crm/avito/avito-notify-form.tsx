"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AVITO_NOTIFY_CHATS_MAX, type AvitoNotifySettings } from "@/lib/avito/notify";
import { cn } from "@/lib/utils";
import { CARD, INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../crm-ui";

/** Кому слать уведомления Авито в Telegram и при каком остатке аванса напоминать. */
export function AvitoNotifyForm({
  initial,
  canEdit,
  heads,
}: {
  initial: AvitoNotifySettings;
  canEdit: boolean;
  heads: { name: string; telegram: boolean }[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);

  const setChat = (index: number, key: "chatId" | "label", value: string) =>
    setForm((current) => ({ ...current, chats: current.chats.map((chat, i) => (i === index ? { ...chat, [key]: value } : chat)) }));

  async function save() {
    setBusy(true);
    try {
      const response = await fetch("/api/root/crm/avito", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, chats: form.chats.filter((chat) => chat.chatId.trim()) }),
      });
      const data = (await response.json().catch(() => null)) as { settings?: AvitoNotifySettings; error?: string } | null;
      if (!response.ok || !data?.settings) throw new Error(data?.error || "Не удалось сохранить");
      setForm(data.settings);
      toast.success("Сохранено");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cn(CARD, "space-y-4 p-5")} data-avito-notify>
      <div>
        <h2 className="text-[16px] font-semibold text-[#0b1024]">Уведомления в Telegram</h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-[#6f7282]">
          Новое сообщение в Авито приходит сразу, в любое время: РОП
          {heads.length ? ` (${heads.map((head) => `${head.name}${head.telegram ? "" : " — Telegram не привязан"}`).join(", ")})` : " — не назначен"}, ответственному за
          контакт и людям из списка ниже. Если аванс опустится ниже порога, напоминание приходит раз в день, с 9 до 21 по Москве.
        </p>
      </div>

      <div className="space-y-2">
        {form.chats.map((chat, index) => (
          <div key={index} className="flex flex-wrap gap-2">
            <input
              value={chat.chatId}
              onChange={(event) => setChat(index, "chatId", event.target.value)}
              placeholder="chat_id, например 66092185"
              inputMode="numeric"
              disabled={!canEdit}
              className={cn(INPUT, "w-[220px]")}
            />
            <input
              value={chat.label}
              onChange={(event) => setChat(index, "label", event.target.value)}
              placeholder="Подпись, например @djdes"
              disabled={!canEdit}
              className={cn(INPUT, "w-[220px] flex-1")}
            />
            {canEdit ? (
              <button
                type="button"
                aria-label="Убрать"
                onClick={() => setForm((current) => ({ ...current, chats: current.chats.filter((_, i) => i !== index) }))}
                className={cn(SECONDARY_BUTTON, "h-11 px-3")}
              >
                <Trash2 className="size-4" />
              </button>
            ) : null}
          </div>
        ))}
        {canEdit && form.chats.length < AVITO_NOTIFY_CHATS_MAX ? (
          <button
            type="button"
            onClick={() => setForm((current) => ({ ...current, chats: [...current.chats, { chatId: "", label: "" }] }))}
            className={SECONDARY_BUTTON}
          >
            <Plus className="size-4" />
            Добавить получателя
          </button>
        ) : null}
      </div>

      <label className="flex flex-wrap items-center gap-3 text-[14px] text-[#3c4053]">
        Напоминать, когда аванс ниже
        <input
          type="number"
          min={0}
          step={100}
          value={form.lowBalanceRub}
          onChange={(event) => setForm((current) => ({ ...current, lowBalanceRub: Number(event.target.value) || 0 }))}
          disabled={!canEdit}
          className={cn(INPUT, "w-[140px]")}
        />
        ₽ <span className="text-[12.5px] text-[#9b9fb3]">(0 — не напоминать)</span>
      </label>

      {canEdit ? (
        <button type="button" onClick={save} disabled={busy} className={PRIMARY_BUTTON}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Сохранить
        </button>
      ) : (
        <p className="text-[12.5px] text-[#9b9fb3]">Менять получателей может владелец платформы.</p>
      )}
    </section>
  );
}
