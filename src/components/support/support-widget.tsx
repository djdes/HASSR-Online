"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Pencil,
  Send,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ConsultantCard } from "@/components/dashboard/consultant-card";
import {
  AttachButton,
  AttachmentChips,
  MessageAttachments,
  useAttachmentUploads,
} from "@/components/support/attachment-composer";
import {
  IncomingMessagePopup,
  LauncherBadge,
} from "@/components/support/incoming-message-popup";
import { useIncomingMessages } from "@/components/support/use-incoming-messages";
import { TYPING_TTL_MS, createTypingPinger } from "@/lib/support-typing";
import { useLiveEvents } from "@/lib/use-live-events";
import { useFabAction, useHasFabDock } from "@/components/layout/fab-dock";
import {
  isNotificationSoundMuted,
  setNotificationSoundMuted,
} from "@/lib/notification-sound";
import { openSanpinChat } from "@/lib/sanpin-chat-bus";
import {
  SUPPORT_CHAT_OPEN_EVENT,
  announceSupportChatRead,
} from "@/lib/support-chat-bus";
import type { ConsultantContact } from "@/lib/partners/consultant-contact-shared";
import type { SupportAttachmentMeta } from "@/lib/support-attachments-shared";

/**
 * Поддержка одной кнопкой в углу кабинета.
 *
 * Раньше вход в поддержку был в двух местах: кнопка «Обратная связь» в
 * шапке и этот пузырь внизу. Человек не понимал, чем они отличаются, а
 * отличались они только тем, куда падало сообщение. Теперь вход один, а
 * внутри — выбор: разовое обращение или живая переписка.
 *
 * Шапка показывает, под кем человек авторизован: поддержка видит ровно
 * эти данные, и расхождений «я писал не с того аккаунта» не возникает.
 *
 * Переписка — одна на организацию: все управляющие видят одну ветку и
 * подпись, кто из них писал. Ответ оператора приходит сам: фоновый опрос
 * статуса, звук, всплывашка справа снизу и бейдж на кнопке.
 */

type Screen = "menu" | "feedback" | "chat";

type FeedbackType = "bug" | "suggestion" | "partnership";
type FeedbackTypeLabelKey = "widget.feedbackTypeBug" | "widget.feedbackTypeSuggestion" | "widget.feedbackTypePartnership";

const FEEDBACK_TYPES: Array<{ value: FeedbackType; labelKey: FeedbackTypeLabelKey }> = [
  { value: "bug", labelKey: "widget.feedbackTypeBug" },
  { value: "suggestion", labelKey: "widget.feedbackTypeSuggestion" },
  { value: "partnership", labelKey: "widget.feedbackTypePartnership" },
];

type Identity = {
  organizationName: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
};

type ChatMessage = {
  id: string;
  author: string;
  body: string;
  operatorName: string | null;
  authorName?: string | null;
  attachments?: SupportAttachmentMeta[];
  createdAt: string;
};

/** Пока чат открыт, тянем новые реплики — ответ оператора должен появиться сам. */
const CHAT_POLL_MS = 10_000;

/**
 * `consultant` — партнёр, сопровождающий организацию (white-label).
 * В меню помощи он идёт первым: клиенту партнёра быстрее написать своему
 * консультанту, чем в общую поддержку WeSetup.
 *
 * `hideChat` — партнёр внутри кабинета клиента: писать самому себе незачем,
 * у него для переписки есть /partner/chats.
 */
