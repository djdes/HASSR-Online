"use client";
import { cn } from "@/lib/utils";
import { useNewDesign } from "@/components/view-prefs/view-prefs-provider";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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

/**
 * Пункт уведомления — одна строка и подпись под ней. Длинный текст (обращение,
 * сообщение в чате) не разворачивается в панели: целиком он — по нажатию.
 */
function NotificationItemText({ item }: { item: NotificationItem }) {
  return (
    <>
      <span className="truncate text-[14px] text-[#0b1024]">{item.label}</span>
      {item.hint ? (
        <span className="truncate text-[12px] text-[#6f7282]">{item.hint}</span>
      ) : null}
    </>
  );
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
      className={cn("notif-check", className)}
    />
  );
}

const REFRESH_INTERVAL_MS = 60 * 1000;
/** Самый долгий уход пункта в notifications-panel.css (`.notif-collapse`) и кадр запаса. */
const LEAVE_MS = 240;
/** Страховка закрытия окна, если событие конца анимации не придёт. */
const CLOSE_FAILSAFE_MS = 400;

/** «Без анимации» в настройках или «Уменьшить движение» системы. */
function motionOff(): boolean {
  if (typeof window === "undefined") return true;
  if (document.documentElement.hasAttribute("data-view-still")) return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Ждём, пока уходящие пункты доиграют, — иначе ответ API обрывает анимацию. */
function leavePause(): Promise<void> {
  if (motionOff()) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, LEAVE_MS));
}
/** Ссылка уведомлений поддержки — см. support-threads.ts. */
const SUPPORT_CHAT_HREF = "/dashboard?support=chat";

// Нейтральная кнопка шапки, как «Выход» (владелец, 2026-11-21): без своего
// цвета и без покачивания. Цветом говорит только счётчик непрочитанного.
const TRIGGER_CLASS =
  "relative inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#f4f5fb] text-[#6f7282] transition-colors duration-200 hover:bg-[#eef1ff] hover:text-[#3848c7]";
/** «Новая» тема: светлая кнопка с рамкой, голубой колокольчик. */
const TRIGGER_CLASS_NEW =
  "relative inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-[#e7e7ec] bg-white text-[#2f80c9] transition-colors duration-150 hover:bg-[#f1f1f4] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#111114]/10";

/**
 * `triggerClassName` — добавка к кнопке-колокольчику. Шапка сайта
 * передаёт `max-sm:size-11`: на телефоне кнопки шапки 44×44. Мини-
 * приложение его не передаёт и остаётся со своими размерами.
 */
