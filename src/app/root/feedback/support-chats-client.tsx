"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Loader2,
  Megaphone,
  MessageSquarePlus,
  MessagesSquare,
  Reply,
  Search,
  Send,
  X,
} from "lucide-react";
import { defaultReplyTarget, findQuotedMessage, quotePreview } from "@/lib/support-reply-quote";
import { ClientLinks } from "./client-links";
import { toast } from "sonner";
import {
  AttachButton,
  AttachmentChips,
  useAttachmentUploads,
} from "@/components/support/attachment-composer";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PARTNER_ESCALATION_HOURS } from "@/lib/support-threads-shared";
import { useLocale, useTranslations } from "next-intl";
import { isLocale } from "@/i18n/locales";
import type { OrgOption, RootChatThread } from "./support-chats";
import { chatAge, chatErrorKey, deliveryKey, formatChatTimestamp } from "./chat-presentation";
import { formatRootAttachmentBytes, getRootUploadFailureContent } from "./attachment-presentation";

type ChatTranslator = ReturnType<typeof useTranslations<"rootSupportChats">>;
type GetCurrentTranslator = () => ChatTranslator;
import { cn } from "@/lib/utils";
import { createTypingPinger, isTypingFresh } from "@/lib/support-typing";
import { useLiveEvents } from "@/lib/use-live-events";
import { useLiveRefetch } from "@/lib/use-live-refetch";

/**
 * Онлайн-чаты в админке: список веток с пометкой, кто должен ответить
 * (WeSetup или партнёр), композер ответа, «написать организации» и
 * рассылка всем. Раньше отвечать можно было только свайп-реплаем в
 * Telegram — теперь и отсюда, тем же путём доставки.
 */

const BTN_PRIMARY =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60";
const BTN_OUTLINE =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-60";
const BTN_DANGER =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#e0445a] to-[#f2607a] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(224,68,90,0.55)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";
const TEXTAREA =
  "w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[14px] leading-[1.55] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

export function SupportChatsClient({
  threads,
  organizations,
}: {
  threads: RootChatThread[];
  organizations: OrgOption[];
}) {
  const t = useTranslations("rootSupportChats");
  const currentT = useRef(t);
  useEffect(() => { currentT.current = t; }, [t]);
  const getCurrentT = useCallback(() => currentT.current, []);
  const [broadcastToken, setBroadcastToken] = useState(() => t("broadcastToken"));
  const [composeOpen, setComposeOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  // Список веток и сообщения приходят с сервера: новое сообщение клиента
  // → перечитать страницу. Не чаще раза в 2 с; вкладка в фоне — при
  // возвращении. Раньше панель не обновлялась вовсе, только F5.
  const router = useRouter();
  useLiveRefetch(() => router.refresh(), { types: ["support"], minIntervalMs: 2000 });

  // «Печатает…» по веткам: время последнего пинга, секундный тик, чтобы
  // метка погасла сама (TTL — в support-typing.ts).
  const [typingAt, setTypingAt] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  useLiveEvents((event) => {
    if (event.type !== "support" || event.kind !== "typing") return;
    const threadId = typeof event.data?.threadId === "string" ? event.data.threadId : null;
    if (threadId) setTypingAt((prev) => ({ ...prev, [threadId]: Date.now() }));
  });
  const anyTyping = Object.values(typingAt).some((at) => isTypingFresh(at, now));
  useEffect(() => {
    if (!anyTyping) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyTyping]);

  const waitingWesetup = threads.filter((t) => t.unreadForStaff > 0 && !t.partner).length;
  const waitingPartner = threads.filter((t) => t.unreadForStaff > 0 && t.partner).length;

  return (
    <section className="rounded-2xl bg-white p-4 sm:p-5" data-support-chats>
      {/* Колонка чатов узкая (половина экрана): кнопки — строкой под описанием. */}
      <div className="flex flex-col gap-3">
        <div>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
            <MessagesSquare className="size-4 text-[#5566f6]" />
            {t("title")}
            <span className="text-[13px] font-normal text-[#6f7282]">{t("threadCount", { count: String(threads.length) })}</span>
          </div>
          <p className="mt-1 text-[13px] text-[#6f7282]">
            {t.rich("waitingDescription", { wesetup: String(waitingWesetup), partner: String(waitingPartner), strong: chunks => <b className="text-[#0b1024]">{chunks}</b> })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setComposeOpen(true)} className={BTN_OUTLINE}>
            <MessageSquarePlus className="size-4 text-[#5566f6]" />
            {t("composeTitle")}
          </button>
          <button type="button" onClick={() => { setBroadcastToken(t("broadcastToken")); setBroadcastOpen(true); }} className={BTN_DANGER}>
            <Megaphone className="size-4" />
            {t("broadcastButton")}
          </button>
        </div>
      </div>

      {threads.length === 0 ? (
        <p className="mt-4 text-[13.5px] text-[#9b9fb3]">{t("empty")}</p>
      ) : (
        // Короткий блок (владелец, 2026-11-23): ветки — строками, список
        // прокручивается внутри, обращения рядом/ниже видно сразу.
        <div className="mt-4 max-h-[45vh] space-y-2 overflow-y-auto overscroll-contain pr-1 xl:max-h-[calc(100vh-14rem)]" data-chat-list>
          {threads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              getCurrentT={getCurrentT}
              typing={isTypingFresh(typingAt[thread.id], now)}
            />
          ))}
        </div>
      )}

      <ComposeToOrgDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        organizations={organizations}
        getCurrentT={getCurrentT}
      />
      <BroadcastDialog
        open={broadcastOpen}
        onClose={() => setBroadcastOpen(false)}
        organizationsCount={organizations.length}
        getCurrentT={getCurrentT}
        confirmationToken={broadcastToken}
      />
    </section>
  );
}

