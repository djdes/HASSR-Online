"use client";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/use-body-scroll-lock";
import { keyboardSheetMaxHeight, scrollDeltaToReveal, useKeyboardInset, useVisibleViewportHeight } from "@/lib/use-keyboard-inset";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  Loader2,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";

type Variant = "default" | "info" | "danger" | "warn";

const VARIANT_STYLES: Record<
  Variant,
  {
    iconBg: string;
    iconColor: string;
    confirmBg: string;
    confirmHover: string;
    confirmRing: string;
    accentBg: string;
    /** Тёмная тема: светлая шапка с посветлевшим текстом не читалась. */
    dark: { accentBg: string; iconBg: string; iconColor: string };
  }
> = {
  default: {
    iconBg: "bg-[#eef1ff]",
    iconColor: "text-[#5566f6]",
    confirmBg: "bg-[#5566f6]",
    confirmHover: "hover:bg-[#4a5bf0]",
    confirmRing: "shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)]",
    accentBg: "bg-gradient-to-br from-[#f5f6ff] to-white",
    dark: {
      accentBg: "bg-gradient-to-br from-[#46437c] to-[#3a3757]",
      iconBg: "bg-[rgba(126,140,255,0.22)]",
      iconColor: "text-[#c3c9ff]",
    },
  },
  info: {
    iconBg: "bg-[#eef1ff]",
    iconColor: "text-[#3848c7]",
    confirmBg: "bg-[#5566f6]",
    confirmHover: "hover:bg-[#4a5bf0]",
    confirmRing: "shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)]",
    accentBg: "bg-gradient-to-br from-[#f5f6ff] to-white",
    dark: {
      accentBg: "bg-gradient-to-br from-[#46437c] to-[#3a3757]",
      iconBg: "bg-[rgba(126,140,255,0.22)]",
      iconColor: "text-[#c3c9ff]",
    },
  },
  warn: {
    iconBg: "bg-[#fff8eb]",
    iconColor: "text-[#a16d32]",
    confirmBg: "bg-[#d97706]",
    confirmHover: "hover:bg-[#b45309]",
    confirmRing: "shadow-[0_10px_30px_-12px_rgba(217,119,6,0.45)]",
    accentBg: "bg-gradient-to-br from-[#fff8eb] to-white",
    dark: {
      accentBg: "bg-gradient-to-br from-[#56484a] to-[#3a3757]",
      iconBg: "bg-[rgba(255,178,80,0.18)]",
      iconColor: "text-[#ffcc80]",
    },
  },
  danger: {
    iconBg: "bg-[#fff4f2]",
    iconColor: "text-[#a13a32]",
    confirmBg: "bg-[#a13a32]",
    confirmHover: "hover:bg-[#8b3128]",
    confirmRing: "shadow-[0_10px_30px_-12px_rgba(161,58,50,0.55)]",
    accentBg: "bg-gradient-to-br from-[#fff4f2] to-white",
    dark: {
      accentBg: "bg-gradient-to-br from-[#583f56] to-[#3a3757]",
      iconBg: "bg-[rgba(255,144,130,0.18)]",
      iconColor: "text-[#ffb4a8]",
    },
  },
};

/**
 * Тёмная тема кабинета и мини-приложения — та же метка, по которой
 * `app-theme.css` перекрашивает страницу. Окно порталится в `<body>`,
 * вне `.app-shell`, поэтому вариант `dark:` до него не доходит.
 */
const DARK_THEME_SELECTOR =
  '[data-app-theme="dark"], :has(.app-shell[data-app-theme="dark"])';

function isDarkTheme(): boolean {
  try {
    return document.body.matches(DARK_THEME_SELECTOR);
  } catch {
    // Браузер без :has() — остаётся светлая шапка.
    return false;
  }
}

