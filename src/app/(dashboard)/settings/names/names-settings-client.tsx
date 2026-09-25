"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Save, Search, X } from "lucide-react";
import { toast } from "sonner";

import {
  CUSTOM_NAME_MAX_LENGTH,
  checkCustomNamesInput,
  diffCustomNames,
  type CustomNameFieldError,
  type CustomNames,
} from "@/lib/custom-names";
import { journalMatchesQuery, normalizeJournalSearch } from "@/lib/journal-search";
import { pluralRu } from "@/lib/plural-ru";
import { cn } from "@/lib/utils";

type SectionItem = { key: string; label: string };
type JournalItem = { code: string; name: string; disabled: boolean };

type Values = Record<string, string>;

const INPUT_CLASS =
  "h-11 w-full rounded-2xl border bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-[border-color,box-shadow] duration-150 focus:outline-none focus:ring-4";

/**
 * Страница «Названия»: два списка (разделы меню и журналы) и одна кнопка
 * «Сохранить» внизу. У строки — стандартное название серым, поле своего
 * названия и «Вернуть стандартное». Пустое поле — стандартное.
 *
 * Проверка та же, что на сервере (`checkCustomNamesInput`): поле с
 * ошибкой подсвечивается сразу, а не после отказа сервера.
 */
export function NamesSettingsClient({
  sections,
  journals,
  initialNames,
}: {
  sections: SectionItem[];
  journals: JournalItem[];
  initialNames: CustomNames;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<CustomNames>(initialNames);
  const [sectionValues, setSectionValues] = useState<Values>(() =>
    valuesFrom(sections.map((s) => s.key), initialNames.sections)
  );
  const [journalValues, setJournalValues] = useState<Values>(() =>
    valuesFrom(journals.map((j) => j.code), initialNames.journals)
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const officialNames = useMemo(
    () => Object.fromEntries(journals.map((journal) => [journal.code, journal.name])),
    [journals]
  );

  // Что сохранится и какие поля с ошибкой — те же правила, что у сервера.
  const check = useMemo(
    () => checkCustomNamesInput({ journals: journalValues, sections: sectionValues }, officialNames),
    [journalValues, sectionValues, officialNames]
  );
  const errorByField = useMemo(() => {
    const map = new Map<string, string>();
    for (const error of check.errors) map.set(fieldKey(error), error.message);
    return map;
  }, [check.errors]);
  const changes = useMemo(
    () => diffCustomNames(saved, check.names, officialNames),
    [saved, check.names, officialNames]
  );
  const changedFields = useMemo(
    () => new Set(changes.map((change) => `${change.kind}:${change.key}`)),
    [changes]
  );
  const dirty = changes.length > 0;
  const customJournalsCount = Object.keys(check.names.journals).length;

  // Несохранённые правки не должны молча пропасть при закрытии вкладки.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const normalizedQuery = normalizeJournalSearch(query);
  const visibleJournals = useMemo(
    () =>
      normalizedQuery
        ? journals.filter((journal) =>
            journalMatchesQuery([journalValues[journal.code], journal.name, journal.code], normalizedQuery)
          )
        : journals,
    [journals, journalValues, normalizedQuery]
  );

  function resetAll() {
    setSectionValues(valuesFrom(sections.map((s) => s.key), saved.sections));
    setJournalValues(valuesFrom(journals.map((j) => j.code), saved.journals));
  }

  async function save() {
    if (check.errors.length > 0) {
      toast.error("Проверьте поля, отмеченные красным");
      const first = check.errors[0];
      const focusFirst = () => document.getElementById(inputId(first.kind, first.key))?.focus();
      if (document.getElementById(inputId(first.kind, first.key))) {
        focusFirst();
      } else {
        // Поле скрыто поиском — сбрасываем поиск и ставим фокус после отрисовки.
        setQuery("");
        window.requestAnimationFrame(focusFirst);
      }
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/custom-names", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Полный набор: пустое поле — стандартное название.
        body: JSON.stringify({ sections: sectionValues, journals: journalValues }),
      });
      const data = (await res.json().catch(() => null)) as
        | { names?: CustomNames; changed?: number; error?: string; errors?: CustomNameFieldError[] }
        | null;
      if (!res.ok || !data?.names) {
        throw new Error(data?.error || "Не удалось сохранить названия");
      }
      setSaved(data.names);
      setSectionValues(valuesFrom(sections.map((s) => s.key), data.names.sections));
      setJournalValues(valuesFrom(journals.map((j) => j.code), data.names.journals));
      const changed = data.changed ?? 0;
      toast.success(
        changed > 0
          ? `Сохранено: ${changed} ${pluralRu(changed, "название", "названия", "названий")}. Меню и журналы уже с новыми названиями`
          : "Изменений не было"
      );
      // Меню, крошки и карточки берут названия из layout'а — обновляем его.
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить названия");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <header className="border-b border-[#ececf4] px-4 py-4 sm:px-6">
          <h2 className="text-[16px] font-semibold text-[#0b1024]">Разделы меню</h2>
          <p className="mt-0.5 text-[13px] text-[#6f7282]">
            Пункты меню кабинета и мини-приложения. «Настройки» и «Выход» не переименовываются.
          </p>
        </header>
        <ul className="divide-y divide-[#ececf4]">
          {sections.map((section) => (
            <NameRow
              key={section.key}
              id={inputId("section", section.key)}
              standard={section.label}
              value={sectionValues[section.key] ?? ""}
              error={errorByField.get(`section:${section.key}`) ?? null}
              changed={changedFields.has(`section:${section.key}`)}
              onChange={(next) => setSectionValues((prev) => ({ ...prev, [section.key]: next }))}
            />
          ))}
        </ul>
      </section>

      <section className="overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <header className="space-y-3 border-b border-[#ececf4] px-4 py-4 sm:px-6">
          <div>
            <h2 className="text-[16px] font-semibold text-[#0b1024]">Журналы</h2>
            <p className="mt-0.5 text-[13px] text-[#6f7282]">
              Серым — официальное название: оно остаётся в печати, у проверяющего и в отчётах.
              {customJournalsCount > 0
                ? ` Своё название у ${customJournalsCount} из ${journals.length}.`
                : null}
            </p>
          </div>
          <div className="relative sm:max-w-[420px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти журнал — по своему или официальному названию"
              aria-label="Найти журнал"
              className={cn(
                INPUT_CLASS,
                "pl-11 pr-11 text-[14px] border-[#dcdfed] focus:border-[#5566f6] focus:ring-[#5566f6]/15"
              )}
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Очистить поиск"
                className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[#9b9fb3] transition-colors hover:bg-[#f5f6ff] hover:text-[#5566f6]"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        </header>
        {visibleJournals.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="text-[15px] font-medium text-[#0b1024]">Ничего не нашли</div>
            <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] text-[#6f7282]">
              Поиск идёт и по своему, и по официальному названию журнала.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#ececf4]">
            {visibleJournals.map((journal) => (
              <NameRow
                key={journal.code}
                id={inputId("journal", journal.code)}
                standard={journal.name}
                muted={journal.disabled}
                value={journalValues[journal.code] ?? ""}
                error={errorByField.get(`journal:${journal.code}`) ?? null}
                changed={changedFields.has(`journal:${journal.code}`)}
                onChange={(next) => setJournalValues((prev) => ({ ...prev, [journal.code]: next }))}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Одна кнопка на всё. Липкая — список журналов длинный. Справа
          запас под плавающие кнопки помощи (FabDock в углу экрана),
          иначе они ложились поверх «Сохранить». */}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-3xl border border-[#ececf4] bg-white/95 py-3 pl-4 pr-16 shadow-[0_12px_32px_-16px_rgba(11,16,36,0.18)] backdrop-blur sm:pl-5 md:pr-[104px]">
        <div className="min-w-0 flex-1 text-[13px] text-[#3c4053]">
          {check.errors.length > 0 ? (
            <span className="text-[#a13a32]">
              Исправьте {check.errors.length}{" "}
              {pluralRu(check.errors.length, "поле", "поля", "полей")}, чтобы сохранить
            </span>
          ) : dirty ? (
            <span className="tabular-nums">
              Изменено: {changes.length} {pluralRu(changes.length, "название", "названия", "названий")}
            </span>
          ) : (
            "Изменений нет"
          )}
        </div>
        {dirty ? (
          <button
            type="button"
            onClick={resetAll}
            disabled={saving}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60 sm:flex-none"
          >
            Отменить
          </button>
        ) : null}
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:bg-[#c8cbe0] disabled:shadow-none sm:flex-none"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Сохранить
        </button>
      </div>
    </div>
  );
}

/**
 * Строка списка: слева стандартное название серым, справа поле своего.
 * На телефоне — друг под другом. «Вернуть стандартное» появляется, когда
 * в поле что-то есть, и просто очищает его — сохраняет общая кнопка.
 */
function NameRow({
  id,
  standard,
  value,
  error,
  changed,
  muted = false,
  onChange,
}: {
  id: string;
  standard: string;
  value: string;
  error: string | null;
  changed: boolean;
  muted?: boolean;
  onChange: (next: string) => void;
}) {
  const hintId = `${id}-hint`;
  // Строка подсказки — только когда есть что сказать: пустые строки
  // списка из сорока пяти журналов должны оставаться короткими.
  const showHint = Boolean(error || value);
  return (
    <li
      className={cn(
        "grid gap-2 px-4 py-3 transition-colors duration-150 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start sm:gap-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]",
        changed && !error && "bg-[#f5f6ff]/70",
        error && "bg-[#fff4f2]/60"
      )}
    >
      <div className="min-w-0 sm:pt-2.5">
        <label htmlFor={id} className="block text-[14px] leading-snug text-[#6f7282]">
          {standard}
        </label>
        {muted ? (
          <span className="mt-1 inline-flex rounded-full bg-[#eef0f6] px-2 py-0.5 text-[11px] font-medium text-[#6f7282]">
            выключен в наборе
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <input
          id={id}
          type="text"
          value={value}
          maxLength={CUSTOM_NAME_MAX_LENGTH}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Своё название — пусто = стандартное"
          aria-invalid={error ? true : undefined}
          aria-describedby={showHint ? hintId : undefined}
          className={cn(
            INPUT_CLASS,
            error
              ? "border-[#e8a39b] focus:border-[#d2453d] focus:ring-[#d2453d]/15"
              : "border-[#dcdfed] focus:border-[#5566f6] focus:ring-[#5566f6]/15"
          )}
        />
        {showHint ? (
          <div id={hintId} className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className={cn("text-[12px]", error ? "text-[#a13a32]" : "text-[#9b9fb3]")}>
              {error ?? (value.trim() ? "Так увидят сотрудники" : "")}
            </span>
            {value ? (
              <button
                type="button"
                onClick={() => onChange("")}
                className="inline-flex items-center gap-1 rounded-lg px-1 text-[12px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                <RotateCcw className="size-3.5" />
                Вернуть стандартное
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function valuesFrom(keys: string[], names: Record<string, string>): Values {
  return Object.fromEntries(keys.map((key) => [key, names[key] ?? ""]));
}

function inputId(kind: "section" | "journal", key: string): string {
  return `custom-name-${kind}-${key}`;
}

function fieldKey(error: CustomNameFieldError): string {
  return `${error.kind}:${error.key}`;
}