export function SupportWidget({
  consultant = null,
  hideChat = false,
}: {
  consultant?: ConsultantContact | null;
  hideChat?: boolean;
} = {}) {
  const t = useTranslations("publicSupport");
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<Screen>("menu");
  const [identity, setIdentity] = useState<Identity | null>(null);

  const [type, setType] = useState<FeedbackType | "">("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [muted, setMuted] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Вложения: чат и форма обратной связи — раздельные наборы, чтобы файл
  // из чата не улетел с обращением и наоборот.
  const chatFiles = useAttachmentUploads();
  const feedbackFiles = useAttachmentUploads();

  const chatVisible = open && screen === "chat";
  const incoming = useIncomingMessages({
    enabled: !hideChat,
    statusUrl: "/api/support/chat/status",
    scope: "org",
    chatVisible,
    title: (status) => status.latest?.operatorName ?? t("widget.title"),
  });
  const { chirpFor } = incoming;

  // «Поддержка печатает…» — эфемерно: событие приходит по потоку и
  // гаснет через TYPING_TTL_MS после последнего. Свой набор текста
  // пингуем не чаще раза в 2,5 с — сервер не должен видеть каждую букву.
  const [operatorTyping, setOperatorTyping] = useState(false);
  const typingTimer = useRef<number | null>(null);
  const pingTyping = useMemo(
    () =>
      createTypingPinger(() => {
        void fetch("/api/support/chat/typing", { method: "POST" }).catch(() => undefined);
      }),
    []
  );
  useEffect(
    () => () => {
      if (typingTimer.current != null) window.clearTimeout(typingTimer.current);
    },
    []
  );

  const openChat = useCallback(() => {
    setOpen(true);
    setScreen("chat");
    setSent(false);
  }, []);

  // Всплывашка и колокольчик открывают переписку через шину.
  useEffect(() => {
    if (hideChat) return;
    window.addEventListener(SUPPORT_CHAT_OPEN_EVENT, openChat);
    return () => window.removeEventListener(SUPPORT_CHAT_OPEN_EVENT, openChat);
  }, [hideChat, openChat]);

  // Deep-link `?support=chat` — из письма, из Telegram, из уведомления.
  //
  // Раньше параметр читался из `window.location.search` один раз при
  // монтировании. Виджет живёт в layout и при клиентском переходе не
  // перемонтируется — ссылка «Открыть чат» из панели уведомлений
  // меняла адрес, а чат не открывался. `useSearchParams` перерисовывает
  // компонент при каждой смене строки запроса, в том числе при
  // клиентском переходе.
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (hideChat) return;
    if (searchParams.get("support") !== "chat") return;
    openChat();
    // Убираем параметр из адреса, чтобы обновление страницы не открывало
    // чат заново. Через router, а не history — иначе Next и браузер
    // разошлись бы во мнении, какой сейчас адрес.
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete("support");
    const query = rest.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [hideChat, openChat, searchParams, pathname, router]);

  useEffect(() => {
    setMuted(isNotificationSoundMuted());
  }, []);

  const loadChat = useCallback(
    async (markRead = false) => {
      const read = markRead && document.visibilityState === "visible";
      const response = await fetch(
        read ? "/api/support/chat?markRead=1" : "/api/support/chat"
      ).catch(() => null);
      if (!response?.ok) {
        setMessages([]);
        return;
      }
      const data = await response.json();
      setIdentity(data.identity ?? null);
      const list: ChatMessage[] = data.messages ?? [];
      setMessages(list);
      // Реплика оператора пришла, пока чат открыт: звук без всплывашки.
      const last = list[list.length - 1];
      if (last && last.author === "operator") chirpFor(last.id);
      if (read) announceSupportChatRead();
    },
    [chirpFor]
  );

  // Живой поток: ответ оператора и «печатает» приходят сразу; опрос раз
  // в 10 с остаётся страховкой, если поток не доходит.
  useLiveEvents((event) => {
    if (hideChat) return;
    if (event.type === "support" && event.kind === "typing") {
      setOperatorTyping(true);
      if (typingTimer.current != null) window.clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(() => setOperatorTyping(false), TYPING_TTL_MS);
      return;
    }
    if (!chatVisible) return;
    if (event.type === "support" && event.kind === "message") {
      setOperatorTyping(false);
      void loadChat(true);
    }
    if (event.type === "reconnect") void loadChat(true);
  });

  // Данные шапки нужны сразу при открытии, ещё до выбора экрана.
  useEffect(() => {
    if (!open || identity) return;
    void loadChat();
  }, [open, identity, loadChat]);

  useEffect(() => {
    if (!chatVisible) return;
    void loadChat(true);
    const timer = setInterval(() => void loadChat(true), CHAT_POLL_MS);
    return () => clearInterval(timer);
  }, [chatVisible, loadChat]);

  useEffect(() => {
    if (screen === "chat") {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [screen, messages, operatorTyping]);

  function close() {
    setOpen(false);
    setScreen("menu");
    setSent(false);
    setType("");
    setMessage("");
  }

  function toggleMute() {
    const next = !muted;
    setNotificationSoundMuted(next);
    setMuted(next);
  }

  async function sendFeedback() {
    if (!type) {
      toast.error(t("widget.feedbackTypeRequired"));
      return;
    }
    if (message.trim().length < 3) {
      toast.error(t("widget.feedbackMessageRequired"));
      return;
    }
    if (feedbackFiles.uploading) {
      toast.error(t("widget.waitForAttachments"));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          message: message.trim(),
          attachments: feedbackFiles.readyAttachments,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? t("widget.feedbackSendFallback"));
      }
      setSent(true);
      setMessage("");
      setType("");
      feedbackFiles.clear();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("widget.genericError"));
    } finally {
      setBusy(false);
    }
  }

  async function sendChat() {
    const body = draft.trim();
    const attachments = chatFiles.readyAttachments;
    // Можно отправить только файл, без текста — «просто скинул скрин».
    if (body.length < 2 && attachments.length === 0) return;
    if (chatFiles.uploading) {
      toast.error(t("widget.waitForAttachments"));
      return;
    }
    setBusy(true);
    // Поле очищаем сразу: ждать сеть, глядя в собственный текст, — худшее,
    // что может делать чат. При ошибке текст вернём обратно.
    setDraft("");
    try {
      const response = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: body, attachments }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.message) {
        throw new Error(data?.error ?? t("widget.chatSendFallback"));
      }
      setMessages((current) => [...(current ?? []), data.message]);
      chatFiles.clear();
    } catch (error) {
      setDraft(body);
      toast.error(error instanceof Error ? error.message : t("widget.genericError"));
    } finally {
      setBusy(false);
    }
  }

  // Подпись автора у реплик клиента нужна, только если писали разные люди.
  const clientAuthors = new Set(
    (messages ?? [])
      .filter((m) => m.author === "client" && m.authorName)
      .map((m) => m.authorName as string)
  );
  const showClientAuthors = clientAuthors.size > 1;

  // В кабинете кнопку рисует общий док; здесь только регистрируем её.
  const docked = useHasFabDock();
  useFabAction(
    {
      id: "support",
      order: 20,
      label: t("widget.supportTitle"),
      hint: t("widget.supportHint"),
      icon: MessageCircle,
      badge: incoming.unread,
      onSelect: () => setOpen(true),
    },
    docked && !open,
  );

  const popup = (
    <IncomingMessagePopup
      popup={incoming.popup}
      onOpen={() => {
        incoming.dismissPopup();
        openChat();
      }}
      onDismiss={incoming.dismissPopup}
    />
  );

  if (!open) {
    return (
      <>
        {popup}
        {docked ? null : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-[68px] z-30 flex size-11 items-center justify-center rounded-full bg-white text-[#5566f6] shadow-[0_10px_24px_-10px_rgba(11,16,36,0.25)] ring-1 ring-[#ececf4] transition-all hover:scale-105"
          aria-label={
            incoming.unread > 0
              ? t("widget.supportUnread", { count: incoming.unread })
              : t("widget.supportTitle")
          }
          title={t("widget.supportTitle")}
        >
          <LauncherBadge count={incoming.unread} />
          <MessageCircle className="relative size-4" />
        </button>
        )}
      </>
    );
  }

  return (
    <>
      {popup}
      <div className="fixed bottom-5 right-5 z-40 flex max-h-[min(640px,calc(100vh-2.5rem))] w-[calc(100vw-2.5rem)] max-w-sm flex-col overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_30px_80px_-20px_rgba(11,16,36,0.45)]">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#eef0f6] px-5 py-4">
          <div className="min-w-0">
            {screen !== "menu" ? (
              <button
                type="button"
                onClick={() => {
                  setScreen("menu");
                  setSent(false);
                }}
                className="mb-1 inline-flex items-center gap-1 text-[12.5px] text-[#6f7282] transition-colors hover:text-[#3848c7]"
              >
                <ArrowLeft className="size-3.5" />
                {t("widget.back")}
              </button>
            ) : null}
            <div className="text-[15px] font-semibold text-[#0b1024]">
              {screen === "feedback"
                ? t("widget.feedbackTitle")
                : screen === "chat"
                  ? t("widget.chatTitle")
                  : t("widget.supportTitle")}
            </div>
            {/* Под кем авторизован: поддержка видит ровно эти данные. */}
            <div className="mt-1 space-y-0.5 text-[12px] leading-snug text-[#6f7282]">
              {identity?.organizationName ? (
                <div className="truncate">{identity.organizationName}</div>
              ) : null}
              {identity?.email ? (
                <div className="truncate">{identity.email}</div>
              ) : null}
              {identity?.phone ? (
                <div className="truncate">{identity.phone}</div>
              ) : null}
              {/* Показали контакты — сразу дали, где их поправить: это те же
                  поля пользователя, что увидит оператор. */}
              <Link
                href="/settings/phone"
                onClick={close}
                className="inline-flex items-center gap-1 pt-0.5 text-[12px] font-medium text-[#5566f6] transition-colors duration-150 hover:text-[#3848c7]"
              >
                <Pencil className="size-3" />
                {t("widget.change")}
              </Link>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {screen === "chat" ? (
              <button
                type="button"
                onClick={toggleMute}
                className="rounded-lg p-1 text-[#9b9fb3] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]"
                aria-label={muted ? t("widget.enableSound") : t("widget.disableSound")}
                title={muted ? t("widget.soundOff") : t("widget.soundOnNewMessage")}
              >
                {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </button>
            ) : null}
            <button
              type="button"
              onClick={close}
              className="rounded-lg p-1 text-[#9b9fb3] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]"
              aria-label={t("widget.close")}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {screen === "menu" ? (
          <div className="space-y-2 p-5">
            {consultant ? <ConsultantCard consultant={consultant} compact /> : null}
            {/* Помощник первым: на «как заполнить» и «где найти» он отвечает
                за секунды, и человеку не нужно ждать оператора. Открываем не
                свой экран, а соседний пузырь — AI-чат в кабинете один. */}
            <button
              type="button"
              onClick={() => {
                openSanpinChat();
                close();
              }}
              className="flex w-full items-center gap-3 rounded-2xl border border-[#5566f6]/30 bg-[#f5f6ff] px-4 py-3 text-left transition-colors hover:border-[#5566f6]/60 hover:bg-[#eef1ff]"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#5566f6] text-white">
                <Bot className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-[#0b1024]">
                  {t("widget.assistantTitle")}
                </span>
                <span className="block text-[12px] text-[#6f7282]">
                  {t("widget.assistantDescription")}
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setScreen("feedback")}
              className="flex w-full items-center gap-3 rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-left transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
                <MessagesSquare className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-[#0b1024]">
                  {t("widget.feedbackTitle")}
                </span>
                <span className="block text-[12px] text-[#6f7282]">
                  {t("widget.feedbackDescription")}
                </span>
              </span>
            </button>

            {!hideChat ? (
              <button
                type="button"
                onClick={() => setScreen("chat")}
                className="relative flex w-full items-center gap-3 rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-left transition-colors hover:border-[#0f7a5a]/40 hover:bg-[#ecfdf5]"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#ecfdf5] text-[#0f7a5a]">
                  <MessageCircle className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-[#0b1024]">
                    {t("widget.chatTitle")}
                  </span>
                  <span className="block text-[12px] text-[#6f7282]">
                    {consultant
                      ? t("widget.consultantChatDescription", { brandName: consultant.brandName })
                      : t("widget.operatorChatDescription")}
                  </span>
                </span>
                {incoming.unread > 0 ? (
                  <span className="rounded-full bg-[#d2453d] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white">
                    {incoming.unread}
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
        ) : null}

        {screen === "feedback" ? (
          sent ? (
            <div className="px-5 py-8 text-center">
              <p className="text-[14px] leading-[1.55] text-[#0b1024]">
                {t("widget.feedbackSent")}
              </p>
              <button
                type="button"
                onClick={close}
                className="mt-4 inline-flex h-10 items-center rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
              >
                {t("widget.close")}
              </button>
            </div>
          ) : (
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <div className="space-y-2">
                <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                  {t("widget.feedbackType")}
                </div>
                <div className="space-y-1.5">
                  {FEEDBACK_TYPES.map((item) => (
                    <label
                      key={item.value}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[14px] transition-colors",
                        type === item.value
                          ? "border-[#5566f6] bg-[#f5f6ff] text-[#0b1024]"
                          : "border-[#dcdfed] bg-white text-[#3c4053] hover:bg-[#fafbff]"
                      )}
                    >
                      <input
                        type="radio"
                        name="support-feedback-type"
                        value={item.value}
                        checked={type === item.value}
                        onChange={() => setType(item.value)}
                        className="size-4 accent-[#5566f6]"
                      />
                      {t(item.labelKey)}
                    </label>
                  ))}
                </div>
              </div>

              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onPaste={feedbackFiles.handlePaste}
                rows={6}
                placeholder={t("widget.feedbackPlaceholder")}
                className="w-full resize-none rounded-2xl border border-[#dcdfed] px-3.5 py-3 text-[14px] leading-[1.55] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />

              <div>
                <AttachmentChips
                  uploads={feedbackFiles.uploads}
                  onRemove={feedbackFiles.remove}
                />
                <div className="flex items-center gap-2">
                  <AttachButton
                    onFiles={feedbackFiles.addFiles}
                    disabled={busy}
                    className="inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13px] font-medium text-[#3c4053] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                  />
                  <button
                    type="button"
                    onClick={() => void sendFeedback()}
                    disabled={busy || feedbackFiles.uploading}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                    {t("widget.send")}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-[#9b9fb3]">
                  {t("widget.attachmentsHelp")}
                </p>
              </div>
            </div>
          )
        ) : null}

        {screen === "chat" ? (
          <>
            <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
              {messages === null ? (
                <div className="flex items-center gap-2 text-[13px] text-[#9b9fb3]">
                  <Loader2 className="size-4 animate-spin" />
                  {t("widget.chatLoading")}
                </div>
              ) : messages.length === 0 ? (
                <p className="py-6 text-center text-[13px] leading-snug text-[#6f7282]">
                  {t("widget.chatEmpty")}
                </p>
              ) : (
                messages.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-[1.5]",
                      item.author === "client"
                        ? "ml-auto bg-[#5566f6] text-white"
                        : "bg-[#f5f6ff] text-[#0b1024]"
                    )}
                  >
                    {item.author === "operator" && item.operatorName ? (
                      <div className="mb-0.5 text-[11px] font-medium text-[#3848c7]">
                        {item.operatorName}
                      </div>
                    ) : null}
                    {item.author === "client" && showClientAuthors && item.authorName ? (
                      <div className="mb-0.5 text-[11px] font-medium text-white/75">
                        {item.authorName}
                      </div>
                    ) : null}
                    {item.body ? (
                      <div className="whitespace-pre-wrap break-words">
                        {item.body}
                      </div>
                    ) : null}
                    <MessageAttachments
                      attachments={item.attachments}
                      light={item.author === "client"}
                    />
                  </div>
                ))
              )}
              {operatorTyping ? (
                <div
                  className="flex w-fit items-center gap-2 rounded-2xl bg-[#f5f6ff] px-3.5 py-2.5 text-[12px] text-[#6f7282]"
                  aria-live="polite"
                >
                  <span className="flex items-center gap-0.5" aria-hidden>
                    <span className="size-1.5 animate-bounce rounded-full bg-[#5566f6]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-[#5566f6] [animation-delay:120ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-[#5566f6] [animation-delay:240ms]" />
                  </span>
                  {t("widget.operatorTyping")}
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>

            <div className="shrink-0 border-t border-[#eef0f6] p-3">
              <AttachmentChips
                uploads={chatFiles.uploads}
                onRemove={chatFiles.remove}
              />
              <div className="flex items-end gap-2">
                <AttachButton onFiles={chatFiles.addFiles} disabled={busy} />
                <textarea
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (event.target.value.trim()) pingTyping();
                  }}
                  onPaste={chatFiles.handlePaste}
                  onKeyDown={(event) => {
                    // Enter отправляет, Shift+Enter — перенос строки: так
                    // ведут себя все мессенджеры, и переучивать незачем.
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendChat();
                    }
                  }}
                  rows={1}
                  placeholder={t("widget.messagePlaceholder")}
                  className="max-h-28 min-h-[44px] flex-1 resize-none rounded-2xl border border-[#dcdfed] px-3.5 py-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                />
                <button
                  type="button"
                  onClick={() => void sendChat()}
                  disabled={
                    busy ||
                    chatFiles.uploading ||
                    (draft.trim().length < 2 &&
                      chatFiles.readyAttachments.length === 0)
                  }
                  className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#5566f6] text-white transition-colors hover:bg-[#4a5bf0] disabled:opacity-50"
                  aria-label={t("widget.send")}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
