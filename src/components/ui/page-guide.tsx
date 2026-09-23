"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, HelpCircle, X } from "lucide-react";

/**
 * Универсальный help-блок для каждой страницы. Рендерит «Как это
 * работает» — раскрывающийся блок с короткими шагами и FAQ.
 *
 * Каждая страница передаёт `title`, `bullets` (что делает страница),
 * и опционально `qa` (вопрос/ответ). По умолчанию свернут — не
 * мешает power-юзеру; новичку разворачивается одним кликом.
 *
 * Закрепляется в localStorage по `storageKey` — если юзер закрыл
 * подсказку для этой страницы, при следующем заходе он её не видит.
 * (Через month можно сбросить через очистку storage.)
 */
export type PageGuideProps = {
  title: string;
  bullets: ReadonlyArray<string | { title: string; body: string }>;
  qa?: ReadonlyArray<{ q: string; a: string }>;
  /** Уникальный slug страницы для запоминания состояния. */
  storageKey: string;
  /** Строка под пунктами — например ссылка на связанную настройку. */
  footer?: ReactNode;
};

export function PageGuide({ title, bullets, qa = [], storageKey, footer }: PageGuideProps) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(`page-guide:${storageKey}`) === "dismissed";
  });

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`page-guide:${storageKey}`, "dismissed");
    }
    setDismissed(true);
    setOpen(false);
  }

  if (dismissed && !open) {
    // Свернуто и закрыто — показываем мини-кнопку «?» которая
    // возвращает блок назад. Не агрессивно, но всегда доступно.
    return (
      <button
        type="button"
        onClick={() => {
          setDismissed(false);
          setOpen(true);
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(`page-guide:${storageKey}`);
          }
        }}
        className="inline-flex items-center gap-1 rounded-full border border-[#dcdfed] bg-white px-3 py-1 text-[12px] text-[#5566f6] hover:bg-[#f5f6ff]"
      >
        <HelpCircle className="size-3.5" />
        Как это работает
      </button>
    );
  }

  return (
    <div className="rounded-3xl border border-[#dcdfed] bg-[#f5f6ff] p-4 text-[13px] text-[#3c4053]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <HelpCircle className="size-4 text-[#5566f6]" />
        <span className="flex-1 font-medium text-[#0b1024]">{title}</span>
        <ChevronDown
          className={`size-4 text-[#6f7282] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          <ul className="space-y-1.5 pl-1">
            {bullets.map((b, i) => {
              if (typeof b === "string") {
                return (
                  <li
                    key={i}
                    className="flex items-start gap-2 leading-relaxed text-[#3c4053]"
                  >
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
                    <span>{b}</span>
                  </li>
                );
              }
              return (
                <li
                  key={i}
                  className="flex items-start gap-2 leading-relaxed text-[#3c4053]"
                >
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
                  <span>
                    <b className="text-[#0b1024]">{b.title}.</b> {b.body}
                  </span>
                </li>
              );
            })}
          </ul>

          {footer ? <div className="pl-1 leading-relaxed text-[#3c4053]">{footer}</div> : null}

          {qa.length > 0 ? (
            <div className="mt-2 space-y-1.5 border-t border-[#dcdfed] pt-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">
                Частые вопросы
              </div>
              {qa.map((item, i) => (
                <details key={i} className="text-[12px]">
                  <summary className="cursor-pointer list-none font-medium text-[#0b1024]">
                    — {item.q}
                  </summary>
                  <div className="mt-1 pl-3 leading-relaxed text-[#6f7282]">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            onClick={dismiss}
            className="inline-flex items-center gap-1 rounded-lg border border-[#dcdfed] bg-white px-2.5 py-1 text-[11px] text-[#6f7282] hover:bg-[#fafbff]"
          >
            <X className="size-3" />
            Понятно, скрыть
          </button>
        </div>
      ) : null}
    </div>
  );
}
