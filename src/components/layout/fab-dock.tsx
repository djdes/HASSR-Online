"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { MessageCircle, Sparkles, X } from "lucide-react";
import { useNewDesign } from "@/components/view-prefs/view-prefs-provider";

import { BottomSheet, SHEET_ROW_CLASS } from "@/components/ui/bottom-sheet";
import { useIsNarrowViewport } from "@/components/ui/spotlight-tour";

/**
 * Док плавающих кнопок.
 *
 * Зачем: AI-помощник, поддержка и «Как заполнять» рисовали каждый свою
 * круглую кнопку в правом нижнем углу. На телефоне их набиралось три,
 * они закрывали правый край таблицы и нижнюю часть страницы. Теперь
 * кнопки регистрируются в доке: на компьютере — привычный ряд, на
 * телефоне — одна кнопка, по которой снизу выезжает список.
 *
 * Портал в `document.body` обязателен: полотно дашборда обёрнуто в блок
 * с `translate: -50%`, и `position: fixed` внутри считался бы от него
 * (см. `modal-tokens.ts`).
 */

export type FabAction = {
  /** Стабильный ключ. */
  id: string;
  /** Порядок в ряду и в списке: меньше — правее на компьютере, выше в листе. */
  order: number;
  label: string;
  /** Пояснение — видно только в списке на телефоне. */
  hint?: string;
  icon: ComponentType<{ className?: string }>;
  /** Непрочитанные — красная точка на кнопке дока. */
  badge?: number;
  /** `brand` — заливка градиентом (главная кнопка), `plain` — белая. */
  tone?: "brand" | "plain";
  onSelect: () => void;
};

type Registry = {
  register: (action: FabAction) => void;
  unregister: (id: string) => void;
};

const FabDockContext = createContext<Registry | null>(null);

/**
 * Регистрирует кнопку в доке, пока компонент смонтирован.
 * `onSelect` держим в ref — иначе каждая перерисовка виджета
 * перерегистрировала бы кнопку и дёргала состояние дока.
 */
export function useFabAction(
  action: Omit<FabAction, "onSelect"> & { onSelect: () => void },
  enabled = true,
): void {
  const registry = useContext(FabDockContext);
  const selectRef = useRef(action.onSelect);
  useEffect(() => {
    selectRef.current = action.onSelect;
  });

  const { id, order, label, hint, icon, badge, tone } = action;
  useEffect(() => {
    if (!registry || !enabled) return;
    registry.register({
      id,
      order,
      label,
      hint,
      icon,
      badge,
      tone,
      onSelect: () => selectRef.current(),
    });
    return () => registry.unregister(id);
  }, [registry, enabled, id, order, label, hint, icon, badge, tone]);
}

/** Есть ли док выше по дереву — виджеты решают, рисовать ли свою кнопку. */
export function useHasFabDock(): boolean {
  return useContext(FabDockContext) !== null;
}

