"use client";

import { useTranslations } from "next-intl";
import { useSiteLocale } from "@/components/i18n/site-locale-provider";
import { phoneInputProps } from "@/lib/phone-input";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Mail,
  MessageCircle,
  MessagesSquare,
  Phone,
  Send,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import {
  isNotificationSoundMuted,
  setNotificationSoundMuted,
} from "@/lib/notification-sound";
import {
  SUPPORT_CHAT_OPEN_EVENT,
  announceSupportChatRead,
} from "@/lib/support-chat-bus";
import type { SupportAttachmentMeta } from "@/lib/support-attachments-shared";

/**
 * Поддержка для гостя сайта — тот же пузырь, что в кабинете, только без
 * авторизации.
 *
 * Отличие ровно одно и оно определяет всю форму: у гостя нет профиля,
 * поэтому вместо шапки «под кем вы авторизованы» он сам оставляет телефон
 * и почту. Спрашиваем один раз, до выбора «чат или обратная связь»:
 * без контакта ответить некуда, а заставлять заполнять оба поля значит
 * терять половину обращений. Кто уже оставлял — попадает сразу в меню.
 *
 * Переписка привязана к случайному id в localStorage: вернувшись через
 * день, человек видит свою ветку, а не пустой чат.
 */

type Screen = "contact" | "menu" | "feedback" | "chat";
type FeedbackType = "bug" | "suggestion" | "partnership";
type FeedbackTypeLabelKey = "widget.feedbackTypeBug" | "widget.feedbackTypeSuggestion" | "widget.feedbackTypePartnership";

const FEEDBACK_TYPES: Array<{ value: FeedbackType; labelKey: FeedbackTypeLabelKey }> = [
  { value: "bug", labelKey: "widget.feedbackTypeBug" },
  { value: "suggestion", labelKey: "widget.feedbackTypeSuggestion" },
  { value: "partnership", labelKey: "widget.feedbackTypePartnership" },
];

const SCREEN_TITLE_KEYS: Record<Screen, "widget.contactTitle" | "widget.menuTitle" | "widget.feedbackTitle" | "widget.chatTitle"> = {
  contact: "widget.contactTitle",
  menu: "widget.menuTitle",
  feedback: "widget.feedbackTitle",
  chat: "widget.chatTitle",
};

type ChatMessage = {
  id: string;
  author: string;
  body: string;
  operatorName: string | null;
  attachments?: SupportAttachmentMeta[];
  createdAt: string;
};

type Contact = { email: string; phone: string };
type ContactField = "phone" | "email";
type ContactErrorKey = "contactRequired" | "contactBothInvalid" | "phoneInvalid" | "emailInvalid";
type ContactError = { message: ContactErrorKey; fields: ContactField[] };
const CONTACT_ERROR_TRANSLATION_KEYS: Record<ContactErrorKey, `widget.${ContactErrorKey}`> = {
  contactRequired: "widget.contactRequired",
  contactBothInvalid: "widget.contactBothInvalid",
  phoneInvalid: "widget.phoneInvalid",
  emailInvalid: "widget.emailInvalid",
};

const GUEST_KEY = "wesetup.support-guest-id";
const CONTACT_KEY = "wesetup.support-contact";
/** Гость уже писал в чат — только тогда есть смысл опрашивать статус ветки. */
const HAS_THREAD_KEY = "wesetup.support-guest-has-thread";
const CHAT_POLL_MS = 10_000;
/** Пульс вокруг пузыря гаснет сам: навязчивая анимация раздражает сильнее, чем зовёт. */
const ATTENTION_MS = 4_000;
const EMAIL_RE = /^\S+@\S+\.\S+$/;

const INPUT_CLASS =
  "h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const INVALID_INPUT_CLASS =
  "border-[#a13a32] focus:border-[#a13a32] focus:ring-[#a13a32]/15";

