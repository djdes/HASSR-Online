"use client";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/use-body-scroll-lock";

import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Loader2, PencilLine, X } from "lucide-react";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";
import { loadConfirmMessages } from "@/i18n/confirm-messages";

/**
 * Imperative prompt API — красивая замена `window.prompt`.
 *
 * Возвращает `Promise<string | null>`: строка при подтверждении,
 * `null` при отмене / Escape / клике по backdrop. Стилистика ровно
 * та же, что у `<ConfirmDialog>` (rounded-3xl карточка, индиго
 * `#5566f6`, focus-ring `ring-[#5566f6]/15`), поэтому визуально
 * prompt и confirm — одна семья.
 *
 * Использование:
 *   const name = await promptAsync({
 *     title: "Название исследования",
 *     label: "Как назвать колонку?",
 *     placeholder: "Например, Флюорография",
 *     validate: (v) => (v.trim() ? null : "Введите название"),
 *   });
 *   if (name === null) return;
 *
 * SSR — no-op (`Promise.resolve(null)`).
 */

export type PromptAsyncOptions = {
  locale?: Locale;
  title: string;
  /** Пояснение под заголовком — «зачем это». */
  description?: React.ReactNode;
  /** Подпись над полем ввода. */
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  type?: "text" | "number" | "date";
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Валидация значения. Возвращает текст ошибки, либо `null`/`undefined`
   * если всё в порядке. Кнопка подтверждения блокируется, пока ошибка.
   */
  validate?: (value: string) => string | null | undefined;
};

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;
let activeResolve: ((value: string | null) => void) | null = null;
let requestId = 0;

function cleanup() {
  if (activeRoot) {
    try {
      activeRoot.unmount();
    } catch {
      /* ignore */
    }
    activeRoot = null;
  }
  if (activeContainer) {
    activeContainer.remove();
    activeContainer = null;
  }
}

function PromptDialog({
  options,
  onResolve,
  copy,
}: {
  options: PromptAsyncOptions;
  onResolve: (value: string | null) => void;
  copy: { save: string; cancel: string; close: string };
}) {
  const [value, setValue] = useState(options.defaultValue ?? "");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const error = options.validate ? options.validate(value) : null;
  const canSubmit = !error && !submitting;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onResolve(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onResolve]);

  useEffect(() => {
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, []);

  function submit() {
    setTouched(true);
    if (!canSubmit) return;
    setSubmitting(true);
    onResolve(value);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-async-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label={copy.close}
        onClick={() => onResolve(null)}
        className="absolute inset-0 bg-[#0b1024]/40 backdrop-blur-sm transition-opacity"
      />

      <div className="relative w-full max-w-[480px] overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_30px_80px_-30px_rgba(11,16,36,0.55)]">
        <div className="relative overflow-hidden bg-gradient-to-br from-[#f5f6ff] to-white p-6">
          <div className="pointer-events-none absolute -right-12 -top-12 size-[200px] rounded-full bg-[#5566f6]/8 blur-3xl" />
          <div className="relative flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff]">
              <PencilLine className="size-6 text-[#5566f6]" />
            </div>
            <div className="min-w-0 flex-1">
              <h2
                id="prompt-async-title"
                className="text-[18px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]"
              >
                {options.title}
              </h2>
              {options.description ? (
                <div className="mt-2 text-[13px] leading-[1.55] text-[#3c4053]">
                  {options.description}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onResolve(null)}
              aria-label={copy.close}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-[#9b9fb3] transition-colors hover:bg-white/60 hover:text-[#0b1024]"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="px-6 pt-5">
          {options.label ? (
            <label
              htmlFor="prompt-async-input"
              className="mb-2 block text-[12px] font-medium text-[#3c4053]"
            >
              {options.label}
            </label>
          ) : null}
          <input
            id="prompt-async-input"
            ref={inputRef}
            type={options.type ?? "text"}
            value={value}
            placeholder={options.placeholder}
            disabled={submitting}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] transition-colors placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60"
          />
          {touched && error ? (
            <div className="mt-1.5 text-[11px] text-[#a13a32]">{error}</div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-4">
          <button
            type="button"
            onClick={() => onResolve(null)}
            disabled={submitting}
            className="inline-flex h-11 items-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#3c4053] transition-colors hover:border-[#5566f6]/40 hover:bg-[#fafbff] disabled:opacity-60"
          >
            {options.cancelLabel ?? copy.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit && touched}
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {options.confirmLabel ?? copy.save}
          </button>
        </div>
      </div>
    </div>
  );
}

export function promptAsync(
  options: PromptAsyncOptions,
): Promise<string | null> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(null);
  }
  const currentRequest = ++requestId;
  cleanup();
  activeResolve?.(null);
  activeResolve = null;
  const rawLocale = options.locale ?? document.documentElement.lang;
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  return new Promise<string | null>((resolve) => {
    activeResolve = resolve;
    void loadConfirmMessages(locale).then(messages => {
      if (currentRequest !== requestId) return;
      const container = document.createElement("div");
      container.dataset.testid = "prompt-async-host";
      document.body.appendChild(container);
      activeContainer = container;

      const root = createRoot(container);
      activeRoot = root;

      function finish(result: string | null) {
        setTimeout(() => {
          if (activeContainer === container) cleanup();
          if (currentRequest === requestId) activeResolve = null;
          resolve(result);
        }, 0);
      }

      root.render(<PromptDialog options={options} onResolve={finish} copy={messages.common} />);
    }).catch(() => {
      if (currentRequest !== requestId) return;
      activeResolve = null;
      resolve(null);
    });
  });
}