export function NotificationsBell({ triggerClassName }: { triggerClassName?: string } = {}) {
  const newDesign = useNewDesign();
  const locale = useLocale();
  const t = useTranslations("notifications.ui");
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
  // Портал в body есть только на клиенте; до монтирования панель не рисуем.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Окно доигрывает уход (`data-closing`) и только потом снимается.
  const [closing, setClosing] = useState(false);
  // Пункты, которые прямо сейчас уходят после «Прочитать / Удалить»:
  // row-id для карточки целиком или itemKey для подпункта.
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrolledFallback, setScrolledFallback] = useState(false);
  // Имя якоря полосы вкладок — своё у каждого экземпляра.
  const tabAnchor = `--notif-tab-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const loadedLocale = useRef(locale);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    if (loadedLocale.current !== locale) {
      loadedLocale.current = locale;
      setData({ unread: [], read: [], unreadCount: 0 });
    }
    const requestLocale = locale;
    const requestId = ++latestRequest.current;
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as {
        locale?: string;
        unread: Array<Record<string, unknown>>;
        read: Array<Record<string, unknown>>;
        unreadCount: number;
      };
      if (requestId !== latestRequest.current || loadedLocale.current !== requestLocale) return;
      if (typeof j.locale === "string" && j.locale !== requestLocale) return;
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
  }, [locale]);

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
    setClosing(false);
    setOpen(true);
  }, []);
  const closePanel = useCallback(() => {
    setSelected(new Set());
    setClosing(true);
  }, []);

  // Уход окна: ждём переходы `data-closing` (затемнение и окно), потом
  // снимаем. Анимаций нет («Без анимации», «Уменьшить движение») — сразу.
  useEffect(() => {
    if (!closing) return;
    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      setOpen(false);
      setClosing(false);
    };
    const frame = requestAnimationFrame(() => {
      const animations = overlayRef.current?.getAnimations({ subtree: true }) ?? [];
      if (motionOff() || animations.length === 0) {
        finish();
        return;
      }
      void Promise.race([
        Promise.allSettled(animations.map((animation) => animation.finished)),
        new Promise((resolve) => setTimeout(resolve, CLOSE_FAILSAFE_MS)),
      ]).then(finish);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [closing]);

  // Тень под панелью действий при прокрутке — CSS (scroll-state или
  // scroll-driven). Старому WebView без обоих — метка `data-scrolled`
  // от IntersectionObserver на нулевом «маячке» в начале списка.
  const scrollSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    if (typeof CSS !== "undefined" && CSS.supports?.("animation-timeline", "scroll()")) return;
    const root = scrollRef.current;
    const sentinel = scrollSentinelRef.current;
    if (!root || !sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolledFallback(!entry.isIntersecting),
      { root },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [open]);

  // Шапка живёт между переходами, а панель — нет: без этого сброса
  // уведомления оставались поверх следующего экрана, а вместе с ними
  // и блокировка прокрутки страницы (`BodyScrollLock` внутри).
  const pathname = usePathname();
  useEffect(() => {
    setOpen(false);
    setClosing(false);
    setSelected(new Set());
  }, [pathname]);

  // Escape закрывает панель — как любое окно поверх страницы.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closePanel]);

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
      toast.info(t("selectReadPrompt"));
      return;
    }
    setLeaving(
      new Set(
        plansForView.flatMap((p) =>
          p.mode === "row" ? [p.rowId] : p.itemIds.map((id) => itemKey(p.rowId, id))
        )
      )
    );
    try {
      const [responses] = await Promise.all([Promise.all(
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
      ), leavePause()]);
      const failures = responses.filter((r) => !r.ok).length;
      if (failures > 0) {
        toast.error(
          failures === responses.length
            ? t("readFailedAll")
            : t("readFailedSome", { count: failures, total: responses.length })
        );
      } else {
        toast.success(t("readSuccess"));
      }
    } catch {
      toast.error(t("networkError"));
    }
    setSelected(new Set());
    await load();
    setLeaving(new Set());
  }

  async function removeSelected() {
    // «Удалить» работает на уровне всей нотификации — даже если выделена
    // одна подзадача, прячем всю карточку. (Per-item delete мы пока не
    // делаем — это симметрично к «Удалить все», другого UX нет.)
    const rowIds = Array.from(new Set(plansForView.map((p) => p.rowId)));
    if (rowIds.length === 0) {
      toast.info(t("selectDeletePrompt"));
      return;
    }
    setLeaving(new Set(rowIds));
    try {
      const [responses] = await Promise.all([Promise.all(
        rowIds.map((id) =>
          fetch(`/api/notifications/${id}`, { method: "DELETE" })
        )
      ), leavePause()]);
      const failures = responses.filter((r) => !r.ok).length;
      if (failures > 0) {
        toast.error(
          failures === responses.length
            ? t("deleteFailedAll")
            : t("deleteFailedSome", { count: failures, total: responses.length })
        );
      } else {
        toast.success(
          rowIds.length === 1
            ? t("deleteOneSuccess")
            : t("deleteManySuccess", { count: rowIds.length })
        );
      }
    } catch {
      toast.error(t("networkError"));
    }
    setSelected(new Set());
    await load();
    setLeaving(new Set());
  }

  async function removeAll() {
    setLeaving(new Set(rows.map((row) => row.id)));
    try {
      const [r] = await Promise.all([fetch("/api/notifications", { method: "DELETE" }), leavePause()]);
      if (!r.ok) {
        toast.error(t("deleteAllFailed"));
      } else {
        toast.success(t("deleteAllSuccess"));
      }
    } catch {
      toast.error(t("networkError"));
    }
    setSelected(new Set());
    await load();
    setLeaving(new Set());
  }

  return (
    <>
      <button
        type="button"
        aria-label={t("title")}
        aria-expanded={open && !closing}
        onClick={() => (open && !closing ? closePanel() : openPanel())}
        className={cn(newDesign ? TRIGGER_CLASS_NEW : TRIGGER_CLASS, triggerClassName)}
      >
        <Bell className={newDesign ? "size-[18px] stroke-[1.75]" : "size-5"} />
        {headerCount > 0 && (
          // `key` — счётчик пересоздаётся при смене числа и «щёлкает»
          // (`.notif-badge`, только при разрешённом движении).
          <span
            key={headerCount}
            className="notif-badge absolute -right-1 -top-1 flex min-w-[18px] items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[10px] font-semibold text-white"
          >
            {headerCount > 99 ? "99+" : headerCount}
          </span>
        )}
      </button>

      {/* Портал в body — обязательно.
          Панель жила внутри шапки, а у шапки есть `backdrop-filter` и
          собственный контекст наложения: `fixed inset-0` считался от
          коробки шапки, а не от экрана. Подложка получалась 360×96
          вместо всего окна, сама панель вела себя как `static` и
          уходила ПОД содержимое страницы — и в приложении, и на сайте.
          z-[60] — поверх нижнего меню приложения (`--mini-z-nav` = 50),
          как у ConfirmDialog и BottomSheet. Цвета, отступы и движение —
          `src/app/notifications-panel.css` (переменные тем `--app-*`,
          тёмная тема — от `body:has(.app-shell[data-app-theme="dark"])`). */}
      {open &&
        mounted &&
        createPortal(
        <div
          ref={overlayRef}
          data-closing={closing ? "" : undefined}
          className="notif-overlay fixed inset-0 z-[60] flex items-start justify-end p-2 pt-20 sm:p-8 sm:pt-24"
          onClick={closePanel}
        >
          <BodyScrollLock />
          {/* `data-touch-zone` — окно живёт в <body>, вне `main`; метка
              включает на телефоне правила «крупнее» кабинета (app-theme.css).
              В мини-приложении метка ничего не делает. `data-slot` — своё
              движение: общая анимация «самодельных окон» (motion.css §7)
              его не трогает. */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("title")}
            data-slot="notifications-panel"
            data-touch-zone=""
            data-closing={closing ? "" : undefined}
            className="notif-panel flex max-h-[80vh] supports-[height:100dvh]:max-h-[80dvh] w-full max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-3xl sm:max-w-[640px]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* HEADER */}
            <div className="flex items-center justify-between gap-3 px-[var(--notif-pad)] pb-1 pt-4">
              <div className="flex items-center gap-2 text-[22px] font-semibold tracking-[-0.01em]">
                <span>{t("title")}</span>
                {headerCount > 0 && (
                  <span
                    key={headerCount}
                    className="notif-badge inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#ff3b30] px-1.5 text-[12px] font-semibold text-white"
                  >
                    {headerCount}
                  </span>
                )}
              </div>
              <button
                type="button"
                aria-label={t("close")}
                onClick={closePanel}
                className="-mr-2 flex size-11 items-center justify-center rounded-xl text-[#6f7282] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* TABS — полоса под выбранной едет к новой (якорь, notifications-panel.css).
                `data-liquid="off"`: общая «жидкая» заливка вкладок (motion-runtime)
                здесь не нужна — своя полоса. */}
            <div
              role="tablist"
              aria-label={t("title")}
              data-liquid="off"
              className="notif-tabs flex gap-6 px-[var(--notif-pad)]"
              style={{ ["--notif-tab-anchor" as string]: tabAnchor } as CSSProperties}
            >
              {(["unread", "read"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className="notif-tab text-[15px] font-medium"
                >
                  {id === "unread" ? t("tabNew") : t("tabRead")}
                </button>
              ))}
            </div>

            {/* ACTIONS — вне прокрутки, с зазором до списка. */}
            {rows.length > 0 && (
              <div className="notif-actions">
                {tab === "unread" && (
                  <button
                    type="button"
                    onClick={markReadSelected}
                    data-kind="read"
                    className="notif-action"
                  >
                    {t("readSelected")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={removeSelected}
                  data-kind="delete"
                  className="notif-action"
                >
                  {t("deleteSelected")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemoveAllOpen(true)}
                  data-kind="delete-all"
                  className="notif-action"
                >
                  {t("deleteAll")}
                </button>
              </div>
            )}

            {/* BODY — тень под панелью действий появляется только при прокрутке. */}
            <div
              ref={scrollRef}
              role="tabpanel"
              aria-label={tab === "unread" ? t("tabNew") : t("tabRead")}
              data-scrolled={scrolledFallback ? "" : undefined}
              className="notif-scroll min-h-0 flex-1 overflow-y-auto"
            >
              <div ref={scrollSentinelRef} aria-hidden="true" className="h-px" />
              {rows.length === 0 ? (
                <div className="px-[var(--notif-pad)] py-6 text-[14px] text-[#9b9fb3]">
                  {tab === "unread"
                    ? t("emptyNew")
                    : t("emptyRead")}
                </div>
              ) : (
                <div key={tab} className="notif-list">
                  {rows.map((row, index) => {
                    const state = rowSelectionState(row);
                    return (
                      <div
                        key={row.id}
                        className="notif-collapse"
                        data-leaving={leaving.has(row.id) ? "" : undefined}
                        style={{ ["--notif-i" as string]: index } as CSSProperties}
                      >
                        <div className="notif-card-gap">
                          <div className="notif-card">
                            <div className="notif-card-head">
                              <label className="notif-check-hit">
                                <TriStateCheckbox
                                  state={state}
                                  onClick={() => toggleRow(row)}
                                  ariaLabel={t("selectAllTask")}
                                />
                              </label>
                              <div className="notif-card-title">
                                {row.title}
                                {row.linkHref && row.linkLabel && (
                                  <>
                                    {" "}
                                    <Link
                                      href={row.linkHref}
                                      className="notif-link"
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
                              <ul className="notif-items">
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
                                      className="notif-collapse"
                                      data-leaving={leaving.has(key) ? "" : undefined}
                                    >
                                      <div className="notif-item">
                                        <label className="notif-check-hit">
                                          <input
                                            type="checkbox"
                                            aria-label={t("readItem", { label: item.label })}
                                            checked={isChecked}
                                            onChange={(e) => {
                                              e.stopPropagation();
                                              toggleItem(row.id, item.id);
                                            }}
                                            className="notif-check"
                                          />
                                        </label>
                                        {href ? (
                                          <Link
                                            href={href}
                                            onClick={closePanel}
                                            className="notif-item-link"
                                          >
                                            <NotificationItemText item={item} />
                                          </Link>
                                        ) : (
                                          <div className="notif-item-link">
                                            <NotificationItemText item={item} />
                                          </div>
                                        )}
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
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
        title={t("deleteAllTitle")}
        description={t("deleteAllDescription")}
        bullets={[
          { label: t("deleteAllIrreversible"), tone: "warn" },
          {
            label: t("deleteAllDataSafe"),
            tone: "default",
          },
        ]}
        confirmLabel={t("confirmDeleteAll")}
        cancelLabel={t("cancel")}
        variant="danger"
      />
    </>
  );
}
