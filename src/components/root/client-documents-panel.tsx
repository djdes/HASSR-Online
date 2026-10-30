"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Download, FileSignature, Loader2, Plus, Presentation, Receipt, Send, X } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  defaultInvoiceMessage,
  defaultInvoiceSubject,
  deliverableEmail,
  type DocumentRecipient,
  type DocumentRecipientSource,
} from "@/lib/client-documents";
import type { ClientDocumentsContext } from "@/lib/client-documents.server";
import { planPeriodPriceRub, type BillingCycle, type PaidTier } from "@/lib/tariff-plans";

/**
 * «Документы клиенту» в карточке клиента панели: три плитки — договор (сам
 * договор ниже, своей карточкой), КП и счёт. КП и счёт отправляются «от
 * пользователя»: с личной почты сотрудника (`sendStaffEmail`), КП подписан им.
 */

type Translator = ReturnType<typeof useTranslations<"rootClientDocuments">>;
type Recipient = { email: string; label: string; source: DocumentRecipientSource | "manual" };

const INPUT =
  "h-10 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const PRIMARY =
  "inline-flex h-9 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[13.5px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 disabled:pointer-events-none disabled:opacity-50";
const OUTLINE =
  "inline-flex h-9 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:pointer-events-none disabled:opacity-50";

const STATUS_KEYS = ["pending", "paid", "cancelled", "failed", "refunded"] as const;

async function errorOf(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  return data?.error || fallback;
}

async function download(response: Response, fallback: string) {
  const blob = await response.blob();
  const match = /filename\*=UTF-8''([^;]+)/.exec(response.headers.get("Content-Disposition") ?? "");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = match ? decodeURIComponent(match[1]) : fallback;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function viaDescription(t: Translator, data: { via?: "personal" | "system"; from?: string | null; fallbackReason?: string | null }): string {
  if (data.via === "personal") return t("mail.viaPersonal", { from: data.from ?? "" });
  return data.fallbackReason ? t("mail.viaSystemFallback", { reason: data.fallbackReason }) : t("mail.viaSystem");
}

export function ClientDocumentsPanel({ initial }: { initial: ClientDocumentsContext }) {
  const t = useTranslations("rootClientDocuments");
  const locale = useLocale();
  const router = useRouter();
  const [ctx] = useState(initial);
  const [dialog, setDialog] = useState<null | "proposal" | "invoice">(null);
  const rub = useMemo(() => new Intl.NumberFormat(locale === "uz" ? "uz-Latn" : locale, { style: "currency", currency: "RUB", maximumFractionDigits: 0 }), [locale]);
  const date = useMemo(() => new Intl.DateTimeFormat(locale === "uz" ? "uz-Latn" : locale, { day: "2-digit", month: "2-digit", year: "numeric" }), [locale]);
  const fmtDate = (value: string) => date.format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
  const base = `/api/root/organizations/${ctx.organizationId}`;

  const invoiceBlocker = ctx.invoice.blockers.includes("requisites")
    ? t("invoice.blockedRequisites")
    : ctx.invoice.blockers.includes("inn")
      ? t("invoice.blockedInn")
      : null;
  const latest = ctx.invoice.latest;
  const latestStatus = latest ? ((STATUS_KEYS as readonly string[]).includes(latest.status) ? t(`invoice.statuses.${latest.status as (typeof STATUS_KEYS)[number]}`) : latest.status) : null;

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6" data-testid="client-documents">
      <div className="mb-4">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("title")}</h2>
        <p className="mt-1 text-[13.5px] leading-[1.55] text-[#6f7282]">{t("subtitle")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Tile
          icon={<FileSignature className="size-5" />}
          title={t("contract.title")}
          status={
            ctx.contract
              ? t("contract.status", {
                  number: ctx.contract.number,
                  date: fmtDate(ctx.contract.date),
                  status: (["issued", "sent", "voided"] as const).includes(ctx.contract.status as "issued") ? t(`contract.statuses.${ctx.contract.status as "issued"}`) : ctx.contract.status,
                })
              : t("contract.none")
          }
        >
          <a href="#client-contract" className={OUTLINE}>
            {t("contract.open")}
          </a>
        </Tile>
        <Tile
          icon={<Presentation className="size-5" />}
          title={t("proposal.title")}
          status={
            ctx.proposal.lastSentAt
              ? ctx.proposal.lastSentBy
                ? t("proposal.lastBy", { date: fmtDate(ctx.proposal.lastSentAt), name: ctx.proposal.lastSentBy })
                : t("proposal.last", { date: fmtDate(ctx.proposal.lastSentAt) })
              : t("proposal.none")
          }
          hint={ctx.permissions.sales ? null : t("noAccess", { section: t("sections.sales") })}
        >
          <button type="button" className={PRIMARY} disabled={!ctx.permissions.sales} onClick={() => setDialog("proposal")} data-testid="proposal-open">
            <Send className="size-4" />
            {t("proposal.action")}
          </button>
        </Tile>
        <Tile
          icon={<Receipt className="size-5" />}
          title={t("invoice.title")}
          status={latest ? t("invoice.latest", { number: String(latest.id), amount: rub.format(latest.amountRub), status: latestStatus ?? "" }) : t("invoice.none")}
          hint={!ctx.permissions.billing ? t("noAccess", { section: t("sections.billing") }) : invoiceBlocker}
          warn={Boolean(ctx.permissions.billing && invoiceBlocker)}
        >
          <button
            type="button"
            className={PRIMARY}
            disabled={!ctx.permissions.billing || Boolean(invoiceBlocker)}
            onClick={() => setDialog("invoice")}
            data-testid="invoice-open"
          >
            <Receipt className="size-4" />
            {t("invoice.action")}
          </button>
        </Tile>
      </div>

      {dialog === "proposal" ? <ProposalDialog t={t} ctx={ctx} base={base} onClose={() => setDialog(null)} onSent={() => router.refresh()} /> : null}
      {dialog === "invoice" ? (
        <InvoiceDialog t={t} ctx={ctx} base={base} rub={rub} onClose={() => setDialog(null)} onChanged={() => router.refresh()} />
      ) : null}
    </div>
  );
}

