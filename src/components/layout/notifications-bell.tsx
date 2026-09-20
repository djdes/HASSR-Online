"use client";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, X } from "lucide-react";
import { toast } from "sonner";
import { openSupportChat } from "@/lib/support-chat-bus";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useLiveEvents } from "@/lib/use-live-events";

type NotificationItem = {
  id: string;
  label: string;
  hint?: string;
  /** Per-item ссылка. Если есть — клик по подзадаче ведёт сюда,
   *  иначе fallback на row.linkHref. */
  href?: string;
};

type NotificationRow = {
  id: string;
  title: string;
  linkHref: string | null;
  linkLabel: string | null;
  items: NotificationItem[];
  readAt: string | null;
  createdAt: string;
};

type ApiResponse = {
  unread: NotificationRow[];
  read: NotificationRow[];
  unreadCount: number;
};

function asItems(raw: unknown): NotificationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    .map((v) => ({
      id: typeof v.id === "string" ? v.id : "",
      label: typeof v.label === "string" ? v.label : "",
      hint: typeof v.hint === "string" ? v.hint : undefined,
      href: typeof v.href === "string" ? v.href : undefined,
    }))
    .filter((it) => it.id && it.label);
}

/** Стабильный ключ для per-item selection. Notification.id + item.id —
 *  каждый item уникален в рамках своей нотификации. */
function itemKey(rowId: string, itemId: string) {
  return `${rowId}::${itemId}`;
}

/**
 * Чекбокс с тремя состояниями: none / all / indeterminate. Native
 * <input type="checkbox"> поддерживает indeterminate только через
 * imperative DOM API (`el.indeterminate = true`) — выставляем через ref
 * каждый рендер. Клик всегда вызывает `onClick`; consumer сам решает
 * что делать (toggle all / toggle none).
 */
function TriStateCheckbox({
  state,
  onClick,
  ariaLabel,
  className,
}: {
  state: "none" | "all" | "indeterminate";
  onClick: () => void;
  ariaLabel?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "indeterminate";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={ariaLabel}
      checked={state === "all"}
      onChange={onClick}
      className={`size-4 shrink-0 cursor-pointer rounded border-[#dcdfed] text-[#5566f6] focus:ring-[#5566f6] ${className ?? ""}`}
    />
  );
}

