"use client";

import { JOURNAL_RATING_MAX_DEFAULT, type JournalCustomColumn } from "@/lib/journal-columns";

/**
 * Ячейка своей колонки организации — одна на все журналы с настройкой
 * колонок. Значение всегда строка: так его одинаково читают таблица,
 * карточка на телефоне и печать, и не приходится плодить типы в конфиге
 * документа.
 *
 * Пустая ячейка колонки, отмеченной «обязательно заполнять», подсвечивается
 * янтарным — это подсказка, а не запрет: журнал заполняют по ходу смены, и
 * блокировать ввод на полпути нельзя.
 */
export function JournalCustomCell({
  column,
  value,
  onChange,
  onBlur,
  disabled,
  mustFill,
  employees,
  className = "",
}: {
  column: JournalCustomColumn;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  mustFill?: boolean;
  /** Сотрудники организации для типа «Сотрудник». */
  employees?: string[];
  className?: string;
}) {
  const empty = value.trim() === "";
  const warn = Boolean(mustFill) && empty && !disabled;
  const base = `h-8 w-full border-0 bg-transparent px-1.5 text-[12.5px] text-[#0b1024] focus:outline-none focus:ring-2 focus:ring-[#5566f6]/20 ${
    warn ? "bg-[#fff8eb]" : ""
  } ${className}`;

  if (column.type === "boolean") {
    return (
      <div className={`flex items-center justify-center gap-1 py-0.5 ${warn ? "bg-[#fff8eb]" : ""}`}>
        {(["Да", "Нет"] as const).map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange(value === option ? "" : option);
              onBlur?.();
            }}
            className={`rounded-lg px-2 py-1 text-[12px] leading-none transition-colors duration-150 disabled:opacity-60 ${
              value === option
                ? option === "Да"
                  ? "bg-[#e9f7ee] font-semibold text-[#1f8a45]"
                  : "bg-[#fff2f1] font-semibold text-[#d43a2f]"
                : "text-[#9b9fb3] hover:bg-[#f5f6ff]"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    );
  }

  if (column.type === "rating") {
    const max = column.ratingMax ?? JOURNAL_RATING_MAX_DEFAULT;
    return (
      <div className={`flex flex-wrap items-center justify-center gap-0.5 py-0.5 ${warn ? "bg-[#fff8eb]" : ""}`}>
        {Array.from({ length: max }, (_, index) => String(index + 1)).map((score) => (
          <button
            key={score}
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange(value === score ? "" : score);
              onBlur?.();
            }}
            className={`size-6 rounded-md text-[12px] leading-none transition-colors duration-150 disabled:opacity-60 ${
              value === score
                ? "bg-[#5566f6] font-semibold text-white"
                : "text-[#9b9fb3] hover:bg-[#f5f6ff]"
            }`}
            aria-label={`Оценка ${score} из ${max}`}
          >
            {score}
          </button>
        ))}
      </div>
    );
  }

  if (column.type === "select" || column.type === "employee") {
    const options = column.type === "employee" ? (employees ?? []) : (column.options ?? []);
    const listId = `journal-custom-${column.key.replace(/[^a-z0-9]/gi, "")}`;
    return (
      <>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          list={listId}
          className={base}
          placeholder={options.length > 0 ? "Выберите или впишите" : ""}
        />
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </>
    );
  }

  if (column.type === "number") {
    return (
      <div className={`flex items-center gap-1 ${warn ? "bg-[#fff8eb]" : ""}`}>
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          className={base}
        />
        {column.unit ? <span className="pr-1 text-[11px] text-[#9b9fb3]">{column.unit}</span> : null}
      </div>
    );
  }

  return (
    <input
      type={column.type === "date" ? "date" : column.type === "time" ? "time" : "text"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      disabled={disabled}
      className={base}
    />
  );
}

/** Значение своей колонки строки — пустая строка, если её ещё не заполняли. */
export function customCellValue(row: { custom?: Record<string, string> }, key: string): string {
  return row.custom?.[key] ?? "";
}

/** Новая карта значений своих колонок для `updateRow`. */
export function withCustomCell(
  row: { custom?: Record<string, string> },
  key: string,
  value: string
): Record<string, string> {
  const next = { ...(row.custom ?? {}) };
  if (value.trim()) next[key] = value;
  else delete next[key];
  return next;
}
