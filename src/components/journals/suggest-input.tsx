"use client";

import { useTranslations } from "next-intl";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Поле со списком вариантов для окон журналов (ФИО, наименования).
 *
 * Системный `<input list>` фильтрует варианты по уже вписанному тексту: в
 * поле стоит ФИО ответственного — и в выпадающем списке виден только он,
 * выбрать другого нельзя. Здесь список свой:
 *   • при фокусе и по стрелке показываются ВСЕ варианты;
 *   • при наборе текста — подходящие по вхождению;
 *   • свой текст вводить можно (подрядчик, которого нет в сотрудниках).
 *
 * Список стоит в потоке, а не поверх: поле живёт внутри прокручиваемого
 * окна, и абсолютный список у нижнего края обрезался бы.
 */
export function SuggestInput({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}) {
  const t = useTranslations("journalControls.suggestInput");
  const optionsId = useId();
  const [open, setOpen] = useState(false);
  // Пока человек не начал печатать, показываем весь список, даже если в поле уже есть текст.
  const [typed, setTyped] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const listRef = useRef<HTMLUListElement | null>(null);

  const query = value.trim().toLowerCase();
  const exact = options.some((option) => option.toLowerCase() === query);
  const visible =
    !typed || !query || exact ? options : options.filter((option) => option.toLowerCase().includes(query));

  useEffect(() => {
    if (open) listRef.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const pick = (option: string) => {
    onChange(option);
    setOpen(false);
    setTyped(false);
    setHighlight(-1);
  };

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={open ? optionsId : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={(event) => {
            onChange(event.target.value);
            setTyped(true);
            setOpen(true);
            setHighlight(-1);
          }}
          onFocus={() => {
            setTyped(false);
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setHighlight(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
              event.stopPropagation();
              setOpen(false);
              return;
            }
            if (!open || visible.length === 0) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlight((index) => (index + 1) % visible.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((index) => (index <= 0 ? visible.length - 1 : index - 1));
            } else if (event.key === "Enter" && highlight >= 0) {
              event.preventDefault();
              pick(visible[highlight]);
            }
          }}
          className={cn(
            "h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 pr-10 text-[13.5px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15",
            className
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? t("collapse") : t("showAll")}
          // mousedown с preventDefault — поле не теряет фокус при клике по стрелке.
          onMouseDown={(event) => {
            event.preventDefault();
            setTyped(false);
            setOpen((current) => !current);
          }}
          className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#5566f6]"
        >
          <ChevronDown className={cn("size-4 transition-transform duration-150", open && "rotate-180")} />
        </button>
      </div>
      {open && visible.length > 0 ? (
        <ul
          ref={listRef}
          role="listbox"
          id={optionsId}
          aria-label={t("options", { label: ariaLabel })}
          className="max-h-48 overflow-auto rounded-2xl border border-[#ececf4] bg-white p-1.5 shadow-[0_16px_40px_-24px_rgba(11,16,36,0.35)]"
        >
          {visible.map((option, index) => (
            <li
              key={option}
              role="option"
              aria-selected={option === value}
              // mousedown только удерживает фокус поля; выбор — по click. Иначе список
              // исчезал между нажатием и отпусканием, окно сжималось, и отпускание
              // приходилось на кнопку под курсором.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(option)}
              className={cn(
                "cursor-pointer rounded-xl px-3 py-2 text-[13.5px] leading-snug text-[#0b1024] transition-colors duration-150 hover:bg-[#f5f6ff]",
                (index === highlight || option === value) && "bg-[#eef1ff] font-medium text-[#3848c7]"
              )}
            >
              {option}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
