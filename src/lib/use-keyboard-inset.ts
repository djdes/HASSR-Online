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
 *
 * Android-приложение делает третье: клавиатура сжимает само окно
 * (innerHeight 839 → 527), видимая часть равна окну — по разнице их не
 * увидеть. Там «открыта» — окно ниже своей полной высоты (`fullHeight`,
 * наибольшая при той же ширине) больше чем на 150px, и фокус в поле ввода;
 * подъём 0 — низ окна и так над клавиатурой. Без этого подвал формы стоял
 * над нижним меню, меню — над клавиатурой, и вдвоём они закрывали поле, в
 * котором печатают (Android, раунд 4, кадр 60).
 */
export function keyboardStateFrom(
  innerHeight: number,
  viewportHeight: number,
  viewportOffsetTop: number,
  fullHeight: number = innerHeight,
  editableFocused = false
): { open: boolean; bottom: number } {
  const overPage = innerHeight - viewportHeight > KEYBOARD_MIN_HEIGHT;
  const shrankWindow = editableFocused && fullHeight - innerHeight > RESIZED_KEYBOARD_MIN_HEIGHT;
  if (!overPage && !shrankWindow) return { open: false, bottom: 0 };
  return { open: true, bottom: Math.max(0, Math.round(innerHeight - viewportHeight - viewportOffsetTop)) };
}

/** Порог для клавиатуры, сжавшей окно: панели браузера двигают его на десятки px. */
const RESIZED_KEYBOARD_MIN_HEIGHT = 150;

/** Поле, над которым телефон открывает клавиатуру (не галочка, не кнопка, не список). */
function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "hidden", "image"].includes(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

/** Состояние клавиатуры для липких подвалов (см. `keyboardStateFrom`). */
export function useKeyboardState(): { open: boolean; bottom: number } {
  const [state, setState] = useState({ open: false, bottom: 0 });

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    // Полная высота окна при текущей ширине: поворот экрана — новый отсчёт.
    let full = { width: window.innerWidth, height: window.innerHeight };
    const update = () => {
      if (window.innerWidth !== full.width) full = { width: window.innerWidth, height: window.innerHeight };
      else if (window.innerHeight > full.height) full = { ...full, height: window.innerHeight };
      const next = keyboardStateFrom(
        window.innerHeight,
        viewport.height,
        viewport.offsetTop,
        full.height,
        isTextEntry(document.activeElement)
      );
      setState((prev) => (prev.open === next.open && prev.bottom === next.bottom ? prev : next));
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    // Фокус перешёл в поле при уже сжатом окне — пересчитать без resize.
    // Закрытие клавиатуры ловит resize: окно снова во весь рост.
    document.addEventListener("focusin", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
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
