"use client";
import { useTranslations } from "next-intl";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/use-body-scroll-lock";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { BookOpen, X } from "lucide-react";
import {
  getJournalDocGuide,
  type JournalDocGuide,
} from "@/lib/journal-doc-guides";
import { hasJournalWalkthrough } from "@/lib/journal-ui-walkthroughs";
import { resolveJournalCodeAlias } from "@/lib/source-journal-map";
import { FillGuideLauncher } from "@/components/journals/fill-guide-launcher";
import { JournalDocGuideBody } from "@/components/journals/journal-doc-guide-body";
import { JournalGuideFab } from "@/components/journals/journal-guide-fab";
import { PORTAL_FONT_FAMILY } from "@/components/ui/spotlight-tour";

/**
 * Inline floating-кнопка внизу справа на странице документа.
 *
 * Журналы с walkthrough (`journal-ui-walkthroughs.ts`) получают окно
 * «Как заполнить?» — вкладки «Куда нажимать» / «Правила» и спотлайт-тур
 * (`FillGuideLauncher`). Остальные — прежний sheet с правилами из
 * `journal-doc-guides.ts`. Если у журнала нет ни того, ни другого —
 * кнопка не рендерится (тихо).
 *
 * На сайте монтируется в layout раздела и читает code из URL. Mini App
 * (`/mini/documents/[id]`) передаёт `code` явно — в его URL кода нет —
 * и `bottomOffset` над нижней навигацией.
 */
export function JournalDocGuideOverlay({
  code: explicitCode,
  basePath = "site",
  bottomOffset = 72,
}: {
  code?: string;
  basePath?: "site" | "mini";
  bottomOffset?: number;
} = {}) {
  const t = useTranslations("journalControls.guide");
  const tDocGuide = useTranslations("journalDocGuides");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Портал в body доступен только после гидрации — иначе SSR и клиент
  // рендерят разное дерево.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Detect /journals/<code>/documents/... and extract code.
  const code = useMemo(() => {
    if (explicitCode) return resolveJournalCodeAlias(explicitCode);
    const m = /^\/journals\/([^/]+)\/documents\/[^/]+/.exec(pathname ?? "");
    if (!m) return null;
    return resolveJournalCodeAlias(decodeURIComponent(m[1]));
  }, [pathname, explicitCode]);

  const guide = useMemo(
    () => (code ? getJournalDocGuide(code, tDocGuide) : null),
    [code, tDocGuide]
  );
  const walkthrough = code ? hasJournalWalkthrough(code) : false;

  // Lock body scroll when sheet is open.
  useEffect(() => {
    if (!open) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [open]);

  // Close on Esc.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!code || (!guide && !walkthrough)) return null;
  if (!mounted || typeof document === "undefined") return null;

  if (walkthrough) {
    return (
      <FillGuideLauncher
        code={code}
        page="document"
        variant="fab"
        basePath={basePath}
        bottomOffset={bottomOffset}
      />
    );
  }

  return (
    <>
      <JournalGuideFab
        onClick={() => setOpen(true)}
        label={t("how")}
        ariaLabel={t("hint")}
        bottomOffset={bottomOffset}
      />
      {open && guide ? (
        <GuideSheet guide={guide} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function GuideSheet({
  guide,
  onClose,
}: {
  guide: JournalDocGuide;
  onClose: () => void;
}) {
  const t = useTranslations("journalControls.guide");
  // Portal в document.body — чтобы sheet оказался ВНЕ .app-shell. Иначе
  // dark-mode CSS-правила в app-theme.css переопределяют bg-white →
  // var(--app-surface) внутри sheet'а и весь модал съезжает в dark-mode
  // независимо от того что мы хотим. У гайда фиксированная light-палитра —
  // это часть design-system.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex"
      style={{ fontFamily: PORTAL_FONT_FAMILY }}
      data-app-theme="light"
      role="dialog"
      aria-modal="true"
      aria-label={t("how")}
    >
      {/* Backdrop. z-0 — иначе position:absolute рисуется поверх sheet'а
          (который flex-item с position:static), и 55%-ное затемнение
          ложится прямо на содержимое модала, делая его выцветшим. */}
      <div
        className="absolute inset-0 z-0 bg-[#0b1024]/55"
        onClick={onClose}
      />

      {/* Sheet — slides from right on desktop, full-screen on mobile.
          relative + z-10 — вытягивает над backdrop'ом. */}
      <div className="relative z-10 ml-auto flex h-full w-full max-w-[640px] flex-col bg-white shadow-[0_0_60px_-10px_rgba(11,16,36,0.4)] sm:rounded-l-3xl">
        {/* Шапка sheet'а. Тёмный hero снят: это не заголовок страницы, а
            шапка карточки — на белом фоне видно, что дальше идёт текст
            инструкции, а не отдельный экран. */}
        <div className="shrink-0 border-b border-[#ececf4] bg-white">
          <div className="flex items-start justify-between gap-3 p-5 sm:p-7">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
                <BookOpen className="size-5" />
              </span>
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-[#6f7282]">
                  {t("how")}
                </div>
                <h2 className="mt-1 text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]">
                  {t("hint")}
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-[#6f7282] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]"
              aria-label={t("close")}
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-5 sm:p-7">
            <JournalDocGuideBody guide={guide} />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[#ececf4] bg-white p-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_26px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
          >
            {t("understood")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
