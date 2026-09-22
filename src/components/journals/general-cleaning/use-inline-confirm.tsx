"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

import { ConfirmDialog, type ConfirmDialogProps } from "@/components/ui/confirm-dialog";

type ConfirmOptions = Omit<ConfirmDialogProps, "open" | "onClose" | "onConfirm">;

/**
 * `ConfirmDialog` из дерева React текущего окна — для вопросов изнутри
 * поповера и листа снизу.
 *
 * ПОЧЕМУ не `confirmAsync`: тот монтирует окно в отдельный корень, и
 * нажатие в нём Radix (поповер) и vaul (лист) считают «кликом снаружи» —
 * окно, из которого спросили, закрывается вместе с набранным. Портал
 * отсюда остаётся «внутри» по дереву React, и слой не закрывается.
 *
 *   const { confirm, element } = useInlineConfirm();
 *   …{element} в разметке окна;
 *   if (!(await confirm({ title: "Убрать дату?" }))) return;
 */
export function useInlineConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  element: ReactNode;
} {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (next: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current?.(false);
        resolverRef.current = resolve;
        setOptions(next);
      }),
    [],
  );

  const settle = useCallback((ok: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolve?.(ok);
  }, []);

  const element = options ? (
    <ConfirmDialog
      {...options}
      open
      onClose={() => settle(false)}
      onConfirm={() => settle(true)}
    />
  ) : null;

  return { confirm, element };
}
