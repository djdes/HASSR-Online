/**
 * Напоминания CRM: что и кому напомнить сейчас. Чистые функции — крон
 * (`notify.server.ts`) только достаёт контакты, «забирает» ключ и отправляет.
 *
 * Лестница «нет ответа клиенту»: 30 минут — ответственному (нет его — РОП),
 * 4 часа — РОП; через 7 дней молчим. Онлайн-чат пропускает первый шаг: там
 * свой сигнал поддержке через 15 минут (`support-unanswered`). «Клиент молчит»
 * — 3 дня после нашего ответа, если следующий шаг не назначен. Следующий
 * шаг — в его срок. Всё только с 9 до 21 по Москве: ночью напоминание ждёт
 * утра, потому что условие к утру никуда не денется.
 */

import {
  CRM_DIGEST_HOUR,
  CRM_ESCALATION_MS,
  CRM_FIRST_REMINDER_MS,
  CRM_GIVE_UP_MS,
  CRM_NEXT_ACTION_GIVE_UP_MS,
  CRM_SILENT_AFTER_MS,
  CRM_SILENT_GIVE_UP_MS,
  CRM_WORK_HOURS,
  MOSCOW_OFFSET_MS,
  QUIET_STAGES,
  crmChannelLabel,
} from "@/lib/crm/constants";

export type ReminderContact = {
  id: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  stage: string;
  ownerId: string | null;
  awaitingSince: Date | null;
  awaitingChannel: string | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  nextActionAt: Date | null;
  nextActionNote: string | null;
};

export type ReminderKind = "unanswered" | "escalation" | "silent" | "next_action";

export type PlannedReminder = {
  kind: ReminderKind;
  contactId: string;
  dedupeKey: string;
  /** Ответственному (если он есть). */
  toOwner: boolean;
  /** РОП: всегда при эскалации, иначе — когда ответственного нет. */
  toHeads: boolean;
};

export function moscowHour(now: Date): number {
  return new Date(now.getTime() + MOSCOW_OFFSET_MS).getUTCHours();
}

