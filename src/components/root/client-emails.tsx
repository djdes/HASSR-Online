"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Eye, FileText, Loader2, Mail, Monitor, Paperclip, PencilLine, RefreshCw, Send, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import type { ClientEmailHistory, ClientEmailView } from "@/lib/client-email";
import type { DocumentRecipient } from "@/lib/client-documents";
import type { EmailSenderOption } from "@/lib/email-sender-access";
import { MAIL_ATTACHMENT_ACCEPT, mailAttachmentError } from "@/lib/mail-attachments";
import {
  CLIENT_EMAIL_TEMPLATE_GROUPS,
  fillClientEmailTemplate,
  isClientEmailTemplateId,
  type ClientEmailTemplateContext,
  type TemplateTranslator,
} from "@/lib/client-email-templates";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollList } from "@/components/ui/scroll-list";
import { cn } from "@/lib/utils";
import { EmailSenderSelect } from "./email-sender-select";

const INPUT = "w-full rounded-2xl border border-[#dcdde3] bg-white px-4 py-3 text-[14px] text-[#111114] outline-none focus:border-[#111114] focus:ring-4 focus:ring-[#111114]/15 disabled:opacity-60";
const SECONDARY = "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdde3] bg-white px-4 text-[14px] font-medium text-[#111114] transition-colors hover:bg-[#f4f4f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#111114]/20 disabled:opacity-60";
const PRIMARY = "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[#111114] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#2c2d36] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#111114]/25 disabled:opacity-60";

type PreviewWidth = "desktop" | "phone";

/**
 * «Письма клиенту» в карточке клиента: письмо с рабочей почты сотрудника в
 * оформлении WeSetup, шаблоны (спека client-mail-templates-2026-11-24),
 * вложения по правилам раздела «Письма», предпросмотр в окне «Так клиент
 * увидит письмо» и история отправок с прокруткой внутри блока.
 */
