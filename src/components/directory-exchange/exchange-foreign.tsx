"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Building2, Clock, Link2, Link2Off, Loader2, Mail, Send, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { useOrgTimeZone } from "@/components/shared/org-time-zone";
import { formatDate } from "@/i18n/locales";
import { BILLING_PAY_HREF } from "@/lib/billing-period";
import { normalizeServiceCode } from "@/lib/dish-pool-code";
import { isInsideMobileApp } from "@/lib/mobile-app";
import { cn } from "@/lib/utils";
import {
  EXCHANGE_KINDS,
  EXCHANGE_REQUESTS_PATH,
  creationRefusal,
  exchangeError,
  exchangeRequest,
  loadForeignState,
  parseForeignRequest,
  parseMoment,
  pendingRequests,
  removeForeign,
  withOutgoing,
  withoutForeign,
  type ExchangeKind,
  type ExchangeMode,
  type ForeignLink,
  type ForeignMember,
  type ForeignRequest,
  type ForeignState,
  type IncomingRequest,
} from "./exchange-api";

/**
 * Обмен справочниками с чужим аккаунтом (спека org-exchange-foreign-2026-11-19):
 * части окна «Связать или перенести данные» и карточки «Обмен справочниками».
 *
 * Заявитель вводит код мастер-кабинета другой компании и ждёт решения её
 * владельца; о той стороне он видит только название кабинета, которое вернул
 * сервер. Владелец кабинета видит входящие запросы (открывает их отсюда или
 * по ссылке из письма) и участников из других аккаунтов.
 *
 * Что обещаем заявителю — ровно то, что делает сервер: списки разрешает
 * владелец кабинета; новые записи появляются у обеих компаний, а правки идут
 * только от организаций владельца; людей с одинаковым ФИО не объединяют.
 */

// Тот же вид, что у окна и карточки обмена (`exchange-dialog.tsx`, `exchange-card.tsx`).
const SECTION_TITLE = "text-[13px] font-medium text-[#3c4053]";
const STATUS =
  "flex items-center gap-2 rounded-2xl border border-[#ececf4] px-4 py-3 text-[13px] leading-[1.5] text-[#6f7282]";
const WARNING =
  "flex items-start gap-2.5 rounded-2xl border border-[#ffd9a8] bg-[#fffaf0] p-3 text-[13px] leading-snug text-[#7a4a00]";
const ROW_BOX = "rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3";
const ROW_ICON = "flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f5f6ff] text-[#5566f6]";
const CHIP = "rounded-full border border-[#dcdfed] bg-white px-2.5 py-0.5 text-[12px] font-medium text-[#3c4053]";
const TEXT_BUTTON =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const DANGER_TEXT_BUTTON =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a13a32]/15 disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_OUTLINE =
  "inline-flex h-9 items-center justify-center rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-50";
