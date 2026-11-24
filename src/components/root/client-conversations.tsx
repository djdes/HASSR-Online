"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ExternalLink, MessagesSquare, Paperclip } from "lucide-react";

import { ChannelIcon } from "@/app/root/crm/crm-ui";
import { crmChannelLabel } from "@/lib/crm/constants";
import type { ClientConversations as Data, ConversationItem } from "@/lib/client-conversations.server";
import { cn } from "@/lib/utils";
import { ScrollList } from "@/components/ui/scroll-list";

/**
 * Вкладка «Переписки» карточки клиента: всё общение по времени — письма,
 * звонки с записью и расшифровкой, чат, Telegram, MAX, заметки.
 * Фильтр по виду — чипами сверху; новые записи сверху. Письма сайта
 * (автоматические и рассылки) — из журнала исходящих писем. Лента
 * прокручивается внутри блока.
 */
type Filter = "all" | "email" | "site" | "call" | "chat" | "messengers" | "avito" | "note";

/** Письмо сайта: автоматическое (напоминание, приветствие, счёт) или рассылка. */
const isSiteMail = (item: ConversationItem) => Boolean(item.automatic);

const FILTERS: { id: Filter; label?: string; match: (item: ConversationItem) => boolean }[] = [
  { id: "all", label: "Все", match: () => true },
  { id: "email", label: "Почта", match: (item) => item.channel === "email" },
  { id: "site", match: isSiteMail },
  { id: "call", label: "Звонки", match: (item) => item.channel === "call" || item.channel === "phone" || Boolean(item.call) },
  { id: "chat", label: "Чат на сайте", match: (item) => item.channel === "chat" || item.channel === "feedback" },
  { id: "messengers", label: "Telegram и MAX", match: (item) => ["telegram", "max", "whatsapp", "vk"].includes(item.channel) },
  { id: "avito", label: "Авито", match: (item) => item.channel === "avito" },
  { id: "note", label: "Заметки и события", match: (item) => item.direction === "note" || item.direction === "event" },
];

const TONE: Record<string, string> = {
  in: "border-[#dfe3ff] bg-[#f7f8ff]",
  out: "border-[#d7efe1] bg-[#f4fbf7]",
  note: "border-[#ececf4] bg-[#fafafc]",
  event: "border-[#ececf4] bg-white",
};

const DAY = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", weekday: "short", timeZone: "Europe/Moscow" });
const TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

function who(item: ConversationItem, site: { automatic: string; mailing: string }): string {
  if (item.automatic) return item.source === "mailing" ? site.mailing : site.automatic;
  if (item.direction === "in") return item.contactName ? `Клиент · ${item.contactName}` : "Клиент";
  if (item.direction === "out") return item.authorName ? `Мы · ${item.authorName}` : "Мы";
  if (item.direction === "note") return item.authorName ? `Заметка · ${item.authorName}` : "Заметка";
  return "Событие";
}

