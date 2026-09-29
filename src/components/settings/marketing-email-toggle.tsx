"use client";

import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";

type State = {
  email: string | null;
  subscribed: boolean;
  blockedReason: "bounced" | "manual" | null;
};

/**
 * «Новости и предложения» — вернуть или отключить рекламу WeSetup во всех
 * каналах рассылки: почта, колокольчик, push, Telegram. Отписка из письма
 * ставит выключено; включить обратно можно только здесь. Служебные письма
 * и уведомления о журналах переключатель не трогает.
 *
 * `variant="mini"` — в профиле мини-приложения (свои цвета темы).
 */
export function MarketingEmailToggle({ variant = "site" }: { variant?: "site" | "mini" }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/notifications/marketing", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: State | null) => alive && data && setState(data))
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, []);

  async function toggle(next: boolean) {
    if (!state) return;
    setBusy(true);
    const prev = state;
    setState({ ...state, subscribed: next });
    try {
      const res = await fetch("/api/notifications/marketing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscribed: next }),
      });
      if (!res.ok) throw new Error();
      setState((await res.json()) as State);
      toast.success(next ? "Новости и предложения включены" : "Новости и предложения выключены");
    } catch {
      setState(prev);
      toast.error("Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  // Ручную блокировку снимает только поддержка; «не принимает почту» касается
  // одного письма — колокольчик, push и Telegram переключатель по-прежнему включает.
  const disabled = !state || busy || state.blockedReason === "manual";
  const always = "Коды входа, счета и уведомления о журналах приходят всегда.";
  const hint = !state
    ? "Загружаем…"
    : state.blockedReason === "manual"
      ? `Реклама для ${state.email} отключена вручную — ни письмом, ни в колокольчик, push или Telegram. Напишите в поддержку, чтобы вернуть.`
      : state.blockedReason === "bounced"
        ? `Новости и акции WeSetup — в колокольчике, push и Telegram. Письма на ${state.email} не доходили — адрес в стоп-листе; напишите в поддержку, если он снова работает. ${always}`
        : !state.email
          ? `Новости и акции WeSetup — в колокольчике, push и Telegram. ${always}`
          : `Новости и акции WeSetup — письмом на ${state.email}, в колокольчике, push и Telegram. Выключите — не придут ни в один из них. ${always}`;

  const checked = Boolean(state?.subscribed);
  const switchEl = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Новости и предложения"
      disabled={disabled}
      onClick={() => void toggle(!checked)}
      data-testid="marketing-toggle"
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? "bg-[#5566f6]" : "bg-[#e4e5f0]"
      }`}
    >
      <span
        className={`inline-block size-5 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );

  if (variant === "mini") {
    return (
      <section className="mini-card p-4" data-testid="marketing-email-mini">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-semibold" style={{ color: "var(--mini-text)" }}>
              Новости и предложения
            </h2>
            <p className="mt-1 text-[14px] leading-[1.5]" style={{ color: "var(--mini-text-muted)" }}>
              {hint}
            </p>
          </div>
          {switchEl}
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
      data-testid="marketing-email"
    >
      <div className="flex items-center justify-between gap-6 px-6 py-5 md:px-8">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f5f6ff] text-[#5566f6]">
            <Megaphone className="size-4" />
          </div>
          <div>
            <div className="text-[15px] font-medium text-[#0b1024]">Новости и предложения</div>
            <div className="mt-1 text-[13px] text-[#6f7282]">{hint}</div>
          </div>
        </div>
        {switchEl}
      </div>
    </section>
  );
}