/** Дата по Москве «2026-11-07» — ключ ежедневной сводки. */
export function moscowDateKey(now: Date): string {
  return new Date(now.getTime() + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

export function isWorkingTime(now: Date): boolean {
  const hour = moscowHour(now);
  return hour >= CRM_WORK_HOURS.start && hour < CRM_WORK_HOURS.end;
}

/** Сводку шлём в первый прогон после 9:00 по Москве (и до конца рабочего дня). */
export function isDigestTime(now: Date): boolean {
  const hour = moscowHour(now);
  return hour >= CRM_DIGEST_HOUR && hour < CRM_WORK_HOURS.end;
}

export function planReminders(contacts: readonly ReminderContact[], now: Date): PlannedReminder[] {
  if (!isWorkingTime(now)) return [];
  const planned: PlannedReminder[] = [];
  const at = now.getTime();
  for (const contact of contacts) {
    if (QUIET_STAGES.has(contact.stage)) continue;
    const hasOwner = Boolean(contact.ownerId);

    if (contact.awaitingSince) {
      const age = at - contact.awaitingSince.getTime();
      const since = contact.awaitingSince.toISOString();
      if (age >= CRM_ESCALATION_MS && age <= CRM_GIVE_UP_MS) {
        planned.push({ kind: "escalation", contactId: contact.id, dedupeKey: `crm:escalation:${contact.id}:${since}`, toOwner: true, toHeads: true });
      } else if (age >= CRM_FIRST_REMINDER_MS && age < CRM_ESCALATION_MS && contact.awaitingChannel !== "chat") {
        planned.push({ kind: "unanswered", contactId: contact.id, dedupeKey: `crm:unanswered:${contact.id}:${since}`, toOwner: true, toHeads: !hasOwner });
      }
    }

    if (contact.nextActionAt) {
      const overdue = at - contact.nextActionAt.getTime();
      if (overdue >= 0 && overdue <= CRM_NEXT_ACTION_GIVE_UP_MS) {
        planned.push({
          kind: "next_action",
          contactId: contact.id,
          dedupeKey: `crm:next:${contact.id}:${contact.nextActionAt.toISOString()}`,
          toOwner: true,
          toHeads: !hasOwner,
        });
      }
      // Шаг назначен (в будущем или уже напомнили) — «молчит» не нужен.
      continue;
    }

    const silentFrom = contact.lastOutboundAt;
    if (
      !contact.awaitingSince &&
      silentFrom &&
      (contact.stage === "new" || contact.stage === "in_work") &&
      (!contact.lastInboundAt || contact.lastInboundAt.getTime() < silentFrom.getTime())
    ) {
      const silence = at - silentFrom.getTime();
      if (silence >= CRM_SILENT_AFTER_MS && silence <= CRM_SILENT_GIVE_UP_MS) {
        planned.push({ kind: "silent", contactId: contact.id, dedupeKey: `crm:silent:${contact.id}:${silentFrom.toISOString()}`, toOwner: true, toHeads: !hasOwner });
      }
    }
  }
  return planned;
}

export function contactTitle(contact: { name: string | null; company: string | null; email: string | null; phone: string | null }): string {
  const who = contact.name?.trim() || contact.email || contact.phone || "Без имени";
  return contact.company?.trim() ? `${who} · ${contact.company.trim()}` : who;
}

function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ч`;
  return `${Math.round(hours / 24)} дн`;
}

/** Текст напоминания для Telegram (HTML) и тема письма. */
export function composeReminder(args: {
  kind: ReminderKind;
  contact: ReminderContact;
  now: Date;
  appUrl: string;
  ownerName?: string | null;
  escape: (value: string) => string;
}): { subject: string; text: string } {
  const { contact, escape } = args;
  const title = contactTitle(contact);
  const link = `${args.appUrl}/root/crm/contacts/${contact.id}`;
  const contacts = [contact.phone, contact.email].filter(Boolean).join(" · ");
  let head: string;
  let detail: string;
  switch (args.kind) {
    case "unanswered":
    case "escalation": {
      const waited = duration(args.now.getTime() - (contact.awaitingSince?.getTime() ?? args.now.getTime()));
      const channel = contact.awaitingChannel ? crmChannelLabel(contact.awaitingChannel) : "обращение";
      head = args.kind === "escalation" ? `🔥 Клиент ждёт ответа ${waited}` : `⏰ Нет ответа клиенту ${waited}`;
      detail = `Канал: ${channel}${args.kind === "escalation" ? `. Ответственный: ${args.ownerName ?? "не назначен"}` : ""}`;
      break;
    }
    case "silent": {
      const silence = duration(args.now.getTime() - (contact.lastOutboundAt?.getTime() ?? args.now.getTime()));
      head = `🤫 Клиент молчит ${silence} после нашего ответа`;
      detail = "Напомните о себе или поставьте следующий шаг.";
      break;
    }
    case "next_action":
      head = "📌 Пора: следующий шаг по клиенту";
      detail = contact.nextActionNote?.trim() ? `Шаг: ${contact.nextActionNote.trim()}` : "Шаг без описания — откройте карточку.";
      break;
  }
  const text = [
    `<b>${escape(head)}</b>`,
    `👤 ${escape(title)}`,
    contacts ? `📇 ${escape(contacts)}` : "",
    escape(detail),
    `<a href="${link}">Открыть в CRM</a>`,
  ]
    .filter(Boolean)
    .join("\n");
  return { subject: `CRM: ${head.replace(/^\S+\s/, "")} — ${title}`, text };
}

export type CrmDigestData = {
  dateLabel: string;
  awaiting: number;
  overdue: number;
  newLeads: number;
  newByChannel: { channel: string; count: number }[];
  nextToday: number;
  nextOverdue: number;
  silent: number;
  filtered: number;
};

/** Утренняя сводка РОП: Telegram-HTML. Пустой день — тоже сводка: «всё разобрано». */
export function composeDigest(data: CrmDigestData, appUrl: string, escape: (value: string) => string): { subject: string; text: string } {
  const channels = data.newByChannel
    .filter((item) => item.count > 0)
    .map((item) => `${crmChannelLabel(item.channel)} — ${item.count}`)
    .join(", ");
  const lines = [
    `<b>📊 CRM на ${escape(data.dateLabel)}</b>`,
    `Ждут ответа: <b>${data.awaiting}</b>${data.overdue ? ` (дольше 4 ч — ${data.overdue})` : ""}`,
    `Новых обращений за сутки: <b>${data.newLeads}</b>${channels ? ` — ${escape(channels)}` : ""}`,
    `Следующие шаги на сегодня: ${data.nextToday}${data.nextOverdue ? `, просрочено — ${data.nextOverdue}` : ""}`,
    data.silent ? `Молчат после нашего ответа 3+ дня: ${data.silent}` : "",
    data.filtered ? `Отсеяно писем за сутки: ${data.filtered} — проверьте, не попало ли нужное` : "",
    data.awaiting === 0 && data.nextOverdue === 0 ? "Очередь разобрана — можно заниматься новыми лидами." : "",
    `<a href="${appUrl}/root/crm">Открыть CRM</a>`,
  ];
  return { subject: `CRM: сводка на ${data.dateLabel}`, text: lines.filter(Boolean).join("\n") };
}

/** Новое письмо в рабочую почту: новый лид (→ РОП) или ответ по контакту (→ ответственному). */
export function composeNewMailAlert(args: {
  contactId: string;
  isNewContact: boolean;
  fromName: string | null;
  fromAddress: string;
  subject: string | null;
  preview: string;
  appUrl: string;
  escape: (value: string) => string;
}): { subject: string; text: string } {
  const head = args.isNewContact ? "📨 Новое обращение на почту" : "💬 Клиент ответил на почту";
  const who = args.fromName ? `${args.fromName} <${args.fromAddress}>` : args.fromAddress;
  const text = [
    `<b>${head}</b>`,
    `👤 ${args.escape(who)}`,
    args.subject ? `Тема: ${args.escape(args.subject)}` : "",
    args.preview ? args.escape(args.preview) : "",
    `<a href="${args.appUrl}/root/crm/contacts/${args.contactId}">Открыть в CRM</a>`,
  ]
    .filter(Boolean)
    .join("\n");
  return { subject: `CRM: ${head.replace(/^\S+\s/, "")} — ${who}`, text };
}
