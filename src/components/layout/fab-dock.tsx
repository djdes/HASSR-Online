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
import { Sparkles } from "lucide-react";

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
  const narrow = useIsNarrowViewport();
  const [sheetRequested, setSheetRequested] = useState(false);
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
                ? `Помощь · новых сообщений: ${unread}`
                : single
                  ? single.label
                  : "Помощь и подсказки"
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
            unread > 0 ? `Помощь · новых сообщений: ${unread}` : "Помощь и подсказки"
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

function FabSheet({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: FabAction[];
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Помощь"
      subtitle="Спросить, написать в поддержку или посмотреть инструкцию"
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
  const Icon = action.icon;
  const brand = action.tone === "brand";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={
        action.badge
          ? `${action.label} · новых сообщений: ${action.badge}`
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