/** id гостя переживает перезагрузку — иначе ветка теряется на F5. */
function readGuestId(): string {
  try {
    const stored = localStorage.getItem(GUEST_KEY);
    if (stored) return stored;
    const fresh = crypto.randomUUID();
    localStorage.setItem(GUEST_KEY, fresh);
    return fresh;
  } catch {
    // Приватный режим — id живёт только в памяти вкладки.
    return crypto.randomUUID();
  }
}

/** Контакт из прошлого визита; битую или пустую запись считаем отсутствием. */
function readSavedContact(): Contact | null {
  try {
    const raw = localStorage.getItem(CONTACT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: unknown; phone?: unknown };
    const email = typeof parsed.email === "string" ? parsed.email.trim() : "";
    const phone = typeof parsed.phone === "string" ? parsed.phone.trim() : "";
    return email || phone ? { email, phone } : null;
  } catch {
    return null;
  }
}

/** Проверяем мягко: хватит одного контакта, лишь бы по нему можно было ответить. */
function validateContact({ phone, email }: Contact): ContactError | null {
  if (!phone && !email) {
    return {
      message: "contactRequired",
      fields: ["phone", "email"],
    };
  }
  const fields: ContactField[] = [];
  if (phone && phone.replace(/\D/g, "").length < 10) fields.push("phone");
  if (email && !EMAIL_RE.test(email)) fields.push("email");
  if (fields.length === 0) return null;
  const message =
    fields.length === 2
      ? "contactBothInvalid"
      : fields[0] === "phone"
        ? "phoneInvalid"
        : "emailInvalid";
  return { message, fields };
}

/**
 * Виджет живёт в футере, а у футера на лендинге при появлении стоит
 * transform/filter — для `position: fixed` это становится containing
 * block, и пузырь уезжал в самый низ страницы. Поэтому рендерим в body.
 */
export function PublicSupportWidget() {
  // На сервере и при гидрации — null, после — портал в body.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return createPortal(<SupportWidgetBody />, document.body);
}

