"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export type PpkNavStatus = "done" | "started" | "empty" | "info";

/**
 * Статусы блоков раздела «Производственный контроль» для точек в меню раздела.
 * Подгружаются, пока человек в разделе: при смене пути внутри раздела и по
 * событию `ppk:changed` (его шлют страницы блоков после сохранения).
 * Для остальных разделов статусов нет.
 */
export function useSectionStatuses(sectionKey: string | undefined): Record<string, PpkNavStatus> {
  const pathname = usePathname();
  const [statuses, setStatuses] = useState<Record<string, PpkNavStatus>>({});
  const wanted = sectionKey === "productionControl";

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    const load = () => {
      fetch("/api/production-control/progress")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { statuses?: Record<string, PpkNavStatus> } | null) => {
          if (!cancelled && data?.statuses) setStatuses(data.statuses);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("ppk:changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("ppk:changed", load);
    };
  }, [wanted, pathname]);

  return wanted ? statuses : {};
}