export function FabDockProvider({
  children,
  slotId,
}: {
  children: ReactNode;
  /**
   * id элемента в шапке, куда встроить кнопку дока вместо плавающей.
   * Нужен оболочке мини-приложения: на телефоне плавающая кнопка лежала
   * поверх правого края карточек и полей, и нажать «изменить» под ней
   * удавалось только после прокрутки.
   */
  slotId?: string;
}) {
  const [actions, setActions] = useState<FabAction[]>([]);

  const register = useCallback((action: FabAction) => {
    setActions((prev) => {
      const next = prev.filter((item) => item.id !== action.id);
      next.push(action);
      next.sort((a, b) => a.order - b.order);
      return next;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setActions((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const registry = useMemo(() => ({ register, unregister }), [register, unregister]);

  return (
    <FabDockContext.Provider value={registry}>
      {children}
      <FabDock actions={actions} slotId={slotId} />
    </FabDockContext.Provider>
  );
}

function FabDock({ actions, slotId }: { actions: FabAction[]; slotId?: string }) {
  const t = useTranslations("layoutUi.fabDock");
  const narrow = useIsNarrowViewport();
  const [sheetRequested, setSheetRequested] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const newDesign = useNewDesign();
  // Слот живёт в шапке, которая монтируется рядом с доком, — ищем его
  // после отрисовки, а не во время неё.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!slotId) return;
    const find = () => setSlot(document.getElementById(slotId));
    find();
    const timer = window.setTimeout(find, 0);
    return () => window.clearTimeout(timer);
  }, [slotId, actions.length]);
  // Список мог схлопнуться до одной кнопки, пока лист открыт (виджет
  // размонтировался) — тогда листу нечего показывать, считаем закрытым.
  const sheetOpen = sheetRequested && actions.length > 1;

  if (typeof document === "undefined" || actions.length === 0) return null;

  const unread = actions.reduce((sum, item) => sum + (item.badge ?? 0), 0);

  // Кнопка в шапке: одна на все подсказки. Одно действие — сразу оно,
  // несколько — тот же лист снизу, что и у плавающей кнопки.
  if (slotId) {
    if (!slot) return null;
    const single = actions.length === 1 ? actions[0] : null;
    return (
      <>
        {createPortal(
          <button
            type="button"
            onClick={() => (single ? single.onSelect() : setSheetRequested(true))}
            aria-label={
              unread > 0
                ? t("helpAriaUnread", { count: unread })
                : single
                  ? single.label
                  : t("helpAria")
            }
            style={{
              background: "var(--mini-surface-1, var(--app-fab-bg))",
              border: "1px solid var(--mini-divider, var(--app-fab-border))",
            }}
            className="mini-press relative inline-flex size-10 shrink-0 items-center justify-center rounded-2xl text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 print:hidden"
          >
            <Sparkles className="size-4" />
            {unread > 0 ? (
              <span className="absolute -right-1 -top-1 flex min-w-[16px] items-center justify-center rounded-full bg-[#ff6b5a] px-1 text-[10px] font-semibold leading-4 text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </button>,
          slot,
        )}
        <FabSheet
          open={sheetOpen}
          onClose={() => setSheetRequested(false)}
          actions={actions}
        />
      </>
    );
  }

  // Кабинет (владелец, 2026-11-11): одна чёрная кнопка справа снизу —
  // «Контакты». Одно действие — сразу оно; несколько — на компьютере
  // карточка над кнопкой, на телефоне — лист снизу. Поддержка, помощник и
  // «Как заполнять» вызываются из этого списка.
  if (newDesign) {
  // Кнопка сразу открывает «Контакты» (владелец, 2026-11-11); нет их — одно
  // действие или карточка со списком.
  const contacts = actions.find((action) => action.id === "contacts");
  const single = contacts ?? (actions.length === 1 ? actions[0] : null);
  return (
    <>
      {createPortal(
        <div className="fixed right-5 bottom-5 z-30 print:hidden">
          {panelOpen && !narrow && !single ? (
            <FabPanel actions={actions} onClose={() => setPanelOpen(false)} />
          ) : null}
          <button
            type="button"
            data-fab-contacts
            onClick={() => {
              if (single) single.onSelect();
              else if (narrow) setSheetRequested(true);
              else setPanelOpen((value) => !value);
            }}
            aria-expanded={single ? undefined : narrow ? sheetOpen : panelOpen}
            aria-label={
              unread > 0
                ? t("actionAriaUnread", { label: t("contacts"), count: unread })
                : t("contacts")
            }
            className="relative flex size-[52px] items-center justify-center rounded-full bg-[#111114] text-white shadow-[0_10px_30px_-12px_rgba(17,17,20,0.55)] ring-4 ring-white/70 transition-[background-color,transform] duration-150 hover:bg-[#2c2d36] active:scale-95 focus-visible:outline-none focus-visible:ring-[#111114]/20"
          >
            <MessageCircle className="size-[22px] stroke-[1.75]" aria-hidden />
            {unread > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-[#ff6b5a] px-1 text-[11px] font-semibold leading-[18px] text-white ring-2 ring-white">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </button>
        </div>,
        document.body,
      )}

      <FabSheet
        open={sheetOpen}
        onClose={() => setSheetRequested(false)}
        actions={actions}
      />
    </>
  );
  }

  // Компьютер и одиночная кнопка на телефоне — привычный ряд в углу.
  if (!narrow || actions.length === 1) {
    return createPortal(
      <div className="fixed bottom-5 right-5 z-30 flex flex-row-reverse items-center gap-2 print:hidden">
        {actions.map((action) => (
          <FabButton key={action.id} action={action} onSelect={action.onSelect} />
        ))}
      </div>,
      document.body,
    );
  }

  return (
    <>
      {createPortal(
        <button
          type="button"
          onClick={() => setSheetRequested(true)}
          aria-label={
            unread > 0 ? t("helpAriaUnread", { count: unread }) : t("helpAria")
          }
          // Полупрозрачная «таблетка» с размытием, как в приложениях:
          // сплошная фиолетовая кнопка перебивала контент под собой.
          // Цвета в токенах — в тёмной общее правило перекрасило бы
          // `bg-white/70` в непрозрачный фон.
          style={{
            background: "var(--app-fab-bg)",
            borderColor: "var(--app-fab-border)",
          }}
          className="fixed bottom-5 right-5 z-30 flex size-12 items-center justify-center rounded-full border text-[#5566f6] shadow-[0_10px_30px_-12px_rgba(11,16,36,0.35)] backdrop-blur-md transition-transform duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 print:hidden"
        >
          <Sparkles className="size-5" />
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-[#ff6b5a] px-1 text-[11px] font-semibold leading-[18px] text-white ring-2 ring-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </button>,
        document.body,
      )}

      <FabSheet
        open={sheetOpen}
        onClose={() => setSheetRequested(false)}
        actions={actions}
      />
    </>
  );
}

/** Карточка «Контакты» над кнопкой (компьютер). */
function FabPanel({ actions, onClose }: { actions: FabAction[]; onClose: () => void }) {
  const t = useTranslations("layoutUi.fabDock");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!ref.current || !target) return;
      if (ref.current.contains(target)) return;
      if ((target as Element).closest?.("[data-fab-contacts]")) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("contacts")}
      className="absolute right-0 bottom-[64px] w-[340px] rounded-2xl border border-[#e7e7ec] bg-white p-3 shadow-[0_18px_48px_-16px_rgba(17,17,20,0.28)]"
    >
      <div className="flex items-start justify-between gap-3 px-2 pt-1 pb-2">
        <div className="min-w-0 text-[16px] font-semibold text-[#111114]">{t("contacts")}</div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[#6a6c7a] hover:bg-[#f1f1f4] hover:text-[#111114]"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="space-y-0.5">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => {
                onClose();
                action.onSelect();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[#f1f1f4] focus-visible:bg-[#f1f1f4] focus-visible:outline-none"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#f1f1f4] text-[#111114]">
                <Icon className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-medium text-[#111114]">{action.label}</span>
                {action.hint ? (
                  <span className="block truncate text-[12.5px] text-[#6a6c7a]">{action.hint}</span>
                ) : null}
              </span>
              {action.badge ? (
                <span className="shrink-0 rounded-full bg-[#ff6b5a] px-2 text-[11px] font-semibold leading-5 text-white">
                  {action.badge > 9 ? "9+" : action.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FabSheet({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: FabAction[];
}) {
  const t = useTranslations("layoutUi.fabDock");
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("sheetTitle")}
      subtitle={t("sheetSubtitle")}
    >
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            onClick={() => {
              onClose();
              action.onSelect();
            }}
            className={SHEET_ROW_CLASS}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{action.label}</span>
              {action.hint ? (
                <span className="block truncate text-[12.5px] text-[#6f7282]">
                  {action.hint}
                </span>
              ) : null}
            </span>
            {action.badge ? (
              <span className="shrink-0 rounded-full bg-[#ff6b5a] px-2 text-[11px] font-semibold leading-5 text-white">
                {action.badge > 9 ? "9+" : action.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </BottomSheet>
  );
}

function FabButton({
  action,
  onSelect,
}: {
  action: FabAction;
  onSelect: () => void;
}) {
  const t = useTranslations("layoutUi.fabDock");
  const Icon = action.icon;
  const brand = action.tone === "brand";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={
        action.badge
          ? t("actionAriaUnread", { label: action.label, count: action.badge })
          : action.label
      }
      style={{
        background: "var(--app-fab-bg)",
        borderColor: "var(--app-fab-border)",
      }}
      className={`group relative flex size-11 items-center justify-center rounded-full border backdrop-blur-md transition-all duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 ${
        brand
          ? "text-[#5566f6] shadow-[0_10px_30px_-12px_rgba(85,102,246,0.45)]"
          : "text-[#5566f6] shadow-[0_10px_24px_-12px_rgba(11,16,36,0.3)]"
      }`}
    >
      <Icon className="size-4" />
      {action.badge ? (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-[#ff6b5a] px-1 text-[11px] font-semibold leading-[18px] text-white ring-2 ring-white">
          {action.badge > 9 ? "9+" : action.badge}
        </span>
      ) : null}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+8px)] right-0 whitespace-nowrap rounded-lg bg-[#0b1024] px-2.5 py-1.5 text-[12.5px] font-medium text-white opacity-0 shadow-[0_8px_24px_-8px_rgba(11,16,36,0.45)] transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {action.label}
      </span>
    </button>
  );
}
