"use client";
import { useTranslations } from "next-intl";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/use-body-scroll-lock";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  BookOpenText,
  ExternalLink,
  MousePointerClick,
  X,
} from "lucide-react";
import type { JournalDocGuide } from "@/lib/journal-doc-guides";
import type {
  WalkthroughPage,
  WalkthroughStep,
} from "@/lib/journal-ui-walkthroughs";
import { JournalDocGuideBody } from "@/components/journals/journal-doc-guide-body";
import { JournalGuide } from "@/components/journals/journal-guide";
import { WalkthroughPreview } from "@/components/journals/walkthrough-previews";
import { PORTAL_FONT_FAMILY } from "@/components/ui/spotlight-tour";

/**
 * Окно «Как заполнить?»: вкладка «Куда нажимать» — шаги по интерфейсу с
 * мини-копиями контролов и ссылкой «Показать на экране» (спотлайт-тур);
 * вкладка «Правила» — прежний контент `journal-doc-guides.ts`.
 *
 * Карточка по правилу CLAUDE.md для модалок: `max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh]`, шапка и
 * футер `shrink-0`, середина скроллится; на телефоне — bottom-sheet.
 * Портал в body (dark-mode ремапы app-theme.css scoped к `.app-shell`).
 */
export type FillGuideTab = "steps" | "rules";


export function FillGuideDialog({
  open,
  onClose,
  journalName,
  steps,
  page,
  guide,
  journalCode,
  guideHref,
  tourAvailable,
  onShowStep,
  showStepHint,
  onStartTour,
}: {
  open: boolean;
  onClose: () => void;
  journalName: string;
  steps: WalkthroughStep[];
  /** Страница, на которой открыто окно, — её шаги можно показать сразу. */
  page: WalkthroughPage;
  guide: JournalDocGuide | null;
  /** Код журнала — для общего гайда, если своих правил ещё нет. */
  journalCode: string;
  /** Ссылка на полную инструкцию (`/journals/<code>/guide`); в Mini App нет. */
  guideHref?: string;
  /** Есть ли на этой странице хоть один шаг с целью. */
  tourAvailable: boolean;
  onShowStep: (step: WalkthroughStep) => void;
  /** Почему шаг нельзя показать (например, нет документа) — кнопка неактивна с подсказкой. */
  showStepHint: (step: WalkthroughStep) => string | null;
  onStartTour: () => void;
}) {
  const t = useTranslations("journalControls.guide");
  const [tab, setTab] = useState<FillGuideTab>("steps");

  useEffect(() => {
    if (open) setTab("steps");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Body scroll lock пока открыто.
  useEffect(() => {
    if (!open) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  // Вкладки показываем всегда: если своих правил у журнала нет, во
  // вкладке «Правила» рендерим общий гайд (`journal-filling-guides`).
  const showSteps = tab === "steps";

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ fontFamily: PORTAL_FONT_FAMILY }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="fill-guide-title"
    >
      <button
        type="button"
        aria-label={t("close")}
        onClick={onClose}
        className="absolute inset-0 bg-[#0b1024]/40 backdrop-blur-sm"
      />

      <div className="relative flex max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-3xl border border-[#ececf4] bg-white shadow-[0_30px_80px_-30px_rgba(11,16,36,0.55)] animate-in fade-in-0 slide-in-from-bottom-8 duration-200 sm:rounded-3xl sm:zoom-in-95 sm:slide-in-from-bottom-0">
        {/* Header — fixed */}
        <div className="relative shrink-0 border-b border-[#ececf4] bg-gradient-to-br from-[#f5f6ff] to-white px-5 pb-4 pt-5">
          <div className="pointer-events-none absolute -right-12 -top-12 size-[180px] rounded-full bg-[#5566f6]/10 blur-3xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
                <MousePointerClick className="size-5" />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                  {t("guide")}
                </div>
                <h2
                  id="fill-guide-title"
                  className="mt-0.5 text-[18px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]"
                >
                  {journalName}
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-[#9b9fb3] transition-colors hover:bg-white/70 hover:text-[#0b1024]"
              aria-label={t("close")}
            >
              <X className="size-4" />
            </button>
          </div>

          {(
            <div
              role="tablist"
              aria-label={t("sections")}
              className="relative mt-4 flex rounded-2xl border border-[#ececf4] bg-white p-1 text-[13px] font-medium"
            >
              <TabButton active={showSteps} onClick={() => setTab("steps")}>
                <MousePointerClick className="size-4" />
                {t("how")}
              </TabButton>
              <TabButton active={!showSteps} onClick={() => setTab("rules")}>
                <BookOpenText className="size-4" />
                {t("rules")}
              </TabButton>
            </div>
          )}
        </div>

        {/* Body — scroll */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {showSteps ? (
            <ol className="space-y-2.5">
              {steps.map((step, i) => {
                const hint = showStepHint(step);
                const elsewhere = step.page !== page;
                return (
                  <li
                    key={step.id}
                    className="flex gap-3 rounded-2xl border border-[#ececf4] bg-white p-3.5"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5566f6] to-[#7a5cff] text-[12px] font-semibold text-white">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <div className="text-[14px] font-semibold leading-tight text-[#0b1024]">
                          {step.title}
                        </div>
                        {step.forManager ? (
                          <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-medium text-[#3848c7]">
                            {t("manager")}
                          </span>
                        ) : null}
                        {elsewhere ? (
                          <span className="text-[11px] text-[#9b9fb3]">
                            {t(step.page)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[13px] leading-[1.6] text-[#3c4053]">
                        {step.body}
                      </p>
                      {step.preview ? <WalkthroughPreview preview={step.preview} /> : null}
                      {step.anchor ? (
                        <button
                          type="button"
                          onClick={() => onShowStep(step)}
                          disabled={Boolean(hint)}
                          title={hint ?? undefined}
                          className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-[#3848c7] transition-colors hover:text-[#5566f6] disabled:cursor-not-allowed disabled:text-[#9b9fb3]"
                        >
                          {t("show")}
                          <ArrowRight className="size-3.5" />
                        </button>
                      ) : null}
                      {hint ? (
                        <div className="mt-1 text-[12px] text-[#9b9fb3]">{hint}</div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : guide ? (
            <JournalDocGuideBody guide={guide} />
          ) : (
            <JournalGuide journalCode={journalCode} expanded />
          )}
        </div>

        {/* Footer — fixed */}
        <div className="flex shrink-0 flex-col gap-2 border-t border-[#ececf4] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          {guideHref ? (
            <a
              href={guideHref}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#6f7282] transition-colors hover:text-[#5566f6]"
            >
              <ExternalLink className="size-3.5" />
              {t("full")}
            </a>
          ) : (
            <span />
          )}
          {/* Порядок кнопок один во всех журналах: слева обычная
              «Показать на экране», справа фиолетовая «Понятно» —
              основное действие всегда правое. */}
          <div className="flex gap-2">
            {showSteps && tourAvailable ? (
              <button
                type="button"
                onClick={onStartTour}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:flex-none"
              >
                {t("show")}
                <ArrowRight className="size-4 text-[#5566f6]" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_26px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] sm:flex-none"
            >
              {t("understood")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 transition-colors ${
        active ? "bg-[#f5f6ff] text-[#5566f6]" : "text-[#6f7282] hover:text-[#0b1024]"
      }`}
    >
      {children}
    </button>
  );
}
