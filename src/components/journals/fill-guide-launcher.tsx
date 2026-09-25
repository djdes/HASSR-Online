"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { BookOpenText } from "lucide-react";
import { toast } from "sonner";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { customJournalName } from "@/lib/custom-names";
import { useCustomNames } from "@/components/shared/custom-names-provider";
import { getJournalDocGuide } from "@/lib/journal-doc-guides";
import {
  getJournalWalkthroughOrGeneric,
  hasJournalWalkthrough,
  visibleWalkthroughSteps,
  type WalkthroughPage,
  type WalkthroughStep,
} from "@/lib/journal-ui-walkthroughs";
import { useSeenNotice } from "@/lib/use-seen-notice";
import { FillGuideDialog } from "@/components/journals/fill-guide-dialog";
import { JournalGuideFab } from "@/components/journals/journal-guide-fab";
import {
  SpotlightTour,
  findTourTarget,
  useIsNarrowViewport,
  waitForTourTarget,
  type SpotlightStep,
} from "@/components/ui/spotlight-tour";

/**
 * Вход в «Инструкцию»: кнопка (список журнала) или круглая кнопка
 * (документ) + окно + спотлайт-тур. Один компонент на сайт и Mini App
 * (П-3), различаются только пути (`basePath`).
 *
 * Поведение:
 * - Первый заход человека в журнал — окно открывается само один раз
 *   (флаг `fill-guide:<code>` в аккаунте, общий для списка и документа).
 * - `?tour=<stepId>` в URL — сразу тур с этого шага (так окно «перебрасывает»
 *   между списком и документом); параметр стирается без навигации.
 * - Шаг другой страницы → переход: список → первый активный документ,
 *   документ → список.
 *
 * Рендерится у ВСЕХ журналов: у кого нет своих шагов — общие
 * (`getJournalWalkthroughOrGeneric`), правила — из `journal-doc-guides`
 * или из общего гайда журнала.
 */
const GHOST_BUTTON_CLASS =
  "inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border-0 bg-[#5566f6]/[0.04] px-3.5 text-[14px] font-semibold text-[#5566f6] transition-colors hover:bg-[#5566f6]/[0.09] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 sm:w-auto";

