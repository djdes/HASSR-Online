"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

/**
 * Куда в мини-приложении ведёт ссылка, написанная для сайта.
 * Документ журнала внутри мини-приложения рисует тот же код, что и сайт,
 * поэтому его ссылки («К списку документов», соседний документ) написаны
 * как `/journals/...` и уводили человека из мини-приложения на сайт —
 * без нижнего меню и без пути назад. Возвращает `null`, если у ссылки нет
 * зеркала в мини-приложении (её оставляем как есть).
 */
export function toMiniHref(href: string): string | null {
  const [path, tail = ""] = href.split(/(?=[?#])/, 2);
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "journals") return null;
  // /journals
  if (parts.length === 1) return `/mini/journals${tail}`;
  // /journals/<code>
  if (parts.length === 2) return `/mini/journals/${parts[1]}${tail}`;
  // /journals/<code>/documents/<id>
  if (parts.length === 4 && parts[2] === "documents") {
    return `/mini/documents/${parts[3]}${tail}`;
  }
  return null;
}

export function MiniDocumentLinks({ children }: { children: ReactNode }) {
  const router = useRouter();

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
    if (!anchor) return;
    if (anchor.getAttribute("target") === "_blank") return;
    const href = anchor.getAttribute("href") ?? "";
    if (!href.startsWith("/")) return;
    const mini = toMiniHref(href);
    if (!mini) return;
    event.preventDefault();
    event.stopPropagation();
    router.push(mini);
  }

  return (
    // Хост НЕ прокручивается сам: стань он контейнером прокрутки, «липкая»
    // нижняя кнопка бланка перестала бы держаться у экрана. Прокрутку вбок
    // таблицам возвращает правило `.mini-document-host` в mini-theme.css.
    <div className="mini-document-host" onClickCapture={onClickCapture}>
      {children}
    </div>
  );
}