function Tile({ icon, title, status, hint, warn, children }: { icon: ReactNode; title: string; status: string; hint?: string | null; warn?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">{icon}</span>
        <span className="text-[14.5px] font-semibold text-[#0b1024]">{title}</span>
      </div>
      <p className="mt-2 flex-1 text-[13px] leading-[1.5] text-[#6f7282]">{status}</p>
      {hint ? <p className={`mt-1 text-[12px] ${warn ? "text-[#a13a32]" : "text-[#9b9fb3]"}`}>{hint}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[12px] text-[#9b9fb3]">{hint}</span> : null}
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div className="inline-flex rounded-2xl border border-[#dcdfed] bg-white p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-8 rounded-xl px-3.5 text-[13px] font-medium transition-colors duration-150 ${
            value === option.value ? "bg-[#5566f6] text-white" : "text-[#3c4053] hover:bg-[#f5f6ff]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Получатели — чипы как в договоре: владелец и бухгалтер отмечены сразу. */
function useRecipients(options: DocumentRecipient[]) {
  const [recipients, setRecipients] = useState<Recipient[]>(options);
  const preselected = options.filter((item) => item.source === "owner" || item.source === "accountant").map((item) => item.email);
  const [selected, setSelected] = useState<string[]>(preselected.length ? preselected : options.slice(0, 1).map((item) => item.email));
  const [draft, setDraft] = useState("");
  return { recipients, setRecipients, selected, setSelected, draft, setDraft };
}

function RecipientPicker({ t, state }: { t: Translator; state: ReturnType<typeof useRecipients> }) {
  const { recipients, setRecipients, selected, setSelected, draft, setDraft } = state;
  const [error, setError] = useState<string | null>(null);
  const toggle = (email: string) => setSelected((prev) => (prev.includes(email) ? prev.filter((item) => item !== email) : [...prev, email]));
  const add = () => {
    const email = deliverableEmail(draft);
    if (!email) {
      setError(t("recipients.invalid"));
      return;
    }
    if (!recipients.some((item) => item.email === email)) setRecipients((prev) => [...prev, { email, label: "", source: "manual" }]);
    setSelected((prev) => (prev.includes(email) ? prev : [...prev, email]));
    setDraft("");
    setError(null);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === "Enter" || event.key === ",") && draft.trim()) {
      event.preventDefault();
      add();
    }
  };
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-medium text-[#3c4053]">{t("recipients.label")}</div>
      {recipients.length === 0 ? <p className="mb-2 text-[12.5px] text-[#a16d32]">{t("recipients.empty")}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {recipients.map((item) => {
          const active = selected.includes(item.email);
          return (
            <span
              key={item.email}
              className={`inline-flex items-center gap-1 rounded-full border py-1 pl-2.5 pr-1.5 text-[12.5px] transition-colors duration-150 ${
                active ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]" : "border-[#dcdfed] bg-white text-[#3c4053]"
              }`}
            >
              <button type="button" onClick={() => toggle(item.email)} className="inline-flex items-center gap-1.5" aria-pressed={active}>
                {active ? <Check className="size-3.5" /> : <Plus className="size-3.5 text-[#9b9fb3]" />}
                <span className="font-medium">{item.email}</span>
                <span className="text-[11px] text-[#9b9fb3]">
                  {item.source === "owner" || item.source === "person" ? item.label || t(`recipients.sources.${item.source}`) : t(`recipients.sources.${item.source}`)}
                </span>
              </button>
              {item.source === "manual" ? (
                <button
                  type="button"
                  aria-label={item.email}
                  onClick={() => {
                    setRecipients((prev) => prev.filter((entry) => entry.email !== item.email));
                    setSelected((prev) => prev.filter((entry) => entry !== item.email));
                  }}
                  className="rounded-full p-0.5 text-[#9b9fb3] hover:bg-white hover:text-[#a13a32]"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="email"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={onKey}
          placeholder={t("recipients.addPlaceholder")}
          className={INPUT}
          data-testid="documents-recipient-add"
        />
        <button type="button" onClick={add} disabled={!draft.trim()} className={OUTLINE}>
          <Plus className="size-4 text-[#5566f6]" />
          {t("recipients.add")}
        </button>
      </div>
      {error ? <p className="mt-1.5 text-[12px] text-[#a13a32]">{error}</p> : null}
    </div>
  );
}

/** Выбранные адреса плюс вписанный, но не добавленный кнопкой. */
function recipientsToSend(state: ReturnType<typeof useRecipients>): string[] {
  const pending = deliverableEmail(state.draft);
  return pending && !state.selected.includes(pending) ? [...state.selected, pending] : state.selected;
}

function MailFields({ t, subject, message, setSubject, setMessage, personal }: { t: Translator; subject: string; message: string; setSubject: (value: string) => void; setMessage: (value: string) => void; personal: boolean }) {
  return (
    <>
      <Field label={t("mail.subject")}>
        <input value={subject} onChange={(event) => setSubject(event.target.value)} className={INPUT} />
      </Field>
      <Field label={t("mail.message")} hint={personal ? t("mail.personalOn") : t("mail.personalOff")}>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={5}
          className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[13.5px] leading-[1.55] text-[#0b1024] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />
      </Field>
    </>
  );
}

function ProposalDialog({ t, ctx, base, onClose, onSent }: { t: Translator; ctx: ClientDocumentsContext; base: string; onClose: () => void; onSent: () => void }) {
  const [plan, setPlan] = useState<PaidTier>("standard");
  const [addressee, setAddressee] = useState(ctx.proposal.addressee ?? "");
  const [greeting, setGreeting] = useState(ctx.proposal.greeting);
  const [extras, setExtras] = useState({ ppk: true, equipment: true });
  const [promoCode, setPromoCode] = useState("");
  const [subject, setSubject] = useState(ctx.proposal.subject);
  const [message, setMessage] = useState(ctx.proposal.message);
  const [busy, setBusy] = useState<null | "pdf" | "send">(null);
  const recipients = useRecipients(ctx.recipients);
  const body = () => ({ plan, addressee, greeting, extras, promoCode: promoCode || null });

  async function preview() {
    setBusy("pdf");
    try {
      const response = await fetch(`${base}/proposal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
      if (!response.ok) {
        toast.error(await errorOf(response, t("errors.generic")));
        return;
      }
      const warnings = response.headers.get("X-Proposal-Warnings");
      if (warnings) toast.warning(t("proposal.warnings", { text: decodeURIComponent(warnings) }));
      await download(response, "WeSetup-KP.pdf");
    } catch {
      toast.error(t("errors.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setBusy("send");
    try {
      const to = recipientsToSend(recipients);
      const response = await fetch(`${base}/proposal/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body(), to, subject, message }),
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; sentTo?: string[]; via?: "personal" | "system"; from?: string | null; fallbackReason?: string | null; warnings?: string[] } | null;
      if (response.ok && data?.ok) {
        toast.success(t("proposal.sent", { emails: (data.sentTo ?? to).join(", ") }), { description: viaDescription(t, data) });
        if (data.warnings?.length) toast.warning(t("proposal.warnings", { text: data.warnings.join(" ") }));
        onClose();
        onSent();
        return;
      }
      toast.error(data?.error || t("proposal.failed"));
    } catch {
      toast.error(t("proposal.failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={send}
      variant="info"
      icon={Presentation}
      title={t("proposal.dialogTitle", { company: ctx.companyName })}
      description={t("proposal.dialogDescription")}
      cancelLabel={t("cancel")}
      confirmLabel={busy === "send" ? t("proposal.sending") : t("proposal.confirm")}
      confirmDisabled={busy !== null || recipientsToSend(recipients).length === 0 || !subject.trim() || !message.trim()}
    >
      <div className="space-y-4" data-testid="proposal-dialog">
        <Field label={t("proposal.plan")}>
          <div>
            <Segmented
              value={plan}
              onChange={setPlan}
              options={[
                { value: "standard", label: t("proposal.plans.standard") },
                { value: "premium", label: t("proposal.plans.premium") },
              ]}
            />
          </div>
        </Field>
        <Field label={t("proposal.addressee")} hint={t("proposal.addresseeHint")}>
          <input value={addressee} onChange={(event) => setAddressee(event.target.value)} className={INPUT} data-testid="proposal-addressee" />
        </Field>
        <Field label={t("proposal.greeting")}>
          <input value={greeting} onChange={(event) => setGreeting(event.target.value)} className={INPUT} data-testid="proposal-greeting" />
        </Field>
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-[#3c4053]">{t("proposal.extras")}</div>
          <div className="space-y-1.5">
            {(
              [
                ["ppk", t("proposal.extraPpk"), false],
                ["equipment", t("proposal.extraEquipment"), plan !== "premium"],
              ] as const
            ).map(([key, label, disabled]) => (
              <label key={key} className={`flex items-center gap-2.5 text-[13.5px] ${disabled ? "text-[#9b9fb3]" : "text-[#0b1024]"}`}>
                <input
                  type="checkbox"
                  className="size-4 accent-[#5566f6]"
                  checked={extras[key] && !disabled}
                  disabled={disabled}
                  onChange={(event) => setExtras((prev) => ({ ...prev, [key]: event.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <Field label={t("proposal.promo")}>
          <select value={promoCode} onChange={(event) => setPromoCode(event.target.value)} className={INPUT}>
            <option value="">{t("proposal.promoNone")}</option>
            {ctx.proposal.promoOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3.5 py-2.5 text-[12.5px] text-[#3c4053]">
          <div className="font-medium text-[#0b1024]">
            {t("proposal.signedBy", { name: [ctx.proposal.sender.name, ctx.proposal.sender.position].filter(Boolean).join(", ") })}
          </div>
          <div className="text-[#6f7282]">{t("proposal.signedHint")}</div>
        </div>
        <RecipientPicker t={t} state={recipients} />
        <MailFields t={t} subject={subject} message={message} setSubject={setSubject} setMessage={setMessage} personal={ctx.proposal.sender.personalMailbox} />
        <button type="button" onClick={preview} disabled={busy !== null} className={OUTLINE} data-testid="proposal-pdf">
          {busy === "pdf" ? <Loader2 className="size-4 animate-spin text-[#5566f6]" /> : <Download className="size-4 text-[#5566f6]" />}
          {busy === "pdf" ? t("preparing") : t("download")}
        </button>
      </div>
    </ConfirmDialog>
  );
}

type IssuedInvoice = { orderId: number; amountRub: number; pdfUrl: string };

function InvoiceDialog({
  t,
  ctx,
  base,
  rub,
  onClose,
  onChanged,
}: {
  t: Translator;
  ctx: ClientDocumentsContext;
  base: string;
  rub: Intl.NumberFormat;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tier, setTier] = useState<PaidTier>(ctx.invoice.current?.tier ?? "standard");
  const [cycle, setCycle] = useState<BillingCycle>(ctx.invoice.current?.cycle ?? "year");
  const [points, setPoints] = useState(ctx.invoice.current?.points ?? 1);
  const [promoCode, setPromoCode] = useState("");
  const [issued, setIssued] = useState<IssuedInvoice | null>(null);
  const [busy, setBusy] = useState(false);
  const recipients = useRecipients(ctx.recipients);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const estimate = planPeriodPriceRub(ctx.invoice.rates, tier, cycle, points);

  async function issue() {
    setBusy(true);
    try {
      const response = await fetch(`${base}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, cycle, points, promoCode: promoCode || null, payerEmail: recipients.selected[0] ?? null }),
      });
      const data = (await response.json().catch(() => null)) as { orderId?: number; amountRub?: number; created?: boolean; pdfUrl?: string; error?: string } | null;
      if (!response.ok || !data?.orderId) {
        toast.error(data?.error || t("errors.generic"));
        return;
      }
      const amount = rub.format(data.amountRub ?? 0);
      toast.success(data.created ? t("invoice.issued", { number: String(data.orderId), amount }) : t("invoice.existing", { number: String(data.orderId), amount }));
      setIssued({ orderId: data.orderId, amountRub: data.amountRub ?? 0, pdfUrl: data.pdfUrl ?? `${base}/invoices/${data.orderId}/pdf` });
      // Письмо клиенту — по-русски, как и сам счёт (тексты — в client-documents.ts).
      setSubject(defaultInvoiceSubject(String(data.orderId)));
      setMessage(defaultInvoiceMessage({ number: String(data.orderId), amount, companyName: ctx.companyName }));
      onChanged();
    } catch {
      toast.error(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!issued) return;
    setBusy(true);
    try {
      const to = recipientsToSend(recipients);
      const response = await fetch(`${base}/invoices/${issued.orderId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, message }),
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; sentTo?: string[]; via?: "personal" | "system"; from?: string | null; fallbackReason?: string | null } | null;
      if (response.ok && data?.ok) {
        toast.success(t("invoice.sent", { emails: (data.sentTo ?? to).join(", ") }), { description: viaDescription(t, data) });
        onClose();
        return;
      }
      toast.error(data?.error || t("invoice.failed"));
    } catch {
      toast.error(t("invoice.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (!issued) {
    return (
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={issue}
        variant="info"
        icon={Receipt}
        title={t("invoice.dialogTitle", { company: ctx.companyName })}
        description={t("invoice.dialogDescription")}
        cancelLabel={t("cancel")}
        confirmLabel={busy ? t("invoice.issuing") : t("invoice.issue")}
        confirmDisabled={busy}
      >
        <div className="space-y-4" data-testid="invoice-dialog">
          <div className="flex flex-wrap gap-4">
            <Field label={t("invoice.plan")}>
              <div>
                <Segmented
                  value={tier}
                  onChange={setTier}
                  options={[
                    { value: "standard", label: t("proposal.plans.standard") },
                    { value: "premium", label: t("proposal.plans.premium") },
                  ]}
                />
              </div>
            </Field>
            <Field label={t("invoice.cycle")}>
              <div>
                <Segmented
                  value={cycle}
                  onChange={setCycle}
                  options={[
                    { value: "month", label: t("invoice.cycles.month") },
                    { value: "year", label: t("invoice.cycles.year") },
                  ]}
                />
              </div>
            </Field>
            <Field label={t("invoice.points")}>
              <input
                type="number"
                min={1}
                max={500}
                value={points}
                onChange={(event) => setPoints(Math.max(1, Math.min(500, Math.floor(Number(event.target.value) || 1))))}
                className={`${INPUT} w-24`}
              />
            </Field>
          </div>
          <p className="rounded-2xl bg-[#f5f6ff] px-3.5 py-2.5 text-[13px] text-[#3848c7]">{t("invoice.estimate", { amount: rub.format(estimate) })}</p>
          <Field label={t("invoice.promo")}>
            <select value={promoCode} onChange={(event) => setPromoCode(event.target.value)} className={INPUT}>
              <option value="">{t("proposal.promoNone")}</option>
              {ctx.proposal.promoOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </ConfirmDialog>
    );
  }

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={send}
      variant="info"
      icon={Send}
      title={t("invoice.sendTitle", { number: String(issued.orderId) })}
      description={t("invoice.sendDescription")}
      cancelLabel={t("cancel")}
      confirmLabel={busy ? t("proposal.sending") : t("invoice.send")}
      confirmDisabled={busy || recipientsToSend(recipients).length === 0}
    >
      <div className="space-y-4" data-testid="invoice-send-dialog">
        <p className="rounded-2xl bg-[#ecfdf5] px-3.5 py-2.5 text-[13px] text-[#116b2a]">
          {t("invoice.ready", { number: String(issued.orderId), amount: rub.format(issued.amountRub) })}
        </p>
        <a href={issued.pdfUrl} className={OUTLINE} data-testid="invoice-pdf">
          <Download className="size-4 text-[#5566f6]" />
          {t("download")}
        </a>
        <RecipientPicker t={t} state={recipients} />
        <MailFields t={t} subject={subject} message={message} setSubject={setSubject} setMessage={setMessage} personal={ctx.proposal.sender.personalMailbox} />
      </div>
    </ConfirmDialog>
  );
}
