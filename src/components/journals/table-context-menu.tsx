"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { BottomSheet, SHEET_ROW_CLASS } from "@/components/ui/bottom-sheet";
import { useIsNarrowViewport } from "@/components/ui/spotlight-tour";
import { Check } from "lucide-react";

/**
 * Пункт ПКМ-меню таблицы.
 *
 * `code` — короткая метка варианта (Зд., В, Б/л, «да»/«нет»): она рисуется
 * моноширинной колонкой слева, чтобы список читался как легенда журнала.
 * `label` — расшифровка. `active` подсвечивает текущее значение ячейки
 * галочкой + индиго-фоном, чтобы не гадать «что там сейчас стоит».
 */
export type TableContextMenuItem = {
  key: string;
  code?: string;
  label: string;
  active?: boolean;
  danger?: boolean;
  /** Тонкая линия-разделитель перед пунктом (секции без заголовков). */
  separatorBefore?: boolean;
  onSelect: () => void;
};

type Props = {
  /** Координаты курсора из `event.clientX` / `event.clientY`. */
  x: number;
  y: number;
  items: TableContextMenuItem[];
  onClose: () => void;
  /** Доступное имя меню для скринридеров. */
  ariaLabel?: string;
};

/** Отступ от края вьюпорта при прижатии. */
const VIEWPORT_MARGIN = 8;

/**
 * Общее контекстное меню для сеток журналов.
 *
 * Зачем отдельный компонент, а не Radix-триггер на ячейку: в сетке
 * 31 день × N сотрудников это тысячи ячеек, и триггер на каждой стоил бы
 * заметного времени монтирования. Меню рендерится ОДНО на документ,
 * координаты приходят из события.
 *
 * Три вещи, ради которых он существует:
 *
 * 1. **Появляется ровно у курсора.** `position: fixed` + `left/top` из
 *    `clientX/clientY`. Портал в `document.body` обязателен: страницы
 *    журналов лежат в full-bleed обёртке с `-translate-x-1/2`, а transform
 *    у предка превращает `fixed` в «прибит к контейнеру» — та же причина,
 *    по которой портален `journal-selection-bar.tsx`.
 * 2. **Прижимается к краям вьюпорта.** Реальные ширина/высота меряются
 *    через ref после первого (невидимого) рендера, поэтому клампинг
 *    работает и для длинных списков, а не только по захардкоженной ширине.
 * 3. **Закрывается по любому выходу из контекста** — клик вне, Escape,
 *    скролл, ресайз, выбор пункта.
 */
export function TableContextMenu({ x, y, items, onClose, ariaLabel }: Props) {
  const t = useTranslations("journalUi.tableContextMenu");
  const narrow = useIsNarrowViewport();
  const ref = useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null
  );

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  // Сбрасываем замер при переоткрытии в другой точке — иначе меню на долю
  // кадра показалось бы на старом месте.
  useLayoutEffect(() => {
    setPosition(null);
  }, [x, y]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || position) return;

    const { width, height } = element.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;

    // Не влезает вправо/вниз — разворачиваем от курсора в обратную сторону,
    // и только потом прижимаем к краю (окно уже меню — редкий, но реальный
    // случай на 320px).
    const left = x > maxLeft ? x - width : x;
    const top = y > maxTop ? y - height : y;

    setPosition({
      left: Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop)),
    });
    // `portalTarget` в deps обязателен: на первом коммите портала ещё нет
    // (ref === null, эффект выходит рано), а после его появления x/y/position
    // не меняются — без этой зависимости замер никогда не перезапускался и
    // меню оставалось `visibility: hidden` навсегда.
  }, [x, y, position, items.length, portalTarget]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("click", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("click", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  if (!portalTarget) return null;

  // На телефоне меню ячейки приходит листом снизу: у курсора там нет
  // курсора — меню открывается долгим нажатием, и «облако» у пальца
  // перекрывает саму ячейку. Пункты те же.
  if (narrow) {
    return (
      <BottomSheet open onClose={onClose} title={ariaLabel ?? t("actions")}>
        {items.map((item) => (
          <div key={item.key}>
            {item.separatorBefore ? (
              <div className="mx-3 my-1 h-px bg-[#ececf4]" />
            ) : null}
            <button
              type="button"
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              className={`${SHEET_ROW_CLASS} ${
                item.danger
                  ? "text-[#a13a32] hover:bg-[#fff4f2] active:bg-[#ffe9e5]"
                  : item.active
                    ? "bg-[#f5f6ff] text-[#3848c7]"
                    : ""
              }`}
            >
              {item.code ? (
                <span className="min-w-[34px] shrink-0 text-center font-semibold tabular-nums">
                  {item.code}
                </span>
              ) : null}
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.active ? (
                <Check className="size-4 shrink-0 text-[#5566f6]" />
              ) : null}
            </button>
          </div>
        ))}
      </BottomSheet>
    );
  }

  // До замера меню рендерится у курсора, но невидимым: так браузер уже
  // посчитал layout, а пользователь не видит прыжка.
  const style: CSSProperties = position
    ? { left: position.left, top: position.top }
    : { left: x, top: y, visibility: "hidden" };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={ariaLabel}
      className="fixed z-50 min-w-[160px] max-w-[260px] rounded-xl border border-[#ececf4] bg-white py-1 shadow-[0_18px_48px_-16px_rgba(11,16,36,0.35)] print:hidden"
      style={style}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <div key={item.key}>
          {item.separatorBefore ? (
            <div className="my-1 h-px bg-[#ececf4]" />
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={`mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors duration-150 ${
              item.danger
                ? "text-[#a13a32] hover:bg-[#fff4f2]"
                : item.active
                  ? "bg-[#f5f6ff] text-[#3848c7] hover:bg-[#eef1ff]"
                  : "text-[#0b1024] hover:bg-[#f5f6fb]"
            }`}
          >
            {item.code ? (
              <span className="min-w-[30px] shrink-0 font-semibold tabular-nums">
                {item.code}
              </span>
            ) : null}
            <span
              className={`flex-1 truncate ${item.code && !item.active ? "text-[#6f7282]" : ""}`}
            >
              {item.label}
            </span>
            {item.active ? (
              <Check className="size-3.5 shrink-0 text-[#5566f6]" />
            ) : null}
          </button>
        </div>
      ))}
    </div>,
    portalTarget
  );
}
