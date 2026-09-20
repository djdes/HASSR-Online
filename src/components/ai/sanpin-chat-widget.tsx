"use client";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { useFabAction, useHasFabDock } from "@/components/layout/fab-dock";
import {
  Bot,
  Check,
  Loader2,
  Send,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import { LiteMarkdown } from "@/components/ui/lite-markdown";
import { SANPIN_CHAT_OPEN_EVENT } from "@/lib/sanpin-chat-bus";
import { IncomingMessagePopup } from "@/components/support/incoming-message-popup";
import type { IncomingPopup } from "@/components/support/use-incoming-messages";
import { playIncomingChirp, primeNotificationSound } from "@/lib/notification-sound";
import { previewOf } from "@/lib/support-threads-shared";

type PendingAction = {
  token: string;
  kind: string;
  title: string;
  details: string[];
  expiresAt: number;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  /** Предложенное действие — карточка с кнопкой «Выполнить». */
  pendingAction?: PendingAction | null;
  /** Что стало с карточкой после клика. */
  actionState?: "confirmed" | "cancelled";
  /** Итог выполнения («Заполнено ячеек: 12»). */
  actionResult?: string;
};

const STARTERS = [
  "Что на этой странице?",
  "Какая температура для холодильника готовых блюд?",
  "Как часто менять масло во фритюре?",
  "Что должно быть в журнале гигиены сотрудников?",
];

// v2: в сообщениях появились карточки действий, старый формат не читаем.
const STORAGE_KEY = "wesetup-sanpin-chat-v2";

/** Ответ через диспетчер занимает 10–60 секунд — статусы сменяются. */
const WAIT_STAGES: Array<[number, string]> = [
  [0, "Думаю…"],
  [8_000, "Изучаю ваши данные…"],
  [25_000, "Ещё немного, сверяюсь с нормативами…"],
];
const CLIENT_TIMEOUT_MS = 100_000;

/**
 * Floating-чат «AI помощник». Иконка в нижнем правом углу; клик —
 * sheet с историей. История в localStorage (20 сообщений).
 *
 * Помощник видит текущую страницу (`pathname` уходит с каждым запросом)
 * и данные организации, а действия (добавить сотрудника, заполнить
 * журнал) предлагает карточкой — выполняются они только после клика
 * «Выполнить». Сайт к LLM не ходит: запрос обрабатывает диспетчер
 * ProjectsFlow, поэтому ответ занимает до минуты.
 */
export function SanpinChatWidget({ bottomOffset }: { bottomOffset?: number }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [waitLabel, setWaitLabel] = useState(WAIT_STAGES[0][1]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  // Ответ пришёл, а панель закрыта (человек ушёл работать, пока помощник
  // думал): звук и всплывашка справа снизу, клик возвращает в панель.
  const [replyPopup, setReplyPopup] = useState<IncomingPopup | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  // Поддержка открывает этот же чат своим пунктом меню — см. sanpin-chat-bus.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(SANPIN_CHAT_OPEN_EVENT, onOpen);
    primeNotificationSound();
    return () => window.removeEventListener(SANPIN_CHAT_OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!replyPopup) return;
    const t = setTimeout(() => setReplyPopup(null), 12_000);
    return () => clearTimeout(t);
  }, [replyPopup]);

  // Restore chat history on mount; протухшие карточки действий гасим.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Message[];
        if (Array.isArray(parsed)) {
          setMessages(
            parsed.slice(-20).map((m) =>
              m.pendingAction &&
              !m.actionState &&
              m.pendingAction.expiresAt < Date.now()
                ? { ...m, actionState: "cancelled" as const }
                : m
            )
          );
        }
      }
    } catch {
      /* ignore corrupted storage */
    }
  }, []);

  // Save on change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-20)));
    } catch {
      /* quota exceeded — silently skip */
    }
  }, [messages]);

  // Scroll to bottom on new message.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open, busy]);

  // Focus input on open.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Сменяющиеся статусы ожидания.
  useEffect(() => {
    if (!busy) {
      setWaitLabel(WAIT_STAGES[0][1]);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - started;
      const stage = [...WAIT_STAGES].reverse().find(([at]) => elapsed >= at);
      if (stage) setWaitLabel(stage[1]);
    }, 1000);
    return () => clearInterval(timer);
  }, [busy]);

  function toApiMessages(list: Message[]) {
    return list.slice(-20).map((m) => ({ role: m.role, content: m.content }));
  }

  async function send(content: string) {
    const trimmed = content.trim();
    if (!trimmed || busy) return;
    const next: Message[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const response = await fetch("/api/ai/sanpin-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: toApiMessages(next),
          pathname: pathname ?? undefined,
        }),
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Ошибка AI");
      }
      setMessages((cur) => [
        ...cur,
        {
          role: "assistant",
          content: data.reply || "(пустой ответ)",
          pendingAction: data.pendingAction ?? null,
        },
      ]);
      playIncomingChirp();
      if (!openRef.current) {
        setReplyPopup({
          id: String(Date.now()),
          threadId: null,
          title: "ИИ-помощник ответил",
          preview: previewOf(String(data.reply ?? ""), 0, 120),
          createdAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      toast.error(
        err instanceof Error && err.name !== "TimeoutError"
          ? err.message
          : "ИИ-помощник не ответил вовремя. Попробуйте ещё раз"
      );
      // Roll back the optimistic user message — keeps history clean.
      setMessages(messages);
    } finally {
      setBusy(false);
    }
  }

  async function confirmAction(index: number, action: PendingAction) {
    if (confirmBusy) return;
    setConfirmBusy(true);
    try {
      const response = await fetch("/api/ai/sanpin-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: toApiMessages(messages).slice(-1),
          confirmAction: { token: action.token },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json();
      const result = data?.actionResult as
        | { ok: boolean; summary?: string; error?: string }
        | undefined;
      if (!response.ok || !result) {
        throw new Error(data?.error ?? "Не удалось выполнить действие");
      }
      setMessages((cur) =>
        cur.map((m, i) =>
          i === index
            ? {
                ...m,
                actionState: "confirmed" as const,
                actionResult: result.ok
                  ? (result.summary ?? "Готово")
                  : `Не выполнено: ${result.error ?? "ошибка"}`,
              }
            : m
        )
      );
      if (result.ok) {
        toast.success(result.summary ?? "Готово");
      } else {
        toast.error(result.error ?? "Не удалось выполнить действие");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось выполнить действие"
      );
    } finally {
      setConfirmBusy(false);
    }
  }

  function cancelAction(index: number) {
    setMessages((cur) =>
      cur.map((m, i) =>
        i === index ? { ...m, actionState: "cancelled" as const } : m
      )
    );
  }

  async function reset() {
    const ok = await confirmAsync({
      title: "Очистить переписку?",
      description:
        "Все вопросы и ответы помощника с этого устройства будут стёрты.",
      bullets: [
        { label: "Вернуть переписку нельзя", tone: "warn" },
        { label: "Журналы и записи это не затрагивает", tone: "default" },
      ],
      confirmLabel: "Очистить",
      variant: "danger",
    });
    if (!ok) return;
    setMessages([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  const fabBottom = bottomOffset ? { bottom: bottomOffset } : undefined;

  const docked = useHasFabDock();
  useFabAction(
    {
      id: "sanpin-chat",
      order: 10,
      label: "ИИ-помощник",
      hint: "Спросить про СанПиН, ХАССП и ваши журналы",
      icon: Sparkles,
      tone: "brand",
      onSelect: () => setOpen(true),
    },
    docked && !open,
  );

  return (
    <>
      <IncomingMessagePopup
        popup={replyPopup}
        icon={Sparkles}
        onOpen={() => {
          setReplyPopup(null);
          setOpen(true);
        }}
        onDismiss={() => setReplyPopup(null)}
      />
      {/* FAB launcher — компактная иконка-кнопка. В кабинете её рисует
          общий док (`FabDockProvider`), в Mini App — этот компонент. */}
      {!open && !docked ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={fabBottom}
          className="fixed bottom-5 right-5 z-40 flex size-11 items-center justify-center rounded-full bg-gradient-to-br from-[#5566f6] to-[#7a5cff] text-white shadow-[0_12px_28px_-10px_rgba(85,102,246,0.6)] transition-all hover:scale-105"
          aria-label="ИИ-помощник по СанПиН"
          title="ИИ-помощник"
        >
          <Sparkles className="size-4" />
        </button>
      ) : null}

      {/* Sheet */}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/30 sm:items-end sm:p-5">
          <BodyScrollLock />
          <div className="flex h-[80svh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_-20px_60px_-20px_rgba(11,16,36,0.4)] sm:h-[600px] sm:max-h-[80svh] sm:w-[440px] sm:rounded-3xl">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-[#ececf4] bg-gradient-to-br from-[#5566f6] to-[#7a5cff] px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-2xl bg-white/15">
                  <Bot className="size-5" />
                </div>
                <div>
                  <div className="text-[15px] font-semibold">ИИ-помощник</div>
                  <div className="text-[12px] text-white/80">
                    СанПиН, ХАССП и ваши журналы
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void reset()}
                  className="rounded-lg px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 hover:text-white"
                >
                  Очистить
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-2 text-white hover:bg-white/15"
                  aria-label="Закрыть"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-5 py-4 text-[14px]"
            >
              {messages.length === 0 ? (
                <div className="space-y-3 text-[13px] leading-relaxed text-[#3c4053]">
                  <p>
                    Я отвечу на вопросы о санитарных нормах, о вашей
                    организации и о странице, где вы находитесь. Могу
                    заполнить журнал или добавить сотрудника — с вашего
                    подтверждения. Спросите, например:
                  </p>
                  <div className="grid gap-2">
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        className="rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-3 py-2 text-left text-[13px] text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <p className="rounded-xl bg-[#fff8eb] px-3 py-2 text-[12px] text-[#7a4a00]">
                    Ответы ИИ — рекомендация. Окончательное решение принимает
                    ваш технолог.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((m, i) => (
                    <MessageBubble
                      key={i}
                      message={m}
                      confirmBusy={confirmBusy}
                      onConfirm={(action) => confirmAction(i, action)}
                      onCancel={() => cancelAction(i)}
                    />
                  ))}
                  {busy ? (
                    <div className="flex items-center gap-2 text-[12px] text-[#6f7282]">
                      <Loader2 className="size-3 animate-spin" />
                      {waitLabel}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="border-t border-[#ececf4] bg-white px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ваш вопрос…"
                  className="h-11 flex-1 rounded-xl border border-[#dcdfed] bg-[#fafbff] px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                  disabled={busy}
                  maxLength={2000}
                />
                <button
                  type="submit"
                  disabled={busy || !input.trim()}
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#5566f6] text-white transition-colors hover:bg-[#4a5bf0] disabled:opacity-50"
                  aria-label="Отправить"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MessageBubble({
  message,
  confirmBusy,
  onConfirm,
  onCancel,
}: {
  message: Message;
  confirmBusy: boolean;
  onConfirm: (action: PendingAction) => void;
  onCancel: () => void;
}) {
  const isUser = message.role === "user";
  const action = message.pendingAction;
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-[1.55] ${
          isUser
            ? "bg-[#5566f6] text-white"
            : "border border-[#ececf4] bg-[#fafbff] text-[#0b1024]"
        }`}
      >
        {isUser ? (
          message.content.split("\n").map((line, i) => (
            <p key={i} className={i > 0 ? "mt-1.5" : ""}>
              {line || " "}
            </p>
          ))
        ) : (
          // Ответы помощника приходят с markdown-разметкой (**жирный**,
          // списки) — рендерим её, а не сырые звёздочки.
          <LiteMarkdown text={message.content} />
        )}

        {/* Карточка предложенного действия */}
        {action ? (
          <div className="mt-2.5 rounded-2xl border border-[#dcdfed] bg-white p-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[#0b1024]">
              <span className="flex size-6 items-center justify-center rounded-lg bg-[#eef1ff]">
                <Zap className="size-3.5 text-[#5566f6]" />
              </span>
              {action.title}
            </div>
            <ul className="mt-2 space-y-1 text-[12px] leading-[1.5] text-[#3c4053]">
              {action.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>

            {message.actionState === "confirmed" ? (
              <div
                className={`mt-2.5 flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[12px] ${
                  message.actionResult?.startsWith("Не выполнено")
                    ? "bg-[#fff4f2] text-[#a13a32]"
                    : "bg-[#ecfdf5] text-[#116b2a]"
                }`}
              >
                <Check className="size-3.5 shrink-0" />
                {message.actionResult ?? "Готово"}
              </div>
            ) : message.actionState === "cancelled" ? (
              <div className="mt-2.5 rounded-xl bg-[#f5f6ff] px-2.5 py-1.5 text-[12px] text-[#6f7282]">
                Отменено
              </div>
            ) : (
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  disabled={confirmBusy}
                  onClick={() => onConfirm(action)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3.5 text-[13px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-50"
                >
                  {confirmBusy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  Выполнить
                </button>
                <button
                  type="button"
                  disabled={confirmBusy}
                  onClick={onCancel}
                  className="inline-flex h-9 items-center rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50"
                >
                  Отмена
                </button>
              </div>
            )}
            <p className="mt-2 text-[11px] leading-[1.4] text-[#9b9fb3]">
              Действие выполнится только после вашего подтверждения.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
