"use client";

import { Building2, ChevronDown, FileUp, Loader2, Search, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { EdoRecipientNote, EdoSignLink } from "@/components/root/edo-status";
import type { EdoCabinetView } from "@/lib/edo/cabinet.server";
import { EDO_FILE_ACCEPT, EDO_FILE_KINDS, EDO_MAX_FILE_BYTES, edoFileExtension, guessDocMeta, type EdoKind } from "@/lib/edo/registry";
import type { EdoDocumentView, EdoRecipientCheckView } from "@/lib/edo/send-core";
import type { EdoSourceOptions } from "@/lib/edo/sources.server";
import { cn } from "@/lib/utils";

import { BTN_PRIMARY, CARD, EYEBROW, INPUT } from "./edo-ui";

type OrgOption = { id: string; name: string; inn: string | null; kpp: string | null };

const KINDS: EdoKind[] = ["contract", "invoice", "upd", "other"];

const rub = (n: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n);
const ruDate = (ymd: string) => ymd.split("-").reverse().join(".");
const todayYmd = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());

export function EdoSendForm({ cabinet, onSent }: { cabinet: EdoCabinetView | null; onSent: (doc: EdoDocumentView) => void }) {
  const t = useTranslations("rootEdo");
  const [org, setOrg] = useState<OrgOption | null>(null);
  const [kind, setKind] = useState<EdoKind>("contract");
  const [sources, setSources] = useState<EdoSourceOptions | null>(null);
  const [sourceId, setSourceId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [participantId, setParticipantId] = useState("");
  const [check, setCheck] = useState<EdoRecipientCheckView | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ document: EdoDocumentView; recipient: EdoRecipientCheckView | null; rewritten: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // Выбрали клиента — сразу «определение по ИНН» и список его счетов/УПД.
  useEffect(() => {
    if (!org) return;
    let alive = true;
    void fetch(`/api/root/edo/organizations/${encodeURIComponent(org.id)}/sources`, { cache: "no-store" })
      .then((res) => res.json().catch(() => null))
      .then((data: { sources?: EdoSourceOptions } | null) => {
        if (alive) setSources(data?.sources ?? { invoices: [], upds: [] });
      });
    if (cabinet) {
      setChecking(true);
      void fetch("/api/root/edo/recipient-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: org.id }),
      })
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as { recipient?: EdoRecipientCheckView; error?: string } | null;
          if (!alive) return;
          if (res.ok && data?.recipient) setCheck(data.recipient);
          else setCheckError(data?.error ?? t("errors.generic"));
        })
        .catch(() => alive && setCheckError(t("errors.network")))
        .finally(() => alive && setChecking(false));
    }
    return () => {
      alive = false;
    };
  }, [org, cabinet, t]);

  function pickOrg(next: OrgOption | null) {
    setOrg(next);
    setSources(null);
    setSourceId("");
    setCheck(null);
    setCheckError(null);
    setResult(null);
    setError(null);
  }

  function pickFile(next: File | null) {
    setFile(next);
    setResult(null);
    setError(null);
    if (!next) return;
    const guess = guessDocMeta(next.name);
    if (guess.number) setNumber(guess.number);
    if (guess.date) setDate(guess.date);
  }

  const fileProblem = file
    ? !edoFileExtension(file.name)
      ? t("send.file.badType")
      : file.size > EDO_MAX_FILE_BYTES
        ? t("send.file.tooBig")
        : null
    : null;
  // Договор пока только файлом: источник договоров WeSetup подключит ветка договоров клиентов.
  const needsFile = EDO_FILE_KINDS.includes(kind);
  const sourceList = kind === "invoice" ? sources?.invoices ?? [] : kind === "upd" ? sources?.upds ?? [] : [];
  const canSend =
    !!cabinet?.ready &&
    !!org &&
    !sending &&
    (needsFile ? !!file && !fileProblem && !!number.trim() && !!date : !!sourceId);

  async function send() {
    if (!org) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      let res: Response;
      if (needsFile && file) {
        const form = new FormData();
        form.set("organizationId", org.id);
        form.set("kind", kind);
        form.set("number", number.trim());
        form.set("date", date);
        if (participantId.trim()) form.set("participantId", participantId.trim());
        form.set("file", file);
        res = await fetch("/api/root/edo/documents", { method: "POST", body: form });
      } else {
        res = await fetch("/api/root/edo/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId: org.id, kind, sourceId, participantId: participantId.trim() || undefined }),
        });
      }
      const data = (await res.json().catch(() => null)) as
        | { document?: EdoDocumentView; recipient?: EdoRecipientCheckView | null; rewritten?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.document) {
        setError(data?.error ?? t("errors.generic"));
        return;
      }
      setResult({ document: data.document, recipient: data.recipient ?? null, rewritten: !!data.rewritten });
      if (data.recipient) setCheck(data.recipient);
      onSent(data.document);
      toast.success(data.rewritten ? t("send.rewritten") : t("send.done"));
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch {
      setError(t("errors.network"));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={CARD} data-testid="edo-send-form">
      <div className={EYEBROW}>{t("send.title")}</div>

      {!cabinet?.ready ? (
        <div className="mb-4 rounded-2xl border border-[#f6e1bd] bg-[#fff8eb] px-3.5 py-3 text-[13px] text-[#8a5a12]">{t("send.cabinetFirst")}</div>
      ) : null}

      <div className="space-y-5">
        {/* 1. Клиент */}
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-[#3c4053]">{t("send.org.label")}</div>
          {org ? (
            <div className="flex items-start gap-3 rounded-2xl border border-[#5566f6]/30 bg-[#f5f6ff] px-4 py-3" data-testid="edo-selected-org">
              <Building2 className="mt-0.5 size-5 shrink-0 text-[#5566f6]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-medium text-[#0b1024]">{org.name}</div>
                <div className="text-[12.5px] text-[#6f7282]">{t("send.org.requisites", { inn: org.inn || "—", kpp: org.kpp || "—" })}</div>
              </div>
              <button
                type="button"
                onClick={() => pickOrg(null)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-[#6f7282] transition-colors duration-150 hover:bg-white hover:text-[#0b1024]"
                aria-label={t("send.org.change")}
                title={t("send.org.change")}
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <OrgSearch onPick={pickOrg} />
          )}
          {org && cabinet ? (
            <div className="mt-2">
              {checking ? (
                <div className="flex items-center gap-2 text-[13px] text-[#6f7282]">
                  <Loader2 className="size-4 animate-spin text-[#5566f6]" />
                  {t("recipient.checking")}
                </div>
              ) : check ? (
                <EdoRecipientNote check={check} />
              ) : checkError ? (
                <div className="rounded-2xl border border-[#f5d0cb] bg-[#fff4f2] px-3.5 py-3 text-[13px] text-[#a13a32]" data-testid="edo-recipient-error">
                  {checkError}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* 2. Вид документа */}
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-[#3c4053]">{t("send.kind.label")}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={t("send.kind.label")}>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => {
                  setKind(k);
                  setSourceId("");
                  setResult(null);
                  setError(null);
                }}
                data-testid={`edo-kind-${k}`}
                className={cn(
                  "rounded-2xl border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                  kind === k ? "border-[#5566f6] bg-[#eef1ff]" : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
                )}
              >
                <div className={cn("text-[14px] font-medium", kind === k ? "text-[#3848c7]" : "text-[#0b1024]")}>{t(`kinds.${k}.title`)}</div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-[#6f7282]">{t(`kinds.${k}.hint`)}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 3. Документ */}
        {needsFile ? (
          <div className="space-y-3">
            <label
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-3xl border border-dashed px-6 py-7 text-center transition-colors duration-150",
                file ? "border-[#5566f6]/50 bg-[#f5f6ff]" : "border-[#dcdfed] bg-[#fafbff] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
              )}
            >
              <FileUp className="size-6 text-[#5566f6]" />
              <span className="text-[14px] font-medium text-[#0b1024]">{file ? file.name : t("send.file.pick")}</span>
              <span className="text-[12px] text-[#6f7282]">{file ? t("send.file.size", { size: (file.size / 1024 / 1024).toFixed(2) }) : t("send.file.hint")}</span>
              <input
                ref={fileInput}
                type="file"
                accept={EDO_FILE_ACCEPT}
                className="sr-only"
                data-testid="edo-file-input"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {kind === "contract" ? <p className="text-[12px] text-[#9b9fb3]">{t("send.file.contractNote")}</p> : null}
            {fileProblem ? <p className="text-[13px] text-[#a13a32]">{fileProblem}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("send.number")}</span>
                <input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={100} className={INPUT} name="edo-number" placeholder={t("send.numberPlaceholder")} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("send.date")}</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} name="edo-date" />
              </label>
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-[#3c4053]">{kind === "invoice" ? t("send.source.invoices") : t("send.source.upds")}</div>
            {!org ? (
              <p className="text-[13px] text-[#6f7282]">{t("send.source.pickOrgFirst")}</p>
            ) : !sources ? (
              <div className="flex items-center gap-2 text-[13px] text-[#6f7282]">
                <Loader2 className="size-4 animate-spin text-[#5566f6]" />
                {t("send.source.loading")}
              </div>
            ) : sourceList.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-5 text-center text-[13px] text-[#6f7282]">
                {kind === "invoice" ? t("send.source.noInvoices") : t("send.source.noUpds")}
              </div>
            ) : (
              <ul className="space-y-1.5" role="radiogroup">
                {sourceList.map((s) => {
                  const voided = "voided" in s && s.voided;
                  const selected = sourceId === s.sourceId;
                  return (
                    <li key={s.sourceId}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={voided}
                        onClick={() => setSourceId(s.sourceId)}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60",
                          selected ? "border-[#5566f6] bg-[#eef1ff]" : "border-[#ececf4] bg-white hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
                        )}
                      >
                        <span className="text-[14px] text-[#0b1024]">
                          {t(kind === "invoice" ? "send.source.invoiceRow" : "send.source.updRow", { number: s.number, date: ruDate(s.date) })}
                          {"issued" in s && !s.issued ? <span className="ml-2 text-[12px] text-[#6f7282]">{t("send.source.notIssuedYet")}</span> : null}
                          {voided ? <span className="ml-2 text-[12px] text-[#a13a32]">{t("send.source.voided")}</span> : null}
                        </span>
                        <span className="shrink-0 text-[13px] tabular-nums text-[#3c4053]">{t("send.source.amount", { amount: rub(s.amountRub) })}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Редко: ID участника, если Saby не находит клиента по реквизитам */}
        <details className="group rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-medium text-[#3c4053]">
            {t("send.advanced.title")}
            <ChevronDown className="size-4 text-[#9b9fb3] transition-transform duration-150 group-open:rotate-180" />
          </summary>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-[13px] text-[#3c4053]">{t("send.advanced.participantId")}</span>
            <input value={participantId} onChange={(e) => setParticipantId(e.target.value)} maxLength={120} className={INPUT} placeholder="2BM-…" spellCheck={false} />
            <span className="mt-1 block text-[12px] text-[#9b9fb3]">{t("send.advanced.hint")}</span>
          </label>
        </details>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void send()} disabled={!canSend} className={BTN_PRIMARY} data-testid="edo-send-submit">
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {t("send.submit")}
            </button>
            <span className="text-[12.5px] text-[#6f7282]">{t("send.submitHint")}</span>
          </div>

          {error ? (
            <div className="rounded-2xl border border-[#f5d0cb] bg-[#fff4f2] px-3.5 py-3 text-[13.5px] text-[#a13a32]" data-testid="edo-send-error">
              {error}
            </div>
          ) : null}

          {result ? (
            <div className="rounded-3xl border border-[#cdeedd] bg-[#ecfdf5] p-5" data-testid="edo-send-result">
              <div className="text-[15px] font-semibold text-[#116b2a]">
                {result.rewritten ? t("send.result.rewrittenTitle", { number: result.document.number }) : t("send.result.title", { number: result.document.number })}
              </div>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13.5px] leading-relaxed text-[#1e4d2f]">
                <li>{t("send.result.step1")}</li>
                <li>{t("send.result.step2")}</li>
                <li>{t("send.result.step3")}</li>
              </ol>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {result.document.signUrl ? <EdoSignLink href={result.document.signUrl} /> : <span className="text-[13px] text-[#1e4d2f]">{t("send.result.noLink")}</span>}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Поиск клиента по названию или ИНН: подсказки появляются по мере ввода. */
function OrgSearch({ onPick }: { onPick: (org: OrgOption) => void }) {
  const t = useTranslations("rootEdo");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<OrgOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void fetch(`/api/root/edo/organizations?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" })
        .then((res) => res.json().catch(() => null))
        .then((data: { organizations?: OrgOption[] } | null) => {
          if (alive) setItems(data?.organizations ?? []);
        })
        .finally(() => alive && setLoading(false));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, open]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={t("send.org.placeholder")}
        className={cn(INPUT, "pl-10")}
        data-testid="edo-org-search"
        role="combobox"
        aria-expanded={open}
        aria-controls="edo-org-results"
      />
      {open ? (
        <ul
          id="edo-org-results"
          role="listbox"
          className="absolute z-20 mt-1.5 max-h-[320px] w-full overflow-y-auto rounded-2xl border border-[#ececf4] bg-white p-1.5 shadow-[0_24px_60px_-24px_rgba(11,16,36,0.35)]"
        >
          {loading && items.length === 0 ? (
            <li className="flex items-center gap-2 px-3 py-2 text-[13px] text-[#6f7282]">
              <Loader2 className="size-4 animate-spin text-[#5566f6]" />
              {t("send.org.searching")}
            </li>
          ) : items.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-[#6f7282]">{t("send.org.nothing")}</li>
          ) : (
            items.map((o) => (
              <li key={o.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(o)}
                  className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors duration-150 hover:bg-[#f5f6ff]"
                  data-testid="edo-org-option"
                >
                  <Building2 className="mt-0.5 size-4 shrink-0 text-[#9b9fb3]" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium text-[#0b1024]">{o.name}</span>
                    <span className="block text-[12px] text-[#6f7282]">{o.inn ? t("send.org.requisites", { inn: o.inn, kpp: o.kpp || "—" }) : t("send.org.noInn")}</span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
