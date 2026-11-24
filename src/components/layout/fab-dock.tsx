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
import { cn } from "@/lib/utils";

import { BottomSheet, SHEET_ROW_CLASS } from "@/components/ui/bottom-sheet";
import { useIsNarrowViewport } from "@/components/ui/spotlight-tour";
import { useMediaQuery } from "@/lib/use-media-query";

/**
 * Док плавающих кнопок.
 *
 * Зачем: AI-помощник, поддержка и «Как заполнять» рисовали каждый свою
 * круглую кнопку в правом нижнем углу. На телефоне их набиралось три,
 * они закрывали правый край таблицы и нижнюю часть страницы. Теперь
 * кнопки регистрируются в доке, а он рисует одну кнопку: на компьютере
 * по ней открывается карточка со списком, на телефоне — лист снизу.
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
 * Открыть док не своей кнопкой: «Контакты» нижнего меню телефона
 * (`mobile-tab-bar.tsx`, владелец 2026-11-23) — то же, что нажатие на круглую
 * кнопку, которой на телефоне и планшете при нижнем меню нет.
 */
export const FAB_DOCK_OPEN_EVENT = "wesetup:fab-dock-open";

/** Непрочитанные во всех действиях дока — для значка «Контакты» в нижнем меню. */
const FabDockUnreadContext = createContext(0);

export function useFabDockUnread(): number {
  return useContext(FabDockUnreadContext);
}

/** Телефон и планшет — где вместо круглой кнопки нижнее меню. */
const TAB_BAR_QUERY = "(max-width: 1023.98px)";

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
  withTabBar = false,
}: {
  children: ReactNode;
  /**
   * id элемента в шапке, куда встроить кнопку дока вместо плавающей.
   * Нужен оболочке мини-приложения: на телефоне плавающая кнопка лежала
   * поверх правого края карточек и полей, и нажать «изменить» под ней
   * удавалось только после прокрутки.
   */
  slotId?: string;
  /**
   * На телефоне и планшете (<1024px) есть нижнее меню с «Контактами»
   * (`MobileTabBar`): круглой кнопки там нет, док открывается из меню —
   * листом снизу.
   */
  withTabBar?: boolean;
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
  const unread = actions.reduce((sum, item) => sum + (item.badge ?? 0), 0);

  return (
    <FabDockContext.Provider value={registry}>
      <FabDockUnreadContext.Provider value={unread}>
        {children}
        <FabDock actions={actions} slotId={slotId} withTabBar={withTabBar} />
      </FabDockUnreadContext.Provider>
    </FabDockContext.Provider>
  );
}