function duration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m} мин ${s.toString().padStart(2, "0")} с` : `${s} с`;
}

const TRANSCRIPT_STATUS: Record<string, string> = {
  pending: "Расшифровка появится через несколько минут.",
  failed: "Расшифровать запись не получилось.",
  skipped: "Разговор слишком короткий — без расшифровки.",
};

function CallBlock({ item }: { item: ConversationItem }) {
  const call = item.call;
  if (!call) return null;
  return (
    <div className="mt-2 space-y-2">
      <div className="text-[12.5px] text-[#6f7282]">
        {call.flow === "in" ? "Входящий" : "Исходящий"}
        {call.durationSec ? ` · ${duration(call.durationSec)}` : ""}
        {call.employeeName ? ` · ${call.employeeName}` : ""}
      </div>
      {call.audio && item.contactId ? (
        <audio controls preload="none" src={`/api/root/crm/contacts/${encodeURIComponent(item.contactId)}/calls/${encodeURIComponent(call.id)}`} className="h-10 w-full max-w-md">
          Браузер не умеет проигрывать запись.
        </audio>
      ) : call.audioStatus !== "none" ? (
        <p className="text-[12.5px] text-[#6f7282]">{call.audioStatus === "failed" ? "Запись не удалось забрать из Телфина." : "Запись загружается из Телфина…"}</p>
      ) : null}
      {call.transcript ? (
        <details className="rounded-xl border border-[#ececf4] bg-white/70 px-3 py-2" open>
          <summary className="cursor-pointer select-none text-[12.5px] font-medium text-[#3848c7]">Расшифровка разговора</summary>
          <p className="mt-1.5 whitespace-pre-line break-words text-[13px] leading-relaxed text-[#0b1024]">{call.transcript}</p>
        </details>
      ) : call.audio && TRANSCRIPT_STATUS[call.transcriptStatus] ? (
        <p className="text-[12.5px] text-[#6f7282]">{TRANSCRIPT_STATUS[call.transcriptStatus]}</p>
      ) : null}
    </div>
  );
}

function Body({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 600;
  return (
    <>
      <p className="mt-1 whitespace-pre-line break-words text-[13.5px] leading-relaxed text-[#0b1024]">{long && !open ? `${text.slice(0, 600).trimEnd()}…` : text}</p>
      {long ? (
        <button type="button" onClick={() => setOpen((value) => !value)} className="mt-1 text-[12.5px] font-medium text-[#3848c7] hover:underline">
          {open ? "Свернуть" : "Показать полностью"}
        </button>
      ) : null}
    </>
  );
}

export function ClientConversations({ data }: { data: Data }) {
  const t = useTranslations("rootOrganizationManagement.conversationFeed");
  const site = { automatic: t("automatic"), mailing: t("mailing") };
  const [filter, setFilter] = useState<Filter>("all");
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, data.items.filter(f.match).length])), [data.items]);
  const items = useMemo(() => data.items.filter(FILTERS.find((f) => f.id === filter)!.match), [data.items, filter]);

  const groups: { day: string; items: ConversationItem[] }[] = [];
  for (const item of items) {
    const day = DAY.format(new Date(item.occurredAt));
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }

  return (
    <section id="conversations" className="scroll-mt-16 rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]" data-client-conversations>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ececf4] px-5 py-4 md:px-6">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <MessagesSquare className="size-5" />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">Переписки</h2>
            <p className="text-[12.5px] text-[#6f7282]">Почта, звонки с записью и расшифровкой, чат, Telegram, MAX и Авито — по времени</p>
          </div>
        </div>
        {data.contacts.length ? (
          <div className="flex flex-wrap gap-1.5 text-[12.5px]">
            {data.contacts.slice(0, 4).map((contact) => (
              <Link key={contact.id} href={`/root/crm/contacts/${contact.id}`} className="inline-flex items-center gap-1 rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[#3848c7] hover:bg-[#eef1ff]">
                CRM: {contact.name || contact.email || contact.phone} <ExternalLink className="size-3" />
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5 px-5 pt-4 md:px-6" role="tablist" aria-label="Вид переписки">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            disabled={f.id !== "all" && !counts[f.id]}
            className={cn(
              "h-8 rounded-full border px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              filter === f.id ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]" : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
            )}
          >
            {f.label ?? t("siteFilter")} <span className="tabular-nums text-[#9b9fb3]">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {items.length ? (
        // Лента длинная — прокручивается внутри блока, шапка и фильтры на месте.
        <ScrollList maxHeightClassName="max-h-[min(70vh,760px)]" className="mt-3">
        <div className="space-y-5 px-5 pb-5 pt-2 md:px-6 md:pb-6" data-conversations-feed>
          {groups.map((group) => (
            <div key={group.day}>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]">{group.day}</div>
              <ol className="space-y-2.5">
                {group.items.map((item) => (
                  <li key={item.id} className={cn("rounded-2xl border px-3.5 py-3", TONE[item.direction] ?? TONE.event)}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-[#3c4053]">
                        <ChannelIcon channel={item.call ? "call" : item.channel} className="size-3.5 shrink-0 text-[#5566f6]" />
                        <span className="truncate">
                          {crmChannelLabel(item.call ? "call" : item.channel)} · {who(item, site)}
                        </span>
                      </span>
                      <span className="text-[12px] tabular-nums text-[#6f7282]">{TIME.format(new Date(item.occurredAt))}</span>
                    </div>
                    {item.subject && !item.call ? <div className="mt-1 text-[13.5px] font-medium text-[#0b1024]">{item.subject}</div> : null}
                    {item.channel === "email" && item.fromAddress ? (
                      <div className="text-[12px] text-[#9b9fb3]">{item.direction === "out" ? `с ${item.fromAddress}${item.source !== "crm" && item.contactName ? ` → ${item.contactName}` : ""}` : item.fromAddress}</div>
                    ) : item.source === "mailing" && item.contactName ? (
                      <div className="text-[12px] text-[#9b9fb3]">→ {item.contactName}</div>
                    ) : null}
                    {item.body ? <Body text={item.body} /> : null}
                    {item.hiddenBody ? <p className="mt-1 text-[12.5px] text-[#6f7282]">{t("hiddenBody")}</p> : null}
                    {item.attachments?.length ? (
                      <p className="mt-1 flex items-start gap-1 break-all text-[12.5px] text-[#3c4053]">
                        <Paperclip className="mt-0.5 size-3.5 shrink-0 text-[#6f7282]" />
                        {t("attachments", { names: item.attachments.join(", ") })}
                      </p>
                    ) : null}
                    <CallBlock item={item} />
                    {item.status ? <p className="mt-1 text-[12.5px] text-[#a13a32]">{item.status}</p> : null}
                    {item.href ? (
                      <Link href={item.href} className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] text-[#3848c7] hover:underline">
                        Открыть <ExternalLink className="size-3" />
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {data.truncated && filter === "all" ? <p className="text-[12.5px] text-[#6f7282]">Показаны последние 400 записей — более старые в карточке CRM.</p> : null}
        </div>
        </ScrollList>
      ) : (
        <div className="m-5 rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center md:m-6">
          <div className="text-[15px] font-medium text-[#0b1024]">Переписки пока нет</div>
          <p className="mx-auto mt-1.5 max-w-[460px] text-[13px] text-[#6f7282]">
            Здесь появятся письма, звонки, чат и сообщения в мессенджерах с людьми этого клиента — CRM находит их по почтам и телефонам из «Как связаться».
          </p>
        </div>
      )}
    </section>
  );
}