const SMALL_DANGER =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-[#a13a32] px-3 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#8b3128] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a13a32]/15 disabled:cursor-not-allowed disabled:opacity-50";
const SEND_BUTTON =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#eef1ff] px-4 text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#e2e7ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";

/** Образец кода мастер-кабинета (`dish-pool-code.ts`): подсказка в пустом поле. */
const CODE_SAMPLE = "ABCDE-FGH23";

/** «26 ноября» по часовому поясу организации; даты нет или она не читается — `null`. */
export function useDayLabel(): (moment: string | null) => string | null {
  const locale = useLocale();
  const timeZone = useOrgTimeZone();
  return (moment) => {
    const at = parseMoment(moment);
    return at ? formatDate(locale, at, timeZone, { day: "numeric", month: "long" }) : null;
  };
}

/**
 * Шаг подтверждения на месте: выйти из обмена и отключить участника —
 * действия, которые одним случайным нажатием делать нельзя. Фокус встаёт на
 * «Отмена»: Enter сразу после нажатия ничего не разорвёт.
 */
export function ConfirmStep({
  text,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
  testId,
}: {
  text: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testId: string;
}) {
  const tc = useTranslations("common");
  return (
    <div className="mt-2 rounded-xl border border-[#ffd2cd] bg-[#fff4f2] p-3" role="group" aria-label={confirmLabel}>
      <p className="text-[13px] leading-snug text-[#a13a32]">{text}</p>
      <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} disabled={busy} autoFocus className={SMALL_OUTLINE}>
          {tc("cancel")}
        </button>
        <button type="button" onClick={onConfirm} disabled={busy} className={SMALL_DANGER} data-testid={testId}>
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

/** Короткий список правил обмена: по строке на правило. */
function RuleList({ rules, className }: { rules: readonly string[]; className?: string }) {
  return (
    <ul className={cn("space-y-1 text-[12.5px] leading-[1.45] text-[#6f7282]", className)}>
      {rules.map((rule, index) => (
        <li key={index} className="flex items-start gap-2">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#9b9fb3]" aria-hidden />
          <span className="min-w-0 flex-1">{rule}</span>
        </li>
      ))}
    </ul>
  );
}

/** Запрос ждёт решения владельца кабинета: кому отправлен, до какого числа, «Отменить запрос». */
function PendingRow({
  request,
  disabled,
  onRemoved,
}: {
  request: ForeignRequest;
  disabled: boolean;
  onRemoved: (id: string) => void;
}) {
  const t = useTranslations("dashboardUi.directoryExchange");
  const dayLabel = useDayLabel();
  const [busy, setBusy] = useState(false);
  const date = dayLabel(request.expiresAt);
  const lists = request.kinds.map((kind) => t(`kinds.${kind}`)).join(", ");

  async function cancel() {
    if (busy) return;
    setBusy(true);
    try {
      const { ok, json } = await removeForeign(request.id);
      if (!ok) {
        toast.error(exchangeError(json, t("foreign.cancelFailed")));
        return;
      }
      toast.success(t("foreign.cancelled"));
      onRemoved(request.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={ROW_BOX} data-testid="exchange-foreign-pending" data-request-id={request.id}>
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 basis-[240px] items-start gap-2.5">
          <Clock className="mt-0.5 size-4 shrink-0 text-[#5566f6]" aria-hidden />
          <div className="min-w-0">
            <p className="break-words text-[13.5px] font-medium leading-snug text-[#0b1024]">
              {date
                ? t("foreign.pending", { name: request.cabinetName, date })
                : t("foreign.pendingNoDate", { name: request.cabinetName })}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-[1.45] text-[#6f7282]">
              {request.mode === "link" ? t("foreign.requestedLink", { lists }) : t("foreign.requestedTransfer", { lists })}
            </p>
            {/* Запрошенное — ещё не разрешённое: решает владелец кабинета. */}
            <p className="mt-0.5 text-[12.5px] leading-[1.45] text-[#6f7282]">
              {request.mode === "link" ? t("foreign.rules.decides") : t("foreign.rules.transferDecides")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void cancel()}
          disabled={disabled || busy}
          className={TEXT_BUTTON}
          data-testid="exchange-foreign-cancel"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          {t("foreign.cancel")}
        </button>
      </div>
    </li>
  );
}

/** Подтверждённая связь с кабинетом другой компании: какими списками и «Выйти из обмена». */
function LinkedRow({
  link,
  disabled,
  onRemoved,
}: {
  link: ForeignLink;
  disabled: boolean;
  onRemoved: (id: string) => void;
}) {
  const t = useTranslations("dashboardUi.directoryExchange");
  const dayLabel = useDayLabel();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const since = dayLabel(link.since);
  const lists = link.kinds.map((kind) => t(`kinds.${kind}`)).join(", ");

  async function leave() {
    if (busy) return;
    setBusy(true);
    try {
      const { ok, json } = await removeForeign(link.id);
      if (!ok) {
        toast.error(exchangeError(json, t("foreign.leaveFailed")));
        return;
      }
      toast.success(t("foreign.left", { name: link.cabinetName }));
      onRemoved(link.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={ROW_BOX} data-testid="exchange-foreign-linked" data-link-id={link.id}>
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 basis-[240px] items-start gap-2.5">
          <Link2 className="mt-0.5 size-4 shrink-0 text-[#5566f6]" aria-hidden />
          <div className="min-w-0">
            <p className="break-words text-[13.5px] font-medium leading-snug text-[#0b1024]">
              {lists
                ? t("foreign.linked", { name: link.cabinetName, lists })
                : t("foreign.linkedPlain", { name: link.cabinetName })}
            </p>
            {since ? (
              <p className="mt-0.5 text-[12.5px] leading-[1.45] text-[#6f7282]">{t("foreign.since", { date: since })}</p>
            ) : null}
          </div>
        </div>
        {confirming ? null : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={disabled}
            className={DANGER_TEXT_BUTTON}
            data-testid="exchange-foreign-leave"
          >
            {t("foreign.leave")}
          </button>
        )}
      </div>
      {/* Как идёт обмен с кабинетом другой компании: правки — только от его владельца. */}
      <RuleList
        className="mt-2"
        rules={[
          t("foreign.rules.newRecords"),
          t("foreign.rules.edits"),
          ...(link.kinds.includes("staff") ? [t("foreign.rules.staff")] : []),
          t("foreign.rules.leave"),
        ]}
      />
      {confirming ? (
        <ConfirmStep
          text={t("foreign.leaveConfirm", { name: link.cabinetName })}
          confirmLabel={t("foreign.leave")}
          busy={busy}
          onConfirm={() => void leave()}
          onCancel={() => setConfirming(false)}
          testId="exchange-foreign-leave-confirm"
        />
      ) : null}
    </li>
  );
}

/**
 * Что у организации есть с другими компаниями: запросы, которые ждут решения,
 * и подтверждённые связи. Нет ни того, ни другого — ничего не рисуем.
 */
export function ForeignOutgoing({
  foreign,
  disabled = false,
  onRemoved,
  className,
}: {
  foreign: Pick<ForeignState, "outgoing" | "foreignLinks">;
  disabled?: boolean;
  /** Запрос отменён или связь разорвана: запись пора убрать и перечитать состояние. */
  onRemoved: (id: string) => void;
  className?: string;
}) {
  const pending = pendingRequests(foreign);
  if (pending.length === 0 && foreign.foreignLinks.length === 0) return null;
  return (
    <ul className={cn("space-y-2", className)}>
      {pending.map((request) => (
        <PendingRow key={request.id} request={request} disabled={disabled} onRemoved={onRemoved} />
      ))}
      {foreign.foreignLinks.map((link) => (
        <LinkedRow key={link.id} link={link} disabled={disabled} onRemoved={onRemoved} />
      ))}
    </ul>
  );
}

/**
 * Блок «Другая компания» окна «Связать или перенести данные»: код
 * мастер-кабинета и «Отправить запрос» со способом и списками, которые
 * сейчас выбраны в окне. Пока запрос ждёт решения, вместо поля — строка
 * «Ожидает подтверждения…» с отменой.
 *
 * Enter в поле кода отправляет запрос и не доходит до формы окна: её кнопка
 * связывает или переносит данные своих организаций, а это не отменить.
 */
export function ForeignBlock({
  mode,
  kinds,
  disabled,
  onChanged,
  onLoaded,
  onDraftChange,
  onNavigate,
  className,
}: {
  mode: ExchangeMode;
  kinds: readonly ExchangeKind[];
  /** Окно занято своим сохранением. */
  disabled: boolean;
  /** Запрос отправлен или отменён, связь разорвана. */
  onChanged: () => void;
  /** Состояние запросов прочитано или изменилось. */
  onLoaded?: (state: ForeignState) => void;
  /** В поле кода есть текст, который ещё не отправлен. */
  onDraftChange?: (draft: boolean) => void;
  /** Переход на страницу тарифа: окно пора закрыть. */
  onNavigate?: () => void;
  className?: string;
}) {
  const t = useTranslations("dashboardUi.directoryExchange");
  const tc = useTranslations("common");
  const inputId = useId();
  const [attempt, setAttempt] = useState(0);
  const [foreign, setForeign] = useState<ForeignState | null>(null);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  // Отказ, который остаётся в блоке: из-за тарифа (со ссылкой на страницу тарифа)
  // или потому, что этот кабинет недавно отклонил запрос (новый — через 7 дней).
  const [refusal, setRefusal] = useState<{ text: string; pay: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    void loadForeignState().then((next) => {
      if (!alive) return;
      // Не удалось перечитать — оставляем то, что уже показано.
      if (next) setForeign(next);
      setFailed(next === null);
    });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const waiting = foreign ? pendingRequests(foreign).length > 0 : false;
  const chosen = EXCHANGE_KINDS.filter((kind) => kinds.includes(kind));
  const typed = code.trim() !== "";
  const canSend = !disabled && !sending && typed && chosen.length > 0;
  // Черновик — код в поле, которое сейчас видно: пока запрос ждёт решения, поля нет.
  const draft = typed && foreign !== null && !waiting;

  // Окно пересоздаёт обработчики на каждый рендер; сообщаем ему только о переменах.
  const listeners = useRef({ onLoaded, onDraftChange });
  useEffect(() => {
    listeners.current = { onLoaded, onDraftChange };
  });
  useEffect(() => {
    if (foreign) listeners.current.onLoaded?.(foreign);
  }, [foreign]);
  useEffect(() => {
    listeners.current.onDraftChange?.(draft);
  }, [draft]);

  function removed(id: string) {
    setForeign((current) => (current ? withoutForeign(current, id) : current));
    setAttempt((value) => value + 1);
    onChanged();
  }

  async function send() {
    if (!canSend) return;
    const normalized = normalizeServiceCode(code);
    if (!normalized) {
      toast.error(t("foreign.codeInvalid"));
      return;
    }
    setSending(true);
    setRefusal(null);
    try {
      const response = await exchangeRequest(EXCHANGE_REQUESTS_PATH, {
        method: "POST",
        body: { code: normalized, mode, kinds: chosen },
      });
      const { json } = response;
      if (!response.ok) {
        const shown = creationRefusal(response);
        if (shown === "plan") {
          // Нужен платный тариф или организация закрыта до оплаты: сервер прикладывает ссылку на оплату.
          setRefusal({ text: exchangeError(json, t("foreign.paidOnly")), pay: true });
        } else if (shown === "inline") {
          // Кабинет недавно отклонил запрос этой организации: срок назван в тексте сервера.
          setRefusal({ text: exchangeError(json, t("foreign.sendFailed")), pay: false });
        } else {
          toast.error(exchangeError(json, t("foreign.sendFailed")));
        }
        // 409 — в том числе «запрос уже отправлен»: перечитываем, чтобы строка ожидания появилась.
        if (response.status === 409) setAttempt((value) => value + 1);
        return;
      }
      const request = parseForeignRequest(json?.request);
      setCode("");
      toast.success(t("foreign.sent"));
      if (request) {
        setForeign((current) =>
          withOutgoing(current ?? { outgoing: [], foreignLinks: [], incoming: [], foreignMembers: [] }, request),
        );
      }
      setAttempt((value) => value + 1);
      onChanged();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={className} data-testid="exchange-foreign">
      <div className={SECTION_TITLE}>{t("foreign.title")}</div>
      <p className="mt-1 text-[12.5px] leading-[1.5] text-[#6f7282]">{t("foreign.description")}</p>
      {!foreign ? (
        failed ? (
          <div className={cn(WARNING, "mt-2")} role="alert">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#b25e00]" aria-hidden />
            <span className="min-w-0 flex-1">{t("foreign.loadFailed")}</span>
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                setAttempt((value) => value + 1);
              }}
              className="shrink-0 font-medium text-[#3848c7] underline underline-offset-2"
            >
              {tc("retry")}
            </button>
          </div>
        ) : (
          <div className={cn(STATUS, "mt-2")}>
            <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" aria-hidden />
            {t("foreign.loading")}
          </div>
        )
      ) : (
        <>
          <ForeignOutgoing foreign={foreign} disabled={disabled || sending} onRemoved={removed} className="mt-2" />
          {waiting ? null : (
            <div className="mt-2">
              <label htmlFor={inputId} className="block text-[12.5px] font-medium text-[#3c4053]">
                {t("foreign.codeLabel")}
              </label>
              <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                <input
                  id={inputId}
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="send"
                  maxLength={24}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                    // Отказ относился к прежнему коду; отказ из-за тарифа от кода не зависит.
                    setRefusal((current) => (current?.pay ? current : null));
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    // Enter отправляет запрос, а не форму окна: её действие не отменить.
                    event.preventDefault();
                    void send();
                  }}
                  disabled={disabled || sending}
                  placeholder={CODE_SAMPLE}
                  // Заглавные — стилем, а не заменой текста: при правке середины кода курсор не прыгает в конец.
                  className="h-11 min-w-0 flex-1 rounded-2xl border border-[#dcdfed] bg-white px-4 font-mono text-[16px] uppercase tracking-wide text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60"
                  data-testid="exchange-foreign-code"
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={!canSend}
                  className={SEND_BUTTON}
                  data-testid="exchange-foreign-send"
                >
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Send className="size-4" aria-hidden />
                  )}
                  {t("foreign.send")}
                </button>
              </div>
              {typed && chosen.length === 0 ? (
                <p className="mt-1.5 text-[12.5px] leading-[1.45] text-[#7a4a00]">{t("foreign.needList")}</p>
              ) : null}
              {refusal ? (
                <div
                  className={cn(WARNING, "mt-2")}
                  role="alert"
                  data-testid={refusal.pay ? "exchange-foreign-plan-note" : "exchange-foreign-refusal"}
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#b25e00]" aria-hidden />
                  <span className="min-w-0 flex-1">
                    {refusal.text}
                    {/* В приложении WeSetup к оплате не зовём (правила сторов) — там только текст. */}
                    {!refusal.pay || isInsideMobileApp() ? null : (
                      <>
                        {" "}
                        <Link
                          href={BILLING_PAY_HREF}
                          onClick={onNavigate}
                          className="font-medium text-[#3848c7] underline underline-offset-2"
                        >
                          {t("result.limitLink")}
                        </Link>
                      </>
                    )}
                  </span>
                </div>
              ) : null}
              {/* Что получит заявитель — теми же словами, что делает сервер: решает владелец
                  кабинета, правки идут только от него, людей по ФИО не объединяют. */}
              <div className={cn(ROW_BOX, "mt-2")} data-testid="exchange-foreign-rules" data-mode={mode}>
                <RuleList
                  className="text-[#3c4053]"
                  rules={
                    mode === "link"
                      ? [
                          t("foreign.rules.decides"),
                          t("foreign.rules.newRecords"),
                          t("foreign.rules.edits"),
                          t("foreign.rules.staff"),
                          t("foreign.rules.leave"),
                        ]
                      : [
                          t("foreign.rules.transferDecides"),
                          t("foreign.rules.transferOnce"),
                          t("foreign.rules.transferDuplicates"),
                          t("foreign.rules.staff"),
                        ]
                  }
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Входящие запросы в карточке владельца кабинета: кто, что просит и до какого
 * числа. «Открыть запрос» ведёт на страницу решения по id запроса — сервер
 * отдаёт её владельцу аккаунта кабинета и без токена из письма.
 */
export function IncomingRequests({ incoming, className }: { incoming: IncomingRequest[]; className?: string }) {
  const t = useTranslations("dashboardUi.directoryExchange");
  const dayLabel = useDayLabel();
  if (incoming.length === 0) return null;
  return (
    <div className={className} data-testid="exchange-incoming">
      <div className={SECTION_TITLE}>{t("foreign.card.incomingTitle")}</div>
      <ul className="mt-2 divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]">
        {incoming.map((request) => {
          const lists = request.kinds.map((kind) => t(`kinds.${kind}`)).join(", ");
          const until = dayLabel(request.expiresAt);
          const details = [
            request.mode === "link" ? t("foreign.requestedLink", { lists }) : t("foreign.requestedTransfer", { lists }),
            until ? t("foreign.validUntil", { date: until }) : null,
          ].filter((part) => part !== null);
          return (
            <li
              key={request.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
              data-testid="exchange-incoming-request"
              data-request-id={request.id}
            >
              <span className={ROW_ICON}>
                <Building2 className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 basis-[220px]">
                <span className="block break-words text-[14px] font-medium text-[#0b1024]">{request.requesterName}</span>
                <span className="mt-0.5 block text-[12.5px] leading-[1.45] text-[#6f7282]">{details.join(" · ")}</span>
                <span className="mt-1 flex items-center gap-1.5 text-[12.5px] leading-[1.45] text-[#6f7282]">
                  <Mail className="size-3.5 shrink-0 text-[#5566f6]" aria-hidden />
                  {t("foreign.card.incomingEmailNote")}
                </span>
              </span>
              <Link
                href={`/exchange-request/${encodeURIComponent(request.id)}`}
                // Страница решения вне кабинета: заранее её не подгружаем.
                prefetch={false}
                aria-label={`${t("foreign.card.incomingOpen")}: ${request.requesterName}`}
                className={cn(SMALL_OUTLINE, "shrink-0")}
                data-testid="exchange-incoming-open"
              >
                {t("foreign.card.incomingOpen")}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Участник обмена из другого аккаунта: пометка «другой аккаунт» и «Отключить» с подтверждением. */
export function ForeignMemberRow({
  member,
  onRemoved,
}: {
  member: ForeignMember;
  onRemoved: (id: string) => void;
}) {
  const t = useTranslations("dashboardUi.directoryExchange");
  const dayLabel = useDayLabel();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const since = dayLabel(member.since);

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    try {
      const { ok, json } = await removeForeign(member.id);
      if (!ok) {
        toast.error(exchangeError(json, t("foreign.card.disconnectFailed")));
        return;
      }
      toast.success(t("foreign.card.disconnected", { name: member.name }));
      onRemoved(member.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-4 py-3" data-testid="exchange-foreign-member" data-organization-id={member.organizationId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={ROW_ICON}>
          <Building2 className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 basis-[220px]">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 break-words text-[14px] font-medium text-[#0b1024]">{member.name}</span>
            <span className="rounded-full border border-[#ffd9a8] bg-[#fffaf0] px-2.5 py-0.5 text-[12px] font-medium text-[#7a4a00]">
              {t("foreign.card.otherAccount")}
            </span>
          </span>
          {since ? (
            <span className="mt-0.5 block text-[12.5px] leading-[1.45] text-[#6f7282]">
              {t("foreign.since", { date: since })}
            </span>
          ) : null}
        </span>
        <span className="flex flex-wrap gap-1.5">
          {member.kinds.map((kind) => (
            <span key={kind} className={CHIP}>
              {t(`kinds.${kind}`)}
            </span>
          ))}
        </span>
        {confirming ? null : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={DANGER_TEXT_BUTTON}
            data-testid="exchange-foreign-disconnect"
          >
            <Link2Off className="size-3.5" aria-hidden />
            {t("foreign.card.disconnect")}
          </button>
        )}
      </div>
      {confirming ? (
        <ConfirmStep
          text={t("foreign.card.disconnectConfirm", { name: member.name })}
          confirmLabel={t("foreign.card.disconnect")}
          busy={busy}
          onConfirm={() => void disconnect()}
          onCancel={() => setConfirming(false)}
          testId="exchange-foreign-disconnect-confirm"
        />
      ) : null}
    </li>
  );
}