const VARIANT_ICONS: Record<Variant, typeof Sparkles> = {
  default: Sparkles,
  info: Check,
  warn: AlertTriangle,
  danger: ShieldAlert,
};

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  /// Описание — может быть строкой или JSX-блоком (для bullet-списков).
  description?: React.ReactNode;
  /// Список ключевых пунктов в стиле «что произойдёт» — рендерим как
  /// яркий список перед кнопками. Лучше использовать для destructive
  /// чтобы менеджер ОЧЕНЬ хорошо понял последствия.
  bullets?: Array<{
    label: string;
    tone?: "default" | "warn" | "info";
  }>;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
  /// Если задано — пользователь должен ввести эту фразу перед кнопкой.
  /// Используется для самых опасных действий (удаление).
  typeToConfirm?: string;
  /// Кастомная иконка (override variant).
  icon?: typeof Sparkles;
  /// Дополнительный блок между списком последствий и кнопками: выбор
  /// режима, поле уточнения и т. п. Иначе такие диалоги приходится
  /// писать с нуля, и они расходятся с остальными по виду.
  children?: React.ReactNode;
  /// Блокирует кнопку подтверждения, пока форма внутри `children` не
  /// заполнена (не выбран сотрудник, пустой список). Без этого диалог с
  /// выбором приходилось бы подтверждать и ловить ошибку с сервера.
  confirmDisabled?: boolean;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  bullets,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  variant = "default",
  typeToConfirm,
  icon: IconOverride,
  children,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [phrase, setPhrase] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const Icon = IconOverride ?? VARIANT_ICONS[variant];
  const styles = VARIANT_STYLES[variant];

  useEffect(() => {
    if (!open) {
      setPhrase("");
      setSubmitting(false);
    }
  }, [open]);

  // Escape ловим в ФАЗЕ ПЕРЕХВАТА на window. Окно нередко открывают из
  // кнопки, лежащей внутри `<summary>` раскрывающейся секции (кнопка
  // «Закрыть день» на главной) — там нажатие успевал обработать кто-то
  // другой, и лист не закрывался. Перехват срабатывает раньше всех и не
  // зависит от того, где сейчас фокус.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || submitting) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, submitting, onClose]);

  // Фокус переводим на саму карточку: иначе он остаётся на кнопке под
  // окном, и клавиатура продолжает управлять страницей, а не листом.
  // Если содержимое уже поставило фокус в своё поле (переименование
  // журнала, `typeToConfirm` с autoFocus) — не отбираем: на телефоне это
  // закрыло бы только что открытую клавиатуру.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      const card = dialogRef.current;
      if (card && !card.contains(document.activeElement)) card.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Body scroll lock пока открыта.
  useEffect(() => {
    if (!open) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [open]);

  // Экранная клавиатура телефона. Лист прижат к низу `position: fixed`, а
  // iPhone (и Android с Chrome 108) клавиатурой уменьшает только видимую
  // часть экрана: без поправки клавиатура закрывала поле и кнопки листа,
  // а iOS, открывая её, сдвигал видимую часть страницы — поле уезжало
  // из-под пальца (владелец, 2026-09-27, окно переименования журнала:
  // «даже выделить нельзя»). Поднимаем лист над клавиатурой — как
  // `card-edit-sheet` и `dynamic-form`.
  const keyboardInset = useKeyboardInset(open);
  // С клавиатурой окно не выше видимой части экрана — иначе на iPhone его
  // верх заезжал под часы и «чёлку».
  const visibleHeight = useVisibleViewportHeight(open);
  const keyboardMaxHeight = keyboardInset ? keyboardSheetMaxHeight(visibleHeight) : null;

  // Окно стало ниже (клавиатура) — поле с фокусом прокручиваем в видимую
  // середину окна: иначе на iPhone оно пряталось под «Отмена» / «Удалить».
  const revealFocused = () => {
    const body = bodyRef.current;
    const active = document.activeElement;
    if (!body || !(active instanceof HTMLElement) || !body.contains(active)) return;
    const delta = scrollDeltaToReveal(body.getBoundingClientRect(), active.getBoundingClientRect());
    if (delta) body.scrollTop += delta;
  };
  useEffect(() => {
    if (!keyboardInset) return;
    const id = window.requestAnimationFrame(revealFocused);
    return () => window.cancelAnimationFrame(id);
  }, [keyboardInset, keyboardMaxHeight]);

  if (!open || typeof document === "undefined") return null;

  const phraseOk =
    !typeToConfirm || phrase.trim().toUpperCase() === typeToConfirm.toUpperCase();
  const canConfirm = phraseOk && !submitting && !confirmDisabled;
  const tone = isDarkTheme() ? { ...styles, ...styles.dark } : styles;

  async function handleConfirm() {
    if (!canConfirm) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } catch {
      // Ошибки выводим через toast в onConfirm — здесь только разлок.
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Портал в `document.body` — ОБЯЗАТЕЛЕН.
   *
   * Полотно страницы дашборда обёрнуто в full-bleed-контейнер с
   * `translate: -50%` (Tailwind v4 пишет отдельное свойство `translate`,
   * а не `transform`). Любой `position: fixed` внутри считается от этой
   * коробки, а не от экрана: на телефоне окно уезжало вниз и его нижняя
   * часть вместе с кнопками оказывалась за краем, а внутренний скролл
   * не помогал — прокручивать было нечего.
   */
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      // z-60: нижнее меню мини-приложения висит на 50-м слое
      // (`--mini-z-nav`), и окно обязано лечь поверх него — иначе
      // кнопки «Подтвердить» на телефоне не видно.
      //
      // pointer-events-auto: подтверждение бывает открыто поверх
      // обычного окна (Radix Dialog), а оно на время своей жизни
      // выключает `pointer-events` у всего `body`. Без этой строки
      // кнопки нашего окна не нажимались бы.
      className="pointer-events-auto fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:px-4"
      style={keyboardInset ? { paddingBottom: keyboardInset } : undefined}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Закрыть"
        onClick={() => !submitting && onClose()}
        className="absolute inset-0 bg-[#0b1024]/40 backdrop-blur-sm transition-opacity"
      />

      {/* Card */}
      {/* Карточка: шапка и кнопки закреплены, середина скроллится —
          иначе диалог с выбором (список сотрудников) вырастает выше
          экрана и кнопка «Подтвердить» уезжает за нижний край. */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        // Клики внутри окна не должны уходить наверх по дереву React:
        // портал остаётся ребёнком того места, где его отрисовали, и на
        // главной это `<summary>` раскрывающейся секции — нажатия внутри
        // листа сворачивали бы её.
        onClick={(e) => e.stopPropagation()}
        // С клавиатурой лист не выше видимой над ней части экрана:
        // середина прокручивается, шапка и кнопки остаются на виду.
        style={keyboardInset ? { maxHeight: keyboardMaxHeight ?? "calc(100% - 12px)" } : undefined}
        className={`relative flex max-h-[90vh] outline-none supports-[height:100dvh]:max-h-[90dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-3xl border border-[#ececf4] bg-white sm:rounded-3xl shadow-[0_30px_80px_-30px_rgba(11,16,36,0.55)]`}
      >
        {/* Header — gradient accent */}
        <div className={`relative shrink-0 overflow-hidden ${tone.accentBg} p-6`}>
          <div className="pointer-events-none absolute -right-12 -top-12 size-[200px] rounded-full bg-[#5566f6]/8 blur-3xl" />
          <div className="relative flex items-start gap-3">
            <div
              className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${tone.iconBg}`}
            >
              <Icon className={`size-6 ${tone.iconColor}`} />
            </div>
            <div className="min-w-0 flex-1">
              <h2
                id="confirm-dialog-title"
                className="text-[18px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]"
              >
                {title}
              </h2>
              {description ? (
                <div className="mt-2 text-[13px] leading-[1.55] text-[#3c4053]">
                  {description}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => !submitting && onClose()}
              aria-label="Закрыть"
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-[#9b9fb3] hover:bg-white/60 hover:text-[#0b1024]"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div
          ref={bodyRef}
          // Фокус в поле при уже открытой клавиатуре — тоже показать поле.
          onFocus={() => {
            if (keyboardInset) window.requestAnimationFrame(revealFocused);
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
        {/* Bullets */}
        {bullets && bullets.length > 0 ? (
          <div className="space-y-2 px-6 pb-1 pt-4">
            {bullets.map((b, i) => {
              const tone = b.tone ?? "default";
              const dot =
                tone === "warn"
                  ? "bg-[#a13a32]"
                  : tone === "info"
                    ? "bg-[#5566f6]"
                    : "bg-[#9b9fb3]";
              return (
                <div
                  key={i}
                  className="flex items-start gap-2 text-[13px] leading-[1.5] text-[#3c4053]"
                >
                  <span
                    className={`mt-1.5 inline-block size-1.5 shrink-0 rounded-full ${dot}`}
                  />
                  <span>{b.label}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        {children ? <div className="px-6 pb-1 pt-4">{children}</div> : null}

        {/* Type-to-confirm */}
        {typeToConfirm ? (
          <div className="px-6 pb-1 pt-4">
            <label className="block text-[12px] font-medium text-[#3c4053]">
              Чтобы продолжить, введите{" "}
              <span className="rounded-md bg-[#fff4f2] px-1.5 py-0.5 font-mono text-[12px] font-semibold text-[#a13a32]">
                {typeToConfirm}
              </span>
            </label>
            <input
              type="text"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoFocus
              placeholder={typeToConfirm}
              disabled={submitting}
              className={`mt-2 h-11 w-full rounded-2xl border bg-white px-4 text-[14px] tracking-wide text-[#0b1024] placeholder:text-[#9b9fb3] focus:outline-none focus:ring-4 disabled:opacity-60 ${
                phraseOk && phrase.length > 0
                  ? "border-emerald-300 focus:border-emerald-400 focus:ring-emerald-300/20"
                  : "border-[#ffd2cd] focus:border-[#a13a32] focus:ring-[#a13a32]/15"
              }`}
            />
            {phrase.length > 0 && !phraseOk ? (
              <div className="mt-1 text-[11px] text-[#a13a32]">
                Не совпало — введите точно так, как написано выше.
              </div>
            ) : null}
          </div>
        ) : null}

        </div>

        {/* Buttons */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#f0f1f7] px-6 pb-6 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-11 items-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#3c4053] transition-colors hover:border-[#5566f6]/40 hover:bg-[#fafbff] disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={`inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-[14px] font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles.confirmBg} ${styles.confirmHover} ${styles.confirmRing}`}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
