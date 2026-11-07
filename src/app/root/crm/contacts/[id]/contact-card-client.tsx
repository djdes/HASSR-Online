"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Ban,
  Building2,
  CalendarClock,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquareText,
  NotebookPen,
  Pencil,
  Phone,
  Receipt,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CRM_STAGES } from "@/lib/crm/constants";
import { whatsappHref } from "@/lib/crm/identity";
import type { CrmContactCard } from "@/lib/crm/queries.server";
import { cn } from "@/lib/utils";
import { DIRECTION_LABEL, STAGE_TONE, channelLabel, displayName, formatAgo, formatDateTime, formatDue, fromMoscowInput, itemHeadline, stageLabel, toMoscowInput } from "../../crm-format";
import { CARD, INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON, TEXTAREA } from "../../crm-ui";

type Links = { feedback: boolean; proposals: boolean; invoices: boolean; organization: boolean; mailSettings: boolean };
type ComposerKind = "email" | "telegram" | "call" | "note";

const DIRECTION_TONE: Record<string, string> = {
  in: "border-[#dfe3ff] bg-[#f7f8ff]",
  out: "border-[#d7efe1] bg-[#f4fbf7]",
  note: "border-[#ececf4] bg-[#fafafc]",
  event: "border-[#ececf4] bg-white",
};

