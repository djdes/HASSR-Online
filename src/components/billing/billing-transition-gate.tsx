"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarClock,
  Check,
  CreditCard,
  Crown,
  Loader2,
  Search,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { lockBodyScroll, unlockBodyScroll } from "@/lib/use-body-scroll-lock";
import { signOutAndOpen } from "@/lib/sign-out";
import { PromoPrice } from "@/components/pricing/promo-price";
import type { BillingPrice } from "@/lib/billing-period";
import { cn } from "@/lib/utils";

/**
 * Окно «Пробный период закончился» — руководителю с правом на тариф, на
 * любой странице кабинета, пока он не решит: подключить «Стандарт» или
 * «Премиум» или остаться на бесплатном — отметить 1 сотрудника и 1 журнал
 * (остальные сотрудники — в архив, остальные журналы выключаются).
 *
 * Тексты честные и считаются на сервере (`transitionCopy`): не платившим —
 * «бесплатный период закончился», а не «оплаченный тариф закончился».
 *
 * `display="card"` — та же развилка карточкой на `/settings/subscription`
 * (там окно не показываем: иначе оно закрыло бы саму оплату).
 */

export type TransitionGateCopy = {
  title: string;
  lead: string;
  graceLine: string | null;
  payTitle: string;
  payHint: string;
  /** `payHint` по частям: цена (`PromoPrice`, в акцию старая зачёркнута) и условия. */
  payPrice?: BillingPrice;
  payTerms?: string;
  freeTitle: string;
  freeHint: string;
};

type Candidate = {
  id: string;
  name: string;
  position: string | null;
  organizationName: string;
  isOwner: boolean;
  isSelf: boolean;
  isManagement: boolean;
  canSignIn: boolean;
};

type JournalOption = {
  code: string;
  name: string;
  /** Записей за 30 дней — самые заполняемые первыми. */
  entries30d: number;
};

type Step = "overview" | "choose" | "journal" | "confirm";

export function BillingTransitionGate({
  copy,
  payHref,
  blocking,
  display = "modal",
  hideOnPaths = [],
  cardNote = null,
}: {
  copy: TransitionGateCopy;
  /** null — звать к оплате нельзя (приложение WeSetup, правила сторов). */
  payHref: string | null;
  /** Окно без «Позже»: работа руководителя ждёт решения. */
  blocking: boolean;
  display?: "modal" | "card";
  /** Страницы, где окна нет (там развилка карточкой). */
  hideOnPaths?: string[];
  /** Подпись под карточкой (например, про оплату счётом). */
  cardNote?: string | null;
}) {
  const t = useTranslations("billingUi.billingTransitionGate");
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);
  // Выбор сотрудника в карточке открывается поверх страницы.
  const [chooserOpen, setChooserOpen] = useState(false);

  if (display === "card") {
    return (
      <>
        <section
          data-testid="billing-decision-card"
          className="rounded-3xl border border-[#ffd9a8] bg-[#fffaf0] p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
        >
          <OverviewBody
            copy={copy}
            payHref={payHref}
            payLabel={t("paySubscription")}
            onFree={() => setChooserOpen(true)}
          />
          {cardNote ? (
            <p className="mt-3 text-[12.5px] leading-[1.5] text-[#6f7282]">{cardNote}</p>
          ) : null}
        </section>
        {chooserOpen ? (
          <ModalShell onClose={() => setChooserOpen(false)} closable>
            <Chooser
              onBack={() => setChooserOpen(false)}
              onDone={() => setChooserOpen(false)}
              backLabel={t("cancel")}
            />
          </ModalShell>
        ) : null}
      </>
    );
  }

  if (dismissed) return null;
  if (hideOnPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  return (
    <ModalShell onClose={() => setDismissed(true)} closable={!blocking}>
      <FlowInModal copy={copy} payHref={payHref} blocking={blocking} onLater={() => setDismissed(true)} />
    </ModalShell>
  );
}

/**
 * «Перейти на бесплатный» по своей воле — со страницы тарифа, когда идёт
 * подписка (в том числе оплаченная). Те же шаги, что в окне решения:
 * кто остаётся → подтверждение; POST с `voluntary: true`.
 */
