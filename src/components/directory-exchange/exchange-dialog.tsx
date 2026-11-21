"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { ArrowRightLeft, Check, ChevronDown, Info, Loader2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

import { BodyScrollLock } from "@/lib/use-body-scroll-lock";
import { cn } from "@/lib/utils";
import {
  EXCHANGE_KINDS,
  SINGLE_RECORD_KINDS,
  exchangeError,
  exchangeRequest,
  isExchangeRunning,
  kindRecord,
  linkMembers,
  loadExchangeState,
  parseSummary,
  parseTransferItems,
  summaryTotals,
  togglePicked,
  transferSelection,
  transferableIds,
  type ExchangeCounts,
  type ExchangeKind,
  type ExchangeMode,
  type ExchangeState,
  type ExchangeSummary,
  type TransferItem,
  type TransferItems,
  type TransferSelection,
} from "./exchange-api";
import { ForeignBlock } from "./exchange-foreign";
import { ExchangeLimitNote, ExchangeSummaryView } from "./exchange-result";

const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const OUTLINE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-50";
const SECTION_TITLE = "text-[13px] font-medium text-[#3c4053]";
const LIST = "mt-2 divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]";
const ROW = "flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-[#f5f6ff]";
const CHECK = "mt-0.5 size-4 shrink-0 accent-[#5566f6]";
const STATUS =
  "flex items-center gap-2 rounded-2xl border border-[#ececf4] px-4 py-3 text-[13px] leading-[1.5] text-[#6f7282]";
const WARNING =
  "flex items-start gap-2.5 rounded-2xl border border-[#ffd9a8] bg-[#fffaf0] p-3 text-[13px] leading-snug text-[#7a4a00]";
const BODY = "min-h-0 flex-1 overflow-y-auto px-5 pb-5";
const FOOTER = "shrink-0 border-t border-[#ececf4] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4";

const NO_COUNTS: ExchangeCounts = kindRecord(() => 0);
const NO_PICKS: Record<ExchangeKind, string[]> = kindRecord<string[]>(() => []);
const EMPTY_SUMMARY: ExchangeSummary = { organizations: [], notes: [] };

/** Поиск по позициям появляется, когда список не помещается на экран целиком. */
const ITEMS_SEARCH_FROM = 9;
/** Сколько строк рисуем сразу: справочник продукции бывает в тысячи позиций. */
const ITEMS_RENDER_LIMIT = 200;

/** Позиции организации-источника; `items: null` — не загрузились. */
type Preview = { sourceId: string; items: TransferItems | null; error: string };

function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

/**
 * Окно «Связать или перенести данные» (спека org-exchange-2026-11-19, Р1–Р8):
 * справочники этой организации и соседних организаций аккаунта.
 *
 * Два способа. «Связать через мастер-кабинет» — обмен в обе стороны по
 * отмеченным спискам (`PUT`), дальше он идёт сам раз в сутки и по кнопке.
 * «Перенести один раз» — выбранные позиции одной организации копируются
 * сюда (`POST …/transfer`), связь не сохраняется. После успеха окно
 * показывает итог сервера: что создано, обновлено, не поместилось в тариф.
 *
 * Блок «Другая компания» (спека org-exchange-foreign-2026-11-19) — запрос в
 * мастер-кабинет чужого аккаунта по его коду, со способом и списками,
 * выбранными в окне. У него своя кнопка: кнопка окна работает только со
 * своими организациями и, пока в поле кода есть неотправленный текст, ждёт.
 *
 * Портал в `document.body`, как у окна нового мастер-кабинета: окно
 * открывают и из мастера первого входа, и из настроек.
 */