function SupportWidgetBody() {
  const t = useTranslations("publicSupport");
  const locale = useSiteLocale();
  const apiErrorText = (code: string | null, fallback: string) => {
    const errorKeys = {
      invalid_request: "widget.apiErrors.invalid_request",
      missing_contact: "widget.apiErrors.missing_contact",
      invalid_email: "widget.apiErrors.invalid_email",
      rate_limited: "widget.apiErrors.rate_limited",
      invalid_attachments: "widget.apiErrors.invalid_attachments",
      message_too_short: "widget.apiErrors.message_too_short",
    } as const;
    return code && Object.hasOwn(errorKeys, code)
      ? t(errorKeys[code as keyof typeof errorKeys])
      : fallback;
  };
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<Screen>("menu");
  /// Пульс у закрытого пузыря: до первого открытия или пока не истёк таймер.
  const [attention, setAttention] = useState(true);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  /// Подтверждённый контакт — по нему решаем, пускать ли сразу в меню.
  const [saved, setSaved] = useState<Contact | null>(null);
  const [contactError, setContactError] = useState<ContactError | null>(null);
  /// Куда вернуть после экрана контакта: обычно в меню, но если контакт
  /// потерялся посреди отправки — обратно на ту же форму.
  const afterContact = useRef<Screen>("menu");
  /// Ловушка для ботов: поле спрятано от человека, но не от автозаполнялки.
  const [company, setCompany] = useState("");

  const [type, setType] = useState<FeedbackType | "">("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const guestId = useRef<string | null>(null);
  // Дубль в state: хук вложений должен видеть id в момент рендера, а не
  // только внутри ref (иначе загрузка до первого re-render уйдёт без него).
  const [guestIdState, setGuestIdState] = useState<string | null>(null);
  /// Ветка уже есть — фоновый опрос «ответили ли» имеет смысл.
  const [hasThread, setHasThread] = useState(false);
  const [muted, setMuted] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const phoneRef = useRef<HTMLInputElement | null>(null);

  // Вложения: чат и обратная связь — раздельные наборы.
  const chatFiles = useAttachmentUploads({ guestId: guestIdState });
  const feedbackFiles = useAttachmentUploads({ guestId: guestIdState });

  useEffect(() => {
    if (!attention) return;
    const timer = setTimeout(() => setAttention(false), ATTENTION_MS);
    return () => clearTimeout(timer);
  }, [attention]);

  // Кто уже переписывался — id гостя нужен сразу, до открытия пузыря:
  // ответ оператора должен прозвучать, даже если виджет ни разу не трогали.
  useEffect(() => {
    setMuted(isNotificationSoundMuted());
    try {
      if (localStorage.getItem(HAS_THREAD_KEY) !== "1") return;
    } catch {
      return;
    }
    if (!guestId.current) guestId.current = readGuestId();
    setGuestIdState(guestId.current);
    setHasThread(true);
  }, []);

  const chatVisible = open && screen === "chat";
  const incoming = useIncomingMessages({
    enabled: hasThread && Boolean(guestIdState),
    statusUrl: guestIdState
      ? `/api/public/support-chat/status?guestId=${encodeURIComponent(guestIdState)}`
      : null,
    scope: guestIdState ? `guest:${guestIdState}` : "guest",
    chatVisible,
      title: (status) => status.latest?.operatorName ?? t("widget.title"),
  });
  const { chirpFor } = incoming;

  const rememberContact = useCallback((next: Contact) => {
    setSaved(next);
    try {
      localStorage.setItem(CONTACT_KEY, JSON.stringify(next));
    } catch {
      /* приватный режим — просто не запоминаем */
    }
  }, []);

  /** Контакт спрашиваем до меню: кто уже оставлял — сразу к кнопкам. */
  function openWidget() {
    setAttention(false);
    if (!guestId.current) guestId.current = readGuestId();
    setGuestIdState(guestId.current);
    let known = saved;
    if (!known) {
      known = readSavedContact();
      if (known) {
        setSaved(known);
        setEmail(known.email);
        setPhone(known.phone);
      }
    }
    afterContact.current = "menu";
    setScreen(known ? "menu" : "contact");
    setOpen(true);
    return known;
  }

  /** Всплывашка «новое сообщение» ведёт сразу в переписку. */
  const openChatRef = useRef<() => void>(() => {});
  openChatRef.current = () => {
    const known = openWidget();
    if (known) setScreen("chat");
    else afterContact.current = "chat";
  };
  useEffect(() => {
    const handler = () => openChatRef.current();
    window.addEventListener(SUPPORT_CHAT_OPEN_EVENT, handler);
    return () => window.removeEventListener(SUPPORT_CHAT_OPEN_EVENT, handler);
  }, []);

  function toggleMute() {
    const next = !muted;
    setNotificationSoundMuted(next);
    setMuted(next);
  }

  /** Незавершённую правку контакта откатываем к сохранённому. */
  const restoreContact = useCallback(() => {
    setContactError(null);
    if (!saved) return;
    setEmail(saved.email);
    setPhone(saved.phone);
  }, [saved]);

  const close = useCallback(() => {
    setOpen(false);
    setSent(false);
    if (screen === "contact") restoreContact();
  }, [screen, restoreContact]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  useEffect(() => {
    if (!open || screen !== "contact") return;
    // Автофокус только с мышью: на телефоне клавиатура сразу закрыла бы полкарточки.
    if (window.matchMedia("(pointer: fine)").matches) phoneRef.current?.focus();
  }, [open, screen]);

  function backToMenu() {
    if (screen === "contact") restoreContact();
    setSent(false);
    setScreen("menu");
  }

  function editContact() {
    setContactError(null);
    afterContact.current = "menu";
    setScreen("contact");
  }

  function submitContact() {
    const next = { phone: phone.trim(), email: email.trim() };
    const problem = validateContact(next);
    if (problem) {
      setContactError(problem);
      return;
    }
    setPhone(next.phone);
    setEmail(next.email);
    setContactError(null);
    rememberContact(next);
    setScreen(afterContact.current);
    afterContact.current = "menu";
  }

  /** Контакт потерялся посреди отправки — не тост, а обратно к вопросу. */
  function requireContact(from: Screen) {
    afterContact.current = from;
    setScreen("contact");
  }

  const loadChat = useCallback(
    async (markRead = false) => {
      if (!guestId.current) return;
      const read = markRead && document.visibilityState === "visible";
      const response = await fetch(
        "/api/public/support-chat?guestId=" +
          encodeURIComponent(guestId.current) +
          (read ? "&markRead=1" : "")
      ).catch(() => null);
      if (!response?.ok) {
        setMessages((current) => current ?? []);
        return;
      }
      const data = await response.json().catch(() => null);
      const list: ChatMessage[] = data?.messages ?? [];
      setMessages(list);
      if (data?.contact?.email) setEmail((value) => value || data.contact.email);
      if (data?.contact?.phone) setPhone((value) => value || data.contact.phone);
      // Оператор ответил, пока чат открыт: звук без всплывашки.
      const last = list[list.length - 1];
      if (last && last.author === "operator") chirpFor(last.id);
      if (read) announceSupportChatRead();
    },
    [chirpFor]
  );

  useEffect(() => {
    if (!chatVisible) return;
    void loadChat(true);
    const timer = setInterval(() => void loadChat(true), CHAT_POLL_MS);
    return () => clearInterval(timer);
  }, [chatVisible, loadChat]);

  useEffect(() => {
    if (screen === "chat") bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, screen]);

  const hasContact = email.trim().length > 0 || phone.trim().length > 0;

  async function sendFeedback() {
    if (!type) {
      toast.error(t("widget.feedbackTypeRequired"));
      return;
    }
    if (message.trim().length < 3) {
      toast.error(t("widget.feedbackMessageRequired"));
      return;
    }
    if (!hasContact) {
      requireContact("feedback");
      return;
    }
    if (feedbackFiles.uploading) {
      toast.error(t("widget.waitForAttachments"));
      return;
    }
    setBusy(true);
    let apiErrorCode: string | null = null;
    try {
      const response = await fetch("/api/public/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          message,
          email,
          phone,
          company,
          guestId: guestId.current ?? undefined,
          attachments: feedbackFiles.readyAttachments,
        }),
      });
      const data = await response.json().catch(() => null);
      apiErrorCode = typeof data?.code === "string" ? data.code : null;
      if (!response.ok) throw new Error(data?.error ?? t("widget.feedbackSendFallback"));
      rememberContact({ email, phone });
      setSent(true);
      setMessage("");
      setType("");
      feedbackFiles.clear();
    } catch {
      toast.error(apiErrorText(apiErrorCode, t("widget.feedbackSendFallback")));
    } finally {
      setBusy(false);
    }
  }

  async function sendChat() {
    const body = draft.trim();
    const attachments = chatFiles.readyAttachments;
    // Можно отправить только файл, без текста — «просто скинул скрин».
    if (body.length < 2 && attachments.length === 0) return;
    if (!hasContact) {
      requireContact("chat");
      return;
    }
    if (chatFiles.uploading) {
      toast.error(t("widget.waitForAttachments"));
      return;
    }
    setBusy(true);
    setDraft("");
    let apiErrorCode: string | null = null;
    try {
      const response = await fetch("/api/public/support-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestId: guestId.current,
          message: body,
          email,
          phone,
          company,
          attachments,
        }),
      });
      const data = await response.json().catch(() => null);
      apiErrorCode = typeof data?.code === "string" ? data.code : null;
      if (!response.ok || !data?.message) {
          throw new Error(data?.error ?? t("widget.chatSendFallback"));
      }
      rememberContact({ email, phone });
      setMessages((current) => [...(current ?? []), data.message]);
      chatFiles.clear();
      // С этого момента есть что ждать — включаем фоновый опрос ответа.
      try {
        localStorage.setItem(HAS_THREAD_KEY, "1");
      } catch {
        /* приватный режим — опрос только в этой вкладке */
      }
      setHasThread(true);
    } catch {
      setDraft(body);
      toast.error(apiErrorText(apiErrorCode, t("widget.chatSendFallback")));
    } finally {
      setBusy(false);
    }
  }

  /** Ловушка: скрыта от человека, видна автозаполнялке бота. Родитель — relative. */
  const honeypot = (
    <input
      type="text"
      value={company}
      onChange={(event) => setCompany(event.target.value)}
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
      className="pointer-events-none absolute left-[-9999px] size-0 opacity-0"
    />
  );

  const savedContacts = saved
    ? [saved.phone, saved.email].filter(Boolean)
    : [];
  const savedLabel = new Intl.ListFormat(locale === "uz" ? "uz-Latn" : locale, {
    type: "conjunction",
    style: "long",
  }).format(savedContacts);
  const phoneInvalid = contactError?.fields.includes("phone") ?? false;
  const emailInvalid = contactError?.fields.includes("email") ?? false;

  const popup = (
    <IncomingMessagePopup
      popup={incoming.popup}
      onOpen={() => {
        incoming.dismissPopup();
        openChatRef.current();
      }}
      onDismiss={incoming.dismissPopup}
    />
  );

  if (!open) {
    return (
      <>
        {popup}
        <button
          type="button"
          onClick={openWidget}
          className="fixed bottom-5 right-5 z-30 flex size-12 items-center justify-center rounded-full bg-[#5566f6] text-white shadow-[0_14px_30px_-10px_rgba(85,102,246,0.6)] ring-1 ring-white/25 transition-all duration-200 hover:scale-105 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25"
          aria-label={
            incoming.unread > 0
          ? t("widget.contactUnread", { count: incoming.unread })
          : t("widget.contactUs")
          }
      title={t("widget.writeUs")}
        >
          {attention && incoming.unread === 0 ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-full bg-[#5566f6] opacity-40 motion-safe:animate-ping"
            />
          ) : null}
          <LauncherBadge count={incoming.unread} />
          <MessageCircle className="relative size-5" />
        </button>
      </>
    );
  }

  return (
    <>
    {popup}
    <div className="fixed bottom-5 right-5 z-40 flex max-h-[min(640px,calc(100vh-2.5rem))] w-[calc(100vw-2.5rem)] max-w-sm flex-col overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_30px_80px_-20px_rgba(11,16,36,0.45)]">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#eef0f6] px-5 py-4">
        <div className="min-w-0">
          {/* На первом вопросе о контакте возвращаться некуда — меню ещё закрыто. */}
          {screen !== "menu" && (screen !== "contact" || saved) ? (
            <button
              type="button"
              onClick={backToMenu}
              className="mb-1 inline-flex items-center gap-1 text-[12.5px] text-[#6f7282] transition-colors hover:text-[#3848c7]"
            >
              <ArrowLeft className="size-3.5" />
            {t("widget.back")}</button>
          ) : null}
          <div className="text-[15px] font-semibold text-[#0b1024]">
              {t(SCREEN_TITLE_KEYS[screen])}
          </div>
          <div className="mt-1 text-[12px] leading-snug text-[#6f7282]">
            {screen === "contact"
                ? t("widget.contactPrompt")
                : t("widget.businessHours")}
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

      {screen === "contact" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitContact();
          }}
          className="relative space-y-3 overflow-y-auto px-5 py-4"
        >
          <div className="space-y-2">
            <input
              ref={phoneRef}
              type="tel"
              {...phoneInputProps(phone, (value) => {
                setPhone(value);
                setContactError(null);
              })}
              placeholder={t("widget.phone")}
              aria-label={t("widget.phone")}
              aria-invalid={phoneInvalid || undefined}
              autoComplete="tel"
              inputMode="tel"
              className={cn(INPUT_CLASS, phoneInvalid && INVALID_INPUT_CLASS)}
            />
            <input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setContactError(null);
              }}
              placeholder="E-mail"
              aria-label="E-mail"
              aria-invalid={emailInvalid || undefined}
              autoComplete="email"
              inputMode="email"
              className={cn(INPUT_CLASS, emailInvalid && INVALID_INPUT_CLASS)}
            />
            {honeypot}
          </div>
          {contactError ? (
            <p role="alert" className="text-[13px] leading-snug text-[#a13a32]">
              {t(CONTACT_ERROR_TRANSLATION_KEYS[contactError.message])}
            </p>
          ) : null}
          <button
            type="submit"
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
          >
              {t("widget.continue")}<ArrowRight className="size-4" />
          </button>
          <p className="text-[12px] leading-snug text-[#9b9fb3]">
            {t("widget.oneContactPrivacy")}</p>
        </form>
      ) : null}

      {screen === "menu" ? (
        <div className="space-y-2 p-5">
          {/* Куда ответим — видно до выбора, чтобы опечатку поймали ещё здесь. */}
          {saved ? (
            <div className="mb-3 flex items-center gap-2 rounded-2xl bg-[#f5f6ff] px-3.5 py-2.5 text-[12.5px] text-[#3c4053]">
              {saved.phone ? (
                <Phone className="size-3.5 shrink-0 text-[#5566f6]" />
              ) : (
                <Mail className="size-3.5 shrink-0 text-[#5566f6]" />
              )}
              <span className="min-w-0 flex-1 truncate">
              {t.rich("widget.replyToContacts", {
                contactList: savedLabel,
                contacts: (chunks) => (
                  <span className="font-medium text-[#0b1024]">{chunks}</span>
                ),
              })}
              </span>
              <span aria-hidden="true" className="text-[#9b9fb3]">
                ·
              </span>
              <button
                type="button"
                onClick={editContact}
                className="shrink-0 font-medium text-[#3848c7] transition-colors hover:text-[#5566f6]"
              >
              {t("widget.change")}</button>
            </div>
          ) : null}
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
                {t("widget.feedbackTitle")}</span>
              <span className="block text-[12px] text-[#6f7282]">
                {t("widget.feedbackDescription")}</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setScreen("chat")}
            className="flex w-full items-center gap-3 rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-left transition-colors hover:border-[#0f7a5a]/40 hover:bg-[#ecfdf5]"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#ecfdf5] text-[#0f7a5a]">
              <MessageCircle className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-medium text-[#0b1024]">
                {t("widget.chatTitle")}</span>
              <span className="block text-[12px] text-[#6f7282]">
                {t("widget.chatDescription")}</span>
            </span>
          </button>
        </div>
      ) : null}

      {screen === "feedback" ? (
        sent ? (
          <div className="px-5 py-8 text-center">
            <p className="text-[14px] leading-[1.55] text-[#0b1024]">
              {t("widget.thanks")}</p>
            <button
              type="button"
              onClick={close}
              className="mt-4 inline-flex h-10 items-center rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
            >
              {t("widget.close")}</button>
          </div>
        ) : (
          <div className="relative space-y-4 overflow-y-auto px-5 py-4">
            <div className="space-y-2">
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                {t("widget.feedbackType")}</div>
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
                      name="public-feedback-type"
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

            {honeypot}

            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onPaste={feedbackFiles.handlePaste}
              rows={5}
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
                  {t("widget.send")}</button>
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-[#9b9fb3]">
                {t("widget.attachmentsHelp")}</p>
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
                {t("widget.chatLoading")}</div>
            ) : messages.length === 0 ? (
              <p className="py-6 text-center text-[13px] leading-snug text-[#6f7282]">
                {t("widget.chatEmpty")}</p>
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
                onChange={(event) => setDraft(event.target.value)}
                onPaste={chatFiles.handlePaste}
                onKeyDown={(event) => {
                  // Enter отправляет, Shift+Enter — перенос строки: так
                  // ведут себя все мессенджеры, переучивать незачем.
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendChat();
                  }
                }}
                rows={1}
                placeholder={t("widget.messagePlaceholder")}
                className="max-h-28 min-h-[44px] flex-1 resize-none rounded-2xl border border-[#dcdfed] px-3.5 py-3 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
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
