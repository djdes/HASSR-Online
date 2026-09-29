"use client";

import type { ReactNode } from "react";
import { Bell, Mail, Send, Smartphone } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CHANNEL_LABELS,
  CHANNEL_STATUS_LABELS,
  MAILING_CHANNELS,
  type ChannelStatus,
  type MailingChannel,
  type MailingChannels,
} from "@/lib/mailing/labels";
import { cn } from "@/lib/utils";

/** Общие классы экрана «Рассылка» — рецепты дизайн-системы. */
export const CARD =
  "rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6";
export const SECTION_LABEL = "text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]";
export const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60";
export const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/20 disabled:opacity-60";
export const OUTLINE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60";
export const OUTLINE_SM =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60";
export const DANGER_SM =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[#ffd2cc] bg-[#fff4f2] px-3 text-[13px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#ffe9e5] disabled:opacity-60";
export const CHECKBOX = "size-4 shrink-0 cursor-pointer rounded border-[#dcdfed] accent-[#5566f6]";

export const CHANNEL_ICONS: Record<MailingChannel, typeof Mail> = {
  email: Mail,
  inApp: Bell,
  push: Smartphone,
  telegram: Send,
};

export function ChannelIcons({ channels, className }: { channels: MailingChannels; className?: string }) {
  const on = MAILING_CHANNELS.filter((c) => channels[c]);
  if (on.length === 0) return <span className="text-[12px] text-[#9b9fb3]">нет каналов</span>;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {on.map((c) => {
        const Icon = CHANNEL_ICONS[c];
        return (
          <span
            key={c}
            title={CHANNEL_LABELS[c]}
            className="inline-flex items-center gap-1 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[12px] text-[#3848c7]"
          >
            <Icon className="size-3.5" />
            {CHANNEL_LABELS[c]}
          </span>
        );
      })}
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  draft: "bg-[#f5f6ff] text-[#6f7282]",
  scheduled: "bg-[#eef1ff] text-[#3848c7]",
  sending: "bg-[#fff8eb] text-[#a16d32]",
  done: "bg-[#ecfdf5] text-[#116b2a]",
  cancelled: "bg-[#f5f6ff] text-[#6f7282]",
  queued: "bg-[#eef1ff] text-[#3848c7]",
  sent: "bg-[#ecfdf5] text-[#116b2a]",
  failed: "bg-[#fff4f2] text-[#a13a32]",
  skipped: "bg-[#f5f6ff] text-[#6f7282]",
  sending_channel: "bg-[#fff8eb] text-[#a16d32]",
};

export function StatusPill({ status, label, className }: { status: string; label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium",
        STATUS_TONE[status] ?? "bg-[#f5f6ff] text-[#6f7282]",
        className
      )}
    >
      {label}
    </span>
  );
}

export function ChannelStatusBadge({
  status,
  error,
  dryRun,
}: {
  status: ChannelStatus;
  error: string | null;
  dryRun?: boolean;
}) {
  return (
    <div className="min-w-0">
      <StatusPill
        status={status === "sending" ? "sending_channel" : status}
        label={`${CHANNEL_STATUS_LABELS[status]}${status === "sent" && dryRun ? " · сухая" : ""}`}
      />
      {error ? <div className="mt-1 text-[12px] leading-[1.4] text-[#6f7282] [overflow-wrap:anywhere]">{error}</div> : null}
    </div>
  );
}

/** Жёлтая/синяя/красная плашка с иконкой. */
export function Notice({
  tone,
  icon,
  children,
  testId,
}: {
  tone: "warn" | "info" | "danger";
  icon: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const tones = {
    warn: "border-[#f5d9a8] bg-[#fff8eb] text-[#7a4b12]",
    info: "border-[#d6dcff] bg-[#f5f6ff] text-[#3848c7]",
    danger: "border-[#ffd2cc] bg-[#fff4f2] text-[#a13a32]",
  };
  return (
    <div
      data-testid={testId}
      className={cn("flex items-start gap-3 rounded-2xl border px-4 py-3 text-[14px] leading-[1.55]", tones[tone])}
    >
      <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Select дизайн-системы для фильтров (значения — непустые строки). */
export function FilterSelect({
  value,
  onChange,
  options,
  label,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  label: string;
  testId?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[12px] font-medium text-[#6f7282]">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          data-testid={testId}
          className="h-11 w-full rounded-2xl border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] shadow-none focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
}

/** Ответ API: JSON или понятная ошибка. */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error ?? `Ошибка ${res.status}`);
  return data as T;
}