export function ExchangeDialog({
  onClose,
  onApplied,
  initialMode = "link",
}: {
  onClose: () => void;
  /** Связь сохранена или перенос выполнен — данные организации изменились. */
  onApplied?: () => void;
  initialMode?: ExchangeMode;
}) {
  const t = useTranslations("dashboardUi.directoryExchange");
  const tc = useTranslations("common");
  const titleId = useId();
  const groupName = useId();

  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<"loading" | "ready" | "failed">("loading");
  const [state, setState] = useState<ExchangeState | null>(null);
  const [mode, setMode] = useState<ExchangeMode>(initialMode);
  const [linkOrgs, setLinkOrgs] = useState<string[]>([]);
  const [linkKinds, setLinkKinds] = useState<ExchangeKind[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [transferKinds, setTransferKinds] = useState<ExchangeKind[]>([]);
  // Позиции источника грузим, когда человек хоть раз открыл перенос.
  const [transferSeen, setTransferSeen] = useState(initialMode === "transfer");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  // Только id позиций, которых у получателя ещё нет.
  const [picked, setPicked] = useState<Record<ExchangeKind, string[]>>(NO_PICKS);
  const [expanded, setExpanded] = useState<ExchangeKind | null>(null);
  const [busy, setBusy] = useState(false);
  // `running` — обмен не уложился в ожидание и идёт в фоне: итог появится в карточке.
  const [result, setResult] = useState<{ mode: ExchangeMode; summary: ExchangeSummary; running: boolean } | null>(null);
  // Запрос в чужой кабинет отправлен или отменён, связь разорвана — карточку и строку стоит перечитать.
  const [foreignChanged, setForeignChanged] = useState(false);
  // В поле кода другой компании есть неотправленный текст.
  const [foreignDraft, setForeignDraft] = useState(false);
  // Сколько в кабинете аккаунта участников из других аккаунтов.
  const [foreignPartners, setForeignPartners] = useState(0);

  useEffect(() => {
    let alive = true;
    void loadExchangeState().then((next) => {
      if (!alive) return;
      if (!next) {
        setLoad("failed");
        return;
      }
      const ownId = next.organization.id;
      const siblingIds = next.siblings.map((sibling) => sibling.id);
      // Закрытая до оплаты организация в обмене и переносе не участвует.
      const openIds = next.siblings.filter((sibling) => !sibling.locked).map((sibling) => sibling.id);
      const partnerIds = next.members
        .filter((member) => member.organizationId !== ownId && member.kinds.length > 0)
        .map((member) => member.organizationId);
      const linked = siblingIds.filter((id) => partnerIds.includes(id));
      setState(next);
      // Уже связанные организации отмечены; связи ещё нет — отмечена первая.
      setLinkOrgs(linked.length > 0 ? linked : openIds.slice(0, 1));
      // Списки — те, что уже в обмене. Новой организации их выбирает человек:
      // связь двусторонняя и занимает места и точки тарифа у соседних.
      setLinkKinds(next.members.find((member) => member.organizationId === ownId)?.kinds ?? []);
      setSourceId(openIds[0] ?? "");
      setLoad("ready");
    });
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (!transferSeen || !sourceId) return;
    let alive = true;
    void exchangeRequest(`/transfer?from=${encodeURIComponent(sourceId)}`).then(({ ok, json }) => {
      if (!alive) return;
      if (!ok) {
        setPreview({ sourceId, items: null, error: exchangeError(json, "") });
        return;
      }
      const items = parseTransferItems(json);
      setPreview({ sourceId, items, error: "" });
      // По умолчанию — всё, чего здесь ещё нет; точечно человек снимает сам.
      setPicked(kindRecord((kind) => transferableIds(items[kind])));
    });
    return () => {
      alive = false;
    };
  }, [transferSeen, sourceId, previewAttempt]);

  const applied = result !== null || foreignChanged;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      if (applied) onApplied?.();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applied, busy, onApplied, onClose]);

  const ownId = state?.organization.id ?? "";
  const ownName = state?.organization.name ?? "";
  const ownCounts = state?.counts ?? NO_COUNTS;
  const siblings = state?.siblings ?? [];
  const members = state?.members ?? [];
  const kindsOf = (organizationId: string): ExchangeKind[] =>
    members.find((member) => member.organizationId === organizationId)?.kinds ?? [];
  // Организация уже в обмене и сняла все списки — это выход из обмена.
  const leaving = mode === "link" && kindsOf(ownId).length > 0 && linkKinds.length === 0;
  const source = siblings.find((sibling) => sibling.id === sourceId) ?? null;
  const currentPreview = preview && preview.sourceId === sourceId ? preview : null;
  const previewItems = currentPreview?.items ?? null;
  const kinds = mode === "link" ? linkKinds : transferKinds;
  const selection = useMemo<TransferSelection>(
    () => (previewItems ? transferSelection(previewItems, transferKinds, picked) : {}),
    [previewItems, transferKinds, picked],
  );

  // Кнопка окна — про обмен между своими организациями. Соседних нет, сама
  // организация не в обмене и участников из других аккаунтов в кабинете нет —
  // ей нечего делать: остаётся запрос в другую компанию.
  const ownExchange = siblings.length > 0 || kindsOf(ownId).length > 0 || foreignPartners > 0;
  // Обмениваться можно и с участником из другого аккаунта: своя соседняя тогда не обязательна.
  const noPartner = linkOrgs.length === 0 && foreignPartners === 0;

  /** Чего не хватает, чтобы нажать основную кнопку; `null` — всё выбрано. */
  const missing: string | null =
    mode === "link"
      ? leaving
        ? null
        : noPartner
          ? t("dialog.needOrganization")
          : linkKinds.length === 0
            ? t("dialog.needList")
            : null
      : !source
        ? t("dialog.needOrganization")
        : transferKinds.length === 0
          ? t("dialog.needList")
          : previewItems && Object.keys(selection).length === 0
            ? t("dialog.needItems")
            : null;
  const canSubmit =
    load === "ready" &&
    !busy &&
    ownExchange &&
    // Код введён, а запрос не отправлен: человек мог принять кнопку окна за отправку запроса.
    !foreignDraft &&
    missing === null &&
    (mode === "link" || previewItems !== null);

  function close() {
    if (busy) return;
    if (applied) onApplied?.();
    onClose();
  }

  function switchMode(next: ExchangeMode) {
    setMode(next);
    if (next === "transfer") setTransferSeen(true);
  }

  function toggleKind(kind: ExchangeKind) {
    if (mode === "link") {
      setLinkKinds((current) => toggled(current, kind));
      return;
    }
    setTransferKinds((current) => toggled(current, kind));
    if (expanded === kind) setExpanded(null);
  }

  async function submit() {
    if (!state || !canSubmit) return;
    setBusy(true);
    try {
      if (mode === "link") {
        const { ok, json } = await exchangeRequest("", {
          method: "PUT",
          body: { members: linkMembers(state, linkOrgs, linkKinds) },
        });
        if (!ok) {
          toast.error(exchangeError(json, t("dialog.linkFailed")));
          return;
        }
        if (leaving) {
          toast.success(t("dialog.left", { name: state.organization.name }));
          onApplied?.();
          onClose();
          return;
        }
        setResult({ mode, summary: parseSummary(json?.summary) ?? EMPTY_SUMMARY, running: isExchangeRunning(json) });
        return;
      }
      const { ok, json } = await exchangeRequest("/transfer", {
        method: "POST",
        body: { fromOrganizationId: sourceId, selection },
      });
      if (!ok) {
        toast.error(exchangeError(json, t("dialog.transferFailed")));
        return;
      }
      setResult({ mode, summary: parseSummary(json?.summary) ?? EMPTY_SUMMARY, running: false });
    } finally {
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;

  // Соседних организаций может и не быть: запрос в другую компанию доступен и одной организации.
  const canConfigure = load === "ready" && state !== null && state.canManage;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-[#0b1024]/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={close}
    >
      <BodyScrollLock />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="exchange-dialog"
        // dvh, а не vh: на iPhone низ окна уезжал бы под панель браузера.
        className="flex max-h-[92dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-3xl border border-[#ececf4] bg-white shadow-[0_30px_80px_-30px_rgba(11,16,36,0.5)] sm:rounded-3xl"
      >
        <div className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <ArrowRightLeft className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[18px] font-semibold leading-snug text-[#0b1024]">
              {result
                ? result.mode === "link"
                  ? t("result.linkTitle")
                  : t("result.transferTitle")
                : t("dialog.title")}
            </h2>
            {!result && ownName ? (
              <p className="mt-1 text-[13px] leading-[1.5] text-[#6f7282]">{t("dialog.description", { name: ownName })}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            aria-label={tc("close")}
            className="-mr-1 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#0b1024] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {result ? (
          <>
            <div className={BODY} data-testid="exchange-result">
              {result.running ? (
                <div className={STATUS} data-testid="exchange-running">
                  <Info className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
                  {t("result.running")}
                </div>
              ) : (
                <ExchangeSummaryView summary={result.summary} />
              )}
              {summaryTotals(result.summary).skippedLimit > 0 ? (
                <ExchangeLimitNote className="mt-3" onNavigate={close} />
              ) : null}
            </div>
            <div className={cn(FOOTER, "flex justify-end")}>
              <button type="button" onClick={close} className={cn(PRIMARY, "w-full sm:w-auto")} data-testid="exchange-done">
                <Check className="size-4" aria-hidden />
                {t("result.done")}
              </button>
            </div>
          </>
        ) : !canConfigure ? (
          <>
            <div className={BODY}>
              {load === "loading" ? (
                <div className={STATUS}>
                  <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" aria-hidden />
                  {t("dialog.loading")}
                </div>
              ) : load === "failed" || !state ? (
                <div className={WARNING} role="alert">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#b25e00]" aria-hidden />
                  <span className="min-w-0 flex-1">{t("dialog.loadFailed")}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setLoad("loading");
                      setAttempt((value) => value + 1);
                    }}
                    className="shrink-0 font-medium text-[#3848c7] underline underline-offset-2"
                  >
                    {tc("retry")}
                  </button>
                </div>
              ) : (
                <div className={STATUS}>
                  <Info className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
                  {t("dialog.ownerOnly")}
                </div>
              )}
            </div>
            <div className={cn(FOOTER, "flex justify-end")}>
              <button type="button" onClick={close} className={cn(OUTLINE, "w-full sm:w-auto")}>
                {tc("close")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={BODY}>
              <div role="radiogroup" aria-label={t("dialog.modeLegend")} className="grid gap-2 sm:grid-cols-2">
                {(["link", "transfer"] as const).map((option) => {
                  const active = mode === option;
                  return (
                    <label
                      key={option}
                      className={cn(
                        "flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 transition-colors duration-150",
                        active ? "border-[#5566f6]/40 bg-[#f5f6ff]" : "border-[#dcdfed] bg-white hover:bg-[#fafbff]",
                      )}
                    >
                      <input
                        type="radio"
                        name={`${groupName}-mode`}
                        checked={active}
                        onChange={() => switchMode(option)}
                        disabled={busy}
                        className={CHECK}
                        data-testid={`exchange-mode-${option}`}
                      />
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium leading-snug text-[#0b1024]">
                          {option === "link" ? t("dialog.modeLink") : t("dialog.modeTransfer")}
                        </span>
                        <span className="mt-0.5 block text-[12.5px] leading-[1.45] text-[#6f7282]">
                          {option === "link" ? t("dialog.modeLinkHint") : t("dialog.modeTransferHint")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="mt-4">
                <div className={SECTION_TITLE}>
                  {mode === "link" ? t("dialog.linkOrganizations") : t("dialog.transferSource")}
                </div>
                {siblings.length === 0 ? (
                  <div className={cn(STATUS, "mt-2")} data-testid="exchange-no-siblings">
                    <Info className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
                    {t("dialog.noSiblings")}
                  </div>
                ) : (
                  <ul className={LIST}>
                    {siblings.map((sibling) => {
                      const checked = mode === "link" ? linkOrgs.includes(sibling.id) : sourceId === sibling.id;
                      const lists = kindsOf(sibling.id);
                      // Закрытую организацию не выбрать; уже связанную можно только снять.
                      const unavailable = sibling.locked && !checked;
                      return (
                        <li key={sibling.id}>
                          <label
                            className={cn(ROW, checked && "bg-[#fafbff]", unavailable && "cursor-default hover:bg-transparent")}
                          >
                            {mode === "link" ? (
                              <input
                                key="link"
                                type="checkbox"
                                checked={checked}
                                onChange={() => setLinkOrgs((current) => toggled(current, sibling.id))}
                                disabled={busy || unavailable}
                                className={CHECK}
                                data-testid="exchange-organization"
                                data-organization-id={sibling.id}
                              />
                            ) : (
                              <input
                                key="transfer"
                                type="radio"
                                name={`${groupName}-source`}
                                checked={checked}
                                onChange={() => {
                                  setSourceId(sibling.id);
                                  setExpanded(null);
                                }}
                                disabled={busy || unavailable}
                                className={CHECK}
                                data-testid="exchange-source"
                                data-organization-id={sibling.id}
                              />
                            )}
                            <span className="min-w-0 flex-1">
                              <span
                                className={cn(
                                  "block break-words text-[14px] font-medium",
                                  unavailable ? "text-[#9b9fb3]" : "text-[#0b1024]",
                                )}
                              >
                                {sibling.name}
                              </span>
                              {sibling.locked ? (
                                <span className="mt-0.5 block text-[12px] leading-[1.45] text-[#7a4a00]">{t("dialog.locked")}</span>
                              ) : lists.length > 0 ? (
                                <span className="mt-0.5 block text-[12px] leading-[1.45] text-[#6f7282]">
                                  {t("dialog.inExchange", { lists: lists.map((kind) => t(`kinds.${kind}`)).join(", ") })}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {mode === "link" && members.length > 0 ? (
                  // Обмен идёт через общий кабинет: галочка здесь добавляет
                  // организацию, но не может исключить ту, у которой список уже включён.
                  <p className="mt-2 text-[12px] leading-[1.5] text-[#6f7282]" data-testid="exchange-common-note">
                    {t("dialog.linkCommonNote")}
                  </p>
                ) : null}
              </div>

              {/* Запрос в мастер-кабинет чужого аккаунта: способ и списки — те, что выбраны в окне. Только владельцу аккаунта. */}
              {state?.isAccountOwner ? (
                <ForeignBlock
                  className="mt-4"
                  mode={mode}
                  kinds={kinds}
                  disabled={busy}
                  onChanged={() => setForeignChanged(true)}
                  onLoaded={(next) => setForeignPartners(next.foreignMembers.length)}
                  onDraftChange={setForeignDraft}
                  onNavigate={close}
                />
              ) : null}

              <div className="mt-4">
                <div className={SECTION_TITLE}>{mode === "link" ? t("dialog.linkLists") : t("dialog.transferLists")}</div>
                {mode === "transfer" && source && !currentPreview ? (
                  <div className={cn(STATUS, "mt-2")}>
                    <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" aria-hidden />
                    {t("dialog.itemsLoading")}
                  </div>
                ) : null}
                {mode === "transfer" && currentPreview && !currentPreview.items ? (
                  <div className={cn(WARNING, "mt-2")} role="alert">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#b25e00]" aria-hidden />
                    <span className="min-w-0 flex-1">{currentPreview.error || t("dialog.itemsFailed")}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setPreview(null);
                        setPreviewAttempt((value) => value + 1);
                      }}
                      className="shrink-0 font-medium text-[#3848c7] underline underline-offset-2"
                    >
                      {tc("retry")}
                    </button>
                  </div>
                ) : null}
                <ul className={LIST}>
                  {EXCHANGE_KINDS.map((kind) => {
                    const checked = kinds.includes(kind);
                    const items = mode === "transfer" && checked ? (previewItems?.[kind] ?? null) : null;
                    const available = items ? transferableIds(items).length : 0;
                    const open = expanded === kind;
                    // Настройки журналов — одна запись: ни счётчиков, ни позиций.
                    const single = SINGLE_RECORD_KINDS.includes(kind);
                    return (
                      <li key={kind}>
                        <label className={cn(ROW, checked && "bg-[#fafbff]")}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleKind(kind)}
                            disabled={busy}
                            className={CHECK}
                            data-testid={`exchange-kind-${kind}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                              <span className="text-[14px] font-medium text-[#0b1024]">{t(`kinds.${kind}`)}</span>
                              {single ? null : siblings.length === 0 ? (
                                // Соседних организаций нет: сравнивать не с чем, а о чужой компании ничего не известно.
                                mode === "link" ? (
                                  <span className="text-[12px] tabular-nums text-[#6f7282]">
                                    {t("foreign.ownCount", { count: String(ownCounts[kind]) })}
                                  </span>
                                ) : null
                              ) : (
                                <span className="text-[12px] tabular-nums text-[#6f7282]">
                                  {mode === "link"
                                    ? t("dialog.linkCounts", {
                                        own: String(ownCounts[kind]),
                                        others: String(
                                          siblings
                                            .filter((sibling) => linkOrgs.includes(sibling.id))
                                            .reduce((sum, sibling) => sum + sibling.counts[kind], 0),
                                        ),
                                      })
                                    : t("dialog.transferCounts", { count: String(source?.counts[kind] ?? 0) })}
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block text-[12px] leading-[1.45] text-[#6f7282]">
                              {/* Соседей нет — окно работает только для другой компании: там у сотрудников
                                  передаются лишь ФИО и должность, и подпись не должна обещать телефон. */}
                              {siblings.length === 0 ? t(`foreign.kindHints.${kind}`) : t(`kindHints.${kind}`)}
                            </span>
                          </span>
                        </label>
                        {items ? (
                          <div className="px-4 pb-3 pl-11">
                            {single ? (
                              // Перенос заменяет настройки журналов целиком — и отменить его нельзя.
                              <p
                                className={cn("text-[12.5px] leading-[1.45]", available === 0 ? "text-[#6f7282]" : "text-[#7a4a00]")}
                                data-testid={`exchange-single-${kind}`}
                              >
                                {available === 0
                                  ? t("dialog.journalsSame", { name: ownName })
                                  : t("dialog.journalsReplace", { source: source?.name ?? "", name: ownName })}
                              </p>
                            ) : items.length === 0 ? (
                              <p className="text-[12.5px] leading-[1.45] text-[#6f7282]">{t("dialog.itemsEmpty")}</p>
                            ) : available === 0 ? (
                              <p className="text-[12.5px] leading-[1.45] text-[#6f7282]">
                                {t("dialog.itemsAllExist", { name: ownName })}
                              </p>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setExpanded(open ? null : kind)}
                                  aria-expanded={open}
                                  title={open ? t("dialog.itemsHide") : t("dialog.itemsShow")}
                                  className="-ml-2 inline-flex h-8 items-center gap-1.5 rounded-xl px-2 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                                  data-testid={`exchange-items-toggle-${kind}`}
                                >
                                  {t("dialog.itemsPicked", {
                                    picked: String(picked[kind].length),
                                    total: String(available),
                                  })}
                                  <ChevronDown
                                    className={cn("size-4 transition-transform duration-150", open && "rotate-180")}
                                    aria-hidden
                                  />
                                </button>
                                {open ? (
                                  <ItemsPicker
                                    items={items}
                                    picked={picked[kind]}
                                    disabled={busy}
                                    onChange={(ids) => setPicked((current) => ({ ...current, [kind]: ids }))}
                                  />
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {mode === "link" && kinds.includes("products") ? (
                  // Меню и сырьё кабинета — только явным подключением в «Мастер-кабинете», не обменом.
                  <p className="mt-2 text-[12px] leading-[1.5] text-[#6f7282]" data-testid="exchange-menu-note">
                    {t("dialog.menuSeparate")}
                  </p>
                ) : null}
              </div>

              {leaving ? (
                <div className={cn(WARNING, "mt-4")}>
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#b25e00]" aria-hidden />
                  <span className="min-w-0 flex-1">{t("dialog.leaveNote", { name: ownName })}</span>
                </div>
              ) : kinds.includes("staff") || kinds.includes("objects") ? (
                // Р5: места и точки тарифа действуют и при обмене.
                <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-3 text-[13px] leading-snug text-[#3c4053]">
                  <Info className="mt-0.5 size-4 shrink-0 text-[#5566f6]" aria-hidden />
                  <span className="min-w-0 flex-1">{t("dialog.limitsNote")}</span>
                </div>
              ) : null}
            </div>

            {ownExchange ? (
              <div className={FOOTER}>
                {foreignDraft ? (
                  <p className="mb-2 text-[12.5px] leading-[1.45] text-[#7a4a00]" data-testid="exchange-foreign-draft-note">
                    {t("foreign.draftNote")}
                  </p>
                ) : missing ? (
                  <p className="mb-2 text-[12.5px] leading-[1.45] text-[#6f7282]">{missing}</p>
                ) : null}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button type="button" onClick={close} disabled={busy} className={OUTLINE}>
                    {tc("cancel")}
                  </button>
                  <button type="submit" disabled={!canSubmit} className={PRIMARY} data-testid="exchange-submit">
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    {leaving
                      ? t("dialog.submitLeave")
                      : mode === "link"
                        ? t("dialog.submitLink")
                        : t("dialog.submitTransfer")}
                  </button>
                </div>
              </div>
            ) : (
              // Своим организациям связывать нечего: в окне работает только запрос в другую компанию.
              <div className={cn(FOOTER, "flex justify-end")}>
                <button type="button" onClick={close} className={cn(OUTLINE, "w-full sm:w-auto")}>
                  {tc("close")}
                </button>
              </div>
            )}
          </>
        )}
      </form>
    </div>,
    document.body,
  );
}

/**
 * Позиции одного списка в разовом переносе: «выбрать все», поиск по длинному
 * списку и галочка у каждой позиции. То, что у получателя уже есть, показано
 * с пометкой и не отмечается — дубли сервер всё равно пропустит. Записи с
 * родителем (люди должности, помещения объекта, оборудование цеха) стоят под
 * ним с отступом; как галочки родителя и записей связаны — `togglePicked`.
 */
function ItemsPicker({
  items,
  picked,
  disabled,
  onChange,
}: {
  items: TransferItem[];
  /** id отмеченных позиций — только из тех, что можно перенести. */
  picked: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations("dashboardUi.directoryExchange.dialog");
  const [query, setQuery] = useState("");
  const marked = useMemo(() => new Set(picked), [picked]);
  const available = useMemo(() => transferableIds(items), [items]);
  const needle = query.trim().toLocaleLowerCase();
  const matches = useMemo(
    () =>
      needle
        ? items.filter((item) => `${item.name} ${item.detail ?? ""}`.toLocaleLowerCase().includes(needle))
        : items,
    [items, needle],
  );
  const shown = matches.slice(0, ITEMS_RENDER_LIMIT);
  const allMarked = available.length > 0 && available.every((id) => marked.has(id));
  // Список с вложением (должность → люди, объект → помещения, цех → оборудование).
  const nested = useMemo(() => items.some((item) => item.parentId !== null), [items]);

  return (
    <div className="mt-1.5 overflow-hidden rounded-2xl border border-[#ececf4] bg-white">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#ececf4] bg-[#fafbff] px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-[#0b1024]">
          <input
            type="checkbox"
            checked={allMarked}
            onChange={(event) => onChange(event.target.checked ? available : [])}
            disabled={disabled}
            className="size-4 shrink-0 accent-[#5566f6]"
            data-testid="exchange-items-all"
          />
          {t("selectAll")}
        </label>
        {items.length >= ITEMS_SEARCH_FROM ? (
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Enter в поиске не должен отправлять форму: перенос не отменить.
              if (event.key === "Enter") {
                event.preventDefault();
                return;
              }
              // Escape сначала очищает поиск, а не закрывает всё окно.
              if (event.key !== "Escape" || !query) return;
              event.stopPropagation();
              setQuery("");
            }}
            placeholder={t("itemsSearch")}
            aria-label={t("itemsSearch")}
            className="h-9 min-w-0 flex-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
        ) : null}
      </div>
      {shown.length > 0 ? (
        <ul className="max-h-56 divide-y divide-[#ececf4] overflow-y-auto">
          {shown.map((item) => (
            <li key={item.id}>
              <label
                className={cn(
                  "flex items-start gap-2.5 py-2 pr-3 text-[13.5px] leading-snug",
                  item.parentId !== null ? "pl-9" : "pl-3",
                  nested && item.parentId === null && "font-medium",
                  item.exists ? "text-[#9b9fb3]" : "cursor-pointer text-[#0b1024] hover:bg-[#f5f6ff]",
                )}
              >
                <input
                  type="checkbox"
                  checked={!item.exists && marked.has(item.id)}
                  onChange={() => onChange(togglePicked(items, picked, item.id))}
                  disabled={disabled || item.exists}
                  className="mt-0.5 size-4 shrink-0 accent-[#5566f6]"
                  data-testid="exchange-item"
                  data-item-id={item.id}
                />
                <span className="min-w-0 flex-1 break-words">
                  {item.name}
                  {item.detail ? <span className={item.exists ? undefined : "text-[#6f7282]"}> · {item.detail}</span> : null}
                </span>
                {item.exists ? (
                  <span className="shrink-0 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[12px] font-medium text-[#6f7282]">
                    {t("exists")}
                  </span>
                ) : null}
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-3 text-[12.5px] text-[#6f7282]">{t("itemsNotFound")}</p>
      )}
      {matches.length > shown.length ? (
        <p className="border-t border-[#ececf4] bg-[#fafbff] px-3 py-2 text-[12px] leading-[1.45] text-[#6f7282]">
          {t("itemsCapped", { count: String(shown.length) })}
        </p>
      ) : null}
    </div>
  );
}
