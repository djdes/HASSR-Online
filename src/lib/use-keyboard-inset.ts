"use client";

import { useEffect, useState } from "react";

/**
 * Высота, которую экранная клавиатура отъела у вьюпорта.
 *
 * Зачем: во всех журналах липкие подвалы диалогов и плавающие кнопки
 * прибиты к `bottom`, а `position: fixed` на iOS считается от **layout
 * viewport**, который клавиатура не уменьшает. В итоге «Сохранить»
 * уезжает под клавиатуру ровно в тот момент, когда он нужен. До этого
 * хука `window.visualViewport` в проекте использовался только в
 * `spotlight-tour.tsx` для позиционирования подсветки.
 *
 * Возвращает число пикселей (0, когда клавиатуры нет). Подставлять в
 * `style={{ paddingBottom: inset }}` или `bottom: inset` у липкого блока.
 *
 * Тонкости:
 *  - Android часто вместо `visualViewport.height` меняет
 *    `window.innerHeight`; берём разницу, а не абсолютное значение.
 *  - `offsetTop` учитывает случай, когда страницу проскроллило под
 *    клавиатуру целиком.
 *  - Порог в 80px отсекает адресную строку Safari, которая тоже двигает
 *    visualViewport, но клавиатурой не является.
 */
const KEYBOARD_MIN_HEIGHT = 80;

/**
 * `enabled = false` — не слушать вьюпорт вовсе (закрытое окно, которое
 * всё равно смонтировано): возвращает 0.
 */
export function useKeyboardInset(enabled = true): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      const hidden =
        window.innerHeight - viewport.height - viewport.offsetTop;
      setInset(hidden > KEYBOARD_MIN_HEIGHT ? Math.round(hidden) : 0);
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);

    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [enabled]);

  return enabled ? inset : 0;
}

/**
 * Предел высоты окна над открытой клавиатурой: видимая часть экрана минус
 * строка состояния. Без него на iPhone окно («Удалить аккаунт навсегда?»
 * с полем ввода) было выше видимой части и заезжало верхом под часы и
 * «чёлку». `null` — видимую высоту не знаем, оставляем как было.
 */
export function keyboardSheetMaxHeight(visibleHeight: number): string | null {
  if (!(visibleHeight > 0)) return null;
  return `calc(${Math.round(visibleHeight)}px - env(safe-area-inset-top, 0px) - 12px)`;
}

/** Высота видимой части экрана (без клавиатуры); 0 — не слушаем. */
export function useVisibleViewportHeight(enabled = true): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setHeight(viewport.height);
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [enabled]);

  return enabled ? height : 0;
}

/**
 * На сколько пикселей прокрутить блок `view`, чтобы элемент `el` был виден
 * целиком (с отступом `margin`). Положительное — вниз, отрицательное — вверх,
 * 0 — уже виден. Высокий элемент выравнивается по верху.
 *
 * Зачем: окно подтверждения с полем ввода при открытой клавиатуре ограничено
 * видимой частью экрана, его середина становится прокручиваемой — и поле
 * «введите УДАЛИТЬ» оказывалось под кнопками окна (iPhone, раунд 5, кадр 040):
 * набирать приходилось вслепую, а нажатие по полю попадало в «Отмена».
 */
export function scrollDeltaToReveal(
  view: { top: number; bottom: number },
  el: { top: number; bottom: number },
  margin = 12
): number {
  const up = el.top - margin - view.top;
  if (up < 0) return Math.round(up);
  const down = el.bottom + margin - view.bottom;
  if (down > 0) return Math.round(Math.min(down, up));
  return 0;
}

/**
 * Открыта ли экранная клавиатура и на сколько поднять над низом раскладки
 * то, что должно стоять прямо над ней.
 *
 * iPhone делает по-разному. Поле вверху экрана — видимая часть просто
 * укорачивается (offsetTop = 0), низ раскладки под клавиатурой: поднять
 * нужно на всю её высоту. Поле внизу экрана — iOS сдвигает видимую часть
 * вниз по раскладке (offsetTop ≈ высота клавиатуры): низ раскладки почти у
 * клавиатуры, поднимать почти не на что. `useKeyboardInset` во втором случае
 * отдаёт 0 («клавиатуры нет»), и подвал формы оставался над нижним меню —
 * выше клавиатуры на 81pt, а меню вылезало над клавиатурой (раунд 6, кадр 012).
 * Поэтому «открыта» считаем по высоте видимой части, а подъём — отдельно.
 */
export function keyboardStateFrom(
  innerHeight: number,
  viewportHeight: number,
  viewportOffsetTop: number
): { open: boolean; bottom: number } {
  if (!(innerHeight - viewportHeight > KEYBOARD_MIN_HEIGHT)) return { open: false, bottom: 0 };
  return { open: true, bottom: Math.max(0, Math.round(innerHeight - viewportHeight - viewportOffsetTop)) };
}

/** Состояние клавиатуры для липких подвалов (см. `keyboardStateFrom`). */
export function useKeyboardState(): { open: boolean; bottom: number } {
  const [state, setState] = useState({ open: false, bottom: 0 });

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const next = keyboardStateFrom(window.innerHeight, viewport.height, viewport.offsetTop);
      setState((prev) => (prev.open === next.open && prev.bottom === next.bottom ? prev : next));
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return state;
}

/**
 * Стиль липкого подвала формы с кнопками «Сохранить» / «Отмена».
 *
 * Клавиатуры нет — подвал у низа экрана (в мини-приложении CSS поднимает
 * его над нижним меню), снизу поле под полоску «домой». Клавиатура
 * открыта — подвал встаёт прямо над ней (`bottom` из `keyboardStateFrom`,
 * в том числе 0), нижнее меню на это время прячется (`data-keyboard-open`).
 * Раньше высота клавиатуры прибавлялась к отступам, и на iPhone между
 * кнопками и клавиатурой оставалась пустая полоса ~140pt, а подвал закрывал
 * поле, в котором человек печатал (раунд 5, кадр 015).
 */
export function stickyFooterStyle(keyboard: { open: boolean; bottom: number }): {
  bottom?: number;
  paddingBottom: string;
} {
  if (keyboard.open) return { bottom: keyboard.bottom, paddingBottom: "0.75rem" };
  return { paddingBottom: "max(0.75rem, var(--safe-b))" };
}