const REFRESH_INTERVAL_MS = 60 * 1000;
/** Ссылка уведомлений поддержки — см. support-threads.ts. */
const SUPPORT_CHAT_HREF = "/dashboard?support=chat";

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"unread" | "read">("unread");
  const [data, setData] = useState<ApiResponse>({
    unread: [],
    read: [],
    unreadCount: 0,
  });
  // Хранит:
  //   - row-id для нотификаций без подзадач (таких в проекте немного)
  //   - itemKey(rowId, itemId) для подзадач каждой нотификации
  // Чекбокс шапки нотификации checked если ВСЕ её items selected, и
  // indeterminate если только некоторые.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmRemoveAllOpen, setConfirmRemoveAllOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as {
        unread: Array<Record<string, unknown>>;
        read: Array<Record<string, unknown>>;
        unreadCount: number;
      };
      const normalise = (rows: Array<Record<string, unknown>>): NotificationRow[] =>
        rows.map((r) => ({
          id: r.id as string,
          title: r.title as string,
          linkHref: (r.linkHref as string | null) ?? null,
          linkLabel: (r.linkLabel as string | null) ?? null,
          items: asItems(r.items),
          readAt: (r.readAt as string | null) ?? null,
          createdAt: r.createdAt as string,
        }));
      setData({
        unread: normalise(j.unread),
        read: normalise(j.read),
        unreadCount: j.unreadCount,
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    // Poll /api/notifications on mount + every minute. setState inside load
    // happens after an async fetch resolves — not in the effect body itself —
    // so the react-hooks/set-state-in-effect rule's concern (synchronous
    // cascading renders) doesn't apply here.
    load();
    const t = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Живые события: сервер сообщает о новом уведомлении — перечитываем
  // сразу. Опрос выше остаётся страховкой на случай, если поток не
  // доходит (прокси, корпоративный фильтр).
  useLiveEvents((event) => {
    if (event.type === "notification" || event.type === "reconnect") void load();
  });

  const openPanel = useCallback(() => {
    setOpen(true);
  }, []);
  const closePanel = useCallback(() => {
    setOpen(false);
    setSelected(new Set());
  }, []);

  // Шапка живёт между переходами, а панель — нет: без этого сброса
  // уведомления оставались поверх следующего экрана, а вместе с ними
  // и блокировка прокрутки страницы (`BodyScrollLock` внутри).
  const pathname = usePathname();
  useEffect(() => {
    setOpen(false);
    setSelected(new Set());
  }, [pathname]);

  const rows = tab === "unread" ? data.unread : data.read;
  const headerCount = data.unreadCount;

  /**
   * Выделение row → выделяет/снимает все её items (для row без items —
   * саму row). Если все items уже выделены — снимаем все. Иначе
   * выделяем все недостающие.
   */
  const toggleRow = useCallback((row: NotificationRow) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (row.items.length === 0) {
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        return next;
      }
      const allKeys = row.items.map((it) => itemKey(row.id, it.id));
      const allSelected = allKeys.every((k) => next.has(k));
      if (allSelected) {
        for (const k of allKeys) next.delete(k);
      } else {
        for (const k of allKeys) next.add(k);
      }
      return next;
    });
  }, []);

  /** Toggle одной подзадачи. Не дёргает родителя. */
  const toggleItem = useCallback((rowId: string, itemId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = itemKey(rowId, itemId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /**
   * Возвращает «состояние родителя» по выделенным items этой row:
   *   "none"          — ни одна подзадача не выделена
   *   "all"           — все подзадачи выделены (или row без items и selected)
   *   "indeterminate" — выделены некоторые, но не все
   */
  function rowSelectionState(row: NotificationRow): "none" | "all" | "indeterminate" {
    if (row.items.length === 0) {
      return selected.has(row.id) ? "all" : "none";
    }
    let count = 0;
    for (const it of row.items) {
      if (selected.has(itemKey(row.id, it.id))) count++;
    }
    if (count === 0) return "none";
    if (count === row.items.length) return "all";
    return "indeterminate";
  }

  /**
   * План «Прочитать выбранное» по строкам:
   *   - all   → PATCH /api/notifications/[id] с пустым body (как раньше)
   *   - indeterminate → PATCH с {dismissedItemIds: [...]}
   *   - none  → пропустить
   */
  type ReadPlan = { rowId: string; mode: "row" | "items"; itemIds: string[] };
  const plansForView = useMemo<ReadPlan[]>(() => {
    const out: ReadPlan[] = [];
    for (const r of rows) {
      const state = rowSelectionState(r);
      if (state === "none") continue;
      if (state === "all") {
        out.push({ rowId: r.id, mode: "row", itemIds: [] });
      } else {
        const itemIds = r.items
          .filter((it) => selected.has(itemKey(r.id, it.id)))
          .map((it) => it.id);
        if (itemIds.length > 0) out.push({ rowId: r.id, mode: "items", itemIds });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selected]);

  async function markReadSelected() {
    if (plansForView.length === 0) {
      toast.info("Отметьте уведомления (или подзадачи) слева.");
      return;
    }
    try {
      const responses = await Promise.all(
        plansForView.map((p) =>
          fetch(`/api/notifications/${p.rowId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body:
              p.mode === "row"
                ? JSON.stringify({})
                : JSON.stringify({ dismissedItemIds: p.itemIds }),
          })
        )
      );
      const failures = responses.filter((r) => !r.ok).length;
      if (failures > 0) {
        toast.error(
          failures === responses.length
            ? "Не удалось отметить уведомления. Попробуйте ещё раз."
            : `${failures} из ${responses.length} не сохранились.`
        );
      } else {
        toast.success("Отмечено как прочитанное.");
      }
    } catch {
      toast.error("Сеть недоступна. Проверьте подключение.");
    }
    setSelected(new Set());
    await load();
  }

  async function removeSelected() {
    // «Удалить» работает на уровне всей нотификации — даже если выделена
    // одна подзадача, прячем всю карточку. (Per-item delete мы пока не
    // делаем — это симметрично к «Удалить все», другого UX нет.)
    const rowIds = Array.from(new Set(plansForView.map((p) => p.rowId)));
    if (rowIds.length === 0) {
      toast.info("Отметьте уведомления, чтобы удалить.");
      return;
    }
    try {
      const responses = await Promise.all(
        rowIds.map((id) =>
          fetch(`/api/notifications/${id}`, { method: "DELETE" })
        )
      );
      const failures = responses.filter((r) => !r.ok).length;
      if (failures > 0) {
        toast.error(
          failures === responses.length
            ? "Не удалось удалить. Попробуйте ещё раз."
            : `${failures} из ${responses.length} не удалось удалить.`
        );
      } else {
        toast.success(
          rowIds.length === 1 ? "Удалено." : `Удалено: ${rowIds.length}.`
        );
      }
    } catch {
      toast.error("Сеть недоступна. Проверьте подключение.");
    }
    setSelected(new Set());
    await load();
  }

  async function removeAll() {
    try {
      const r = await fetch("/api/notifications", { method: "DELETE" });
      if (!r.ok) {
        toast.error("Не удалось удалить. Попробуйте ещё раз.");
      } else {
        toast.success("Все уведомления удалены.");
      }
    } catch {
      toast.error("Сеть недоступна. Проверьте подключение.");
    }
    setSelected(new Set());
    await load();
  }

  return (
    <>
      <button
        type="button"
        aria-label="Уведомления"
        onClick={() => (open ? closePanel() : openPanel())}
        className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#5566f6]/[0.04] text-[#5566f6] transition-colors duration-200 hover:bg-[#5566f6]/[0.09]"
      >
        <Bell className="size-5" />
        {headerCount > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-[18px] items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[10px] font-semibold text-white">
            {headerCount > 99 ? "99+" : headerCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-end bg-[#0b1024]/15 p-4 pt-20 sm:p-8 sm:pt-24"
          onClick={closePanel}
        >
          <BodyScrollLock />
          <div
            className="flex max-h-[80vh] supports-[height:100dvh]:max-h-[80dvh] w-full max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_30px_80px_-20px_rgba(11,16,36,0.35)] sm:max-w-[640px]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* HEADER */}
            <div className="flex items-center justify-between border-b border-[#ececf4] px-6 py-4">
              <div className="flex items-center gap-2 text-[22px] font-semibold tracking-[-0.01em]">
                <span>Уведомления</span>
                {headerCount > 0 && (
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-[#ff3b30] text-[12px] font-semibold text-white">
                    {headerCount}
                  </span>
                )}
              </div>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={closePanel}
                className="flex size-8 items-center justify-center rounded-xl text-[#6f7282] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* TABS */}
            <div className="flex gap-6 border-b border-[#ececf4] px-6">
              <button
                type="button"
                onClick={() => setTab("unread")}
                className={`relative py-3 text-[15px] font-medium transition-colors ${
                  tab === "unread" ? "text-[#0b1024]" : "text-[#9b9fb3]"
                }`}
              >
                Новые
                {tab === "unread" && (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#5566f6]" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setTab("read")}
                className={`relative py-3 text-[15px] font-medium transition-colors ${
                  tab === "read" ? "text-[#0b1024]" : "text-[#9b9fb3]"
                }`}
              >
                Прочитанные
                {tab === "read" && (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#5566f6]" />
                )}
              </button>
            </div>

            {/* ACTIONS */}
            {rows.length > 0 && (
              <div className="flex flex-wrap gap-2 px-6 pt-4">
                {tab === "unread" && (
                  <button
                    type="button"
                    onClick={markReadSelected}
                    className="rounded-xl bg-[#eef1ff] px-4 py-2 text-[13px] font-medium text-[#3848c7] transition-colors hover:bg-[#e3e7ff]"
                  >
                    Прочитать
                  </button>
                )}
                <button
                  type="button"
                  onClick={removeSelected}
                  className="rounded-xl bg-[#fff4f2] px-4 py-2 text-[13px] font-medium text-[#d2453d] transition-colors hover:bg-[#ffe6e1]"
                >
                  Удалить
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemoveAllOpen(true)}
                  className="rounded-xl bg-[#fff4f2] px-4 py-2 text-[13px] font-medium text-[#d2453d] transition-colors hover:bg-[#ffe6e1]"
                >
                  Удалить все
                </button>
              </div>
            )}

            {/* BODY */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {rows.length === 0 ? (
                <div className="py-6 text-[14px] text-[#9b9fb3]">
                  {tab === "unread"
                    ? "Нет новых уведомлений."
                    : "Нет прочитанных уведомлений."}
                </div>
              ) : (
                <div className="space-y-4">
                  {rows.map((row) => {
                    const state = rowSelectionState(row);
                    return (
                      <div
                        key={row.id}
                        className="overflow-hidden rounded-2xl border border-[#ececf4] bg-[#fafbff]"
                      >
                        <div className="flex items-start gap-3 px-4 py-3.5">
                          <TriStateCheckbox
                            state={state}
                            onClick={() => toggleRow(row)}
                            ariaLabel="Выделить всю задачу"
                            className="mt-0.5"
                          />
                          <div className="min-w-0 text-[14px] font-medium leading-[1.45] text-[#0b1024]">
                            {row.title}
                            {row.linkHref && row.linkLabel && (
                              <>
                                {" "}
                                <Link
                                  href={row.linkHref}
                                  className="text-[#5566f6] hover:underline"
                                  onClick={(event) => {
                                    // «Открыть чат» открываем на месте, без
                                    // перехода. Виджет поддержки живёт в
                                    // layout и при клиентском переходе не
                                    // перемонтируется — deep-link `?support=chat`
                                    // он читал один раз при старте и ссылку из
                                    // панели просто не замечал.
                                    if (row.linkHref === SUPPORT_CHAT_HREF) {
                                      event.preventDefault();
                                      openSupportChat();
                                    }
                                    closePanel();
                                  }}
                                >
                                  {row.linkLabel}
                                </Link>
                              </>
                            )}
                          </div>
                        </div>
                        {row.items.length > 0 && (
                          <ul className="divide-y divide-[#ececf4] border-t border-[#ececf4]">
                            {row.items.map((item) => {
                              const key = itemKey(row.id, item.id);
                              const isChecked = selected.has(key);
                              // Per-item href: сначала item.href (если
                              // notification передал свой линк на каждую
                              // подзадачу), иначе общий row.linkHref.
                              const href = item.href ?? row.linkHref;
                              return (
                                <li
                                  key={item.id}
                                  className="flex items-center gap-3 px-4 py-3 hover:bg-white/60"
                                >
                                  <input
                                    type="checkbox"
                                    aria-label={`Прочитать ${item.label}`}
                                    checked={isChecked}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      toggleItem(row.id, item.id);
                                    }}
                                    className="size-4 shrink-0 cursor-pointer rounded border-[#dcdfed] text-[#5566f6] focus:ring-[#5566f6]"
                                  />
                                  {href ? (
                                    <Link
                                      href={href}
                                      onClick={closePanel}
                                      className="flex flex-1 items-center gap-3"
                                    >
                                      <span className="text-[14px] text-[#0b1024]">
                                        {item.label}
                                      </span>
                                      {item.hint && (
                                        <span className="ml-auto text-[12px] text-[#9b9fb3]">
                                          {item.hint}
                                        </span>
                                      )}
                                    </Link>
                                  ) : (
                                    <div className="flex flex-1 items-center gap-3">
                                      <span className="text-[14px] text-[#0b1024]">
                                        {item.label}
                                      </span>
                                      {item.hint && (
                                        <span className="ml-auto text-[12px] text-[#9b9fb3]">
                                          {item.hint}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Нативный confirm() в WebView Telegram может не показаться
          вовсе — кнопка тогда молча ничего не делает (CLAUDE.md §6). */}
      <ConfirmDialog
        open={confirmRemoveAllOpen}
        onClose={() => setConfirmRemoveAllOpen(false)}
        onConfirm={async () => {
          setConfirmRemoveAllOpen(false);
          await removeAll();
        }}
        title="Удалить все уведомления?"
        description="Список очистится полностью — и прочитанные, и непрочитанные."
        bullets={[
          { label: "Вернуть удалённые уведомления нельзя", tone: "warn" },
          {
            label: "Сами задачи и записи журналов не пострадают",
            tone: "default",
          },
        ]}
        confirmLabel="Удалить всё"
        cancelLabel="Отмена"
        variant="danger"
      />
    </>
  );
}
