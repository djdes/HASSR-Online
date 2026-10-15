"use client";

import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { createTranslator } from "use-intl/core";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";
import { loadConfirmMessages } from "@/i18n/confirm-messages";
import { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog";

type ConfirmOptions = Omit<ConfirmDialogProps, "open" | "onClose" | "onConfirm"> & {
  locale?: Locale;
  /** Runs in the button event, retaining activation for native downloads. */
  onAccepted?: () => void;
};

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;
let activeResolve: ((value: boolean) => void) | null = null;
let requestId = 0;

function cleanup() {
  if (activeRoot) {
    try {
      activeRoot.unmount();
    } catch {
      // Ignore teardown errors from an already-unmounted root.
    }
    activeRoot = null;
  }
  activeContainer?.remove();
  activeContainer = null;
}

function openConfirmation(opts: ConfirmOptions, useDeleteDefault = false): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(false);
  }

  const currentRequest = ++requestId;
  cleanup();
  activeResolve?.(false);
  activeResolve = null;

  const { locale: requestedLocale, onAccepted, ...dialogOptions } = opts;
  const rawLocale = requestedLocale ?? document.documentElement.lang;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  return new Promise<boolean>((resolve) => {
    activeResolve = resolve;
    void loadConfirmMessages(locale).then((messages) => {
      // A later confirmation may have superseded this load.
      if (currentRequest !== requestId) return;

      const container = document.createElement("div");
      container.dataset.testid = "confirm-async-host";
      document.body.appendChild(container);
      activeContainer = container;

      const root = createRoot(container);
      activeRoot = root;
      const confirmLabel = opts.confirmLabel ?? (useDeleteDefault
        ? createTranslator({ locale, messages, namespace: "common" })("delete")
        : undefined);
      const dialogMessages = { journalControls: messages.journalControls };
      const renderDialog = (open: boolean, onClose: () => void, onConfirm: () => void) => (
        <NextIntlClientProvider locale={locale} messages={dialogMessages}>
          <ConfirmDialog {...dialogOptions} confirmLabel={confirmLabel} open={open} onClose={onClose} onConfirm={onConfirm} />
        </NextIntlClientProvider>
      );

      function close(result: boolean) {
        root.render(renderDialog(false, () => {}, () => {}));
        setTimeout(() => {
          if (activeContainer === container) cleanup();
          if (currentRequest === requestId) {
            activeResolve = null;
            resolve(result);
          }
        }, 50);
      }

      root.render(renderDialog(true, () => close(false), () => {
        try { onAccepted?.(); } finally { close(true); }
      }));
    }).catch(() => {
      if (currentRequest !== requestId) return;
      activeResolve = null;
      resolve(false);
    });
  });
}

export function confirmAsync(opts: ConfirmOptions): Promise<boolean> {
  return openConfirmation(opts);
}

/** Destructive confirmation; the dialog supplies the locale-aware default label. */
export function confirmDestructive(
  title: string,
  description?: React.ReactNode,
  confirmLabel?: string,
): Promise<boolean> {
  return openConfirmation({
    title,
    description,
    variant: "danger",
    ...(confirmLabel !== undefined ? { confirmLabel } : {}),
  }, true);
}
