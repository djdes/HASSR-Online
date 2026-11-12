"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Граница области данных (2026-11-12): сменился `scopeKey` — всё внутри
 * монтируется заново, как после перезагрузки, и берёт данные новой
 * организации или точки с сервера. Без этого клиентское состояние
 * (`useState(initial)`, загрузка при монтировании) переживало смену, и
 * «Баланс и бонусы» показывал прежнюю организацию.
 *
 * Ключ считает layout (`lib/cabinet-scope.ts`). Провайдер перехода
 * (`ContentTransitionProvider`) и `<Toaster>` должны быть ВЫШЕ границы: тогда
 * скелет на время смены и тост после неё её переживают. Ключ ставится на
 * клиенте — так он надёжно доезжает из серверного layout.
 */
export function ScopeBoundary({ scopeKey, children }: { scopeKey: string; children: ReactNode }) {
  return <Fragment key={scopeKey}>{children}</Fragment>;
}
