"use client";

import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import { useEffect, useState } from "react";

import { hasMiniShellCookie } from "@/lib/mini-shell-cookie";

/**
 * Карточка «страница не найдена».
 *
 * Куда вести человека — зависит от того, где он сейчас:
 *
 *   • в оболочке приложения (кука `ws-shell=mini`) — на `/mini`:
 *     тот сам уводит домой по роли. `/dashboard` линейному сотруднику
 *     закрыт, а `/` — это лендинг, то есть выход из приложения;
 *   • на обычном сайте — как раньше: лендинг плюс кабинет.
 *
 * Цвета — через токены темы (`--app-*`), иначе в тёмной теме карточка
 * оставалась ярко-белой.
 */
export function NotFoundCard() {
  // Куку читает только браузер, и делает это после гидрации: на сервере
  // 404 может отрисоваться заранее, без запроса.
  const [inShell, setInShell] = useState(false);
  useEffect(() => {
    // Легитимный hydration-паттерн: кука — внешнее состояние, читаем
    // один раз после монтирования.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInShell(hasMiniShellCookie(document.cookie));
  }, []);

  const homeHref = inShell ? "/mini" : "/dashboard";

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-10"
      style={{
        background: "var(--app-bg)",
        // Кнопки не должны прятаться под нижним меню приложения.
        paddingBottom: "max(2.5rem, calc(var(--mini-safe-b, 0px) + 7rem))",
      }}
    >
      <div
        className="w-full max-w-md rounded-3xl border p-8 text-center"
        style={{
          background: "var(--app-surface)",
          borderColor: "var(--app-border)",
        }}
      >
        <div
          className="mx-auto flex size-14 items-center justify-center rounded-2xl"
          style={{
            background: "var(--app-tint-indigo-2)",
            color: "var(--app-indigo)",
          }}
        >
          <Compass className="size-7" />
        </div>
        <h1
          className="mt-6 text-[clamp(1.5rem,4vw+1rem,2.25rem)] font-semibold tracking-[-0.02em]"
          style={{ color: "var(--app-text)" }}
        >
          Страница не найдена
        </h1>
        <p
          className="mt-3 text-[14px] leading-relaxed"
          style={{ color: "var(--app-text-muted)" }}
        >
          Ссылка устарела или раздел перенесён. Вернитесь на главную, чтобы
          продолжить работу.
        </p>
        <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {inShell ? null : (
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border px-4 text-[14px] font-medium transition-colors"
              style={{
                background: "var(--app-surface)",
                borderColor: "var(--app-border-strong)",
                color: "var(--app-text)",
              }}
            >
              <ArrowLeft className="size-4" />
              О сервисе
            </Link>
          )}
          <Link
            href={homeHref}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors"
            style={{ background: "var(--app-indigo)" }}
          >
            Вернуться на главную
          </Link>
        </div>
      </div>
    </div>
  );
}