export function ContactCardClient({ card, viewerId, links, nowIso }: { card: CrmContactCard; viewerId: string; links: Links; nowIso: string }) {
  const router = useRouter();
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const { contact, interactions, organization, owners } = card;
  const [saving, setSaving] = useState<string | null>(null);
  const [nextAt, setNextAt] = useState(toMoscowInput(contact.nextActionAt));
  const [nextNote, setNextNote] = useState(contact.nextActionNote ?? "");
  const [editOpen, setEditOpen] = useState(false);
  const [spamOpen, setSpamOpen] = useState(false);
  const [details, setDetails] = useState({ name: contact.name ?? "", company: contact.company ?? "", email: contact.email ?? "", phone: contact.phone ?? "", note: contact.note ?? "" });
  const defaultKind: ComposerKind = contact.email ? "email" : contact.telegramChatId ? "telegram" : "call";
  const [kind, setKind] = useState<ComposerKind>(defaultKind);
  const lastSubject = interactions.find((item) => item.subject && item.channel === "email")?.subject ?? "";
  const [subject, setSubject] = useState(lastSubject ? (lastSubject.startsWith("Re:") ? lastSubject : `Re: ${lastSubject}`) : "WeSetup — электронные журналы ХАССП");
  const [body, setBody] = useState("");
  const wa = whatsappHref(contact.phone);
  // Лента новыми сверху: первое обращение — последний элемент, а не дата заведения карточки.
  const firstAt = interactions.length ? interactions[interactions.length - 1].occurredAt : contact.createdAt;
  const due = formatDue(contact.nextActionAt, now);

  async function patch(data: Record<string, unknown>, label: string, success: string) {
    setSaving(label);
    try {
      const response = await fetch(`/api/root/crm/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Не удалось сохранить");
      toast.success(success);
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function send(kindToSend: ComposerKind | "resolved") {
    setSaving(`send:${kindToSend}`);
    try {
      const response = await fetch(`/api/root/crm/contacts/${contact.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: kindToSend, subject: kindToSend === "email" ? subject : undefined, body: kindToSend === "resolved" ? "" : body }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string; note?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Не получилось");
      const done: Record<string, string> = { email: "Письмо отправлено", telegram: "Сообщение ушло в Telegram", call: "Звонок записан", note: "Заметка сохранена", resolved: "Отмечено: ответ не нужен" };
      toast.success(done[kindToSend], result?.note ? { description: result.note } : undefined);
      if (kindToSend !== "resolved") setBody("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не получилось");
    } finally {
      setSaving(null);
    }
  }

  function quickNext(days: number) {
    const date = new Date(now.getTime() + days * 86_400_000);
    const moscow = new Date(date.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
    setNextAt(`${moscow}T10:00`);
  }

  const composerTabs: { key: ComposerKind; label: string; icon: typeof Mail; disabled?: string }[] = [
    { key: "email", label: "Письмо", icon: Mail, disabled: contact.email ? undefined : "нет почты" },
    { key: "telegram", label: "Telegram", icon: Send, disabled: contact.telegramChatId ? undefined : "не писал боту" },
    { key: "call", label: "Звонок", icon: Phone },
    { key: "note", label: "Заметка", icon: NotebookPen },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-5">
        <section className={cn(CARD, "p-4 sm:p-5")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-[24px] font-semibold tracking-[-0.02em] text-[#0b1024]">{displayName(contact)}</h1>
              <p className="mt-0.5 text-[13.5px] text-[#6f7282]">
                {[contact.company !== contact.name ? contact.company : null, `первое обращение: ${channelLabel(contact.source)}, ${formatDateTime(firstAt)}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <button type="button" onClick={() => setEditOpen(true)} className={SECONDARY_BUTTON} data-crm-edit>
              <Pencil className="size-4" />
              Данные
            </button>
          </div>
          {contact.awaitingSince ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#f4e3c4] bg-[#fff8eb] px-3.5 py-2.5" data-crm-awaiting>
              <span className="text-[13.5px] text-[#7a4a00]">
                Клиент ждёт ответа {formatAgo(contact.awaitingSince, now)} ({channelLabel(contact.awaitingChannel ?? "")}).
              </span>
              <button type="button" onClick={() => send("resolved")} disabled={saving !== null} className="text-[13px] font-medium text-[#7a4a00] underline-offset-2 hover:underline" data-crm-resolve>
                Ответ не нужен
              </button>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Стадия">
            {CRM_STAGES.map((stage) => (
              <button
                key={stage}
                type="button"
                role="radio"
                aria-checked={contact.stage === stage}
                disabled={saving !== null}
                onClick={() => (stage === "spam" ? setSpamOpen(true) : contact.stage !== stage && patch({ stage }, "stage", `Стадия: ${stageLabel(stage)}`))}
                className={cn(
                  "h-8 rounded-full border px-3 text-[13px] transition-colors duration-150",
                  contact.stage === stage ? cn("border-transparent font-medium", STAGE_TONE[stage]) : "border-[#ececf4] bg-white text-[#3c4053] hover:border-[#5566f6]/40",
                )}
                data-crm-stage={stage}
              >
                {stageLabel(stage)}
              </button>
            ))}
          </div>
        </section>

        <section className={cn(CARD, "p-4 sm:p-5")} aria-label="Написать клиенту" data-crm-composer>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {composerTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                disabled={Boolean(tab.disabled)}
                onClick={() => setKind(tab.key)}
                title={tab.disabled}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-2xl px-3 text-[13.5px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45",
                  kind === tab.key ? "bg-[#0b1024] font-medium text-white" : "border border-[#ececf4] bg-white text-[#3c4053] hover:border-[#5566f6]/40",
                )}
                data-crm-composer-tab={tab.key}
              >
                <tab.icon className="size-4" />
                {tab.label}
                {tab.disabled ? <span className="text-[11.5px]">· {tab.disabled}</span> : null}
              </button>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {kind === "email" ? (
              <input value={subject} onChange={(event) => setSubject(event.target.value)} className={INPUT} placeholder="Тема письма" aria-label="Тема письма" />
            ) : null}
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className={TEXTAREA}
              aria-label="Текст"
              placeholder={
                kind === "email"
                  ? `Письмо на ${contact.email ?? ""}. Подпись из «Моей почты» добавится сама.`
                  : kind === "telegram"
                    ? "Сообщение придёт клиенту от бота WeSetup."
                    : kind === "call"
                      ? "Позвонил: о чём договорились, что дальше."
                      : "Заметка для команды — клиент её не увидит."
              }
              data-crm-body
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-[#9b9fb3]">
                {kind === "email"
                  ? "Уходит с вашей личной почты; не настроена — с общего адреса с ответом на вашу."
                  : kind === "call"
                    ? "Звонок считается ответом клиенту."
                    : kind === "note"
                      ? "Заметка не снимает «ждёт ответа»."
                      : "Ответ клиента придёт в CRM через бота."}
              </span>
              <button type="button" onClick={() => send(kind)} disabled={saving !== null || !body.trim() || (kind === "email" && !subject.trim())} className={PRIMARY_BUTTON} data-crm-send>
                {saving?.startsWith("send:") ? <Loader2 className="size-4 animate-spin" /> : null}
                {kind === "email" ? "Отправить письмо" : kind === "telegram" ? "Отправить в Telegram" : kind === "call" ? "Записать звонок" : "Сохранить заметку"}
              </button>
            </div>
          </div>
        </section>

        <section className={CARD} aria-label="Переписка" data-crm-timeline>
          <div className="flex items-baseline justify-between gap-3 border-b border-[#eef0f6] px-4 py-3 sm:px-5">
            <span className="text-[15px] font-semibold text-[#0b1024]">Вся переписка</span>
            <span className="text-[13px] tabular-nums text-[#6f7282]">{interactions.length}</span>
          </div>
          {interactions.length ? (
            <ol className="space-y-2.5 p-3 sm:p-4">
              {interactions.map((item) => (
                <li key={item.id} className={cn("rounded-2xl border px-3.5 py-3", DIRECTION_TONE[item.direction] ?? DIRECTION_TONE.event)} data-crm-item={item.direction}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-[12.5px] font-medium text-[#3c4053]">
                      {DIRECTION_LABEL[item.direction] ?? item.direction}
                      {item.authorName && item.direction !== "in" ? ` · ${item.authorName}` : ""}
                      {item.channel === "note" ? "" : ` · ${item.channel === "email" ? channelLabel(item.channel) : itemHeadline(item.channel, item.subject)}`}
                    </span>
                    <span className="text-[12px] text-[#9b9fb3]">{formatDateTime(item.occurredAt)}</span>
                  </div>
                  {item.subject && item.channel === "email" ? <div className="mt-1 text-[13.5px] font-medium text-[#0b1024]">{item.subject}</div> : null}
                  <p className="mt-1 whitespace-pre-line break-words text-[13.5px] leading-relaxed text-[#0b1024]">{item.body}</p>
                  {item.href ? (
                    <Link href={item.href} className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] text-[#3848c7] hover:underline">
                      Открыть в инструменте <ExternalLink className="size-3" />
                    </Link>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-5 py-6 text-[13.5px] text-[#6f7282]">Переписки пока нет.</p>
          )}
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:h-fit">
        <section className={cn(CARD, "space-y-3 p-4 sm:p-5")} aria-label="Связаться">
          <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">Связаться</div>
          <div className="space-y-1.5 text-[14px]">
            {contact.phone ? (
              <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-[#0b1024] hover:text-[#3848c7]">
                <Phone className="size-4 text-[#5566f6]" />
                {contact.phone}
              </a>
            ) : null}
            {contact.email ? (
              <a href={`mailto:${contact.email}`} className="flex items-center gap-2 break-all text-[#0b1024] hover:text-[#3848c7]">
                <Mail className="size-4 shrink-0 text-[#5566f6]" />
                {contact.email}
              </a>
            ) : null}
            {!contact.phone && !contact.email ? <p className="text-[13px] text-[#6f7282]">Нет телефона и почты — добавьте в «Данные».</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {wa ? (
              <a href={wa} target="_blank" rel="noreferrer" className={cn(SECONDARY_BUTTON, "h-9 px-3 text-[13px]")}>
                <MessageCircle className="size-4" /> WhatsApp
              </a>
            ) : null}
            {contact.phone ? (
              <a href={`tel:${contact.phone}`} className={cn(SECONDARY_BUTTON, "h-9 px-3 text-[13px]")}>
                <Phone className="size-4" /> Позвонить
              </a>
            ) : null}
            {links.feedback ? (
              <Link href="/root/feedback" className={cn(SECONDARY_BUTTON, "h-9 px-3 text-[13px]")}>
                <MessageSquareText className="size-4" /> Чат
              </Link>
            ) : null}
            {links.proposals ? (
              <Link href="/root/proposals" className={cn(SECONDARY_BUTTON, "h-9 px-3 text-[13px]")}>
                <FileText className="size-4" /> КП
              </Link>
            ) : null}
            {organization && links.organization ? (
              <Link href={`/root/organizations/${organization.id}`} className={cn(SECONDARY_BUTTON, "h-9 px-3 text-[13px]")}>
                <Receipt className="size-4" /> Счёт, договор
              </Link>
            ) : links.invoices ? (
              <Link href="/root/invoices" className={cn(SECONDARY_BUTTON, "h-9 px-3 text-[13px]")}>
                <Receipt className="size-4" /> Счета
              </Link>
            ) : null}
          </div>
          {organization ? (
            <div className="flex items-start gap-2 rounded-2xl bg-[#f5f6ff] px-3 py-2.5 text-[13px] text-[#3848c7]">
              <Building2 className="mt-0.5 size-4 shrink-0" />
              <span>
                Клиент платформы:{" "}
                {links.organization ? (
                  <Link href={`/root/organizations/${organization.id}`} className="font-medium hover:underline">
                    {organization.name}
                  </Link>
                ) : (
                  <b>{organization.name}</b>
                )}
                <span className="block text-[12px] text-[#6f7282]">с {formatDateTime(organization.createdAt)}</span>
              </span>
            </div>
          ) : null}
          {links.mailSettings ? (
            <p className="text-[12px] text-[#9b9fb3]">
              Письма уходят с адреса из{" "}
              <Link href="/root/me" className="text-[#3848c7] hover:underline">
                «Моей почты»
              </Link>
              .
            </p>
          ) : null}
        </section>

        <section className={cn(CARD, "space-y-3 p-4 sm:p-5")} aria-label="Ответственный и следующий шаг">
          <label className="block">
            <span className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">Ответственный</span>
            <select
              value={contact.ownerId ?? ""}
              disabled={saving !== null}
              onChange={(event) => patch({ ownerId: event.target.value || null }, "owner", event.target.value ? "Ответственный назначен" : "Ответственный снят")}
              className={cn(INPUT, "mt-1.5")}
              data-crm-owner
            >
              <option value="">Не назначен — напоминания РОП</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                  {owner.salesHead ? " (РОП)" : ""}
                  {owner.id === viewerId ? " — я" : ""}
                </option>
              ))}
            </select>
          </label>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">Следующий шаг</span>
              {due ? <span className={cn("text-[12.5px]", due.tone === "overdue" ? "text-[#a13a32]" : "text-[#3848c7]")}>{due.label}</span> : null}
            </div>
            <input type="datetime-local" value={nextAt} onChange={(event) => setNextAt(event.target.value)} className={cn(INPUT, "mt-1.5")} aria-label="Когда" data-crm-next-at />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[
                { days: 1, label: "Завтра 10:00" },
                { days: 3, label: "Через 3 дня" },
                { days: 7, label: "Через неделю" },
              ].map((item) => (
                <button key={item.days} type="button" onClick={() => quickNext(item.days)} className="rounded-full border border-[#ececf4] px-2.5 py-1 text-[12px] text-[#3c4053] hover:border-[#5566f6]/40">
                  {item.label}
                </button>
              ))}
            </div>
            <input value={nextNote} onChange={(event) => setNextNote(event.target.value)} className={cn(INPUT, "mt-2")} placeholder="Что сделать: позвонить, отправить КП…" aria-label="Что сделать" data-crm-next-note />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving !== null || !nextAt}
                onClick={() => patch({ nextActionAt: fromMoscowInput(nextAt), nextActionNote: nextNote || null }, "next", "Следующий шаг назначен — напомним в срок")}
                className={cn(SECONDARY_BUTTON, "h-9 text-[13px]")}
                data-crm-next-save
              >
                <CalendarClock className="size-4" /> Назначить
              </button>
              {contact.nextActionAt ? (
                <button
                  type="button"
                  disabled={saving !== null}
                  onClick={() => {
                    setNextAt("");
                    setNextNote("");
                    void patch({ nextActionAt: null, nextActionNote: null }, "next", "Шаг выполнен");
                  }}
                  className={cn(SECONDARY_BUTTON, "h-9 text-[13px]")}
                >
                  <BadgeCheck className="size-4" /> Выполнено
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {contact.note ? (
          <section className={cn(CARD, "p-4 text-[13.5px] text-[#3c4053] sm:p-5")}>
            <div className="mb-1 text-[13px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">О клиенте</div>
            <p className="whitespace-pre-line">{contact.note}</p>
          </section>
        ) : null}

        <button type="button" onClick={() => setSpamOpen(true)} className="inline-flex items-center gap-1.5 text-[13px] text-[#a13a32] hover:underline" data-crm-spam>
          <Ban className="size-4" /> Это спам
        </button>
      </aside>

      <ConfirmDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onConfirm={async () => {
          if (await patch(details, "details", "Данные сохранены")) setEditOpen(false);
        }}
        title="Данные контакта"
        icon={Pencil}
        confirmLabel="Сохранить"
        cancelLabel="Отмена"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["name", "Имя"],
              ["company", "Компания"],
              ["phone", "Телефон"],
              ["email", "Почта"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-[13px] text-[#3c4053]">
              {label}
              <input value={details[key]} onChange={(event) => setDetails((current) => ({ ...current, [key]: event.target.value }))} className={cn(INPUT, "mt-1")} />
            </label>
          ))}
          <label className="block text-[13px] text-[#3c4053] sm:col-span-2">
            О клиенте
            <textarea value={details.note} onChange={(event) => setDetails((current) => ({ ...current, note: event.target.value }))} className={cn(TEXTAREA, "mt-1")} placeholder="Сколько точек, кто решает, что важно" />
          </label>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={spamOpen}
        onClose={() => setSpamOpen(false)}
        onConfirm={async () => {
          if (await patch({ stage: "spam", blockSender: Boolean(contact.email) }, "spam", "Отмечено как спам")) setSpamOpen(false);
        }}
        variant="danger"
        title="Отметить как спам?"
        bullets={[
          { label: "Контакт уйдёт в «Спам», напоминаний по нему не будет" },
          ...(contact.email ? [{ label: `Письма с ${contact.email} будут отсеиваться (правило в «Почте и фильтрах»)`, tone: "warn" as const }] : []),
        ]}
        confirmLabel="Это спам"
        cancelLabel="Отмена"
      />
    </div>
  );
}
