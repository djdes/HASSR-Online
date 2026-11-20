"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRightLeft, Check, Info, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";

import { BrandLogo } from "@/components/brand/logo";
import { formatDate } from "@/i18n/locales";
import { HOME_HREF } from "@/lib/home-page";
import { cn } from "@/lib/utils";
import {
  approvalBody,
  defaultOwnOrganizations,
  decisionRequest,
  decisionView,
  exchangeError,
  narrowKinds,
  parseDecisionResult,
  parseMoment,
  type DecisionBody,
  type DecisionResult,
  type DecisionState,
  type DecisionView,
  type ExchangeKind,
  keepsRequestOpen,
} from "./exchange-api";
import { ExchangeSummaryView } from "./exchange-result";

// Тот же вид, что у окна «Связать или перенести данные» (`exchange-dialog.tsx`).
const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const OUTLINE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-50";
const DANGER =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#a13a32] px-5 text-[15px] font-medium text-white transition-colors duration-150 hover:bg-[#8b3128] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a13a32]/15 disabled:cursor-not-allowed disabled:opacity-50";
const SECTION_TITLE = "text-[13px] font-medium text-[#3c4053]";
const LIST = "mt-2 divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]";
const ROW = "flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-[#f5f6ff]";
const CHECK = "mt-0.5 size-4 shrink-0 accent-[#5566f6]";
const WARNING =
  "flex items-start gap-2.5 rounded-2xl border border-[#ffd9a8] bg-[#fffaf0] p-3 text-[13px] leading-snug text-[#7a4a00]";
const NOTE =
  "flex items-start gap-2.5 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-3 text-[13px] leading-snug text-[#3c4053]";
const LABEL = "text-[12px] font-medium uppercase tracking-[0.06em] text-[#6f7282]";

/** Раздел, где владелец кабинета видит участников обмена и может их отключить. */
const MASTER_CABINETS_HREF = "/settings/master-cabinet";

/** Что сейчас на странице: загрузка, разбор ответа сервера или итог только что принятого решения. */
export type RequestView =
  | { kind: "loading" }
  | DecisionView
  | { kind: "done"; data: DecisionState; result: DecisionResult };

/** «26 ноября». Страница вне кабинета: пояса организации здесь нет, берём пояс устройства. */
function useDayLabel(): (moment: string | null) => string | null {
  const locale = useLocale();
  return (moment) => {
    const at = parseMoment(moment);
    if (!at) return null;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow";
    return formatDate(locale, at, timeZone, { day: "numeric", month: "long" });
  };
}

/**
 * Страница решения по запросу на обмен справочниками (спека
 * org-exchange-foreign-2026-11-19, Р3–Р4): владелец аккаунта, которому
 * принадлежит мастер-кабинет, открывает ссылку из письма, видит, кто и что
 * просит, отмечает разрешаемые списки (не шире запрошенных), для разового
 * переноса выбирает свою организацию-источник и подтверждает или отклоняет.
 *
 * Оба решения необратимы — данные уходят в другую компанию либо запрос
 * закрывается, — поэтому у каждого свой шаг подтверждения на месте. Страница
 * стоит вне кабинета, всплывающих уведомлений здесь нет: ошибки — в карточке.
 */
