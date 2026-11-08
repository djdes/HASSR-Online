import { createElement } from "react";
import Link from "next/link";
import {
  AtSign,
  BadgeCheck,
  CalendarClock,
  FileDown,
  Handshake,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Mail,
  MessageCircle,
  MessageSquareText,
  NotebookPen,
  Phone,
  Receipt,
  Send,
  Sparkles,
  UserPlus,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { STAGE_TONE, channelLabel, stageLabel } from "./crm-format";

/** Общие куски экранов CRM (серверные компоненты). */

const TABS = [
  { href: "/root/crm", label: "Сводка", icon: LayoutDashboard, exact: true },
  { href: "/root/crm/contacts", label: "Контакты и переписка", icon: Inbox },
  { href: "/root/crm/mail", label: "Почта и фильтры", icon: Mail },
];

export function CrmHeader({ active, title, description, actions }: { active: string; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">{title}</h1>
          <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <nav aria-label="Разделы CRM" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {TABS.map((tab) => {
          const current = tab.exact ? active === tab.href : active.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-2xl px-3 text-[13.5px] transition-colors duration-150",
                current ? "bg-[#0b1024] font-medium text-white" : "border border-[#ececf4] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
              )}
            >
              <tab.icon className="size-4" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function StageBadge({ stage }: { stage: string }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium", STAGE_TONE[stage] ?? STAGE_TONE.new)}>{stageLabel(stage)}</span>;
}

const CHANNEL_ICONS: Record<string, LucideIcon> = {
  email: Mail,
  chat: MessageSquareText,
  feedback: MessageCircle,
  telegram: Send,
  demo: CalendarClock,
  service: Sparkles,
  invoice: Receipt,
  signup: UserPlus,
  blank: FileDown,
  partner: Handshake,
  whatsapp: MessageCircle,
  vk: AtSign,
  max: MessageCircle,
  phone: Phone,
  call: Phone,
  note: NotebookPen,
  resolved: BadgeCheck,
};

/** Иконка канала из справочника (не создаём компонент на каждом рендере). */
export function ChannelIcon({ channel, className }: { channel: string; className?: string }) {
  return createElement(CHANNEL_ICONS[channel] ?? MessageCircle, { className });
}

export function ChannelBadge({ channel }: { channel: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11.5px] text-[#3c4053]">
      <ChannelIcon channel={channel} className="size-3 text-[#5566f6]" />
      {channelLabel(channel)}
    </span>
  );
}

export const CARD = "rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";
export const ZONE_TITLE = "text-[12px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]";
export const SECONDARY_BUTTON =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60";
export const PRIMARY_BUTTON =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-60";
export const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] outline-none transition-colors placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15";
export const TEXTAREA =
  "min-h-[110px] w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 py-3 text-[14px] leading-relaxed text-[#0b1024] outline-none transition-colors placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15";
