"use client";

import { useState } from "react";
import { Loader2, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Props = {
  initialEmail: string | null;
};

export function AccountingClient({ initialEmail }: Props) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [saved, setSaved] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

  async function save() {
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Введите email");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/accountant-email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      toast.success(`Сохранено: ${trimmed}`);
      setSaved(trimmed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/accountant-email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: null }),
      });
      if (!res.ok) throw new Error("Ошибка");
      toast.success("Рассылка отключена");
      setSaved(null);
      setEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#f5f6ff] text-[#3848c7]">
          <Mail className="size-5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-[#0b1024]">
            Email бухгалтера
          </div>
          {saved ? (
            <p className="mt-1 text-[13px] text-[#6f7282]">
              Подключено:{" "}
              <span className="font-mono text-[#3848c7]">{saved}</span>{" "}
              · ближайший отчёт — понедельник 09:00 МСК
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-[#6f7282]">
              Введите адрес — на него начнут приходить еженедельные CSV
              со списаниями.
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="accountant@yourcompany.ru"
          className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />
        <button
          type="button"
          onClick={save}
          disabled={busy || !email.trim() || email.trim() === saved}
          className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {saved ? "Сохранить" : "Подключить"}
        </button>
        {saved ? (
          <button
            type="button"
            onClick={() => setConfirmDisconnectOpen(true)}
            disabled={busy}
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#a13a32] hover:bg-[#fff4f2] disabled:opacity-50"
          >
            <Trash2 className="size-4" />
            Отключить
          </button>
        ) : null}
      </div>

      <div className="mt-5 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[12px] leading-relaxed text-[#6f7282]">
        <span className="font-medium text-[#0b1024]">Что в письме:</span>{" "}
        вложение CSV с колонками Дата / Категория / Продукт / Кол-во /
        Ед.изм / Сумма ₽ / Причина. Кодировка UTF-8 BOM, разделитель
        «;», даты в формате ДД.ММ.ГГГГ. Если за неделю не было
        списаний — письмо не отправляется.
      </div>

      {/* Нативный confirm() в приложении Telegram может не показаться —
          кнопка тогда молча не срабатывает (CLAUDE.md §6). */}
      <ConfirmDialog
        open={confirmDisconnectOpen}
        onClose={() => setConfirmDisconnectOpen(false)}
        onConfirm={async () => {
          setConfirmDisconnectOpen(false);
          await disconnect();
        }}
        title="Отключить рассылку бухгалтеру?"
        description={`Адрес ${saved ?? ""} перестанет получать еженедельный отчёт по списаниям.`}
        bullets={[
          { label: "Письма по понедельникам приходить перестанут", tone: "warn" },
          { label: "Сами списания и журналы остаются на месте", tone: "default" },
          { label: "Подключить обратно можно в любой момент", tone: "info" },
        ]}
        confirmLabel="Отключить"
        cancelLabel="Отмена"
        variant="warn"
      />
    </section>
  );
}
