"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Download,
  Droplets,
  FileText,
  HeartPulse,
  Sparkles,
  ThermometerSnowflake,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { HeroEmailStart } from "@/components/landing/hero-email-start";
import { BlankDownloadButton } from "@/components/public/blank-download";
import { JOURNALS_TOTAL_LABEL } from "@/lib/journal-catalog";

/**
 * Интерактивное демо: посетитель «трогает» форму журнала без
 * регистрации.
 *
 * Раньше здесь был один журнал — контроль температуры холодильника.
 * По нему нельзя было понять, что журналы разные: у гигиены отметки, у
 * уборки помещения, у бракеража органолептика. Теперь пять вкладок с
 * настоящими полями каждого журнала, и под формой — ссылки на
 * заполненный образец именно этого бланка.
 *
 * Бэкенда нет: введённое никуда не уходит. Цель — снять страх
 * «слишком сложно» до регистрации.
 */

type DemoField =
  | {
      kind: "text";
      key: string;
      label: string;
      placeholder: string;
    }
  | {
      kind: "number";
      key: string;
      label: string;
      placeholder: string;
      unit: string;
      /// Физически допустимый ввод — за ним форма не даст сохранить.
      min: number;
      max: number;
      /// Норма по СанПиН. Выход за неё не блокирует запись: в реальном
      /// журнале отклонение фиксируют, а не прячут.
      okMin: number;
      okMax: number;
    }
  | {
      kind: "select";
      key: string;
      label: string;
      options: { value: string; label: string; warn?: boolean }[];
    };

type DemoJournal = {
  /// Код журнала — по нему собираются ссылки на образцы.
  code: string;
  tab: string;
  icon: LucideIcon;
  title: string;
  hint: string;
  fields: DemoField[];
  /// Есть ли DOCX-версия образца (см. DOCX_SAMPLE_CODES).
  docx: boolean;
};

const DEMO_JOURNALS: DemoJournal[] = [
  {
    code: "cold_equipment_control",
    tab: "Холодильник",
    icon: ThermometerSnowflake,
    title: "Контроль температуры холодильного оборудования",
    hint: "Ежедневно, перед началом смены. Норма для холодильника — от 0 до +6 °C.",
    docx: true,
    fields: [
      {
        kind: "text",
        key: "employee",
        label: "Кто проверил",
        placeholder: "Петров Сергей Иванович",
      },
      {
        kind: "number",
        key: "temp",
        label: "Температура",
        placeholder: "4",
        unit: "°C",
        min: -30,
        max: 30,
        okMin: 0,
        okMax: 6,
      },
    ],
  },
  {
    code: "hygiene",
    tab: "Гигиена",
    icon: Sparkles,
    title: "Гигиенический журнал",
    hint: "Осмотр перед сменой: состояние кожи рук, признаки ОРВИ, температура.",
    docx: true,
    fields: [
      {
        kind: "text",
        key: "employee",
        label: "Сотрудник",
        placeholder: "Сидорова Анна Викторовна",
      },
      {
        kind: "select",
        key: "status",
        label: "Результат осмотра",
        options: [
          { value: "healthy", label: "Здоров, допущен к работе" },
          { value: "suspended", label: "Отстранён от работы", warn: true },
        ],
      },
      {
        kind: "select",
        key: "fever",
        label: "Температура выше 37 °C",
        options: [
          { value: "no", label: "Нет" },
          { value: "yes", label: "Да", warn: true },
        ],
      },
    ],
  },
  {
    code: "cleaning",
    tab: "Уборка",
    icon: Droplets,
    title: "Журнал уборки",
    hint: "Текущая уборка — ежесменно, генеральная — по графику.",
    docx: true,
    fields: [
      {
        kind: "select",
        key: "room",
        label: "Помещение",
        options: [
          { value: "hot", label: "Горячий цех" },
          { value: "cold", label: "Холодный цех" },
          { value: "wash", label: "Моечная" },
        ],
      },
      {
        kind: "select",
        key: "type",
        label: "Вид уборки",
        options: [
          { value: "current", label: "Текущая (Т)" },
          { value: "general", label: "Генеральная (Г)" },
        ],
      },
      {
        kind: "text",
        key: "employee",
        label: "Кто убирал",
        placeholder: "Морозова Елена Андреевна",
      },
    ],
  },
  {
    code: "health_check",
    tab: "Здоровье",
    icon: HeartPulse,
    title: "Журнал здоровья",
    hint: "Ежедневная отметка о состоянии здоровья и подпись сотрудника.",
    docx: true,
    fields: [
      {
        kind: "text",
        key: "employee",
        label: "Сотрудник",
        placeholder: "Кузнецов Дмитрий Олегович",
      },
      {
        kind: "select",
        key: "signed",
        label: "Отметка",
        options: [
          { value: "yes", label: "Подписал, жалоб нет" },
          { value: "no", label: "Есть жалобы", warn: true },
        ],
      },
    ],
  },
  {
    code: "finished_product",
    tab: "Бракераж",
    icon: UtensilsCrossed,
    title: "Бракераж готовой продукции",
    hint: "Каждая партия перед выдачей: оценка и решение о реализации.",
    docx: true,
    fields: [
      {
        kind: "text",
        key: "dish",
        label: "Блюдо",
        placeholder: "Суп-пюре грибной",
      },
      {
        kind: "select",
        key: "grade",
        label: "Органолептическая оценка",
        options: [
          { value: "good", label: "Соответствует" },
          { value: "bad", label: "Не соответствует", warn: true },
        ],
      },
      {
        kind: "select",
        key: "decision",
        label: "Решение",
        options: [
          { value: "allow", label: "Разрешено к реализации" },
          { value: "deny", label: "Снято с реализации", warn: true },
        ],
      },
    ],
  },
];