function ThreadCard({ thread, typing = false, getCurrentT }: { thread: RootChatThread; typing?: boolean; getCurrentT: GetCurrentTranslator }) {
  const t = useTranslations("rootSupportChats");
  const selectedLocale = useLocale();
  const locale = isLocale(selectedLocale) ? selectedLocale : "ru";
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const files = useAttachmentUploads({ getUploadFailureContent: getRootUploadFailureContent });
  const messagesRef = useRef<HTMLDivElement>(null);
  // На что отвечаем (владелец, 2026-11-23): по умолчанию — последнее
  // сообщение клиента, «Ответить» у любого сообщения клиента выбирает его,
  // крестик — без цитаты. `undefined` — выбор по умолчанию.
  const [quoteId, setQuoteId] = useState<string | null | undefined>(undefined);
  const fallbackQuote = defaultReplyTarget(thread.messages);
  const quoted = quoteId === undefined ? fallbackQuote : findQuotedMessage(thread.messages, quoteId);
  // Свой набор ответа → клиенту «Поддержка печатает…», не чаще раза в 2,5 с.
  const pingTyping = useMemo(
    () =>
      createTypingPinger(() => {
        void fetch(`/api/root/support/threads/${thread.id}/typing`, { method: "POST" }).catch(
          () => undefined
        );
      }),
    [thread.id]
  );

  // Открыли ветку или пришло новое сообщение — показываем низ переписки.
  useEffect(() => {
    if (!open) return;
    const box = messagesRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [open, thread.messages.length]);

  const waitingHours =
    thread.unreadForStaff > 0
      ? (Date.now() - new Date(thread.lastMessageAt).getTime()) / 3_600_000
      : 0;
  const escalated = Boolean(thread.partner) && waitingHours >= PARTNER_ESCALATION_HOURS;
  const title = thread.organizationName || (thread.kind === "guest" ? t("guest") : t("withoutOrganization"));
  const who = [title, thread.userName, thread.userEmail, thread.phone].filter(Boolean).join(" · ");
  const lastMessage = thread.messages.at(-1);

  async function send() {
    const body = draft.trim();
    if (body.length < 2 && files.readyAttachments.length === 0) return;
    if (files.uploading) {
      toast.error(getCurrentT()("waitForUploads"));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/root/support/threads/${thread.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: body,
          attachments: files.readyAttachments,
          ...(quoted ? { replyToId: quoted.id } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(getCurrentT()(chatErrorKey(data?.error)));
        return;
      }
      toast.success(getCurrentT()(deliveryKey(data?.delivered, "reply")));
      setDraft("");
      setQuoteId(undefined);
      files.clear();
      router.refresh();
    } catch {
      toast.error(getCurrentT()("sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      id={`chat-${thread.id}`}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      className="group scroll-mt-24 rounded-xl bg-[var(--app-veil)] px-3.5 py-2.5 transition-shadow duration-300 data-[flash]:ring-2 data-[flash]:ring-[#5566f6]"
      data-chat-thread={thread.id}
    >
      {/* Свёрнутая ветка — одна строка: кто, отметки, время; текст последнего
          сообщения — второй тихой строкой. */}
      <summary className="cursor-pointer list-none">
        <span className="flex min-w-0 items-center gap-2 text-[13.5px]">
          <span className="min-w-0 truncate font-medium text-[#0b1024]">{title}</span>
          {typing ? (
            <span className="inline-flex shrink-0 items-center rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11px] font-medium text-[#3848c7]">
              {t("typing")}
            </span>
          ) : null}
          {thread.unreadForStaff > 0 && !thread.partner ? (
            <span className="shrink-0 rounded-full bg-[#fff4f2] px-2 py-0.5 text-[11px] font-medium text-[#a13a32]">
              {t("unanswered", { count: String(thread.unreadForStaff) })}
            </span>
          ) : null}
          {thread.unreadForStaff > 0 && thread.partner ? (
            <span
              className={cn(
                "shrink-0 truncate rounded-full px-2 py-0.5 text-[11px] font-medium",
                escalated ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#fff7ed] text-[#9a4a06]"
              )}
              title={escalated ? t("escalationHint") : t("partnerResponds")}
            >
              {t(escalated ? "escalated" : "waitingPartner", { brand: thread.partner.brandName, age: chatAge(thread.lastMessageAt, t) })}
            </span>
          ) : thread.partner ? (
            <span className="shrink-0 truncate rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11px] font-medium text-[#3848c7]">
              {t("partner", { brand: thread.partner.brandName })}
            </span>
          ) : null}
          {thread.unreadForClient > 0 ? (
            <span className="shrink-0 rounded-full bg-[#f4f5fb] px-2 py-0.5 text-[11px] font-medium text-[#3c4053] max-sm:hidden">
              {t("unreadByClient", { count: String(thread.unreadForClient) })}
            </span>
          ) : null}
          {thread.kind === "legacy" ? (
            <span
              className="shrink-0 rounded-full bg-[#f4f5fb] px-2 py-0.5 text-[11px] font-medium text-[#6f7282]"
              title={t("archiveHint")}
            >
              {t("archive")}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 text-[12px] text-[#9b9fb3]">
            {formatChatTimestamp(thread.lastMessageAt, locale)}
          </span>
        </span>
        {lastMessage ? (
          <span className="mt-0.5 block truncate text-[12.5px] text-[#6f7282] group-open:hidden">
            {lastMessage.author === "client" ? "" : "↩ "}
            {quotePreview(lastMessage)}
          </span>
        ) : null}
      </summary>

      {/* Кому отвечаем и куда перейти: карточка клиента, кабинет, звонок, почта. */}
      <div className="mt-2.5 space-y-2 rounded-lg bg-white/70 px-3 py-2" data-chat-client>
        <div className="text-[12.5px] text-[#3c4053]">
          <span className="font-medium text-[#6f7282]">{t("to")}: </span>
          {who}
        </div>
        <ClientLinks
          clientHref={thread.clientHref ?? null}
          cabinetOrganizationId={thread.cabinetOrganizationId ?? null}
          phone={thread.phone}
          email={thread.userEmail}
          labels={{
            clientCard: t("clientCard"),
            enterCabinet: t("enterCabinet"),
            enterCabinetFailed: t("sendFailed"),
            call: t("call"),
            writeEmail: t("writeEmail"),
          }}
        />
      </div>

      <div ref={messagesRef} className="mt-2.5 max-h-[40vh] space-y-1.5 overflow-y-auto overscroll-contain pr-1" data-chat-messages>
        {thread.messages.map((item) => {
          const replied = findQuotedMessage(thread.messages, item.replyToId);
          return (
            <div
              key={item.id}
              className={cn(
                "group/message max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-[1.5]",
                item.author === "client"
                  ? "bg-white text-[#0b1024]"
                  : "ml-auto bg-[#eef1ff] text-[#0b1024]",
                quoted?.id === item.id ? "ring-2 ring-[#5566f6]/40" : ""
              )}
              data-chat-message={item.id}
            >
              <div className="mb-0.5 flex items-center gap-2 text-[11px] text-[#6f7282]">
                <span className="min-w-0 truncate">
                  {item.author === "client"
                    ? item.authorName || t("client")
                    : item.operatorName || t("support")}
                  {" · "}
                  {formatChatTimestamp(item.createdAt, locale)}
                </span>
                {item.author === "client" ? (
                  <button
                    type="button"
                    onClick={() => setQuoteId(item.id)}
                    className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[#3848c7] transition-colors hover:bg-[#eef1ff]"
                    data-quote-message={item.id}
                  >
                    <Reply className="size-3" />
                    {t("replyToMessage")}
                  </button>
                ) : null}
              </div>
              {item.replyToId ? (
                <div className="mb-1 border-l-2 border-[#5566f6]/50 pl-2 text-[12px] text-[#6f7282]" data-chat-quote>
                  {replied ? quotePreview(replied) : t("quoteMissing")}
                </div>
              ) : null}
              <div className="whitespace-pre-wrap break-words">{item.body}</div>
              {item.attachments.map((a, ai) => (
                <a
                  key={ai}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block text-[12.5px] text-[#3848c7] underline-offset-2 hover:underline"
                >
                  📎 {a.filename}
                </a>
              ))}
            </div>
          );
        })}
      </div>

      <div
        className={cn("mt-2.5 rounded-xl pt-2.5 transition-shadow", dragging ? "ring-2 ring-[#5566f6]/40" : "")}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          setDragging(false);
          files.addFiles(event.dataTransfer.files);
        }}
        data-chat-composer
      >
        {quoted ? (
          <div className="mb-2 flex items-start gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-[12px]" data-reply-target={quoted.id}>
            <Reply className="mt-0.5 size-3.5 shrink-0 text-[#5566f6]" />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-[#6f7282]">{t("replyingTo")}: </span>
              <span className="text-[#0b1024]">«{quotePreview(quoted, 120)}»</span>
            </span>
            <button
              type="button"
              onClick={() => setQuoteId(null)}
              aria-label={t("clearQuote")}
              title={t("clearQuote")}
              className="shrink-0 rounded-md p-0.5 text-[#9b9fb3] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}
        <AttachmentChips uploads={files.uploads} onRemove={files.remove} formatSizeBytes={formatRootAttachmentBytes} />
        <div className="flex items-end gap-2">
          <AttachButton onFiles={files.addFiles} disabled={busy} />
          <textarea
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (event.target.value.trim()) pingTyping();
            }}
            onPaste={files.handlePaste}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder={
              thread.kind === "guest"
                ? t("replyGuest")
                : thread.partner
                  ? t("replyPartner", { brand: thread.partner.brandName })
                  : t("replySupport")
            }
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-[#dcdfed] bg-white px-3.5 py-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || files.uploading || (draft.trim().length < 2 && files.readyAttachments.length === 0)}
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#5566f6] text-white transition-colors hover:bg-[#4a5bf0] disabled:opacity-50"
            aria-label={t("send")}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
        <p className="mt-1.5 text-[11.5px] text-[#9b9fb3]">{dragging ? t("dropHint") : t("attachHint")}</p>
      </div>
    </details>
  );
}

function OrgPicker({
  organizations,
  value,
  onChange,
}: {
  organizations: OrgOption[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const t = useTranslations("rootSupportChats");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? organizations.filter((o) => o.name.toLowerCase().includes(q)) : organizations;
  }, [organizations, query]);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("findOrganization")}
          className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white pl-10 pr-4 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />
      </div>
      <div className="max-h-[200px] space-y-1 overflow-y-auto rounded-2xl border border-[#ececf4] p-1.5">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-[13px] text-[#9b9fb3]">{t("notFound")}</div>
        ) : (
          filtered.slice(0, 200).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px] transition-colors",
                value === o.id ? "bg-[#5566f6] text-white" : "text-[#0b1024] hover:bg-[#f5f6ff]"
              )}
            >
              <Building2 className="size-4 shrink-0 opacity-70" />
              <span className="truncate">{o.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function ComposeToOrgDialog({
  open,
  onClose,
  organizations,
  getCurrentT,
}: {
  getCurrentT: GetCurrentTranslator;
  open: boolean;
  onClose: () => void;
  organizations: OrgOption[];
}) {
  const t = useTranslations("rootSupportChats");
  const router = useRouter();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // Скриншот к первому сообщению — кнопкой, Ctrl+V или перетаскиванием (2026-11-23).
  const files = useAttachmentUploads({ getUploadFailureContent: getRootUploadFailureContent });
  const hasContent = text.trim().length >= 2 || files.readyAttachments.length > 0;

  async function submit() {
    if (!orgId || !hasContent) return;
    if (files.uploading) {
      toast.error(getCurrentT()("waitForUploads"));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/root/support/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId, message: text.trim(), attachments: files.readyAttachments }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(getCurrentT()(chatErrorKey(data?.error)));
        return;
      }
      toast.success(getCurrentT()(deliveryKey(data?.delivered, "compose")));
      setText("");
      setOrgId(null);
      files.clear();
      onClose();
      router.refresh();
    } catch {
      toast.error(getCurrentT()("sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent className="sm:max-w-[560px]" closeLabel={t("close")}>
        <DialogHeader>
          <DialogTitle>{t("composeTitle")}</DialogTitle>
          <DialogDescription>
            {t("composeDescription")}
          </DialogDescription>
        </DialogHeader>
        <div
          className="space-y-3"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) event.preventDefault();
          }}
          onDrop={(event) => {
            if (event.dataTransfer.files.length === 0) return;
            event.preventDefault();
            files.addFiles(event.dataTransfer.files);
          }}
        >
          <OrgPicker organizations={organizations} value={orgId} onChange={setOrgId} />
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onPaste={files.handlePaste}
            rows={4}
            placeholder={t("composePlaceholder")}
            className={TEXTAREA}
          />
          <AttachmentChips uploads={files.uploads} onRemove={files.remove} formatSizeBytes={formatRootAttachmentBytes} />
          <div className="flex items-center gap-2">
            <AttachButton onFiles={files.addFiles} disabled={busy} />
            <p className="text-[12px] text-[#6f7282]">{t("attachHint")}</p>
          </div>
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className={BTN_OUTLINE}>
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || files.uploading || !orgId || !hasContent}
            className={BTN_PRIMARY}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {t("send")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function newBroadcastId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function BroadcastDialog({
  open,
  onClose,
  organizationsCount,
  getCurrentT,
  confirmationToken,
}: {
  getCurrentT: GetCurrentTranslator;
  confirmationToken: string;
  open: boolean;
  onClose: () => void;
  organizationsCount: number;
}) {
  const t = useTranslations("rootSupportChats");
  const [text, setText] = useState("");
  const [includePartnerManaged, setIncludePartnerManaged] = useState(true);
  // id рассылки живёт, пока диалог открыт: двойной клик или перезагрузка
  // с повтором не дублируют сообщения — сервер пропускает уже обработанные.
  const [broadcastId, setBroadcastId] = useState<string>(() => newBroadcastId());

  async function confirm() {
    try {
    const response = await fetch("/api/root/support/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text.trim(), broadcastId, includePartnerManaged }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      toast.error(getCurrentT()(chatErrorKey(data?.error, "broadcastFailed")));
      return;
    }
    toast.success(getCurrentT()("broadcastStarted", { count: String(data.organizations) }));
    setText("");
    setBroadcastId(newBroadcastId());
    onClose();
    } catch {
      toast.error(getCurrentT()("broadcastFailed"));
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={confirm}
      title={t("broadcastTitle")}
      description={t("broadcastDescription", { count: String(organizationsCount) })}
      variant="danger"
      icon={Megaphone}
      typeToConfirm={confirmationToken}
      confirmLabel={t("broadcastConfirm")}
      confirmDisabled={text.trim().length < 10}
      bullets={[
        { label: t("broadcastChat"), tone: "info" },
        { label: t("broadcastManagement"), tone: "info" },
        { label: t("broadcastRetry"), tone: "default" },
      ]}
    >
      <div className="space-y-3">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={5}
          placeholder={t("broadcastPlaceholder")}
          className={TEXTAREA}
        />
        <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-[#3c4053]">
          <input
            type="checkbox"
            checked={includePartnerManaged}
            onChange={(event) => setIncludePartnerManaged(event.target.checked)}
            className="mt-0.5 size-4 accent-[#5566f6]"
          />
          <span>
            {t("includePartners")}
            <span className="block text-[12px] text-[#9b9fb3]">
              {t("includePartnersHint")}
            </span>
          </span>
        </label>
      </div>
    </ConfirmDialog>
  );
}
