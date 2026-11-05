"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import {
  badgeToneClass,
  formatOrderStatusBadge,
  formatRub,
  generateClientIdempotencyKey,
} from "@/lib/seo/gogetlinks-ui-format";
import {
  formatRuDateTime,
  type GglMessageDto,
  type GglThreadDto,
  SEO_BTN_PRIMARY_CLASS,
  SEO_BTN_SM_CLASS,
  SEO_INPUT_CLASS,
  SEO_TEXTAREA_CLASS,
  shortWesetupPath,
} from "./types";

export interface ChatsTabProps {
  threads: GglThreadDto[];
  focusedThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onRefreshOverview: () => Promise<void> | void;
}

type ThreadFilter = "all" | "unread" | "needs_reply";

function deliveryStatusMeta(status: string): { label: string; className: string } {
  switch (status) {
    case "sending":
      return { label: "Отправляется…", className: "text-[#3848c7]" };
    case "failed":
      return { label: "Ошибка доставки", className: "text-[#a13a32] font-medium" };
    case "synced":
    default:
      return { label: "Отправлено", className: "text-[#6f7282]" };
  }
}

export function ChatsTab({
  threads,
  focusedThreadId,
  onSelectThread,
  onRefreshOverview,
}: ChatsTabProps) {
  const [filter, setFilter] = useState<ThreadFilter>("all");
  const [search, setSearch] = useState("");
  const [messagesByThread, setMessagesByThread] = useState<
    Record<string, GglMessageDto[]>
  >({});
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const [replyBody, setReplyBody] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionComment, setRevisionComment] = useState("");
  const [reviewingOrder, setReviewingOrder] = useState(false);

  const replyIdempotencyRef = useRef<string | null>(null);

  const sortedFilteredThreads = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = threads.filter((t) => {
      if (filter === "unread" && t.unreadCount <= 0) return false;
      if (filter === "needs_reply" && !t.needsReply) return false;
      if (needle) {
        const hay = [
          t.donorDomain ?? "",
          t.webmasterLogin ?? "",
          t.subject ?? "",
          t.lastMessagePreview ?? "",
          t.order?.anchor ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (a.needsReply !== b.needsReply) return a.needsReply ? -1 : 1;
      if ((a.unreadCount > 0) !== (b.unreadCount > 0)) {
        return a.unreadCount > 0 ? -1 : 1;
      }
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [threads, filter, search]);

  const activeThread = useMemo(() => {
    if (focusedThreadId) {
      const exact = threads.find((t) => t.id === focusedThreadId);
      if (exact) return exact;
    }
    return sortedFilteredThreads[0] ?? threads[0] ?? null;
  }, [threads, focusedThreadId, sortedFilteredThreads]);

  const activeThreadId = activeThread?.id ?? null;

  const loadThreadMessages = useCallback(
    async (threadId: string, refreshRemote = true) => {
      setLoadingThreadId(threadId);
      try {
        const response = await fetch(
          `/api/root/gogetlinks/threads/${encodeURIComponent(threadId)}?refresh=${
            refreshRemote ? "true" : "false"
          }`,
        );
        const data = (await response.json().catch(() => null)) as {
          messages?: GglMessageDto[];
          refreshError?: string | null;
          error?: string;
        } | null;
        if (!response.ok) {
          throw new Error(data?.error ?? "Не удалось загрузить переписку");
        }
        setMessagesByThread((prev) => ({
          ...prev,
          [threadId]: data?.messages ?? [],
        }));
        setRefreshError(data?.refreshError ?? null);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Ошибка загрузки диалога",
        );
      } finally {
        setLoadingThreadId((curr) => (curr === threadId ? null : curr));
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeThreadId) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) {
        await loadThreadMessages(activeThreadId, true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeThreadId, loadThreadMessages]);

  const activeMessages = activeThreadId
    ? messagesByThread[activeThreadId] ?? []
    : [];
  const isReadOnlyArchive = activeThread?.campaign?.isWesetup === false;

  async function handleSendReply() {
    if (!activeThread || isReadOnlyArchive) return;
    const text = replyBody.trim();
    if (!text) return;

    if (!replyIdempotencyRef.current) {
      replyIdempotencyRef.current = generateClientIdempotencyKey(
        `reply-${activeThread.id}`,
      );
    }

    setSendingReply(true);
    try {
      const response = await fetch(
        `/api/root/gogetlinks/threads/${encodeURIComponent(activeThread.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: text,
            idempotencyKey: replyIdempotencyRef.current,
          }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        message?: GglMessageDto;
        error?: string;
      } | null;
      if (!response.ok || !data?.message) {
        replyIdempotencyRef.current = null;
        throw new Error(data?.error ?? "Не удалось отправить сообщение");
      }
      const sentMsg = data.message;
      replyIdempotencyRef.current = null;
      setReplyBody("");
      setMessagesByThread((prev) => ({
        ...prev,
        [activeThread.id]: [...(prev[activeThread.id] ?? []), sentMsg],
      }));
      toast.success("Ответ отправлен вебмастеру в GoGetLinks");
      await onRefreshOverview();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Ошибка отправки сообщения",
      );
    } finally {
      setSendingReply(false);
    }
  }

  async function handleQuickOrderReview(action: "accept" | "request_revision") {
    const order = activeThread?.order;
    if (!order || isReadOnlyArchive) return;
    if (action === "request_revision" && revisionComment.trim().length < 5) {
      toast.error("Укажите причину возврата на доработку (минимум 5 символов)");
      return;
    }

    setReviewingOrder(true);
    try {
      const response = await fetch(
        `/api/root/gogetlinks/orders/${encodeURIComponent(order.id)}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            ...(action === "request_revision"
              ? { comment: revisionComment.trim() }
              : {}),
            idempotencyKey: generateClientIdempotencyKey(
              `chat-review-${order.id}-${action}`,
            ),
          }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? "Не удалось выполнить проверку");
      }
      toast.success(
        action === "accept"
          ? `Размещение на ${order.donorDomain} принято`
          : "Замечания отправлены вебмастеру на доработку",
      );
      setRevisionOpen(false);
      setRevisionComment("");
      await onRefreshOverview();
      if (activeThread) {
        await loadThreadMessages(activeThread.id, true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка проверки");
    } finally {
      setReviewingOrder(false);
    }
  }

  const unreadTotal = threads.filter((t) => t.unreadCount > 0).length;
  const needsReplyTotal = threads.filter((t) => t.needsReply).length;

  return (
    <div className="grid min-h-[600px] gap-4 lg:grid-cols-12">
      {/* Left column: Thread list */}
      <div className="flex flex-col rounded-3xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] lg:col-span-5 xl:col-span-4">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { key: "all", label: `Все · ${threads.length}` },
              { key: "unread", label: `Непрочитанные · ${unreadTotal}` },
              { key: "needs_reply", label: `Ждут ответа · ${needsReplyTotal}` },
            ] as Array<{ key: ThreadFilter; label: string }>
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                filter === f.key
                  ? "border-[#5566f6] bg-[#5566f6] text-white"
                  : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по донору, вебмастеру или теме…"
            className={SEO_INPUT_CLASS}
          />
        </div>

        <div className="mt-3 flex-1 space-y-1.5 overflow-y-auto pr-1">
          {sortedFilteredThreads.length === 0 ? (
            <div className="py-12 text-center text-[13px] text-[#6f7282]">
              Диалогов по выбранному фильтру нет.
            </div>
          ) : (
            sortedFilteredThreads.map((t) => {
              const selected = activeThread?.id === t.id;
              const orderBadge = t.order
                ? formatOrderStatusBadge(t.order.status)
                : null;
              const archiveThread = t.campaign?.isWesetup === false;

              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectThread(t.id)}
                  className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                    selected
                      ? "border-[#5566f6] bg-[#eef1ff]/70"
                      : "border-[#ececf4] bg-white hover:border-[#5566f6]/35 hover:bg-[#fafbff]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13.5px] font-semibold text-[#0b1024]">
                      {t.donorDomain || t.webmasterLogin || "Диалог GoGetLinks"}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {t.needsReply ? (
                        <span className="rounded-full bg-[#fffbeb] px-2 py-0.5 text-[10.5px] font-semibold text-[#92400e]">
                          Ждёт ответа
                        </span>
                      ) : null}
                      {t.unreadCount > 0 ? (
                        <span className="rounded-full bg-[#5566f6] px-2 py-0.5 text-[10.5px] font-semibold text-white">
                          {t.unreadCount}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {t.subject ? (
                    <div className="mt-0.5 truncate text-[12px] font-medium text-[#3c4053]">
                      {t.subject}
                    </div>
                  ) : null}

                  {t.lastMessagePreview ? (
                    <div className="mt-1 line-clamp-2 text-[12px] text-[#6f7282]">
                      {t.lastMessagePreview}
                    </div>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-[#6f7282]">
                    <div className="flex items-center gap-1.5">
                      {orderBadge ? (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${badgeToneClass(
                            orderBadge.badgeTone,
                          )}`}
                        >
                          {orderBadge.label}
                        </span>
                      ) : null}
                      {archiveThread && t.campaign ? (
                        <span className="rounded-md bg-[#f4f4f8] px-1.5 py-0.5 text-[10.5px] text-[#6f7282]">
                          {t.campaign.domain}
                        </span>
                      ) : null}
                    </div>
                    <span>{formatRuDateTime(t.lastMessageAt)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right column: Conversation feed & order context */}
      <div className="flex flex-col rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)] lg:col-span-7 xl:col-span-8">
        {!activeThread ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <MessageSquare className="size-9 text-[#9b9fb3]" />
            <div className="mt-3 text-[15px] font-medium text-[#0b1024]">
              Выберите диалог слева
            </div>
            <p className="mt-1 max-w-[360px] text-[13px] text-[#6f7282]">
              Здесь отображаются все сообщения вебмастеров GoGetLinks и история ответов от лица команды Wesetup.
            </p>
          </div>
        ) : (
          <>
            {/* Thread & Order context bar */}
            <div className="border-b border-[#ececf4] px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[16px] font-semibold text-[#0b1024]">
                      {activeThread.donorDomain ||
                        activeThread.webmasterLogin ||
                        "Диалог с вебмастером"}
                    </h3>
                    {activeThread.webmasterLogin ? (
                      <span className="text-[12.5px] text-[#6f7282]">
                        вебмастер: {activeThread.webmasterLogin}
                      </span>
                    ) : null}
                    {isReadOnlyArchive && activeThread.campaign ? (
                      <span className="rounded-full border border-[#fde68a] bg-[#fffbeb] px-2.5 py-0.5 text-[11px] font-medium text-[#92400e]">
                        Архив {activeThread.campaign.domain} · только чтение
                      </span>
                    ) : null}
                  </div>
                  {activeThread.subject ? (
                    <div className="mt-0.5 text-[13px] text-[#6f7282]">
                      {activeThread.subject}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  disabled={loadingThreadId === activeThread.id}
                  onClick={() => void loadThreadMessages(activeThread.id, true)}
                  className={SEO_BTN_SM_CLASS}
                >
                  <RefreshCw
                    className={`size-3.5 ${
                      loadingThreadId === activeThread.id ? "animate-spin" : ""
                    }`}
                  />
                  Обновить диалог
                </button>
              </div>

              {activeThread.order ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-3.5 py-2.5 text-[12.5px]">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold text-[#0b1024]">
                      {formatRub(activeThread.order.priceRub)}
                    </span>
                    <span className="text-[#6f7282]">
                      Посадочная:{" "}
                      <strong className="text-[#0b1024]">
                        {shortWesetupPath(activeThread.order.targetUrl)}
                      </strong>
                    </span>
                    <span className="text-[#6f7282]">
                      Анкор:{" "}
                      <strong className="text-[#0b1024]">
                        «{activeThread.order.anchor}»
                      </strong>
                    </span>
                    {activeThread.order.publishedUrl ? (
                      <a
                        href={activeThread.order.publishedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-[#3848c7] underline-offset-2 hover:underline"
                      >
                        Проверить размещение
                        <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </div>

                  {activeThread.order.status === "on_check" &&
                  !isReadOnlyArchive ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={reviewingOrder}
                        onClick={() => void handleQuickOrderReview("accept")}
                        className="inline-flex h-8 items-center gap-1 rounded-xl bg-[#116b2a] px-2.5 text-[12px] font-medium text-white hover:bg-[#0e5822] disabled:opacity-50"
                      >
                        <Check className="size-3.5" />
                        Принять
                      </button>
                      <button
                        type="button"
                        disabled={reviewingOrder}
                        onClick={() => setRevisionOpen((v) => !v)}
                        className={SEO_BTN_SM_CLASS}
                      >
                        <RotateCcw className="size-3.5 text-[#a13a32]" />
                        На доработку
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {revisionOpen &&
              activeThread.order?.status === "on_check" &&
              !isReadOnlyArchive ? (
                <div className="mt-2.5 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-3">
                  <textarea
                    rows={2}
                    value={revisionComment}
                    onChange={(e) => setRevisionComment(e.target.value)}
                    placeholder="Опишите, что вебмастер должен поправить (минимум 5 символов)…"
                    className={SEO_TEXTAREA_CLASS}
                  />
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setRevisionOpen(false)}
                      className={SEO_BTN_SM_CLASS}
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      disabled={
                        reviewingOrder || revisionComment.trim().length < 5
                      }
                      onClick={() =>
                        void handleQuickOrderReview("request_revision")
                      }
                      className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[#a13a32] px-3 text-[12px] font-medium text-white disabled:opacity-50"
                    >
                      Отправить на доработку
                    </button>
                  </div>
                </div>
              ) : null}

              {refreshError ? (
                <div className="mt-2 text-[12px] text-[#92400e]">
                  Показана сохранённая история из БД (живое обновление GoGetLinks временно вернуло: {refreshError}).
                </div>
              ) : null}
            </div>

            {/* Messages feed */}
            <div className="flex-1 space-y-3 overflow-y-auto bg-[#fafbff]/60 p-5">
              {loadingThreadId === activeThread.id &&
              activeMessages.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-14 text-[13.5px] text-[#6f7282]">
                  <Loader2 className="size-4 animate-spin text-[#5566f6]" />
                  Загрузка сообщений диалога…
                </div>
              ) : activeMessages.length === 0 ? (
                <div className="py-14 text-center text-[13.5px] text-[#6f7282]">
                  Сообщений в этом диалоге пока нет. Вы можете написать вебмастеру первым ниже.
                </div>
              ) : (
                activeMessages.map((msg) => {
                  const isOutbound = msg.direction === "outbound";
                  const delivery = deliveryStatusMeta(msg.deliveryStatus);

                  return (
                    <div
                      key={msg.id}
                      className={`flex ${
                        isOutbound ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[82%] rounded-2xl border px-4 py-3 text-[13.5px] leading-relaxed ${
                          isOutbound
                            ? "border-[#d8deff] bg-[#eef1ff] text-[#0b1024]"
                            : "border-[#dcdfed] bg-white text-[#0b1024]"
                        }`}
                      >
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-3 text-[11.5px]">
                          <span className="font-semibold text-[#3848c7]">
                            {isOutbound
                              ? msg.sentByName
                                ? `Wesetup · ${msg.sentByName}`
                                : "Аккаунт GoGetLinks"
                              : msg.authorLabel || "Вебмастер"}
                          </span>
                          <span className="text-[#6f7282]">
                            {formatRuDateTime(msg.sentAt)}
                          </span>
                        </div>
                        <div className="whitespace-pre-wrap break-words">
                          {msg.body}
                        </div>
                        {isOutbound ? (
                          <div
                            className={`mt-1 text-right text-[11px] ${delivery.className}`}
                          >
                            {delivery.label}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Reply composer */}
            <div className="border-t border-[#ececf4] bg-white p-4">
              {isReadOnlyArchive ? (
                <div className="rounded-2xl border border-[#dcdfed] bg-[#f4f4f8] px-4 py-3 text-center text-[13px] text-[#6f7282]">
                  Отправка сообщений заблокирована: диалог относится к стороннему архивному домену ({activeThread.campaign?.domain}).
                </div>
              ) : (
                <div className="space-y-2.5">
                  <textarea
                    rows={3}
                    value={replyBody}
                    disabled={sendingReply}
                    onChange={(e) => {
                      replyIdempotencyRef.current = null;
                      setReplyBody(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        void handleSendReply();
                      }
                    }}
                    placeholder="Напишите ответ вебмастеру (отправится напрямую в GoGetLinks с подписью вашего имени в журнале Wesetup)…"
                    className={SEO_TEXTAREA_CLASS}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11.5px] text-[#6f7282]">
                      Ctrl + Enter — быстрая отправка
                    </span>
                    <button
                      type="button"
                      disabled={sendingReply || !replyBody.trim()}
                      onClick={() => void handleSendReply()}
                      className={SEO_BTN_PRIMARY_CLASS}
                    >
                      {sendingReply ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                      {sendingReply
                        ? "Отправляется…"
                        : "Отправить вебмастеру"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