export function DemoJournalWidget() {
  const [activeCode, setActiveCode] = useState(DEMO_JOURNALS[0].code);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const journal =
    DEMO_JOURNALS.find((j) => j.code === activeCode) ?? DEMO_JOURNALS[0];

  function setField(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function switchTab(code: string) {
    // Значения не переносим между журналами: поля у них разные, и
    // «Петров» из холодильника в бракераже смотрелся бы как баг.
    setActiveCode(code);
    setValues({});
    setSaved(false);
  }

  const fieldErrors = journal.fields.map((field) => {
    const raw = (values[field.key] ?? "").trim();
    if (!raw) return "Заполните поле";
    if (field.kind === "text" && raw.length < 2) return "Слишком коротко";
    if (field.kind === "number") {
      const num = Number(raw.replace(",", "."));
      if (Number.isNaN(num)) return "Введите число";
      if (num < field.min || num > field.max)
        return `Допустимо от ${field.min} до ${field.max}`;
    }
    return null;
  });
  const formValid = fieldErrors.every((e) => e === null);

  /** Отклонение от нормы — предупреждение, а не запрет сохранения. */
  const warnings = journal.fields.flatMap((field, i) => {
    if (fieldErrors[i]) return [];
    const raw = (values[field.key] ?? "").trim();
    if (field.kind === "number") {
      const num = Number(raw.replace(",", "."));
      if (num < field.okMin || num > field.okMax) {
        return [
          `${field.label}: ${raw} ${field.unit} — вне нормы ${field.okMin}…${field.okMax} ${field.unit}`,
        ];
      }
    }
    if (field.kind === "select") {
      const opt = field.options.find((o) => o.value === raw);
      if (opt?.warn) return [`${field.label}: ${opt.label}`];
    }
    return [];
  });

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-7">
      {/* Вкладки журналов */}
      <div className="-mx-1 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {DEMO_JOURNALS.map((j) => {
          const Icon = j.icon;
          const active = j.code === journal.code;
          return (
            <button
              key={j.code}
              type="button"
              onClick={() => switchTab(j.code)}
              aria-pressed={active}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors ${
                active
                  ? "border-[#5566f6] bg-[#5566f6] text-white"
                  : "border-[#ececf4] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              }`}
            >
              <Icon className="size-3.5" />
              {j.tab}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        <div className="text-[16px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]">
          {journal.title}
        </div>
        <p className="mt-1.5 text-[13px] leading-[1.55] text-[#6f7282]">
          {journal.hint}
        </p>
      </div>

      <form
        className="mt-5 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (formValid) setSaved(true);
        }}
      >
        {/* Поля демо — 16px: это первое, что посетитель трогает
            пальцем, а iOS Safari при фокусе в поле со шрифтом меньше
            16px зумит страницу и масштаб назад не возвращает. */}
        {journal.fields.map((field) => (
          <label key={field.key} className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
              {field.label}
            </span>
            {field.kind === "select" ? (
              <select
                value={values[field.key] ?? ""}
                onChange={(e) => {
                  setField(field.key, e.target.value);
                  setSaved(false);
                }}
                className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[16px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              >
                <option value="">Выберите…</option>
                {field.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="relative block">
                <input
                  value={values[field.key] ?? ""}
                  onChange={(e) => {
                    setField(field.key, e.target.value);
                    setSaved(false);
                  }}
                  inputMode={field.kind === "number" ? "decimal" : "text"}
                  placeholder={field.placeholder}
                  className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                />
                {field.kind === "number" ? (
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-[#9b9fb3]">
                    {field.unit}
                  </span>
                ) : null}
              </span>
            )}
          </label>
        ))}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={!formValid}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:bg-[#c9cef7] disabled:shadow-none sm:w-auto"
          >
            Сохранить запись
          </button>
        </div>
      </form>

      {saved ? (
        <div className="mt-5 rounded-2xl border border-[#5566f6]/25 bg-gradient-to-br from-[#f5f6ff] to-white p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-[#0b1024]">
                Запись сохранена
              </div>
              <p className="mt-1 text-[13px] leading-[1.55] text-[#6f7282]">
                В настоящем WeSetup она попадёт в журнал с датой, автором
                и историей правок — и уйдёт в PDF для проверки.
              </p>
              {warnings.length > 0 ? (
                <ul className="mt-3 space-y-1 text-[13px] text-[#a13a32]">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                  <li className="text-[12px] text-[#6f7282]">
                    Отклонение не блокирует запись: журнал его фиксирует —
                    так и требует СанПиН.
                  </li>
                </ul>
              ) : null}
            </div>
          </div>
          {/* Пик интереса: человек только что заполнил журнал — здесь и
              предлагаем завести свой. Та же форма в одно поле, что и в
              hero, со своим местом для целей Метрики. */}
          <div className="mt-4 border-t border-[#5566f6]/15 pt-4">
            <HeroEmailStart
              layout="stack"
              place="demo"
              buttonLabel="Продолжить в своём журнале"
              showLoginLink={false}
            />
          </div>
        </div>
      ) : null}

      {/* Образцы именно этого журнала */}
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[#f2f3f9] pt-5">
        <span className="text-[13px] text-[#6f7282]">
          Скачать заполненный образец:
        </span>
        <BlankDownloadButton
          target={{ kind: "code", code: journal.code }}
          format="pdf"
          title={journal.title}
          place="landing-demo"
          className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          <FileText className="size-4 text-[#5566f6]" />
          PDF
        </BlankDownloadButton>
        {journal.docx ? (
          <BlankDownloadButton
            target={{ kind: "code", code: journal.code }}
            format="docx"
            title={journal.title}
            place="landing-demo"
            className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            <Download className="size-4 text-[#5566f6]" />
            DOCX
          </BlankDownloadButton>
        ) : null}
        <Link
          href="/journals-info"
          className="ml-auto text-[13px] font-medium text-[#3848c7] underline-offset-4 hover:underline"
        >
          Все {JOURNALS_TOTAL_LABEL} →
        </Link>
      </div>
    </div>
  );
}
