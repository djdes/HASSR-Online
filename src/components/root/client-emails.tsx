"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Eye, Loader2, Mail, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import type { ClientEmailHistory, ClientEmailView } from "@/lib/client-email";
import type { DocumentRecipient } from "@/lib/client-documents";

const INPUT = "w-full rounded-2xl border border-[#dcdde3] bg-white px-4 py-3 text-[14px] text-[#111114] outline-none focus:border-[#111114] focus:ring-4 focus:ring-[#111114]/15 disabled:opacity-60";
const SECONDARY = "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdde3] bg-white px-4 text-[14px] font-medium text-[#111114] transition-colors hover:bg-[#f4f4f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#111114]/20 disabled:opacity-60";

export function ClientEmails({ organizationId, recipients, sender, initialHistory }: {
  organizationId: string;
  recipients: DocumentRecipient[];
  sender: { fromName: string; fromEmail: string; ready: boolean } | null;
  initialHistory: ClientEmailHistory;
}) {
  const t = useTranslations("rootOrganizationManagement.mail");
  const locale = useLocale();
  const [history, setHistory] = useState(initialHistory);
  const [composing, setComposing] = useState(false);
  const [to, setTo] = useState(recipients[0]?.email ?? "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "preview" | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestKey = useRef<{ payload: string; id: string } | null>(null);
  const endpoint = `/api/root/organizations/${organizationId}/emails`;
  const ready = Boolean(sender?.ready);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

  async function loadHistory(append = false) {
    setLoadingHistory(true);
    try {
      const cursor = append ? history.nextCursor : null;
      const response = await fetch(`${endpoint}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json() as ClientEmailHistory;
      setHistory((current) => ({ items: append ? [...current.items, ...data.items] : data.items, nextCursor: data.nextCursor }));
    } catch {
      toast.error(t("historyError"));
    } finally {
      setLoadingHistory(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "preview" ? "preview" : "send";
    if (busy) return;
    setBusy(action);
    setError(null);
    const payload = JSON.stringify({ to, subject, message });
    if (!requestKey.current || requestKey.current.payload !== payload) requestKey.current = { payload, id: crypto.randomUUID() };
    try {
      const response = await fetch(action === "preview" ? `${endpoint}/preview` : endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, message, requestId: requestKey.current.id }),
      });
      const data = await response.json() as { error?: string; html?: string; item?: ClientEmailView };
      if (!response.ok) { setError(data.error ?? t("error")); return; }
      if (action === "preview") { setPreview(data.html ?? null); return; }
      if (!data.item) throw new Error();
      if (data.item.status === "sent") {
        toast.success(t("sent"));
        setSubject(""); setMessage(""); setPreview(null); setComposing(false);
        requestKey.current = null;
      } else if (data.item.status === "failed") {
        setError(data.item.error ?? t("error"));
        requestKey.current = null;
      } else {
        setError(t("pendingHint"));
      }
    } catch {
      setError(action === "send" ? t("networkUncertain") : t("error"));
    } finally {
      setBusy(null);
      if (action === "send") await loadHistory();
    }
  }

  const status = (item: ClientEmailView) => item.status === "sent" ? t("statusSent") : item.status === "failed" ? t("statusFailed") : t("statusPending");

  return (
    <section id="emails" aria-labelledby="client-emails-title" className="scroll-mt-16 rounded-3xl border border-[#e7e7ec] bg-white p-5 md:p-6" data-client-emails>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="client-emails-title" className="text-[17px] font-semibold text-[#111114]">{t("title")}</h2>
          <p className="mt-1 text-[13px] text-[#6a6c7a]">{t("description")}</p>
        </div>
        <button type="button" onClick={() => setComposing(!composing)} disabled={busy !== null} className={SECONDARY} aria-expanded={composing} aria-controls="client-email-form">
          <Mail className="size-4 text-[#111114]" />{composing ? t("close") : t("compose")}
        </button>
      </div>

      {composing ? (
        <form id="client-email-form" onSubmit={submit} className="mt-5 space-y-4 border-t border-[#e7e7ec] pt-5" onChange={() => setPreview(null)}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[#3c3d48]">
            <span>{ready && sender ? t("from", { name: sender.fromName, email: sender.fromEmail }) : t("setupHint")}</span>
            <Link href="/root/me" className="font-medium text-[#111114] underline underline-offset-4">{t("settings")}</Link>
          </div>
          <fieldset disabled={busy !== null || !ready} className="space-y-4 disabled:opacity-70">
            <label className="block text-[13px] font-medium text-[#3c3d48]">
              {t("to")}
              <input className={`${INPUT} mt-1.5`} type="email" name="to" required maxLength={254} list={`client-email-contacts-${organizationId}`} value={to} onChange={(event) => setTo(event.target.value)} autoComplete="off" />
              <datalist id={`client-email-contacts-${organizationId}`}>{recipients.map((person) => <option key={person.email} value={person.email}>{person.label}</option>)}</datalist>
            </label>
            <label className="block text-[13px] font-medium text-[#3c3d48]">
              {t("subject")}
              <input className={`${INPUT} mt-1.5`} name="subject" required maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} />
            </label>
            <label className="block text-[13px] font-medium text-[#3c3d48]">
              {t("message")}
              <textarea className={`${INPUT} mt-1.5 min-h-48 resize-y leading-relaxed`} name="message" required maxLength={20000} rows={8} value={message} onChange={(event) => setMessage(event.target.value)} aria-describedby="client-email-signature-hint" />
            </label>
            <p id="client-email-signature-hint" className="text-[13px] text-[#6a6c7a]">{t("signatureHint")}</p>
            <div className="flex flex-wrap gap-3">
              <button type="submit" value="send" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[#111114] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#2c2d36] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#111114]/25 disabled:opacity-60">
                {busy === "send" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Send className="size-4" />}{busy === "send" ? t("sending") : t("send")}
              </button>
              <button type="submit" value="preview" className={SECONDARY}>
                {busy === "preview" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Eye className="size-4" />}{t("preview")}
              </button>
            </div>
          </fieldset>
          {error ? <p role="alert" className="rounded-2xl bg-[#fff4f2] p-3 text-[14px] text-[#a13a32]">{error}</p> : null}
          {preview ? <iframe title={t("preview")} srcDoc={preview} sandbox="" className="h-[520px] w-full rounded-2xl border border-[#e7e7ec]" /> : null}
        </form>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-[#e7e7ec] pt-4">
        <h3 className="text-[14px] font-medium text-[#111114]">{t("history")}</h3>
        <button type="button" onClick={() => void loadHistory()} disabled={loadingHistory || busy !== null} className={SECONDARY}>
          <RefreshCw className={`size-4 ${loadingHistory ? "animate-spin motion-reduce:animate-none" : ""}`} />{t("refresh")}
        </button>
      </div>
      {history.items.length ? (
        <ul className="mt-3 divide-y divide-[#e7e7ec]">
          {history.items.map((item) => (
            <li key={item.id} className="py-3">
              <details>
                <summary className="cursor-pointer rounded-xl py-1 text-[14px] text-[#111114] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#111114]/20">
                  <span className="break-words font-medium">{item.subject}</span>
                  <span className={`ml-2 inline-block rounded-full px-2.5 py-0.5 text-[12px] ${item.status === "sent" ? "bg-[#ecfdf5] text-[#116b2a]" : item.status === "failed" ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#f4f4f6] text-[#111114]"}`}>{status(item)}</span>
                  <span className="mt-1 block break-words text-[13px] font-normal text-[#6a6c7a]">{date(item.sentAt ?? item.createdAt)} · {item.to} · {item.senderName}</span>
                </summary>
                <div className="mt-3 space-y-3 text-[14px] text-[#3c3d48]">
                  <p className="break-words text-[13px]">{t("from", { name: item.senderName, email: item.fromEmail })}</p>
                  {item.error ? <p className="text-[#a13a32]">{item.error}</p> : null}
                  {item.status === "sending" ? <p>{t("pendingHint")}</p> : null}
                  <p className="whitespace-pre-wrap break-words leading-relaxed">{item.message}</p>
                  <details><summary className="cursor-pointer font-medium text-[#111114]">{t("showLetter")}</summary>
                    <iframe title={`${t("preview")}: ${item.subject}`} srcDoc={item.html} sandbox="" loading="lazy" className="mt-3 h-[520px] w-full rounded-2xl border border-[#e7e7ec]" />
                  </details>
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : <p className="py-6 text-[14px] text-[#6a6c7a]">{t("empty")}</p>}
      {history.nextCursor ? <button type="button" className={`${SECONDARY} mt-3`} disabled={loadingHistory || busy !== null} onClick={() => void loadHistory(true)}>{t("more")}</button> : null}
    </section>
  );
}
