"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "wesetup.cookie-consent";

/**
 * Разделы приложения, где баннер не показываем: это уже кабинет
 * вошедшего пользователя, а не публичный сайт.
 */
const APP_PREFIXES = [
  "/mini",
  "/dashboard",
  "/settings",
  "/journals/",
  "/reports",
  "/root",
  "/staff",
  "/team",
  "/batches",
  "/capa",
  "/losses",
  "/plans",
  "/changes",
  "/competencies",
  "/verifications",
  "/equipment",
  "/task-fill",
  "/equipment-fill",
  "/room-fill",
  "/journal-fill",
  // Экраны входа и регистрации. На узком телефоне (360×640) баннер ложился
  // поверх кнопки «Зарегистрироваться» и нижней части поля «Пароль» —
  // человек физически не мог закончить регистрацию, пока не нажмёт «ОК».
  // Согласие всё равно собирается на публичных страницах сайта.
  "/login",
  "/register",
  "/join/",
  "/invite/",
  "/pair/",
] as const;

/**
 * Компактный уведомительный бар про cookies.
 *
 * Требование модерации платёжного сервиса: посетитель должен видеть
 * уведомление об использовании cookies со ссылкой на политику. Баннер
 * именно уведомительный (одна кнопка «ОК»), поэтому аналитику мы им не
 * гейтим — согласие фиксируется фактом продолжения использования сайта.
 *
 * Дефолтное состояние — скрыт: решение о показе принимается в useEffect
 * после чтения localStorage, иначе на SSR баннер мигал бы у тех, кто уже
 * нажал «ОК». В `/mini*` (Telegram Mini App) не рендерим вовсе — там свой
 * fixed nav-rail внизу и баннер перекрыл бы навигацию.
 */
export function CookieConsent() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let accepted = true;
    try {
      accepted = Boolean(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      /* localStorage недоступен (приватный режим) — не показываем */
    }
    if (accepted) return;
    // Кабинет и мини-приложение (у них корень `.app-shell`): человек уже
    // вошёл, а баннер ложился поверх нижнего меню приложения на разделах,
    // не попавших в список префиксов («Премии», «Приказы», «Идеи»…).
    if (document.querySelector(".app-shell")) return;

    // Показ и появление разнесены по кадрам: сначала монтируем бар
    // скрытым, следующим кадром включаем opacity/translate — иначе
    // transition не отработает и баннер «прыгнет» на место.
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      setVisible(true);
      second = window.requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      window.cancelAnimationFrame(first);
      if (second) window.cancelAnimationFrame(second);
    };
  }, []);

  // Баннер — только для публичных страниц. Внутри кабинета согласие
  // уже получено при регистрации, а плашка там налезала на карточки
  // дашборда и на «Быстрый старт» (на мобильном — особенно заметно).
  if (pathname && APP_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  // Сам список журналов — тоже кабинет. В префиксах он записан со слэшем,
  // чтобы не задеть публичный /journals-info, и из-за этого выпадал:
  // баннер ложился поверх нижнего меню приложения.
  if (pathname === "/journals") return null;
  if (!visible) return null;

  function accept() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        `accepted:${new Date().toISOString()}`,
      );
    } catch {
      /* не смогли сохранить — просто скрываем на эту сессию */
    }
    setEntered(false);
    setVisible(false);
  }

  return (
    <div
      role="region"
      aria-label="Уведомление об использовании cookies"
      style={{ bottom: "var(--safe-b)" }}
      className={
        "fixed left-1/2 z-50 w-[calc(100%-24px)] max-w-[600px] -translate-x-1/2 " +
        "rounded-2xl border border-[#ececf4] bg-white/95 px-4 py-3 backdrop-blur " +
        "shadow-[0_16px_40px_-24px_rgba(11,16,36,0.4)] " +
        "flex items-center gap-3 transition-all duration-200 " +
        (entered
          ? "translate-y-0 opacity-100"
          : "translate-y-2 opacity-0")
      }
    >
      <p className="flex-1 text-[13px] leading-[1.5] text-[#6f7282]">
        <span className="hidden sm:inline">
          Мы используем cookies, чтобы сайт работал корректно и удобно.
        </span>
        <span className="sm:hidden">Мы используем cookies</span>{" "}
        <Link
          href="/privacy"
          className="text-[#3848c7] transition-colors hover:text-[#0b1024]"
        >
          Подробнее
        </Link>
      </p>
      <button
        type="button"
        onClick={accept}
        className="h-9 shrink-0 rounded-xl bg-[#5566f6] px-5 text-[13px] font-medium text-white transition-colors hover:bg-[#4a5bf0] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
      >
        ОК
      </button>
    </div>
  );
}
