"use client";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/use-body-scroll-lock";

import { useEffect } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Hammer,
  ScrollText,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { getFillingGuide } from "@/lib/journal-filling-guides";

type Props = {
  open: boolean;
  onClose: () => void;
  journalCode: string;
  journalLabel: string;
};

/**
 * Beautiful overlay-помощник «Как заполнять журнал». Контент берётся из
 * `src/lib/journal-filling-guides.ts` (для топ-15 журналов прописаны
 * подробные шаги). Если гайда нет — fallback на базовое объяснение
 * и ссылку на полную страницу /journals/<code>/guide.
 *
 * Дизайн: фиксированный overlay на весь экран с blur-фоном, центральная
 * карточка max-w-2xl rounded-3xl, фиксированный hero сверху с big icon,
 * scrollable middle (категории-секции с пастельными бэкграундами,
 * иконки), фиксированный footer с CTA «Начать заполнение».
 *
 * Цвета — TF-style: насыщенный indigo gradient в hero, зелёный/жёлтый/
 * красный в секциях по смыслу (готово / частые ошибки / СанПиН).
 */
export function TaskFillHelperModal({
  open,
  onClose,
  journalCode,
  journalLabel,
}: Props) {
  const guide = getFillingGuide(journalCode);

  // ESC закрывает модалку.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Body scroll-lock пока модалка открыта.
  useEffect(() => {
    if (!open) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0b1024]/60 px-2 backdrop-blur-[3px] animate-in fade-in-0 duration-200 sm:items-center sm:px-4">
      <div className="flex max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_-30px_80px_-20px_rgba(11,16,36,0.55)] animate-in slide-in-from-bottom-8 fade-in-0 duration-300 sm:rounded-3xl sm:zoom-in-95">
        {/* Hero */}
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#3d4efc] via-[#5566f6] to-[#7a5cff] px-6 py-7 text-white">
          <div className="pointer-events-none absolute -right-16 -top-16 size-[240px] rounded-full bg-white/15 blur-[80px]" />
          <div className="pointer-events-none absolute -bottom-20 -left-12 size-[200px] rounded-full bg-[#a78bfa]/40 blur-[80px]" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="absolute right-4 top-4 z-10 flex size-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/25"
          >
            <X className="size-5" />
          </button>

          <div className="relative z-[1] flex items-start gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur-sm">
              <BookOpen className="size-7" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
                Гайд
              </div>
              <h2 className="mt-1 text-[22px] font-semibold leading-tight tracking-[-0.02em] sm:text-[24px]">
                Как заполнять
              </h2>
              <p className="mt-1 text-[13px] text-white/85 sm:text-[14px]">
                {journalLabel}
              </p>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          {guide ? (
            <div className="space-y-6">
              {/* Summary */}
              <section className="rounded-2xl bg-[#f5f6ff] p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#5566f6]/15 text-[#3848c7]">
                    <Sparkles className="size-4" />
                  </span>
                  <p className="text-[14px] leading-relaxed text-[#3c4053] sm:text-[15px]">
                    {guide.summary}
                  </p>
                </div>
              </section>

              {/* Materials */}
              {guide.materials.length > 0 ? (
                <section>
                  <SectionHeader
                    icon={Hammer}
                    title="Что взять"
                    tone="amber"
                  />
                  <ul className="mt-3 space-y-2">
                    {guide.materials.map((item, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-3 rounded-xl border border-[#fef3c7] bg-[#fffbeb] p-3 text-[13.5px] leading-snug text-[#78350f] sm:text-[14px]"
                      >
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-400/30 text-[10px] font-bold text-amber-800">
                          {idx + 1}
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* Steps */}
              {guide.steps.length > 0 ? (
                <section>
                  <SectionHeader
                    icon={ScrollText}
                    title="Шаги"
                    tone="indigo"
                  />
                  <ol className="mt-3 space-y-3">
                    {guide.steps.map((step, idx) => (
                      <li
                        key={idx}
                        className="rounded-2xl border border-[#dcdfed] bg-white p-4 transition-colors hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
                      >
                        <div className="flex items-start gap-3">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#5566f6] to-[#7a5cff] text-[13px] font-semibold text-white shadow-[0_4px_12px_-4px_rgba(85,102,246,0.6)]">
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[14.5px] font-semibold leading-snug text-[#0b1024] sm:text-[15.5px]">
                              {step.title}
                            </div>
                            <p className="mt-1 text-[13px] leading-relaxed text-[#3c4053] sm:text-[13.5px]">
                              {step.detail}
                            </p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              {/* Completion criteria */}
              {guide.completionCriteria ? (
                <section>
                  <SectionHeader
                    icon={CheckCircle2}
                    title="Готово, когда"
                    tone="emerald"
                  />
                  <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-[13.5px] leading-relaxed text-emerald-900 sm:text-[14px]">
                    {guide.completionCriteria}
                  </div>
                </section>
              ) : null}

              {/* Common mistakes */}
              {guide.commonMistakes.length > 0 ? (
                <section>
                  <SectionHeader
                    icon={AlertTriangle}
                    title="Частые ошибки"
                    tone="rose"
                  />
                  <ul className="mt-3 space-y-2">
                    {guide.commonMistakes.map((mistake, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-[13px] leading-snug text-rose-900 sm:text-[13.5px]"
                      >
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-200/80 text-rose-700">
                          <AlertTriangle className="size-3" />
                        </span>
                        <span>{mistake}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* Regulation ref */}
              {guide.regulationRef ? (
                <section className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[12.5px] leading-relaxed text-[#6f7282] sm:text-[13px]">
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
                    <span>
                      <strong className="text-[#3c4053]">Источник:</strong>{" "}
                      {guide.regulationRef}
                    </span>
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-6 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
                  <BookOpen className="size-6" />
                </div>
                <h3 className="mt-3 text-[16px] font-semibold text-[#0b1024]">
                  Подробного гайда пока нет
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#6f7282]">
                  Заполни поля по описанию выше. Если что-то непонятно —
                  спроси заведующего производством или открой полную страницу гайда.
                </p>
                <a
                  href={`/journals/${journalCode}/guide`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border-0 bg-[#5566f6]/[0.04] px-4 text-[14px] font-semibold text-[#5566f6] hover:bg-[#5566f6]/[0.09]"
                >
                  Открыть полную инструкцию
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-[#ececf4] bg-white px-5 py-4 sm:px-7 sm:py-5">
          <button
            type="button"
            onClick={onClose}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-[#3d4efc] to-[#7a5cff] text-[15px] font-medium text-white shadow-[0_12px_30px_-12px_rgba(85,102,246,0.65)] transition-opacity hover:opacity-95"
          >
            Понятно — заполняю
          </button>
        </div>
      </div>
    </div>
  );
}

const SECTION_TONES = {
  indigo: { bg: "bg-[#eef1ff]", text: "text-[#3848c7]" },
  emerald: { bg: "bg-emerald-100", text: "text-emerald-800" },
  amber: { bg: "bg-amber-100", text: "text-amber-800" },
  rose: { bg: "bg-rose-100", text: "text-rose-800" },
} as const;

function SectionHeader({
  icon: Icon,
  title,
  tone,
}: {
  icon: typeof BookOpen;
  title: string;
  tone: keyof typeof SECTION_TONES;
}) {
  const t = SECTION_TONES[tone];
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`flex size-8 items-center justify-center rounded-xl ${t.bg} ${t.text}`}
      >
        <Icon className="size-4" />
      </span>
      <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[#0b1024] sm:text-[16px]">
        {title}
      </h3>
    </div>
  );
}
