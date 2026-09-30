"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
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
import { employeesLabel } from "@/lib/plan-catalog";
import { cn } from "@/lib/utils";

/**
 * Окно «Бесплатный период подписки закончился» — руководителю с правом на
 * тариф, на любой странице кабинета, пока он не решит: оплатить подписку
 * или перейти на бесплатный (1 сотрудник, остальные — в архив).
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

type Step = "overview" | "choose" | "confirm";

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
            payLabel="Оплатить картой"
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
              backLabel="Отмена"
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
        Перейти на бесплатный
      </button>
      {open ? (
        <ModalShell onClose={() => setOpen(false)} closable>
          <Chooser
            onBack={() => setOpen(false)}
            onDone={() => setOpen(false)}
            backLabel="Отмена"
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
            aria-label="Закрыть"
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
  const [step, setStep] = useState<"overview" | "choose">("overview");
  if (step === "choose") {
    return <Chooser onBack={() => setStep("overview")} onDone={onLater} backLabel="Назад" />;
  }
  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 pb-5 pt-6 sm:px-6">
        <OverviewBody
          copy={copy}
          payHref={payHref}
          payLabel="Оплатить подписку"
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
            Решу позже
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
                  <PromoPrice price={copy.payPrice} size="sm" suffix="/мес" />
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

/** Шаги «кто остаётся» → «подтвердите». Список грузится с сервера. */
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
  const router = useRouter();
  const [step, setStep] = useState<Exclude<Step, "overview">>("choose");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [multiOrg, setMultiOrg] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/settings/subscription/transition", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error ?? "Не удалось загрузить сотрудников");
      const list = (data.candidates ?? []) as Candidate[];
      setCandidates(list);
      setMultiOrg(data.multiOrg === true);
      // По умолчанию остаётся сам руководитель, потом владелец.
      const preferred = list.find((c) => c.isSelf) ?? list.find((c) => c.isOwner) ?? list[0];
      setSelected((current) => current ?? preferred?.id ?? null);
      // Выбирать не из кого — сразу подтверждение.
      if (list.length === 1) setStep("confirm");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Не удалось загрузить сотрудников");
    }
  }, []);

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

  const chosen = candidates?.find((c) => c.id === selected) ?? null;
  const others = candidates?.filter((c) => c.id !== selected) ?? [];

  async function submit() {
    if (!chosen) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings/subscription/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(voluntary ? { keepUserId: chosen.id, voluntary: true } : { keepUserId: chosen.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Не удалось перейти на бесплатный тариф");
      toast.success(
        data.archivedCount > 0
          ? `Готово: бесплатный тариф. В архиве: ${employeesLabel(data.archivedCount)}`
          : "Готово: бесплатный тариф"
      );
      if (data.selfArchived) {
        // Руководитель оставил другого — его сессия уже завершена.
        await signOutAndOpen("/login").catch(() => window.location.replace("/login"));
        return;
      }
      onDone();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось перейти на бесплатный тариф");
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
            Перейти на бесплатный тариф?
          </h2>
          <ul className="mt-4 space-y-2.5 text-[14px] leading-[1.55] text-[#3c4053]">
            <li className="flex gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-[#116b2a]" />
              <span>
                В работе останется: <strong className="text-[#0b1024]">{chosen.name}</strong>
              </span>
            </li>
            {others.length > 0 ? (
            <li className="flex gap-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#b25f00]" />
              <span data-testid="billing-archive-list">
                В архив перейдут: {employeesLabel(others.length)}
                {preview.length ? ` — ${preview.join(", ")}${rest > 0 ? ` и ещё ${rest}` : ""}` : ""}. Они
                не смогут входить в кабинет и приложение, их записи в журналах сохранятся.
              </span>
            </li>
            ) : null}
            {others.length > 0 ? (
            <li className="flex gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-[#3848c7]" />
              <span>Вернуть их можно после оплаты подписки: «Сотрудники» → «Архив».</span>
            </li>
            ) : null}
          </ul>
          {paidUntilLabel ? (
            <p
              data-testid="billing-paid-term-warning"
              className="mt-4 rounded-2xl bg-[#fff8eb] px-4 py-3 text-[13.5px] leading-[1.55] text-[#7a4a00]"
            >
              Подписка оплачена до {paidUntilLabel}. При переходе на бесплатный оплаченный срок не
              сохранится, автопродление выключится. Вернуть деньги за неиспользованные дни можно по
              заявлению на{" "}
              <a href="mailto:support@wesetup.ru" className="underline underline-offset-2">
                support@wesetup.ru
              </a>{" "}
              —{" "}
              <a href="/oferta" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                п. 6.2 оферты
              </a>
              .
            </p>
          ) : null}
          {!chosen.isSelf ? (
            <p className="mt-4 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13.5px] leading-[1.55] text-[#a13a32]">
              Вы тоже перейдёте в архив и сразу выйдете из кабинета.
            </p>
          ) : null}
          {!chosen.canSignIn ? (
            <p className="mt-3 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13.5px] leading-[1.55] text-[#a13a32]">
              У «{chosen.name}» нет пароля и Telegram — войти в кабинет будет некому. Лучше оставить
              себя.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-[#ececf4] px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => setStep("choose")}
            disabled={busy}
            className="inline-flex h-12 items-center justify-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
          >
            <ArrowLeft className="size-4" />
            Назад
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            data-testid="billing-confirm-free"
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#e5484d] px-5 text-[15px] font-medium text-white shadow-[0_12px_30px_-14px_rgba(229,72,77,0.75)] transition-colors duration-150 hover:bg-[#d93d42] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Перейти на бесплатный
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
          Кто остаётся на бесплатном тарифе
        </h2>
        <p className="mt-2 text-[13.5px] leading-[1.55] text-[#6f7282]">
          Бесплатный тариф — {employeesLabel(1)}. Остальные перейдут в архив; вернуть их можно после
          оплаты подписки.
        </p>

        {loadError ? (
          <div className="mt-4 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13.5px] text-[#a13a32]">
            {loadError}{" "}
            <button type="button" onClick={() => void load()} className="font-medium underline underline-offset-2">
              Повторить
            </button>
          </div>
        ) : !candidates ? (
          <div className="mt-6 flex items-center justify-center gap-2 py-6 text-[13.5px] text-[#6f7282]">
            <Loader2 className="size-4 animate-spin" /> Загружаем сотрудников…
          </div>
        ) : (
          <>
            {candidates.length > 7 ? (
              <label className="relative mt-4 block">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Найти сотрудника"
                  className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white pl-10 pr-4 text-[14.5px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                />
              </label>
            ) : null}
            <div role="radiogroup" aria-label="Кто остаётся" className="mt-4 space-y-2">
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
                            Вы
                          </span>
                        ) : null}
                        {c.isOwner ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#fff3dd] px-2 py-0.5 text-[11.5px] font-medium text-[#8a5300]">
                            <Crown className="size-3" /> Владелец
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-[#6f7282]">
                        {[c.position, multiOrg ? c.organizationName : null].filter(Boolean).join(" · ") ||
                          "Сотрудник"}
                        {!c.canSignIn ? " · не может войти в кабинет" : ""}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border",
                        active ? "border-[#5566f6] bg-[#5566f6] text-white" : "border-[#dcdfed]"
                      )}
                    >
                      {active ? <Check className="size-3" /> : null}
                    </span>
                  </button>
                );
              })}
              {visible.length === 0 ? (
                <p className="py-4 text-center text-[13px] text-[#9b9fb3]">Никого не нашли</p>
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
          onClick={() => setStep("confirm")}
          data-testid="billing-next"
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Далее
          <ArrowRight className="size-4" />
        </button>
      </div>
    </>
  );
}
