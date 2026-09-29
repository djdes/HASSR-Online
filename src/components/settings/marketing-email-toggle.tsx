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
 * «Новости и предложения на почту» — вернуть или отключить рекламные
 * письма WeSetup. Отписка из письма ставит выключено; включить обратно
 * можно только здесь. Служебные письма переключатель не трогает.
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

  const disabled = !state || busy || !state.email || state.blockedReason !== null;
  const hint = !state
    ? "Загружаем…"
    : !state.email
      ? "У аккаунта нет настоящей почты — рекламных писем и так нет."
      : state.blockedReason === "bounced"
        ? `Письма на ${state.email} не доходили — адрес в стоп-листе. Напишите в поддержку, если он снова работает.`
        : state.blockedReason === "manual"
          ? `Адрес ${state.email} отключён от рассылок вручную. Напишите в поддержку, чтобы вернуть.`
          : `Письма о новых возможностях и акциях на ${state.email}. Коды входа, счета и уведомления о журналах приходят всегда.`;

  const checked = Boolean(state?.subscribed);
  const switchEl = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Новости и предложения на почту"
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
              Новости и предложения на почту
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
            <div className="text-[15px] font-medium text-[#0b1024]">Новости и предложения на почту</div>
            <div className="mt-1 text-[13px] text-[#6f7282]">{hint}</div>
          </div>
        </div>
        {switchEl}
      </div>
    </section>
  );
}