export function VoluntaryFreeButton({
  paidUntilLabel,
  className,
}: {
  /** «3 ноября» — подписка реально оплачена: срок при переходе не сохранится. */
  paidUntilLabel: string | null;
  className?: string;
}) {
  const t = useTranslations("billingUi.billingTransitionGate");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          console.info("[billing] voluntary downgrade dialog opened", { paid: Boolean(paidUntilLabel) });
          setOpen(true);
        }}
        data-testid="billing-voluntary-free"
        className={cn(
          "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
          className
        )}
      >
        {t("goFree")}
      </button>
      {open ? (
        <ModalShell onClose={() => setOpen(false)} closable>
          <Chooser
            onBack={() => setOpen(false)}
            onDone={() => setOpen(false)}
            backLabel={t("cancel")}
            voluntary
            paidUntilLabel={paidUntilLabel}
          />
        </ModalShell>
      ) : null}
    </>
  );
}

function ModalShell({
  children,
  onClose,
  closable,
}: {
  children: React.ReactNode;
  onClose: () => void;
  closable: boolean;
}) {
  const t = useTranslations("billingUi.billingTransitionGate");
  // Портал в <body> — как у ConfirmDialog: внутри оболочки мини-приложения
  // страница живёт в `main` на первом слое, и окно оказывалось под шапкой
  // и нижним меню (50-й слой) — кнопку «Перейти на бесплатный» закрывала
  // навигация. На сайте полотно с `translate` сдвигает `position: fixed`.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, []);

  useEffect(() => {
    if (!closable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closable, onClose]);

  if (!mounted) return null;
  return createPortal(
    <div className="pointer-events-auto fixed inset-0 z-[85] flex items-end justify-center bg-[#0b1024]/45 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-transition-title"
        data-testid="billing-transition-modal"
        className="relative flex max-h-[92vh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_30px_80px_-30px_rgba(11,16,36,0.55)] sm:rounded-3xl sm:pb-0"
      >
        {closable ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-xl text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#0b1024]"
          >
            <X className="size-4" />
          </button>
        ) : null}
        {children}
      </div>
    </div>,
    document.body
  );
}

function FlowInModal({
  copy,
  payHref,
  blocking,
  onLater,
}: {
  copy: TransitionGateCopy;
  payHref: string | null;
  blocking: boolean;
  onLater: () => void;
}) {
  const t = useTranslations("billingUi.billingTransitionGate");
  const [step, setStep] = useState<"overview" | "choose">("overview");
  if (step === "choose") {
    return <Chooser onBack={() => setStep("overview")} onDone={onLater} backLabel={t("back")} />;
  }
  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 pb-5 pt-6 sm:px-6">
        <OverviewBody
          copy={copy}
          payHref={payHref}
          payLabel={t("paySubscription")}
          onFree={() => setStep("choose")}
        />
      </div>
      {!blocking ? (
        <div className="shrink-0 border-t border-[#ececf4] px-5 py-3 sm:px-6">
          <button
            type="button"
            onClick={onLater}
            className="inline-flex h-10 w-full items-center justify-center rounded-2xl text-[14px] font-medium text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#0b1024]"
          >
            {t("later")}
          </button>
        </div>
      ) : null}
    </>
  );
}