export function ExchangeRequestClient({ token }: { token: string }) {
  const t = useTranslations("dashboardUi.directoryExchange.foreign.page");
  const tc = useTranslations("common");
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<RequestView>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    void decisionRequest(token).then((response) => {
      if (alive) setView(decisionView(response, Date.now()));
    });
    return () => {
      alive = false;
    };
  }, [token, attempt]);

  const signedOut = view.kind === "signedOut";
  useEffect(() => {
    // Сессия кончилась, пока страница была открыта, — на вход с возвратом сюда.
    if (!signedOut) return;
    window.location.assign(`/login?next=${encodeURIComponent(`/exchange-request/${encodeURIComponent(token)}`)}`);
  }, [signedOut, token]);

  return (
    <div className="relative z-10 w-full max-w-[520px]">
      <div className="mb-6 flex justify-center">
        <Link href={HOME_HREF} className="text-[#0b1024]" aria-label="WeSetup">
          <BrandLogo height={24} title="" />
        </Link>
      </div>
      <div
        className="rounded-3xl border border-[#dcdfed] bg-white p-5 shadow-[0_20px_50px_-24px_rgba(11,16,36,0.12)] sm:p-8"
        data-testid="exchange-request-card"
        data-state={view.kind}
      >
        {view.kind === "loading" || view.kind === "signedOut" ? (
          <div className="flex items-center gap-2 text-[14px] text-[#6f7282]" role="status">
            <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" aria-hidden />
            {t("loading")}
          </div>
        ) : view.kind === "failed" ? (
          <Message
            tone="warning"
            title={t("title")}
            text={t("loadFailed")}
            action={
              <button
                type="button"
                onClick={() => {
                  setView({ kind: "loading" });
                  setAttempt((value) => value + 1);
                }}
                className={cn(PRIMARY, "w-full")}
              >
                {tc("retry")}
              </button>
            }
          />
        ) : view.kind === "forbidden" ? (
          <Message tone="warning" title={t("forbiddenTitle")} text={t("forbidden")} testId="exchange-request-forbidden" />
        ) : view.kind === "missing" ? (
          <Message tone="warning" title={t("notFoundTitle")} text={t("notFound")} testId="exchange-request-missing" />
        ) : view.kind === "closed" ? (
          <DecisionClosed status={view.status} />
        ) : view.kind === "done" ? (
          <DecisionOutcome data={view.data} result={view.result} />
        ) : (
          <DecisionForm
            // Другой запрос — другая форма: отметки прежнего на него не переносятся.
            key={view.data.request.id}
            token={token}
            data={view.data}
            onView={setView}
          />
        )}
      </div>
    </div>
  );
}

