import type React from "react";

/**
 * Общие примитивы раздела «Баланс и бонусы»: карточка секции, поля,
 * кнопки и пилюли в двух палитрах — сайт и Mini App (variant="mini").
 * Вынесены из balance-client.tsx, чтобы блок пополнения
 * (topup-section.tsx) выглядел так же, не копируя классы.
 */

export const miniCard: React.CSSProperties = {
  background: "var(--mini-card-solid-bg)",
  border: "1px solid var(--mini-divider)",
};
export const miniInput: React.CSSProperties = {
  background: "var(--mini-surface-2)",
  color: "var(--mini-text)",
  border: "1px solid var(--mini-divider)",
};
export const miniPrimary: React.CSSProperties = {
  background: "var(--mini-lime)",
  color: "var(--mini-primary-contrast)",
};
export const miniSecondary: React.CSSProperties = {
  background: "var(--mini-surface-2)",
  color: "var(--mini-text)",
  border: "1px solid var(--mini-divider)",
};

export function inputClass(mini: boolean): string {
  return mini
    ? "h-11 w-full rounded-2xl px-4 text-[15px] outline-none focus:ring-2 focus:ring-[color:var(--mini-lime-strong)]"
    : "h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
}

export function primaryButtonClass(mini: boolean): string {
  return mini
    ? "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl px-5 text-[14px] font-medium disabled:opacity-50"
    : "inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60";
}

export function secondaryButtonClass(mini: boolean): string {
  return mini
    ? "inline-flex h-10 items-center gap-2 rounded-2xl px-4 text-[13.5px] font-medium disabled:opacity-50"
    : "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-60";
}

export function StatusPill({
  tone,
  mini,
  children,
}: {
  tone: "muted" | "info" | "ok";
  mini: boolean;
  children: React.ReactNode;
}) {
  if (mini) {
    const background =
      tone === "ok"
        ? "var(--mini-sage-soft)"
        : tone === "info"
          ? "var(--mini-ice-soft)"
          : "var(--mini-surface-3)";
    const color =
      tone === "ok"
        ? "var(--mini-sage)"
        : tone === "info"
          ? "var(--mini-ice)"
          : "var(--mini-text-muted)";
    return (
      <span
        className="rounded-full px-2.5 py-1 text-[11.5px] whitespace-nowrap"
        style={{ background, color }}
      >
        {children}
      </span>
    );
  }
  const cls =
    tone === "ok"
      ? "bg-[#ecfdf5] text-[#116b2a]"
      : tone === "info"
        ? "bg-[#eef1ff] text-[#3848c7]"
        : "bg-[#f5f6ff] text-[#6f7282]";
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11.5px] whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
}

export function Section({
  mini,
  icon,
  title,
  subtitle,
  children,
}: {
  mini: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={
        mini
          ? "rounded-2xl p-5"
          : "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7"
      }
      style={mini ? miniCard : undefined}
    >
      <div className="flex items-start gap-4">
        <span
          className={
            mini
              ? "flex size-11 shrink-0 items-center justify-center rounded-2xl"
              : "flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff]"
          }
          style={
            mini
              ? { background: "var(--mini-surface-3)", color: "var(--mini-text)" }
              : undefined
          }
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2
            className={
              mini
                ? "text-[16px] font-semibold"
                : "text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]"
            }
            style={mini ? { color: "var(--mini-text)" } : undefined}
          >
            {title}
          </h2>
          <p
            className={
              mini
                ? "mt-1 text-[13px] leading-relaxed"
                : "mt-1 max-w-[640px] text-[13.5px] leading-relaxed text-[#6f7282]"
            }
            style={mini ? { color: "var(--mini-text-muted)" } : undefined}
          >
            {subtitle}
          </p>
          {children ? <div className="mt-4">{children}</div> : null}
        </div>
      </div>
    </section>
  );
}
