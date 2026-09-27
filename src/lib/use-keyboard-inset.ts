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