/** Экран без формы: значок, заголовок, пояснение и одно действие (по умолчанию — «Открыть кабинет»). */
function Message({
  tone,
  title,
  text,
  action,
  children,
  testId,
  status,
}: {
  tone: "warning" | "info" | "success";
  title: string;
  text: string;
  action?: ReactNode;
  children?: ReactNode;
  testId?: string;
  status?: string;
}) {
  const t = useTranslations("dashboardUi.directoryExchange.foreign.page");
  const Icon = tone === "warning" ? TriangleAlert : tone === "success" ? Check : Info;
  return (
    <div data-testid={testId} data-status={status}>
      <div
        className={cn(
          "mb-4 inline-flex size-11 items-center justify-center rounded-2xl",
          tone === "warning" ? "bg-[#fffaf0] text-[#b25e00]" : "bg-[#eef1ff] text-[#5566f6]",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </div>
      <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">{title}</h1>
      <p className="mt-2 break-words text-[14px] leading-relaxed text-[#6f7282]">{text}</p>
      {children}
      <div className="mt-6">
        {action ?? (
          <Link href={HOME_HREF} className={cn(OUTLINE, "w-full")}>
            {t("home")}
          </Link>
        )}
      </div>
    </div>
  );
}

/** Запрос уже закрыт: говорим, чем именно он закончился; сервер не сказал — общими словами. */
export function DecisionClosed({ status }: { status: Extract<DecisionView, { kind: "closed" }>["status"] }) {
  const t = useTranslations("dashboardUi.directoryExchange.foreign.page");
  const [title, text] =
    status === "approved"
      ? [t("closedApprovedTitle"), t("closedApprovedText")]
      : status === "declined"
        ? [t("closedDeclinedTitle"), t("closedDeclinedText")]
        : status === "cancelled"
          ? [t("closedCancelledTitle"), t("closedCancelledText")]
          : status === "expired"
            ? [t("closedExpiredTitle"), t("closedExpiredText")]
            : [t("closedTitle"), t("closedText")];
  return (
    <Message
      tone={status === "approved" ? "success" : "info"}
      title={title}
      text={text}
      testId="exchange-request-closed"
      status={status ?? "closed"}
    />
  );
}

/** Итог только что принятого решения; у подтверждения — что создано и обновлено. */
export function DecisionOutcome({ data, result }: { data: DecisionState; result: DecisionResult }) {
  const t = useTranslations("dashboardUi.directoryExchange.foreign.page");
  const name = data.request.requesterName;
  const approved = result.status === "approved";
  const link = data.request.mode === "link";
  const title = !approved ? t("declinedTitle") : link ? t("approvedLinkTitle") : t("approvedTransferTitle");
  const text = !approved
    ? t("declinedText", { name })
    : link
      ? t("approvedLinkText", { name, cabinet: data.cabinet.name })
      : t("approvedTransferText", { name });
  return (
    <Message
      tone={approved ? "success" : "info"}
      title={title}
      text={text}
      testId="exchange-request-outcome"
      status={result.status}
      action={
        // После связи участников видно в «Мастер-кабинетах»: там же компанию можно отключить.
        <Link href={approved && link ? MASTER_CABINETS_HREF : HOME_HREF} className={cn(PRIMARY, "w-full")}>
          {approved && link ? t("manage") : t("home")}
        </Link>
      }
    >
      {result.summary ? (
        <div className="mt-4" data-testid="exchange-request-summary">
          <ExchangeSummaryView summary={result.summary} />
        </div>
      ) : null}
    </Message>
  );
}

/**
 * Форма решения. Отмечены все запрошенные списки — владелец может только
 * сузить выбор. Источник переноса заранее выбран, лишь когда организация
 * одна: из нескольких человек выбирает сам, чтобы не отдать данные не той.
 */
export function DecisionForm({
  token,
  data,
  onView,
}: {
  token: string;
  data: DecisionState;
  onView: (view: RequestView) => void;
}) {
  const t = useTranslations("dashboardUi.directoryExchange");
  const tc = useTranslations("common");
  const dayLabel = useDayLabel();
  const groupName = useId();
  const { request, cabinet, sources } = data;
  const link = request.mode === "link";

  const [chosen, setChosen] = useState<ExchangeKind[]>(request.kinds);
  const [sourceId, setSourceId] = useState(sources.length === 1 ? sources[0].id : "");
  // Связь: какие свои организации будут обмениваться с компанией.
  const [ownIds, setOwnIds] = useState<string[]>(() => defaultOwnOrganizations(data));
  const [confirming, setConfirming] = useState<DecisionBody["decision"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const until = dayLabel(request.expiresAt);
  const allowed = narrowKinds(request.kinds, chosen);
  const approval = approvalBody(data, chosen, sourceId, ownIds);
  const sourceName = sources.find((source) => source.id === sourceId)?.name ?? "";
  const lists = allowed.map((kind) => t(`kinds.${kind}`)).join(", ");
  const noSources = sources.length === 0;
  /** Чего не хватает для подтверждения; `null` — можно подтверждать (или не из чего переносить). */
  const missing =
    allowed.length === 0
      ? t("foreign.page.needList")
      : !approval && !noSources
        ? t(link ? "foreign.page.needOwn" : "foreign.page.needSource")
        : null;

  function toggleKind(kind: ExchangeKind) {
    setChosen((current) => (current.includes(kind) ? current.filter((entry) => entry !== kind) : [...current, kind]));
  }

  async function decide(decision: DecisionBody["decision"]) {
    if (busy) return;
    const body: DecisionBody | null = decision === "approve" ? approval : { decision: "decline" };
    if (!body) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await decisionRequest(token, body);
      if (response.ok) {
        onView({ kind: "done", data, result: parseDecisionResult(response.json, decision) });
        return;
      }
      if (response.status === 401 || response.status === 403) {
        onView(decisionView(response, Date.now()));
        return;
      }
      if (keepsRequestOpen(response)) {
        // Кабинет уже связан с другой компанией или заявитель больше не на платном
        // тарифе: запрос ждёт дальше, форма остаётся — текст сервера объясняет, что делать.
        setNotice(exchangeError(response.json, t("foreign.page.decisionFailed")));
        setConfirming(null);
        return;
      }
      if (response.status === 404 || response.status === 409) {
        // Отказ не всегда значит «ссылка недействительна» или «уже решён»: 404 —
        // это и пропавшая организация-источник, 409 — и кабинет, занятый другим
        // обменом. Если ответ исход не называет, спрашиваем запрос заново и верим ему.
        const refusal = decisionView(response, Date.now());
        const fresh =
          refusal.kind === "closed" && refusal.status !== null
            ? refusal
            : decisionView(await decisionRequest(token), Date.now());
        if (fresh.kind !== "form") {
          onView(fresh);
          return;
        }
      }
      setNotice(exchangeError(response.json, t("foreign.page.decisionFailed")));
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <ArrowRightLeft className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-semibold leading-snug tracking-[-0.01em] text-[#0b1024]">
            {t("foreign.page.title")}
          </h1>
          {until ? (
            <p className="mt-1 text-[13px] leading-[1.5] text-[#6f7282]">{t("foreign.page.validUntil", { date: until })}</p>
          ) : null}
        </div>
      </div>

      <dl className="mt-5 divide-y divide-[#ececf4] rounded-2xl border border-[#ececf4]">
        <div className="px-4 py-3">
          <dt className={LABEL}>{t("foreign.page.requester")}</dt>
          <dd className="mt-1">
            <span className="block break-words text-[15px] font-semibold text-[#0b1024]" data-testid="exchange-request-requester">
              {request.requesterName}
            </span>
            {request.requesterInn ? (
              <span className="mt-0.5 block text-[13px] tabular-nums text-[#6f7282]">
                {t("foreign.page.inn", { inn: request.requesterInn })}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="px-4 py-3">
          <dt className={LABEL}>{t("foreign.page.what")}</dt>
          <dd className="mt-1 break-words text-[14px] font-medium leading-snug text-[#0b1024]" data-testid="exchange-request-mode">
            {link ? t("foreign.page.modeLink", { cabinet: cabinet.name }) : t("foreign.page.modeTransfer")}
          </dd>
        </div>
      </dl>

      <fieldset className="mt-5" disabled={busy || confirming !== null}>
        <legend className={SECTION_TITLE}>{link ? t("foreign.page.kindsLink") : t("foreign.page.kindsTransfer")}</legend>
        <p className="mt-1 text-[12.5px] leading-[1.5] text-[#6f7282]">{t("foreign.page.kindsHint")}</p>
        <ul className={LIST}>
          {request.kinds.map((kind) => {
            const checked = chosen.includes(kind);
            return (
              <li key={kind}>
                <label className={cn(ROW, checked && "bg-[#fafbff]")}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleKind(kind)}
                    className={CHECK}
                    data-testid={`exchange-request-kind-${kind}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-[#0b1024]">{t(`kinds.${kind}`)}</span>
                    <span className="mt-0.5 block text-[12px] leading-[1.45] text-[#6f7282]">
                      {t(`foreign.kindHints.${kind}`)}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {noSources ? (
        <div className={cn(WARNING, "mt-5")} role="alert">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#b25e00]" aria-hidden />
          <span className="min-w-0 flex-1">{t(link ? "foreign.page.noOwn" : "foreign.page.noSources")}</span>
        </div>
      ) : link ? (
        <fieldset className="mt-5" disabled={busy || confirming !== null}>
          <legend className={SECTION_TITLE}>{t("foreign.page.own")}</legend>
          <p className="mt-1 text-[12.5px] leading-[1.45] text-[#6f7282]">{t("foreign.page.ownHint")}</p>
          <ul className={LIST}>
            {sources.map((source) => {
              const checked = ownIds.includes(source.id);
              return (
                <li key={source.id}>
                  <label className={cn(ROW, checked && "bg-[#fafbff]")}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setOwnIds((current) =>
                          current.includes(source.id) ? current.filter((id) => id !== source.id) : [...current, source.id],
                        )
                      }
                      className={CHECK}
                      data-testid="exchange-request-own"
                      data-organization-id={source.id}
                    />
                    <span className="min-w-0 flex-1 break-words text-[14px] font-medium text-[#0b1024]">{source.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : (
        <fieldset className="mt-5" disabled={busy || confirming !== null}>
          <legend className={SECTION_TITLE}>{t("foreign.page.source")}</legend>
          <ul className={LIST}>
            {sources.map((source) => {
              const checked = sourceId === source.id;
              return (
                <li key={source.id}>
                  <label className={cn(ROW, checked && "bg-[#fafbff]")}>
                    <input
                      type="radio"
                      name={`${groupName}-source`}
                      checked={checked}
                      onChange={() => setSourceId(source.id)}
                      className={CHECK}
                      data-testid="exchange-request-source"
                      data-organization-id={source.id}
                    />
                    <span className="min-w-0 flex-1 break-words text-[14px] font-medium text-[#0b1024]">{source.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      <div className={cn(NOTE, "mt-5")} data-testid="exchange-request-rules">
        <Info className="mt-0.5 size-4 shrink-0 text-[#5566f6]" aria-hidden />
        <span className="min-w-0 flex-1 break-words">
          {link
            ? t("foreign.page.linkNote", { name: request.requesterName, cabinet: cabinet.name })
            : t("foreign.page.transferNote", { name: request.requesterName })}
          {/* Что будет дальше — теми же правилами, по которым работает обмен (спека, уточнения 2026-11-20). */}
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            {(link
              ? [
                  t("foreign.page.ruleNewRecords"),
                  t("foreign.page.ruleEdits", { name: request.requesterName }),
                  t("foreign.page.staffRule"),
                  t("foreign.page.ruleOneCompany"),
                  t("foreign.page.ruleDisconnect"),
                ]
              : [t("foreign.page.staffRule")]
            ).map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </span>
      </div>
      <div className={cn(NOTE, "mt-2")}>
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#5566f6]" aria-hidden />
        <span className="min-w-0 flex-1">{t("foreign.page.neverPassed")}</span>
      </div>

      {notice ? (
        <div className={cn(WARNING, "mt-4")} role="alert" data-testid="exchange-request-error">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#b25e00]" aria-hidden />
          <span className="min-w-0 flex-1 break-words">{notice}</span>
        </div>
      ) : null}

      {confirming === null ? (
        <div className="mt-6">
          {missing ? <p className="mb-2 text-[12.5px] leading-[1.45] text-[#6f7282]">{missing}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setConfirming("decline")}
              className={OUTLINE}
              data-testid="exchange-request-decline"
            >
              {t("foreign.page.decline")}
            </button>
            <button
              type="button"
              onClick={() => setConfirming("approve")}
              disabled={!approval}
              className={PRIMARY}
              data-testid="exchange-request-approve"
            >
              {t("foreign.page.approve")}
            </button>
          </div>
        </div>
      ) : (
        // Шаг подтверждения на месте: что именно произойдёт, названо ещё раз перед необратимым действием.
        <div
          className={cn(
            "mt-6 rounded-2xl border p-4",
            confirming === "approve" ? "border-[#dcdfed] bg-[#fafbff]" : "border-[#ffd2cd] bg-[#fff4f2]",
          )}
          role="group"
          aria-label={confirming === "approve" ? t("foreign.page.approve") : t("foreign.page.decline")}
          data-testid="exchange-request-confirm"
        >
          <p
            className={cn(
              "break-words text-[14px] font-medium leading-snug",
              confirming === "approve" ? "text-[#0b1024]" : "text-[#a13a32]",
            )}
          >
            {confirming === "decline"
              ? t("foreign.page.confirmDecline", { name: request.requesterName })
              : link
                ? t("foreign.page.confirmLink", { name: request.requesterName, cabinet: cabinet.name, lists })
                : t("foreign.page.confirmTransfer", { name: request.requesterName, source: sourceName, lists })}
          </p>
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setConfirming(null)} disabled={busy} autoFocus className={OUTLINE}>
              {tc("back")}
            </button>
            <button
              type="button"
              onClick={() => void decide(confirming)}
              disabled={busy || (confirming === "approve" && !approval)}
              className={confirming === "approve" ? PRIMARY : DANGER}
              data-testid={confirming === "approve" ? "exchange-request-approve-confirm" : "exchange-request-decline-confirm"}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {confirming === "approve" ? t("foreign.page.confirmApproveAction") : t("foreign.page.confirmDeclineAction")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