function FabDock({ actions, slotId, withTabBar }: { actions: FabAction[]; slotId?: string; withTabBar: boolean }) {
  const t = useTranslations("layoutUi.fabDock");
  // С нижним меню (<1024px) док открывается из «Контактов» и всегда листом:
  // круглой кнопки, над которой встала бы карточка, там нет.
  const tabBarScreen = useMediaQuery(TAB_BAR_QUERY);
  const narrow = useIsNarrowViewport() || (withTabBar && tabBarScreen);
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

  // Одна кнопка справа снизу в обоих дизайнах. Одно действие — сразу оно;
  // несколько — на компьютере карточка над кнопкой, на телефоне — лист снизу.
  //   • «Новая» тема (владелец, 2026-11-11): чёрная кнопка сразу открывает
  //     «Контакты»; нет их — одно действие или карточка со списком.
  //   • Прежний дизайн (владелец, 2026-11-19: «одна кнопка, как в новой»):
  //     вместо ряда из трёх кнопок — одна; по ней список всех действий
  //     (контакты, поддержка, помощник, «Как заполнять») — ни одно не пропадает.
  const contacts = actions.find((action) => action.id === "contacts");
  const single = newDesign
    ? (contacts ?? (actions.length === 1 ? actions[0] : null))
    : actions.length === 1
      ? actions[0]
      : null;

  // «Контакты» нижнего меню — то же, что нажатие на круглую кнопку.
  useEffect(() => {
    if (slotId) return;
    const open = () => {
      if (single) single.onSelect();
      else if (narrow) setSheetRequested(true);
      else setPanelOpen((value) => !value);
    };
    window.addEventListener(FAB_DOCK_OPEN_EVENT, open);
    return () => window.removeEventListener(FAB_DOCK_OPEN_EVENT, open);
  }, [single, narrow, slotId]);

  if (typeof document === "undefined" || actions.length === 0) return null;

  const unread = actions.reduce((sum, item) => sum + (item.badge ?? 0), 0);

  // Кнопка в шапке: одна на все подсказки. Одно действие — сразу оно,
  // несколько — тот же лист снизу, что и у плавающей кнопки.
  if (slotId) {
    if (!slot) return null;
    const only = actions.length === 1 ? actions[0] : null;
    return (
      <>
        {createPortal(
          <button
            type="button"
            onClick={() => (only ? only.onSelect() : setSheetRequested(true))}
            aria-label={
              unread > 0
                ? t("helpAriaUnread", { count: unread })
                : only
                  ? only.label
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

  const title = newDesign ? t("contacts") : single ? single.label : t("dockTitle");
  // Прежний дизайн: кнопка — «Контакты и помощь», контакты в списке первыми.
  const listed = newDesign
    ? actions
    : [...actions].sort((a, b) => Number(b.id === "contacts") - Number(a.id === "contacts"));
  return (
    <>
      {createPortal(
        <div
          data-fab-dock
          className={cn(
            "fixed z-30 print:hidden",
            // Телефон и планшет с нижним меню: вместо кнопки — «Контакты» в меню.
            withTabBar && "max-lg:hidden",
            // Прежний дизайн, компьютер: кнопка по центру полосы подвала
            // (72px) и по правому полю страницы — как «Пришла проверка» слева.
            newDesign ? "right-5 bottom-5" : "right-5 bottom-5 lg:right-8 lg:bottom-3",
          )}
        >
          {panelOpen && !narrow && !single ? (
            <FabPanel actions={listed} title={title} classic={!newDesign} onClose={() => setPanelOpen(false)} />
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
            aria-haspopup={single ? undefined : "dialog"}
            title={title}
            aria-label={unread > 0 ? t("actionAriaUnread", { label: title, count: unread }) : title}
            className={cn(
              "relative flex items-center justify-center rounded-full text-white transition-[background-color,transform] duration-150 active:scale-95 focus-visible:outline-none",
              newDesign
                ? "size-[52px] bg-[#111114] shadow-[0_10px_30px_-12px_rgba(17,17,20,0.55)] ring-4 ring-white/70 hover:bg-[#2c2d36] focus-visible:ring-[#111114]/20"
                : "size-12 bg-[#5566f6] shadow-[0_12px_30px_-12px_rgba(85,102,246,0.75)] hover:bg-[#4a5bf0] focus-visible:ring-4 focus-visible:ring-[#5566f6]/25",
            )}
          >
            {panelOpen && !narrow && !single && !newDesign ? (
              <X className="size-5" aria-hidden />
            ) : (
              <MessageCircle className={newDesign ? "size-[22px] stroke-[1.75]" : "size-5"} aria-hidden />
            )}
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
        actions={listed}
        title={newDesign ? undefined : t("dockTitle")}
      />
    </>
  );
}

/**
 * Карточка над кнопкой (компьютер): список действий дока. `classic` —
 * прежний дизайн (индиго, тёмная тема перекрашивает сама), иначе — «Новая».
 */
function FabPanel({
  actions,
  title,
  classic = false,
  onClose,
}: {
  actions: FabAction[];
  title: string;
  classic?: boolean;
  onClose: () => void;
}) {
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
      aria-label={title}
      data-fab-panel
      className={cn(
        "absolute right-0 w-[320px] rounded-2xl border bg-white p-2",
        classic
          ? "bottom-[60px] border-[#ececf4] shadow-[0_20px_50px_-20px_rgba(11,16,36,0.35)]"
          : "bottom-[64px] border-[#e7e7ec] p-3 shadow-[0_18px_48px_-16px_rgba(17,17,20,0.28)]",
      )}
    >
      <div className={cn("flex items-center justify-between gap-3", classic ? "px-2 pt-1 pb-1.5" : "px-2 pt-1 pb-2")}>
        <div className={cn("min-w-0 font-semibold", classic ? "text-[15px] text-[#0b1024]" : "text-[16px] text-[#111114]")}>
          {title}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            classic
              ? "text-[#6f7282] hover:bg-[#f5f6ff] hover:text-[#0b1024]"
              : "text-[#6a6c7a] hover:bg-[#f1f1f4] hover:text-[#111114]",
          )}
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
              data-fab-action={action.id}
              onClick={() => {
                onClose();
                action.onSelect();
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors focus-visible:outline-none",
                classic
                  ? "hover:bg-[#f5f6ff] focus-visible:bg-[#f5f6ff]"
                  : "hover:bg-[#f1f1f4] focus-visible:bg-[#f1f1f4]",
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-[10px]",
                  classic ? "bg-[#eef1ff] text-[#5566f6]" : "bg-[#f1f1f4] text-[#111114]",
                )}
              >
                <Icon className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[14.5px] font-medium", classic ? "text-[#0b1024]" : "text-[#111114]")}>
                  {action.label}
                </span>
                {action.hint ? (
                  <span className={cn("block truncate text-[12.5px]", classic ? "text-[#6f7282]" : "text-[#6a6c7a]")}>
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
      </div>
    </div>
  );
}

function FabSheet({
  open,
  onClose,
  actions,
  title,
}: {
  open: boolean;
  onClose: () => void;
  actions: FabAction[];
  /** Заголовок листа; по умолчанию — «Помощь». */
  title?: string;
}) {
  const t = useTranslations("layoutUi.fabDock");
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title ?? t("sheetTitle")}
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
