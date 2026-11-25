"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("notificationSettings.marketing");
  const feedback = useRef(t);
  useEffect(() => { feedback.current = t; }, [t]);
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
      toast.success(feedback.current(next ? "enabled" : "disabled"));
    } catch {
      setState(prev);
      toast.error(feedback.current("saveError"));
    } finally {
      setBusy(false);
    }
  }

  // Ручную блокировку снимает только поддержка; «не принимает почту» касается
  // одного письма — колокольчик, push и Telegram переключатель по-прежнему включает.
  const disabled = !state || busy || state.blockedReason === "manual";
  // Под тумблером — только то, что мешает: блокировка или недоходящие письма.
  // Оговорка «служебные приходят всегда» — тостом при выключении.
  const hint =
    state?.blockedReason === "manual"
      ? t("manual")
      : state?.blockedReason === "bounced" && state.email
        ? t("bounced", { email: state.email })
        : null;

  const checked = Boolean(state?.subscribed);
  const mini = variant === "mini";
  const switchEl = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={t("title")}
      disabled={disabled}
      onClick={() => void toggle(!checked)}
      data-testid="marketing-toggle"
      // В мини-приложении цвета дорожки и кольцо фокуса — от темы
      // (`.mini-switch` в mini-theme.css): светлая дорожка сайта на тёмной
      // карточке резала глаз, а белое кольцо-отступ рисовалось поверх неё.
      className={
        mini
          ? "mini-switch"
          : `relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
              checked ? "bg-[#5566f6]" : "bg-[#e4e5f0]"
            }`
      }
    >
      <span
        className={`inline-block size-5 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );

  if (mini) {
    // Общая строка карточки профиля (`.mini-row`): заголовок слева,
    // тумблер справа по центру — как «Face ID» и «Язык интерфейса».
    return (
      <section className="mini-card p-4" data-testid="marketing-email-mini">
        <div className="mini-row">
          <div>
            <h2 className="mini-card-title">{t("title")}</h2>
            {hint ? <p className="mini-row-hint">{hint}</p> : null}
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
        <div className="flex items-center gap-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f5f6ff] text-[#5566f6]">
            <Megaphone className="size-4" />
          </div>
          <div>
            <div className="text-[15px] font-medium text-[#0b1024]">{t("title")}</div>
            {hint ? <div className="mt-1 text-[13px] text-[#6f7282]">{hint}</div> : null}
          </div>
        </div>
        {switchEl}
      </div>
    </section>
  );
}