export function FillGuideLauncher({
  code,
  journalName,
  page,
  variant,
  basePath = "site",
  firstDocumentId,
  bottomOffset = 72,
  className,
  style,
  label = "Инструкция",
}: {
  code: string;
  /** Название журнала в шапке окна; по умолчанию — из каталога. */
  journalName?: string;
  page: WalkthroughPage;
  variant: "button" | "fab";
  basePath?: "site" | "mini";
  /** Со списка: куда вести шаги «внутри документа». */
  firstDocumentId?: string;
  /** Для `fab`: отступ снизу (над стопкой других плавающих кнопок). */
  bottomOffset?: number;
  className?: string;
  style?: CSSProperties;
  /** Подпись кнопки: на списке журнала — «Инструкция». */
  label?: string;
}) {
  const router = useRouter();
  const narrow = useIsNarrowViewport();
  // Окно открывается у ЛЮБОГО журнала: свои шаги, если есть, иначе общие.
  const steps = getJournalWalkthroughOrGeneric(code);
  const guide = getJournalDocGuide(code);
  // Своё название журнала организации — первым: инструкция открывается
  // рядом с заголовком, где журнал уже назван по-своему.
  const customName = customJournalName(useCustomNames(), code);
  const name =
    customName ??
    journalName ??
    ACTIVE_JOURNAL_CATALOG.find((item) => item.code === code)?.name ??
    "Журнал";

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tour, setTour] = useState<{ startId?: string } | null>(null);
  // Само окно всплывает только у журналов со СВОИМ разбором: общие шаги
  // одинаковы везде, и показывать их при первом заходе в каждый из
  // сорока журналов — назойливо. Кнопка «Инструкция» есть всегда.
  const autoOpenOnFirstVisit = hasJournalWalkthrough(code);
  const { seen, markSeen } = useSeenNotice(
    autoOpenOnFirstVisit ? `fill-guide:${code}` : null,
  );

  const visible = useMemo(
    () => visibleWalkthroughSteps(steps, { isMobile: narrow }),
    [steps, narrow]
  );
  const tourSteps = useMemo<SpotlightStep[]>(
    () =>
      visible
        .filter((step) => step.page === page && step.anchor)
        .map((step) => ({
          id: step.id,
          anchor: step.anchor!,
          fallbackAnchor: step.fallbackAnchor,
          title: step.title,
          body: step.body,
        })),
    [visible, page]
  );

  const listPath = basePath === "mini" ? `/mini/journals/${code}` : `/journals/${code}`;
  const documentPath = (id: string) =>
    basePath === "mini" ? `/mini/documents/${id}` : `/journals/${code}/documents/${id}`;

  const startTour = useCallback(
    async (stepId?: string) => {
      const probe = tourSteps.find((s) => s.id === stepId) ?? tourSteps[0];
      if (!probe) return;
      await waitForTourTarget(probe.anchor, probe.fallbackAnchor);
      const present = tourSteps.some((s) => findTourTarget(s.anchor, s.fallbackAnchor));
      if (!present) {
        toast.info("На этой странице пока нечего показать — сначала создайте документ.");
        return;
      }
      setDialogOpen(false);
      setTour({ startId: stepId });
    },
    [tourSteps]
  );
  const startTourRef = useRef(startTour);
  startTourRef.current = startTour;

  // `?tour=<stepId>` — стартуем тур и убираем параметр без навигации
  // (router.replace на dynamic-страницах — лишний серверный round-trip;
  // `?tab=` и state роутера сохраняем).
  useEffect(() => {
    const url = new URL(window.location.href);
    const requested = url.searchParams.get("tour");
    if (!requested) return;
    url.searchParams.delete("tour");
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search + url.hash
    );
    markSeen();
    void startTourRef.current(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Автооткрытие один раз: отметку ставим сразу при открытии — даже если
  // человек уйдёт со страницы, не закрыв окно, второй раз оно не всплывёт.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (seen !== false || autoOpened.current) return;
    autoOpened.current = true;
    markSeen();
    setDialogOpen(true);
  }, [seen, markSeen]);

  function showStepHint(step: WalkthroughStep): string | null {
    if (step.page === "document" && page === "list" && !firstDocumentId) {
      return "Сначала создайте документ";
    }
    return null;
  }

  function showStep(step: WalkthroughStep) {
    if (step.page === page) {
      void startTour(step.id);
      return;
    }
    if (step.page === "document") {
      if (!firstDocumentId) return;
      router.push(`${documentPath(firstDocumentId)}?tour=${encodeURIComponent(step.id)}`);
      return;
    }
    router.push(`${listPath}?tour=${encodeURIComponent(step.id)}`);
  }

  const trigger =
    variant === "fab" ? (
      mounted ? (
        <JournalGuideFab
          onClick={() => setDialogOpen(true)}
          label={label}
          ariaLabel="Как заполнить этот журнал"
          bottomOffset={bottomOffset}
        />
      ) : null
    ) : (
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className={className ?? GHOST_BUTTON_CLASS}
        style={style}
      >
        <BookOpenText className="size-4" />
        {label}
      </button>
    );

  return (
    <>
      {trigger}
      {mounted ? (
        <FillGuideDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          journalName={name}
          steps={visible}
          page={page}
          guide={guide}
          journalCode={code}
          guideHref={basePath === "site" ? `/journals/${code}/guide` : undefined}
          tourAvailable={tourSteps.length > 0}
          onShowStep={showStep}
          showStepHint={showStepHint}
          onStartTour={() => void startTour()}
        />
      ) : null}
      {tour ? (
        <SpotlightTour
          steps={tourSteps}
          startStepId={tour.startId}
          onClose={() => setTour(null)}
        />
      ) : null}
    </>
  );
}
