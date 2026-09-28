"use client";

import { useLayoutEffect, useRef } from "react";

import { attachDashboardSectionMemory } from "@/lib/dashboard-section-memory";

/**
 * Помощник запоминания внутри `DashboardSection`: при переходе на главную
 * внутри приложения inline-скрипт страницы не исполняется (React вставляет
 * его «мёртвым»), и без этого секция открывалась бы по умолчанию, а
 * сворачивание не сохранялось. Layout-effect — до отрисовки, без мигания.
 * При полной загрузке секцию уже подхватил скрипт — здесь вызов пустой.
 */
export function DashboardSectionMemory() {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const details = ref.current?.closest("details");
    if (!details) return;
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    attachDashboardSectionMemory(
      details as HTMLDetailsElement & { __persistAttached?: boolean },
      storage,
    );
  }, []);
  return <span ref={ref} hidden />;
}