function OverviewBody({
  copy,
  payHref,
  payLabel,
  onFree,
}: {
  copy: TransitionGateCopy;
  payHref: string | null;
  payLabel: string;
  onFree: () => void;
}) {
  const t = useTranslations("billingUi.billingTransitionGate");
  return (
    <div>
      <div className="flex items-start gap-3 pr-8">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#fff3dd] text-[#b25f00]">
          <CalendarClock className="size-5" />
        </span>
        <h2
          id="billing-transition-title"
          className="pt-1 text-[20px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]"
        >
          {copy.title}
        </h2>
      </div>
      <p className="mt-4 text-[14.5px] leading-[1.6] text-[#3c4053]">{copy.lead}</p>
      {copy.graceLine ? (
        <p className="mt-3 rounded-2xl bg-[#fff8eb] px-4 py-3 text-[13.5px] leading-[1.55] text-[#7a4a00]">
          {copy.graceLine}
        </p>
      ) : null}

      <div className="mt-5 grid gap-3">
        {payHref ? (
          <div className="rounded-2xl border border-[#c7ccea] bg-[#f5f6ff] p-4">
            <div className="text-[15px] font-semibold text-[#0b1024]">{copy.payTitle}</div>
            <p className="mt-1 text-[13px] leading-[1.5] text-[#3c4053]">
              {copy.payPrice && copy.payTerms ? (
                <>
                  <PromoPrice price={copy.payPrice} size="sm" suffix={t("perMonth")} />
                  {" · "}
                  {copy.payTerms}
                </>
              ) : (
                copy.payHint
              )}
            </p>
            {/* Обычная ссылка, а не клиентский переход: живое обновление
                дашборда (router.refresh) могло перебить мягкую навигацию, и
                человек оставался перед окном. К оплате — полной загрузкой. */}
            <a
              href={payHref}
              data-testid="billing-pay"
              className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0]"
            >
              <CreditCard className="size-4" />
              {payLabel}
            </a>
          </div>
        ) : null}
        <div className="rounded-2xl border border-[#ececf4] bg-white p-4">
          <div className="text-[15px] font-semibold text-[#0b1024]">{copy.freeTitle}</div>
          <p className="mt-1 text-[13px] leading-[1.5] text-[#3c4053]">{copy.freeHint}</p>
          <button
            type="button"
            onClick={onFree}
            data-testid="billing-go-free"
            className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            {copy.freeTitle}
            <ArrowRight className="size-4 text-[#5566f6]" />
          </button>
        </div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

/**
 * Шаги «кто остаётся» → «какой журнал остаётся» → «подтвердите». Списки
 * грузятся с сервера; отмечается по одному (бесплатный — 1 сотрудник и
 * 1 журнал).
 */
function Chooser({
  onBack,
  onDone,
  backLabel,
  voluntary = false,
  paidUntilLabel = null,
}: {
  onBack: () => void;
  /** Переход выполнен: окно закрываем сразу, не дожидаясь обновления страницы. */
  onDone: () => void;
  backLabel: string;
  /** Добровольный переход с подписки (страница тарифа). */
  voluntary?: boolean;
  /** Оплачено до этой даты — предупредить, что срок не сохранится. */
  paidUntilLabel?: string | null;
}) {
  const t = useTranslations("billingUi.billingTransitionGate");
  const router = useRouter();
  const [step, setStep] = useState<Exclude<Step, "overview">>("choose");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [multiOrg, setMultiOrg] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [journals, setJournals] = useState<JournalOption[] | null>(null);
  const [keepJournal, setKeepJournal] = useState<string | null>(null);
  const [journalQuery, setJournalQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/settings/subscription/transition", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error ?? t("loadFailed"));
      const list = (data.candidates ?? []) as Candidate[];
      setCandidates(list);
      setMultiOrg(data.multiOrg === true);
      // По умолчанию остаётся сам руководитель, потом владелец.
      const preferred = list.find((c) => c.isSelf) ?? list.find((c) => c.isOwner) ?? list[0];
      setSelected((current) => current ?? preferred?.id ?? null);
      // Журнал по умолчанию — самый заполняемый (сервер отдаёт их первыми).
      const journalList = (data.journals ?? []) as JournalOption[];
      setJournals(journalList);
      setKeepJournal((current) => current ?? journalList[0]?.code ?? null);
      // Выбирать сотрудника не из кого — сразу к журналу или подтверждению.
      if (list.length === 1) setStep(journalList.length > 1 ? "journal" : "confirm");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (!candidates) return [];
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) =>
      [c.name, c.position ?? "", c.organizationName].some((v) => v.toLowerCase().includes(q))
    );
  }, [candidates, query]);

  const visibleJournals = useMemo(() => {
    if (!journals) return [];
    const q = journalQuery.trim().toLowerCase();
    return q ? journals.filter((j) => j.name.toLowerCase().includes(q)) : journals;
  }, [journals, journalQuery]);

  const chosen = candidates?.find((c) => c.id === selected) ?? null;
  const others = candidates?.filter((c) => c.id !== selected) ?? [];
  const keptJournal = journals?.find((j) => j.code === keepJournal) ?? null;
  const journalsOff = journals && keptJournal ? journals.length - 1 : 0;
  const hasJournalStep = (journals?.length ?? 0) > 1;

  async function submit() {
    if (!chosen) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings/subscription/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keepUserId: chosen.id,
          ...(keptJournal ? { keepJournalCode: keptJournal.code } : {}),
          ...(voluntary ? { voluntary: true } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? t("transitionFailed"));
      toast.success(
        data.archivedCount > 0
          ? t("doneArchived", { employees: t("employeesCount", { count: Number(data.archivedCount) }) })
          : t("done")
      );
      if (data.selfArchived) {
        // Руководитель оставил другого — его сессия уже завершена.
        await signOutAndOpen("/login").catch(() => window.location.replace("/login"));
        return;
      }
      onDone();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("transitionFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (step === "confirm" && chosen) {
    const preview = others.slice(0, 5).map((c) => c.name);
    const rest = others.length - preview.length;
    return (
      <>
        <div className="flex-1 overflow-y-auto px-5 pb-5 pt-6 sm:px-6">
          <h2
            id="billing-transition-title"
            className="pr-8 text-[20px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]"
          >
            {t("confirmTitle")}
          </h2>
          <ul className="mt-4 space-y-2.5 text-[14px] leading-[1.55] text-[#3c4053]">
            <li className="flex gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-[#116b2a]" />
              <span>
                {t.rich("keepRemains", {
                  name: chosen.name,
                  b: (chunks) => <strong className="text-[#0b1024]">{chunks}</strong>,
                })}
              </span>
            </li>
            {others.length > 0 ? (
            <li className="flex gap-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#b25f00]" />
              <span data-testid="billing-archive-list">
                {t("archiveList", {
                  employees: t("employeesCount", { count: others.length }),
                  names: preview.length
                    ? ` — ${preview.join(", ")}${rest > 0 ? ` ${t("andMore", { count: rest })}` : ""}`
                    : "",
                })}
              </span>
            </li>
            ) : null}
            {others.length > 0 ? (
            <li className="flex gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-[#3848c7]" />
              <span>{t("restoreHint")}</span>
            </li>
            ) : null}
            {keptJournal ? (
              <li className="flex gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-[#116b2a]" />
                <span data-testid="billing-keep-journal">
                  {t.rich("keepJournalRemains", {
                    name: keptJournal.name,
                    b: (chunks) => <strong className="text-[#0b1024]">{chunks}</strong>,
                  })}
                </span>
              </li>
            ) : null}
            {journalsOff > 0 ? (
              <li className="flex gap-2.5">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#b25f00]" />
                <span data-testid="billing-journals-off">
                  {t("journalsOff", { journals: t("journalsCount", { count: journalsOff }) })}
                </span>
              </li>
            ) : null}
          </ul>
          {paidUntilLabel ? (
            <p
              data-testid="billing-paid-term-warning"
              className="mt-4 rounded-2xl bg-[#fff8eb] px-4 py-3 text-[13.5px] leading-[1.55] text-[#7a4a00]"
            >
              {t.rich("paidTerm", {
                date: paidUntilLabel,
                mail: (chunks) => (
                  <a href="mailto:support@wesetup.ru" className="underline underline-offset-2">
                    {chunks}
                  </a>
                ),
                offer: (chunks) => (
                  <a href="/oferta" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    {chunks}
                  </a>
                ),
              })}
            </p>
          ) : null}
          {!chosen.isSelf ? (
            <p className="mt-4 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13.5px] leading-[1.55] text-[#a13a32]">
              {t("selfArchived")}
            </p>
          ) : null}
          {!chosen.canSignIn ? (
            <p className="mt-3 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13.5px] leading-[1.55] text-[#a13a32]">
              {t("noSignIn", { name: chosen.name })}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-[#ececf4] px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => setStep(hasJournalStep ? "journal" : "choose")}
            disabled={busy}
            className="inline-flex h-12 items-center justify-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
          >
            <ArrowLeft className="size-4" />
            {t("back")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            data-testid="billing-confirm-free"
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#e5484d] px-5 text-[15px] font-medium text-white shadow-[0_12px_30px_-14px_rgba(229,72,77,0.75)] transition-colors duration-150 hover:bg-[#d93d42] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("goFree")}
          </button>
        </div>
      </>
    );
  }

  if (step === "journal" && journals) {
    return (
      <>
        <div className="flex-1 overflow-y-auto px-5 pb-5 pt-6 sm:px-6">
          <h2
            id="billing-transition-title"
            className="pr-8 text-[20px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]"
          >
            {t("journalTitle")}
          </h2>
          <p className="mt-2 text-[13.5px] leading-[1.55] text-[#6f7282]">
            {t("journalLead", { journals: t("journalsCount", { count: 1 }) })}
          </p>
          {journals.length > 7 ? (
            <label className="relative mt-4 block">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
              <input
                value={journalQuery}
                onChange={(e) => setJournalQuery(e.target.value)}
                placeholder={t("searchJournal")}
                className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white pl-10 pr-4 text-[14.5px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </label>
          ) : null}
          {/* Чекбоксы, но отмечается один: бесплатный — 1 журнал. */}
          <div role="radiogroup" aria-label={t("journalTitle")} className="mt-4 space-y-2">
            {visibleJournals.map((journal) => {
              const active = journal.code === keepJournal;
              return (
                <button
                  key={journal.code}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setKeepJournal(journal.code)}
                  data-testid={`billing-keep-journal-${journal.code}`}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors duration-150",
                    active
                      ? "border-[#5566f6] bg-[#f5f6ff] ring-4 ring-[#5566f6]/15"
                      : "border-[#ececf4] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-md border",
                      active ? "border-[#5566f6] bg-[#5566f6] text-white" : "border-[#dcdfed] bg-white"
                    )}
                  >
                    {active ? <Check className="size-3.5" /> : null}
                  </span>
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-2xl",
                      active ? "bg-[#5566f6] text-white" : "bg-[#eef1ff] text-[#3848c7]"
                    )}
                  >
                    <BookOpen className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-medium leading-snug text-[#0b1024]">{journal.name}</span>
                    <span className="mt-0.5 block text-[12.5px] text-[#6f7282]">
                      {t("journalEntries", { count: journal.entries30d })}
                    </span>
                  </span>
                </button>
              );
            })}
            {visibleJournals.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-[#9b9fb3]">{t("noJournalFound")}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-2 border-t border-[#ececf4] px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => ((candidates?.length ?? 0) > 1 ? setStep("choose") : onBack())}
            className="inline-flex h-12 items-center justify-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            <ArrowLeft className="size-4" />
            {(candidates?.length ?? 0) > 1 ? t("back") : backLabel}
          </button>
          <button
            type="button"
            disabled={!keptJournal}
            onClick={() => setStep("confirm")}
            data-testid="billing-journal-next"
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("next")}
            <ArrowRight className="size-4" />
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 pb-5 pt-6 sm:px-6">
        <h2
          id="billing-transition-title"
          className="pr-8 text-[20px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]"
        >
          {t("chooserTitle")}
        </h2>
        <p className="mt-2 text-[13.5px] leading-[1.55] text-[#6f7282]">
          {t("chooserLead", { employees: t("employeesCount", { count: 1 }) })}
        </p>

        {loadError ? (
          <div className="mt-4 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13.5px] text-[#a13a32]">
            {loadError}{" "}
            <button type="button" onClick={() => void load()} className="font-medium underline underline-offset-2">
              {t("retry")}
            </button>
          </div>
        ) : !candidates ? (
          <div className="mt-6 flex items-center justify-center gap-2 py-6 text-[13.5px] text-[#6f7282]">
            <Loader2 className="size-4 animate-spin" /> {t("loadingEmployees")}
          </div>
        ) : (
          <>
            {candidates.length > 7 ? (
              <label className="relative mt-4 block">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchEmployee")}
                  className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white pl-10 pr-4 text-[14.5px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                />
              </label>
            ) : null}
            <div role="radiogroup" aria-label={t("whoStays")} className="mt-4 space-y-2">
              {visible.map((c) => {
                const active = c.id === selected;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSelected(c.id)}
                    data-testid={`billing-keep-${c.id}`}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors duration-150",
                      active
                        ? "border-[#5566f6] bg-[#f5f6ff] ring-4 ring-[#5566f6]/15"
                        : "border-[#ececf4] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                        active ? "bg-[#5566f6] text-white" : "bg-[#eef1ff] text-[#3848c7]"
                      )}
                    >
                      {initials(c.name) || <UserRound className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[14.5px] font-medium text-[#0b1024]">{c.name}</span>
                        {c.isSelf ? (
                          <span className="rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11.5px] font-medium text-[#3848c7]">
                            {t("you")}
                          </span>
                        ) : null}
                        {c.isOwner ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#fff3dd] px-2 py-0.5 text-[11.5px] font-medium text-[#8a5300]">
                            <Crown className="size-3" /> {t("owner")}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-[#6f7282]">
                        {[c.position, multiOrg ? c.organizationName : null].filter(Boolean).join(" · ") ||
                          t("employee")}
                        {!c.canSignIn ? t("cannotSignIn") : ""}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-md border",
                        active ? "border-[#5566f6] bg-[#5566f6] text-white" : "border-[#dcdfed] bg-white"
                      )}
                    >
                      {active ? <Check className="size-3.5" /> : null}
                    </span>
                  </button>
                );
              })}
              {visible.length === 0 ? (
                <p className="py-4 text-center text-[13px] text-[#9b9fb3]">{t("nobodyFound")}</p>
              ) : null}
            </div>
          </>
        )}
      </div>
      <div className="flex shrink-0 gap-2 border-t border-[#ececf4] px-5 py-4 sm:px-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-12 items-center justify-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          <ArrowLeft className="size-4" />
          {backLabel}
        </button>
        <button
          type="button"
          disabled={!chosen}
          onClick={() => setStep(hasJournalStep ? "journal" : "confirm")}
          data-testid="billing-next"
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t("next")}
          <ArrowRight className="size-4" />
        </button>
      </div>
    </>
  );
}
