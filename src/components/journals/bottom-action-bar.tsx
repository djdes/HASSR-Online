"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { haptic } from "@/app/mini/_components/use-haptic";

/**
 * Главное действие журнала, прижатое к низу экрана телефона.
 *
 * Не путать со `sticky-action-bar.tsx`: та липнет СВЕРХУ и держит ряд
 * «Добавить строку / Настроить» над таблицей. Эта — снизу, и в ней
 * ровно одно главное действие смены.
 *
 * Зачем снизу: список на двадцать сотрудников длиннее экрана втрое, и
 * кнопка над ним требует доскроллить обратно. Внизу её достаёт большой
 * палец, не перехватывая телефон.
 *
 * Появляется, только когда делать действительно есть что: иначе полоса
 * молча съедала бы место у последней строки списка.
 *
 * Нижний отступ считает `var(--safe-area-inset-bottom, env(safe-area-inset-bottom))` — на айфонах с
 * домашней полосой кнопка иначе оказывается наполовину под ней.
 */
export function BottomActionBar({
  primary,
  secondary,
  hint,
}: {
  primary: {
    label: string;
    onRun: () => void;
    disabled?: boolean;
    icon?: ReactNode;
  } | null;
  secondary?: { label: string; onRun: () => void } | null;
  /** Короткая строка над кнопкой: «осталось 8 из 9». */
  hint?: ReactNode;
}) {
  // Оболочка мини-приложения (Telegram). `sticky` держит панель только в
  // пределах блока со списком: на невысоком телефоне список начинается
  // низко, панель ложилась на его первые строки, а сама кнопка уходила под
  // нижнее меню — видна наполовину. В оболочке закрепляем панель по-настоящему:
  // `fixed` над меню, портал в `#mini-root` (у полотна страницы есть
  // `transform`, внутри него `fixed` считался бы от полотна, а не от экрана).
  const [miniRoot, setMiniRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setMiniRoot(document.getElementById("mini-root"));
  }, []);

  /**
   * Показывать ли закреплённую панель прямо сейчас (только в оболочке).
   *
   * На 360px она ложилась на первый экран и закрывала переключатель
   * «Карточки/Таблица» и первые карточки — человек не понимал, что там
   * вообще есть. Правило простое: пока страница стоит в самом верху и
   * её есть куда крутить — панель не мешаем показывать содержимое.
   * Прокрутил чуть вниз (80px) — панель приезжает. Страница короче
   * экрана (крутить некуда) — панель видна сразу, там она никому не
   * мешает: распорка ниже резервирует под неё место.
   */
  const [barVisible, setBarVisible] = useState(true);
  useEffect(() => {
    if (!miniRoot) return;
    function update() {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight > 120;
      setBarVisible(!scrollable || window.scrollY > 80);
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [miniRoot]);

  if (!primary) return null;

  const body = (
    <>
      {/* В оболочке приложения строку-подсказку не рисуем: счётчик уже стоит в
          самой кнопке, а экран там ниже на высоту нижнего меню. */}
      {hint && !miniRoot ? (
        <div className="mb-2 text-center text-[12px] text-[#6f7282]">{hint}</div>
      ) : null}
      <div className="flex gap-2">
        {secondary ? (
          <button
            type="button"
            onClick={secondary.onRun}
            className="min-h-[52px] shrink-0 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            {secondary.label}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            haptic("medium");
            primary.onRun();
          }}
          disabled={primary.disabled}
          className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-50"
        >
          {primary.icon}
          {primary.label}
        </button>
      </div>
    </>
  );

  if (miniRoot) {
    return (
      <>
        {/* Место под закреплённую панель, чтобы она не закрывала конец списка. */}
        <div aria-hidden className="h-[88px] sm:hidden print:hidden" />
        {createPortal(
          <div
            aria-hidden={!barVisible}
            className={`fixed inset-x-0 z-30 border-t border-[#ececf4] bg-white/95 px-4 pb-3 pt-3 backdrop-blur transition-opacity duration-200 sm:hidden print:hidden ${
              barVisible ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            style={{
              bottom: "calc(var(--mini-safe-b, 12px) + var(--mini-nav-h, 64px) + 8px)",
            }}
          >
            {body}
          </div>,
          miniRoot,
        )}
      </>
    );
  }

  return (
    <div
      className="sticky inset-x-0 bottom-0 z-30 -mx-4 mt-3 border-t border-[#ececf4] bg-white/95 px-4 pt-3 backdrop-blur sm:hidden print:hidden"
      style={{ paddingBottom: "var(--safe-b)" }}
    >
      {body}
    </div>
  );
}
