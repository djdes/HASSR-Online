"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { Check, ChevronDown, Download, FileText, Search } from "lucide-react";
import { BlankDownloadButton } from "@/components/public/blank-download";

/**
 * Галерея образцов: выбираешь любой из наших журналов — видишь его
 * бланк и скачиваешь готовый файл.
 *
 * Выбор сделан открывашкой с поиском, а не рядом кнопок: журналов 35,
 * в ряд они не помещаются, а листать горизонтальную ленту в поисках
 * «Журнала учёта дезинфицирующих средств» — мучение.
 *
 * Картинки лежат в public/journal-samples и пересобираются скриптом
 * scripts/render-journal-sample-thumbs.ts после правки печатных форм.
 */
export type SampleGalleryItem = {
  code: string;
  name: string;
  /// Есть ли DOCX-версия — совпадает с DOCX_SAMPLE_CODES.
  docx: boolean;
};

export function SampleGallery({ items }: { items: SampleGalleryItem[] }) {
  const [activeCode, setActiveCode] = useState(items[0]?.code ?? "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const active = items.find((s) => s.code === activeCode) ?? items[0];

  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
    );
  }, [items, query]);

  // Клик мимо и Esc закрывают список — иначе он висит поверх страницы
  // и перехватывает прокрутку.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!active) return null;

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-7">
      <div ref={boxRef} className="relative max-w-[520px]">
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setQuery("");
          }}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="flex h-12 w-full items-center gap-3 rounded-2xl border border-[#dcdfed] bg-white px-4 text-left text-[15px] text-[#0b1024] transition-colors hover:border-[#5566f6]/40 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        >
          <FileText className="size-4 shrink-0 text-[#5566f6]" />
          <span className="min-w-0 flex-1 truncate">{active.name}</span>
          <span className="shrink-0 text-[13px] text-[#9b9fb3]">
            {items.length} журналов
          </span>
          <ChevronDown
            className={`size-4 shrink-0 text-[#6f7282] transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>

        {open ? (
          <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-2xl border border-[#dcdfed] bg-white shadow-[0_24px_60px_-24px_rgba(11,16,36,0.35)]">
            <label className="relative block border-b border-[#eef0f6]">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Найти журнал"
                className="h-12 w-full bg-white pl-11 pr-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:outline-none"
              />
            </label>
            <ul role="listbox" className="max-h-[320px] overflow-y-auto py-1">
              {found.length === 0 ? (
                <li className="px-4 py-6 text-center text-[14px] text-[#6f7282]">
                  Ничего не нашлось
                </li>
              ) : null}
              {found.map((s) => {
                const on = s.code === active.code;
                return (
                  <li key={s.code}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => {
                        setActiveCode(s.code);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[14px] transition-colors hover:bg-[#f5f6ff] ${
                        on ? "text-[#3848c7]" : "text-[#3c4053]"
                      }`}
                    >
                      <Check
                        className={`size-4 shrink-0 ${
                          on ? "text-[#5566f6]" : "opacity-0"
                        }`}
                      />
                      <span className="min-w-0 flex-1">{s.name}</span>
                      {s.docx ? (
                        <span className="shrink-0 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] text-[#3848c7]">
                          PDF · DOCX
                        </span>
                      ) : (
                        <span className="shrink-0 text-[11px] text-[#9b9fb3]">
                          PDF
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={active.code}
          src={`/journal-samples/${active.code}.webp`}
          alt={`Образец: ${active.name}`}
          loading="lazy"
          className="aspect-[1228/862] w-full rounded-2xl border border-[#dcdfed] bg-white object-cover object-top shadow-[0_20px_50px_-30px_rgba(11,16,36,0.35)]"
        />

        <div className="min-w-0">
          <div className="text-[17px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]">
            {active.name}
          </div>
          <p className="mt-2 text-[14px] leading-[1.55] text-[#6f7282]">
            Готовый бланк, заполненный по шаблону: организация «Ромашка»,
            пять сотрудников, показания за две недели. Ровно такой файл
            сервис отдаёт инспектору — только с вашими данными.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {/* Скачивание — после почты: окно «Куда прислать шаблон?». */}
            <BlankDownloadButton
              target={{ kind: "code", code: active.code }}
              format="pdf"
              title={active.name}
              place="landing-gallery"
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
            >
              <FileText className="size-4" />
              Скачать PDF
            </BlankDownloadButton>
            {active.docx ? (
              <BlankDownloadButton
                target={{ kind: "code", code: active.code }}
                format="docx"
                title={active.name}
                place="landing-gallery"
                className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                <Download className="size-4 text-[#5566f6]" />
                Скачать DOCX
              </BlankDownloadButton>
            ) : (
              <span className="inline-flex h-11 items-center rounded-2xl bg-[#fafbff] px-4 text-[13px] text-[#9b9fb3]">
                Этот бланк — только в PDF
              </span>
            )}
          </div>

          <p className="mt-3 text-[12px] leading-[1.5] text-[#9b9fb3]">
            Данные в образце вымышленные. Без регистрации — копия придёт на почту.
          </p>
        </div>
      </div>
    </div>
  );
}
