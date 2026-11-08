"use client";

import { useRef, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { TEXT_SIZES, type TextSize } from "@/lib/view-prefs";
import { useViewPrefs } from "./view-prefs-provider";

/**
 * «Размер текста» — три кнопки «A» растущей величины: «Обычный», «Крупный»,
 * «Очень крупный». Нажал — весь интерфейс сразу крупнее (атрибут на <html>,
 * кегли из CSS умножаются, см. `postcss-plugins/text-scale.cjs`).
 *
 * Живёт в меню профиля (компьютер — `TextSizeMenu`, пункты Radix; телефон —
 * `TextSizeGroup` в листе профиля), в «Настройки → Оформление» и в профиле
 * мини-приложения — чтобы человеку, который плохо видит, не искать настройку.
 *
 * Буква «A» задана стилем элемента, а не классом: её размер не растёт вместе
 * с выбором — три кнопки всегда показывают разницу.
 */

/** Размер буквы «A» на кнопке, px — по возрастанию. */
const GLYPH_PX: Record<TextSize, number> = { normal: 14, large: 18, xlarge: 23 };

export type TextSizeGroupSize = "compact" | "comfortable" | "touch";

/** Следующий размер по стрелке (как у родных radio): по кругу. */
export function textSizeForKey(current: TextSize, key: string): TextSize | null {
  const index = TEXT_SIZES.indexOf(current);
  if (key === "ArrowRight" || key === "ArrowDown") return TEXT_SIZES[(index + 1) % TEXT_SIZES.length];
  if (key === "ArrowLeft" || key === "ArrowUp") return TEXT_SIZES[(index - 1 + TEXT_SIZES.length) % TEXT_SIZES.length];
  if (key === "Home") return TEXT_SIZES[0];
  if (key === "End") return TEXT_SIZES[TEXT_SIZES.length - 1];
  return null;
}

function TextSizeFace({ size, checked, withLabel }: { size: TextSize; checked: boolean; withLabel: boolean }) {
  const t = useTranslations("common.viewPrefs");
  return (
    <span
      className={cn(
        "flex w-full flex-col items-center justify-center gap-1 rounded-2xl border px-2 transition-colors duration-150",
        withLabel ? "min-h-[72px] py-2.5" : "h-11",
        checked
          ? "border-[var(--app-indigo,#5566f6)] bg-[var(--app-tint-indigo,#eef1ff)] text-[var(--app-indigo-deep,#3848c7)]"
          : "border-[var(--app-border-strong,#dcdfed)] bg-[var(--app-surface,#ffffff)] text-[var(--app-text,#0b1024)] group-hover/size:border-[var(--app-indigo,#5566f6)]",
      )}
    >
      <span aria-hidden className="font-semibold leading-none" style={{ fontSize: GLYPH_PX[size] }}>
        A
      </span>
      {withLabel ? (
        <span className="text-center text-[12px] font-medium leading-tight">{t(`sizes.${size}`)}</span>
      ) : null}
    </span>
  );
}

/**
 * Обычная группа переключателей: лист профиля на телефоне, страница
 * настроек, профиль мини-приложения. Tab заходит на выбранную кнопку,
 * стрелки выбирают соседнюю.
 */
export function TextSizeGroup({
  size = "comfortable",
  className,
  buttonClassName,
}: {
  size?: TextSizeGroupSize;
  className?: string;
  /** Дополнительные классы кнопки (мини-приложение — отклик нажатия). */
  buttonClassName?: string;
}) {
  const t = useTranslations("common.viewPrefs");
  const { prefs, update } = useViewPrefs();
  const buttons = useRef<Partial<Record<TextSize, HTMLButtonElement | null>>>({});

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: TextSize) {
    const next = textSizeForKey(current, event.key);
    if (!next) return;
    event.preventDefault();
    update({ textSize: next });
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("textSize")}
      data-testid="text-size-picker"
      className={cn("no-mobile-shrink grid grid-cols-3", size === "compact" ? "gap-1.5" : "gap-2", className)}
    >
      {TEXT_SIZES.map((option) => {
        const checked = prefs.textSize === option;
        return (
          <button
            key={option}
            ref={(el) => {
              buttons.current[option] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={t(`sizes.${option}`)}
            title={t(`sizes.${option}`)}
            tabIndex={checked ? 0 : -1}
            data-state={checked ? "checked" : "unchecked"}
            data-text-size-option={option}
            onClick={() => update({ textSize: option })}
            onKeyDown={(event) => onKeyDown(event, option)}
            className={cn("group/size flex min-w-0 cursor-pointer rounded-2xl outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25", buttonClassName)}
          >
            <TextSizeFace size={option} checked={checked} withLabel={size !== "compact"} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Те же кнопки внутри выпадающего меню Radix: пункты `RadioItem`, стрелки
 * вверх-вниз доходят до них, как до остальных пунктов, влево-вправо — по
 * ряду. Меню после выбора не закрывается: видно, как вырос текст.
 */
export function TextSizeMenu({ className }: { className?: string }) {
  const t = useTranslations("common.viewPrefs");
  const { prefs, update } = useViewPrefs();

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, current: TextSize) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const next = textSizeForKey(current, event.key);
    const target = event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-text-size-option="${next}"]`);
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  return (
    <DropdownMenuPrimitive.RadioGroup
      value={prefs.textSize}
      onValueChange={(value) => {
        if ((TEXT_SIZES as readonly string[]).includes(value)) update({ textSize: value as TextSize });
      }}
      aria-label={t("textSize")}
      data-testid="text-size-picker"
      className={cn("grid grid-cols-3 gap-1", className)}
    >
      {TEXT_SIZES.map((option) => (
        <DropdownMenuPrimitive.RadioItem
          key={option}
          value={option}
          textValue={t(`sizes.${option}`)}
          aria-label={t(`sizes.${option}`)}
          title={t(`sizes.${option}`)}
          data-text-size-option={option}
          onSelect={(event) => event.preventDefault()}
          onKeyDown={(event) => onKeyDown(event, option)}
          className="group/size flex min-w-0 cursor-pointer select-none rounded-2xl p-0.5 outline-none data-[highlighted]:bg-[var(--app-tint-indigo)]"
        >
          <TextSizeFace size={option} checked={prefs.textSize === option} withLabel={false} />
        </DropdownMenuPrimitive.RadioItem>
      ))}
    </DropdownMenuPrimitive.RadioGroup>
  );
}