export function ClientEmails({ organizationId, recipients, senders, initialHistory, templates }: {
  organizationId: string;
  recipients: DocumentRecipient[];
  senders: EmailSenderOption[];
  initialHistory: ClientEmailHistory;
  templates: ClientEmailTemplateContext;
}) {
  const t = useTranslations("rootOrganizationManagement.mail");
  const w = useTranslations("rootOrganizationManagement.mail.workspace");
  const tt = useTranslations("rootOrganizationManagement.mail.templates");
  const p = useTranslations("rootOrganizationManagement.mail.previewDialog");
  const locale = useLocale();
  const [history, setHistory] = useState(initialHistory);
  const [composing, setComposing] = useState(false);
  const [mailboxUserId, setMailboxUserId] = useState(senders[0]?.userId ?? "");
  const sender = senders.find(option => option.userId === mailboxUserId);
  const [to, setTo] = useState(recipients[0]?.email ?? "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState<PreviewWidth>("desktop");
  const [busy, setBusy] = useState<"send" | "preview" | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestKey = useRef<{ payload: string; id: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const messageField = useRef<HTMLTextAreaElement>(null);
  const dragDepth = useRef(0);
  const fileRevision = useRef(0);
  const endpoint = `/api/root/organizations/${organizationId}/emails`;
  const ready = Boolean(sender?.ready);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const fileSize = (bytes: number) => `${bytes < 1024 ? "< 1" : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024)} ${w("kb")}`;

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

  function edited() { setPreview(null); setError(null); }

  function addFiles(incoming: File[]) {
    if (busy || !incoming.length) return;
    const next = [...files, ...incoming];
    const problem = mailAttachmentError(next);
    if (problem) { setFileError(w(problem === "count" ? "fileCountError" : problem === "size" ? "fileSizeError" : "fileTypeError")); return; }
    setFiles(next); fileRevision.current++; setFileError(null); edited();
  }

  function removeFile(index: number) {
    setFiles(current => current.filter((_, n) => n !== index)); fileRevision.current++; setFileError(null); edited();
  }

  /** Имя для обращения: владелец и сотрудники — по имени, общие адреса — без имени. */
  function recipientName(): string | null {
    const person = recipients.find(item => item.email === to.trim().toLowerCase());
    return person && (person.source === "owner" || person.source === "person") ? person.label : null;
  }

  function applyTemplate(value: string) {
    if (!isClientEmailTemplateId(value)) return;
    const title = tt(`items.${value}.title`);
    if ((subject.trim() || message.trim()) && !window.confirm(tt("replace", { title }))) return;
    const filled = fillClientEmailTemplate(tt as unknown as TemplateTranslator, value, templates, recipientName(), locale);
    setSubject(filled.subject); setMessage(filled.message); edited();
    toast.success(tt("applied", { title }));
    requestAnimationFrame(() => messageField.current?.focus());
  }

  function content() {
    return { to, subject, message, mailboxUserId };
  }

  async function requestPreview() {
    if (busy) return;
    setBusy("preview"); setError(null);
    try {
      const response = await fetch(`${endpoint}/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(content()) });
      const data = await response.json() as { error?: string; html?: string };
      if (!response.ok || !data.html) { setError(data.error ?? t("error")); return; }
      setPreview(data.html);
    } catch {
      setError(t("error"));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (busy) return;
    setBusy("send"); setError(null);
    const fields = content();
    const payload = JSON.stringify([fields, fileRevision.current]);
    if (!requestKey.current || requestKey.current.payload !== payload) requestKey.current = { payload, id: crypto.randomUUID() };
    try {
      const json = JSON.stringify({ ...fields, requestId: requestKey.current.id });
      let init: RequestInit = { method: "POST", headers: { "Content-Type": "application/json" }, body: json };
      if (files.length) {
        const form = new FormData(); form.set("content", json);
        for (const file of files) form.append("files", file);
        init = { method: "POST", body: form };
      }
      const response = await fetch(endpoint, init);
      const data = await response.json() as { error?: string; item?: ClientEmailView };
      if (!response.ok) { setError(data.error ?? t("error")); setPreview(null); return; }
      if (!data.item) throw new Error();
      if (data.item.status === "sent") {
        toast.success(t("sent"));
        setSubject(""); setMessage(""); setFiles([]); fileRevision.current++; setPreview(null); setComposing(false);
        requestKey.current = null;
      } else if (data.item.status === "failed") {
        setError(data.item.error ?? t("error")); setPreview(null);
        requestKey.current = null;
      } else {
        setError(t("pendingHint")); setPreview(null);
      }
    } catch {
      setError(t("networkUncertain")); setPreview(null);
    } finally {
      setBusy(null);
      await loadHistory();
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "preview" ? "preview" : "send";
    void (action === "preview" ? requestPreview() : send());
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
        <form id="client-email-form" onSubmit={submit} className="mt-5 space-y-4 border-t border-[#e7e7ec] pt-5" onChange={edited}>
          <EmailSenderSelect options={senders} value={mailboxUserId} disabled={busy !== null} label={t("senderLabel")} unavailable={t("senderUnavailable")} onChange={value => { setMailboxUserId(value); edited(); requestKey.current = null; }} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[#3c3d48]">
            <span>{ready && sender ? t("from", { name: sender.fromName, email: sender.fromEmail }) : t("setupHint")}</span>
            <Link href="/root/me" className="font-medium text-[#111114] underline underline-offset-4">{t("settings")}</Link>
          </div>
          <fieldset disabled={busy !== null || !ready} className="min-w-0 space-y-4 disabled:opacity-70">
            <div className="space-y-1.5" data-client-email-templates>
              <span id="client-email-template-label" className="block text-[13px] font-medium text-[#3c3d48]">{tt("label")}</span>
              <Select value="" onValueChange={applyTemplate} disabled={busy !== null || !ready}>
                <SelectTrigger aria-labelledby="client-email-template-label" className="min-h-11 w-full bg-white sm:max-w-md">
                  <span className="flex min-w-0 items-center gap-2"><FileText className="size-4 shrink-0 text-[#5f6170]" /><SelectValue placeholder={tt("choose")} /></span>
                </SelectTrigger>
                <SelectContent position="popper" align="start" sideOffset={6} className="max-h-[min(70vh,28rem)]">
                  {CLIENT_EMAIL_TEMPLATE_GROUPS.map(group => (
                    <SelectGroup key={group.id}>
                      <SelectLabel>{tt(`groups.${group.id}`)}</SelectLabel>
                      {group.items.map(id => <SelectItem key={id} value={id}>{tt(`items.${id}.title`)}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[12.5px] leading-relaxed text-[#6a6c7a]">{tt("hint")}</p>
            </div>
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
              <textarea ref={messageField} className={`${INPUT} mt-1.5 min-h-48 resize-y leading-relaxed`} name="message" required maxLength={20000} rows={10} value={message} onChange={(event) => setMessage(event.target.value)} aria-describedby="client-email-signature-hint" />
            </label>
            <div className="space-y-2">
              <p id="client-email-files-label" className="text-[13px] font-medium text-[#3c3d48]">{w("attachments")}</p>
              <div
                onDragEnter={event => { event.preventDefault(); if (!busy && event.dataTransfer.types.includes("Files")) { dragDepth.current++; setDragging(true); } }}
                onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; }}
                onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
                onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}
                className={cn("rounded-2xl border p-4 transition-colors", dragging ? "border-[#111114] bg-[#ececef]" : "border-transparent bg-[var(--app-veil)]")}
                data-client-email-dropzone
              >
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className={SECONDARY} onClick={() => fileInput.current?.click()} aria-describedby="client-email-files-hint"><Paperclip className="size-4" />{w("chooseFiles")}</button>
                  <span className="text-[13px] text-[#6a6c7a]">{w("dropFiles")}</span>
                </div>
                <input ref={fileInput} type="file" multiple accept={MAIL_ATTACHMENT_ACCEPT} aria-labelledby="client-email-files-label" className="sr-only" tabIndex={-1} onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
                <p id="client-email-files-hint" className="mt-3 text-[12.5px] leading-relaxed text-[#6a6c7a]">{w("fileHint")}</p>
              </div>
              {fileError ? <p role="alert" className="text-[13px] text-[#a13a32]">{fileError}</p> : null}
              {files.length ? (
                <ul aria-label={w("attachments")} className="space-y-1">
                  {files.map((file, index) => (
                    <li key={`${index}:${file.name}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-[var(--app-veil)] py-1 pl-3 pr-1">
                      <span className="flex min-w-0 items-center gap-2 break-all text-[13px] text-[#111114]"><Paperclip className="size-3.5 shrink-0 text-[#5f6170]" />{file.name}<span className="shrink-0 text-[12px] text-[#6a6c7a]">{fileSize(file.size)}</span></span>
                      <button type="button" className="flex size-9 shrink-0 items-center justify-center rounded-xl text-[#3c3d48] hover:bg-[var(--app-veil-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#111114]/20" aria-label={w("removeFile", { name: file.name })} onClick={() => removeFile(index)}><X className="size-4" /></button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <p id="client-email-signature-hint" className="text-[13px] text-[#6a6c7a]">{t("signatureHint")}</p>
            <div className="flex flex-wrap gap-3">
              <button type="submit" value="send" className={PRIMARY}>
                {busy === "send" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Send className="size-4" />}{busy === "send" ? t("sending") : t("send")}
              </button>
              <button type="submit" value="preview" className={SECONDARY}>
                {busy === "preview" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Eye className="size-4" />}{t("preview")}
              </button>
            </div>
          </fieldset>
          {error ? <p role="alert" className="rounded-2xl bg-[#fff4f2] p-3 text-[14px] text-[#a13a32]">{error}</p> : null}
        </form>
      ) : null}

      <Dialog open={preview !== null} onOpenChange={open => { if (!open && busy !== "send") setPreview(null); }}>
        <DialogContent className="gap-0 bg-white p-0 sm:max-w-[min(60rem,calc(100vw-2rem))]" data-client-email-preview>
          <DialogHeader className="border-b border-[#e7e7ec] px-5 pb-4 pt-5 text-left md:px-6">
            <DialogTitle className="pr-10 text-[18px] font-semibold text-[#111114]">{p("title")}</DialogTitle>
            <DialogDescription className="text-[13px] text-[#6a6c7a]">{p("description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 py-4 md:px-6">
            <dl className="grid gap-x-4 gap-y-1.5 rounded-2xl bg-[var(--app-veil)] p-4 text-[13.5px] sm:grid-cols-[auto_minmax(0,1fr)]" data-preview-envelope>
              <dt className="text-[#6a6c7a]">{p("from")}</dt>
              <dd className="min-w-0 break-words text-[#111114]">{sender ? `${sender.fromName} <${sender.fromEmail}>` : "—"}</dd>
              <dt className="text-[#6a6c7a]">{p("to")}</dt>
              <dd className="min-w-0 break-all font-medium text-[#111114]">{to}</dd>
              <dt className="text-[#6a6c7a]">{p("subject")}</dt>
              <dd className="min-w-0 break-words font-medium text-[#111114]">{subject}</dd>
              {files.length ? (
                <>
                  <dt className="text-[#6a6c7a]">{p("attachments")}</dt>
                  <dd className="min-w-0 break-all text-[#111114]">{files.map(file => `${file.name} (${fileSize(file.size)})`).join(", ")}</dd>
                </>
              ) : null}
            </dl>
            <div className="flex justify-end">
              <div role="radiogroup" aria-label={p("width")} className="inline-flex rounded-2xl bg-[var(--app-veil)] p-1">
                {([["desktop", Monitor], ["phone", Smartphone]] as const).map(([value, Icon]) => (
                  <button key={value} type="button" role="radio" aria-checked={previewWidth === value} onClick={() => setPreviewWidth(value)}
                    className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#111114]/20", previewWidth === value ? "bg-white text-[#111114] shadow-sm" : "text-[#5f6170] hover:text-[#111114]")}>
                    <Icon className="size-4" />{p(value)}
                  </button>
                ))}
              </div>
            </div>
            {preview ? (
              <div className="rounded-2xl bg-[#f4f4f6] p-2 sm:p-3">
                <iframe title={p("title")} srcDoc={preview} sandbox="" className={cn("mx-auto block h-[min(62vh,640px)] rounded-xl border border-[#e7e7ec] bg-white transition-[width]", previewWidth === "phone" ? "w-[390px] max-w-full" : "w-full")} />
              </div>
            ) : null}
          </div>
          <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-[#e7e7ec] bg-white px-5 py-4 md:px-6">
            <button type="button" className={SECONDARY} disabled={busy === "send"} onClick={() => { setPreview(null); requestAnimationFrame(() => messageField.current?.focus()); }}>
              <PencilLine className="size-4" />{p("edit")}
            </button>
            <button type="button" className={PRIMARY} disabled={busy !== null || !ready} onClick={() => void send()}>
              {busy === "send" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Send className="size-4" />}{busy === "send" ? t("sending") : t("send")}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-[#e7e7ec] pt-4">
        <h3 className="text-[14px] font-medium text-[#111114]">{t("history")}</h3>
        <button type="button" onClick={() => void loadHistory()} disabled={loadingHistory || busy !== null} className={SECONDARY}>
          <RefreshCw className={`size-4 ${loadingHistory ? "animate-spin motion-reduce:animate-none" : ""}`} />{t("refresh")}
        </button>
      </div>
      {history.items.length ? (
        // История длинная — прокручивается внутри блока.
        <ScrollList maxHeightClassName="max-h-[min(60vh,560px)]" className="mt-3">
          <ul className="divide-y divide-[#e7e7ec]" data-client-email-history>
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
                    {item.attachments?.length ? (
                      <ul aria-label={w("attachments")} className="space-y-1 text-[13px]">
                        {item.attachments.map((file, index) => <li key={index} className="flex items-center gap-1.5 break-all"><Paperclip className="size-3.5 shrink-0 text-[#5f6170]" />{file.filename} · {fileSize(file.size)}</li>)}
                      </ul>
                    ) : null}
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
        </ScrollList>
      ) : <p className="py-6 text-[14px] text-[#6a6c7a]">{t("empty")}</p>}
      {history.nextCursor ? <button type="button" className={`${SECONDARY} mt-3`} disabled={loadingHistory || busy !== null} onClick={() => void loadHistory(true)}>{t("more")}</button> : null}
    </section>
  );
}
