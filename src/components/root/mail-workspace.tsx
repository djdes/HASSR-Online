"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, Eye, Loader2, Mail, Plus, RefreshCw, Search, Send, X } from "lucide-react";
import { EmailSenderSelect } from "@/components/root/email-sender-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MAIL_RECIPIENT_LIMIT, type MailRecipient, type MailWorkspaceHistory, type MailWorkspaceResult } from "@/lib/mail-workspace";
import type { EmailSenderOption } from "@/lib/email-sender-access";

const INPUT = "w-full rounded-2xl border border-[#dcdde3] bg-white px-4 py-3 text-sm text-[#0b1024] outline-none placeholder:text-[#6f7282] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60";
const BUTTON = "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdde3] bg-white px-4 text-sm font-medium text-[#0b1024] transition-colors hover:bg-[#f4f4fa] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 disabled:cursor-not-allowed disabled:opacity-50";
const ENDPOINT = "/api/root/correspondence";

export function MailWorkspace({ senders, initialHistory }: { senders: EmailSenderOption[]; initialHistory: MailWorkspaceHistory }) {
  const t = useTranslations("rootOrganizationManagement.mail");
  const w = useTranslations("rootOrganizationManagement.mail.workspace");
  const locale = useLocale();
  const [mailboxUserId, setMailboxUserId] = useState(senders.find(sender => sender.ready)?.userId ?? senders[0]?.userId ?? "");
  const [selected, setSelected] = useState<MailRecipient[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [directory, setDirectory] = useState<MailRecipient[]>([]);
  const [limited, setLimited] = useState(false);
  const [searching, setSearching] = useState(false);
  const [directoryError, setDirectoryError] = useState(false);
  const [directoryRetry, setDirectoryRetry] = useState(0);
  const [history, setHistory] = useState(initialHistory);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [busy, setBusy] = useState<"send" | "preview" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<MailWorkspaceResult | null>(null);
  const requestKey = useRef<{ payload: string; id: string } | null>(null);
  const sender = senders.find(item => item.userId === mailboxUserId);
  const ready = Boolean(sender?.ready);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const status = (value: string) => value === "sent" ? t("statusSent") : value === "failed" ? t("statusFailed") : t("statusPending");

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setSearching(true); setDirectoryError(false); setDirectory([]);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${ENDPOINT}/recipients?q=${encodeURIComponent(search)}`, { cache: "no-store", signal: abort.signal });
        if (!response.ok) throw new Error();
        const data = await response.json() as { items: MailRecipient[]; limited: boolean };
        if (!abort.signal.aborted) { setDirectory(data.items); setLimited(data.limited); }
      } catch {
        if (!abort.signal.aborted) setDirectoryError(true);
      } finally {
        if (!abort.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [search, open, directoryRetry]);

  function edited() { setPreview(null); setResult(null); setError(null); }

  async function loadHistory(append = false) {
    if (historyBusy) return;
    setHistoryBusy(true); setHistoryError(false);
    try {
      const response = await fetch(`${ENDPOINT}${append && history.nextCursor ? `?cursor=${encodeURIComponent(history.nextCursor)}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json() as MailWorkspaceHistory;
      setHistory(current => ({ items: append ? [...current.items, ...data.items.filter(item => !current.items.some(old => old.id === item.id))] : data.items, nextCursor: data.nextCursor }));
    } catch { setHistoryError(true); }
    finally { setHistoryBusy(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !ready || !selected.length) return;
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "preview" ? "preview" : "send";
    setBusy(action); setError(null);
    const content = { mailboxUserId, subject, message, recipients: selected.map(({ organizationId, email }) => ({ organizationId, email })) };
    const payload = JSON.stringify(content);
    if (!requestKey.current || requestKey.current.payload !== payload) requestKey.current = { payload, id: crypto.randomUUID() };
    try {
      const response = await fetch(action === "preview" ? `${ENDPOINT}/preview` : ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...content, requestId: requestKey.current.id }),
      });
      const data = await response.json() as MailWorkspaceResult & { error?: string; html?: string };
      if (!response.ok) { setError(data.error ?? t("error")); return; }
      if (action === "preview") { setPreview(data.html ?? null); return; }
      if (!Array.isArray(data.items)) throw new Error();
      setResult(data);
      if (data.interrupted) setError(w("interrupted"));
    } catch { setError(action === "send" ? t("networkUncertain") : t("error")); }
    finally { setBusy(null); if (action === "send") await loadHistory(); }
  }

  function newLetter() {
    if ((subject || message || selected.length) && !window.confirm(w("discard"))) return;
    setSubject(""); setMessage(""); setSelected([]); requestKey.current = null; edited();
  }

  return <div className="mx-auto max-w-[1100px] space-y-7 text-[#0b1024] selection:bg-[#e1e5ff]" data-mail-workspace>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-[65ch]"><h1 className="text-[26px] font-semibold tracking-[-0.02em]">{w("title")}</h1><p className="mt-2 text-sm leading-relaxed text-[#6f7282]">{w("description")}</p></div>
      <Link href="/root/me" className={BUTTON}><Mail className="size-4" />{t("settings")}</Link>
    </header>

    <section aria-labelledby="mail-compose-title" className="rounded-2xl border border-[#ececf4] bg-white p-5 sm:p-7">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><h2 id="mail-compose-title" className="text-lg font-semibold">{t("compose")}</h2><button type="button" className={BUTTON} disabled={busy !== null} onClick={newLetter}><Plus className="size-4" />{w("newLetter")}</button></div>
      <form onSubmit={submit} className="space-y-5">
        <fieldset disabled={busy !== null} className="min-w-0 space-y-5">
          <div className="max-w-xl"><EmailSenderSelect options={senders} value={mailboxUserId} onChange={value => { setMailboxUserId(value); edited(); }} label={t("senderLabel")} unavailable={t("senderUnavailable")} /></div>
          {!ready ? <div role="status" className="rounded-xl bg-[#fff6e6] px-4 py-3 text-sm leading-relaxed text-[#754600]">{w("connectionHint")} <Link href="/root/me" className="font-medium underline underline-offset-4">{t("settings")}</Link></div> : null}
          <div className="space-y-2">
            <span id="mail-to-label" className="block text-[13px] font-medium text-[#3c4053]">{t("to")}</span>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild><button type="button" aria-labelledby="mail-to-label mail-to-value" className={`${BUTTON} w-full justify-between text-left sm:max-w-xl`} disabled={selected.length >= MAIL_RECIPIENT_LIMIT}>
                <span id="mail-to-value">{w("chooseRecipients")}</span><ChevronDown className="size-4 shrink-0" />
              </button></PopoverTrigger>
              <PopoverContent align="start" className="w-[min(36rem,calc(100vw-2rem))] p-2" aria-label={w("chooseRecipients")}>
                <label className="flex items-center gap-2 px-2"><Search className="size-4 shrink-0 text-[#6f7282]" /><input aria-label={w("search")} value={search} onChange={event => setSearch(event.target.value)} maxLength={100} placeholder={w("search")} className={`${INPUT} border-0 px-1 focus:ring-0`} /></label>
                <div className="max-h-72 overflow-y-auto border-t border-[#ececf4] pt-2" aria-busy={searching}>
                  {searching ? <div role="status" className="space-y-2 p-3"><span className="text-sm text-[#6f7282]">{w("searching")}</span><div className="h-10 rounded-xl bg-[#f2f3fa]" /><div className="h-10 rounded-xl bg-[#f2f3fa]" /></div> : directoryError ? <div role="alert" className="space-y-2 p-3 text-sm"><p>{w("directoryError")}</p><button type="button" className={BUTTON} onClick={() => setDirectoryRetry(value => value + 1)}>{t("refresh")}</button></div> : directory.length ? directory.map(item => {
                    const chosen = selected.some(value => value.email === item.email);
                    return <button type="button" key={`${item.organizationId}:${item.email}`} aria-pressed={chosen} disabled={chosen || selected.length >= MAIL_RECIPIENT_LIMIT} onClick={() => { setSelected(current => [...current, item]); edited(); setOpen(false); setSearch(""); }} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-[#eef1ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5566f6] disabled:opacity-50">
                      <span className="min-w-0"><span className="block break-words text-sm font-medium">{item.organizationName}</span><span className="block break-all text-xs leading-relaxed text-[#6f7282]">{item.label} · {item.email}</span></span>{chosen ? <Check className="size-4 shrink-0" /> : <Plus className="size-4 shrink-0" />}
                    </button>;
                  }) : <p className="p-3 text-sm leading-relaxed text-[#6f7282]">{w("noRecipients")}</p>}
                </div>
                {limited && !searching && !directoryError ? <p className="border-t border-[#ececf4] p-3 text-xs text-[#6f7282]">{w("refineSearch")}</p> : null}
              </PopoverContent>
            </Popover>
            {selected.length ? <ul className="flex flex-wrap gap-2" aria-label={w("selected")}>
              {selected.map(item => <li key={item.email} className="flex max-w-full items-center gap-1 rounded-xl bg-[#eef1ff] pl-3 text-sm text-[#3848c7]"><span className="min-w-0 break-all py-2">{item.email}</span><button type="button" aria-label={w("remove", { email: item.email })} onClick={() => { setSelected(current => current.filter(value => value.email !== item.email)); edited(); }} className="flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-[#e1e5ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]"><X className="size-4" /></button></li>)}
            </ul> : null}
            <p className="text-xs leading-relaxed text-[#6f7282]">{w("recipientHint", { count: String(selected.length), limit: String(MAIL_RECIPIENT_LIMIT) })}</p>
          </div>
          <div className="space-y-2"><label htmlFor="mail-subject" className="block text-[13px] font-medium text-[#3c4053]">{t("subject")}</label><input id="mail-subject" value={subject} onChange={event => { setSubject(event.target.value); edited(); }} maxLength={200} required className={INPUT} /></div>
          <div className="space-y-2"><label htmlFor="mail-message" className="block text-[13px] font-medium text-[#3c4053]">{t("message")}</label><textarea id="mail-message" value={message} onChange={event => { setMessage(event.target.value); edited(); }} maxLength={20000} required rows={9} className={`${INPUT} min-h-48 resize-y leading-relaxed`} /></div>
          <p className="text-xs leading-relaxed text-[#6f7282]">{t("signatureHint")}</p>
        </fieldset>
        {error ? <p role="alert" className="break-words rounded-xl bg-[#fff0ee] p-4 text-sm leading-relaxed text-[#9b3022]">{error}</p> : null}
        {result ? <div role="status" className="space-y-2 rounded-xl bg-[#f4f5fb] p-4 text-sm"><p className="font-medium">{w("results")}</p>{result.items.map(item => <p key={item.id} className="break-words">{item.to} — {status(item.status)}{item.error ? `: ${item.error}` : ""}</p>)}<p className="text-xs leading-relaxed text-[#6f7282]">{w("resultHint")}</p></div> : null}
        <div className="flex flex-wrap gap-3">
          <button type="submit" value="send" disabled={busy !== null || !ready || !selected.length} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-sm font-medium text-white transition-colors hover:bg-[#4353dd] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 disabled:cursor-not-allowed disabled:opacity-50">{busy === "send" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{busy === "send" ? t("sending") : result ? w("checkResult") : w("send", { count: String(selected.length) })}</button>
          <button type="submit" value="preview" disabled={busy !== null || !ready || !selected.length} className={BUTTON}>{busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}{t("preview")}</button>
        </div>
      </form>
      {preview ? <div className="mt-6 border-t border-[#ececf4] pt-5"><h3 className="mb-3 text-sm font-medium">{t("preview")}</h3><iframe title={t("preview")} sandbox="" srcDoc={preview} className="h-[480px] w-full rounded-xl border border-[#ececf4] bg-white" /></div> : null}
    </section>

    <section aria-labelledby="mail-history-title" className="rounded-2xl border border-[#ececf4] bg-white p-5 sm:p-7">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 id="mail-history-title" className="text-lg font-semibold">{t("history")}</h2><button type="button" className={BUTTON} disabled={historyBusy || busy !== null} onClick={() => void loadHistory()}><RefreshCw className={`size-4 ${historyBusy ? "animate-spin" : ""}`} />{t("refresh")}</button></div>
      {historyError ? <p role="alert" className="mb-4 text-sm text-[#9b3022]">{t("historyError")}</p> : null}
      <div aria-busy={historyBusy} className="divide-y divide-[#ececf4]">
        {!history.items.length ? <p className="py-6 text-sm leading-relaxed text-[#6f7282]">{w("emptyHistory")}</p> : history.items.map(item => <details key={item.id} className="group py-4">
          <summary className="cursor-pointer list-none rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/20"><div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2"><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{item.subject}</p><p className="mt-1 break-all text-xs leading-relaxed text-[#6f7282]">{item.organizationName} · {item.to}</p></div><span className={`rounded-lg px-2 py-1 text-xs ${item.status === "sent" ? "bg-[#e9faf1] text-[#176947]" : item.status === "failed" ? "bg-[#fff0ee] text-[#9b3022]" : "bg-[#fff6e6] text-[#754600]"}`}>{status(item.status)}</span><ChevronDown className="size-4 shrink-0 group-open:rotate-180" /></div><p className="mt-2 text-xs tabular-nums text-[#6f7282]">{date(item.createdAt)} · {item.fromEmail}</p></summary>
          <div className="mt-4 space-y-3"><Link className="text-sm font-medium text-[#3848c7] underline underline-offset-4" href={`/root/organizations/${encodeURIComponent(item.organizationId)}#emails`}>{w("clientCard")}</Link>{item.error ? <p className="break-words text-sm text-[#9b3022]">{item.error}</p> : null}{item.status === "sending" ? <p className="text-sm text-[#754600]">{t("pendingHint")}</p> : null}<p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.message}</p><details><summary className="cursor-pointer text-sm text-[#3848c7] underline underline-offset-4">{t("showLetter")}</summary><iframe title={`${t("preview")}: ${item.subject}`} sandbox="" srcDoc={item.html} loading="lazy" className="mt-3 h-[420px] w-full rounded-xl border border-[#ececf4] bg-white" /></details></div>
        </details>)}
      </div>
      {history.nextCursor ? <button type="button" disabled={historyBusy || busy !== null} onClick={() => void loadHistory(true)} className={`${BUTTON} mt-4`}>{t("more")}</button> : null}
    </section>
  </div>;
}
