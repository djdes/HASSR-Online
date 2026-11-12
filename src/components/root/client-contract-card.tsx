"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Ban,
  Check,
  CircleAlert,
  Download,
  Eye,
  FilePlus2,
  FileSignature,
  FileText,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  applyBuyerInput,
  blocksToText,
  buyerChecklist,
  buyerKindFromInput,
  cleanCustomSections,
  type ContractBuyerInput,
} from "@/lib/contracts/buyer-form";
import { defaultContractMessage, defaultContractSubject } from "@/lib/contracts/email-copy";
import { CONTRACT_CYCLES, CONTRACT_TIERS, contractPricingLine, formatAmount } from "@/lib/contracts/pricing";
import { SIGNER_BASIS_PRESETS } from "@/lib/contracts/format";
import { isDeliverableEmail, normalizeEmail } from "@/lib/contracts/recipients";
import type { ContractContext, ContractIssueInput, ContractListItem, ContractPricingInput } from "@/lib/contracts/service.server";
import { EdoSendButton } from "@/components/root/edo-send-button";
import type { ContractBuyer, ContractChecklistItem, ContractRecipientSource } from "@/lib/contracts/types";
import { isValidInn } from "@/lib/inn";

/**
 * Карточка «Договор оказания услуг» на ROOT-странице организации:
 * бланк («рыба») без данных клиента → готовность реквизитов БФС и клиента →
 * данные договора, реквизиты клиента и свой текст под клиента → проект
 * PDF/Word → выпуск с номером → скачать или отправить письмом. История
 * выпущенных договоров — тут же, с повторным скачиванием и аннулированием.
 */

type TextDraft = Array<{ id: number; title: string; text: string }>;

let draftSeq = 0;
const toDraft = (sections: ContractContext["templateSections"]): TextDraft =>
  sections.map((section) => ({ id: ++draftSeq, title: section.title, text: blocksToText(section.blocks) }));

type Translator = ReturnType<typeof useTranslations<"rootClientContract">>;

const SELLER_ITEMS = {
  nameFull: "seller.items.nameFull",
  inn: "seller.items.inn",
  ogrn: "seller.items.ogrn",
  address: "seller.items.address",
  bank: "seller.items.bank",
  head: "seller.items.head",
  facsimile: "seller.items.facsimile",
  stamp: "seller.items.stamp",
} as const;

const BUYER_ITEMS = {
  inn: "buyer.items.inn",
  nameFull: "buyer.items.nameFull",
  ogrn: "buyer.items.ogrn",
  legalAddress: "buyer.items.legalAddress",
  kpp: "buyer.items.kpp",
  signer: "buyer.items.signer",
  basis: "buyer.items.basis",
  email: "buyer.items.email",
} as const;

const BUYER_ITEMS_INDIVIDUAL = {
  ogrn: "buyer.items.ogrnIndividual",
  legalAddress: "buyer.items.legalAddressIndividual",
  signer: "buyer.items.signerIndividual",
} as const;

function itemLabel(t: Translator, side: "seller" | "buyer", item: ContractChecklistItem, individual: boolean): string {
  if (side === "seller") {
    const key = SELLER_ITEMS[item.key as keyof typeof SELLER_ITEMS];
    return key ? t(key) : item.label;
  }
  const own = individual ? BUYER_ITEMS_INDIVIDUAL[item.key as keyof typeof BUYER_ITEMS_INDIVIDUAL] : undefined;
  const key = own ?? BUYER_ITEMS[item.key as keyof typeof BUYER_ITEMS];
  return key ? t(key) : item.label;
}

const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const OUTLINE =
  "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:pointer-events-none disabled:opacity-50";
const PRIMARY =
  "inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 disabled:pointer-events-none disabled:opacity-50";
const SMALL =
  "inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

async function errorText(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  return data?.error || fallback;
}

/** Скачивание ответа fetch как файла (черновик PDF приходит POST-ом). */
async function downloadResponse(response: Response, fallbackName: string) {
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ClientContractCard({ initial, edo = false }: { initial: ContractContext; edo?: boolean }) {
  const t = useTranslations("rootClientContract");
  const locale = useLocale();
  const [ctx, setCtx] = useState(initial);
  const [form, setForm] = useState<ContractIssueInput & { buyer: ContractBuyerInput; pricing: ContractPricingInput }>(initial.defaults);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "previewDocx" | "issue" | "refresh">(null);
  const [sendTarget, setSendTarget] = useState<ContractListItem | null>(null);
  const [voidTarget, setVoidTarget] = useState<ContractListItem | null>(null);
  const [voiding, setVoiding] = useState(false);
  const base = `/api/root/organizations/${ctx.organizationId}/contracts`;
  const individual = buyerKindFromInput(form.buyer.inn, ctx.buyer.kind) === "individual";

  // Чек-лист клиента — по тому, что сейчас в форме (реквизиты правятся тут же).
  const formBuyer = useMemo(() => {
    const base = { kind: ctx.buyer.kind } as ContractBuyer;
    return applyBuyerInput(base, form.buyer, form.buyerEmail?.trim() || null);
  }, [ctx.buyer.kind, form.buyer, form.buyerEmail]);
  const buyerItems = useMemo(
    () =>
      buyerChecklist(
        formBuyer,
        { signerName: form.signerName, signerPost: form.signerPost, signerBasis: form.signerBasis, useFacsimile: form.useFacsimile },
        Boolean(formBuyer.nameFull),
      ),
    [formBuyer, form.signerName, form.signerPost, form.signerBasis, form.useFacsimile],
  );
  const innOk = Boolean(formBuyer.inn && isValidInn(formBuyer.inn));

  const formatDate = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale === "uz" ? "uz-Latn" : locale, { day: "2-digit", month: "2-digit", year: "numeric" });
    return (value: string) => format.format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
  }, [locale]);

  const sellerBlockers = ctx.seller.checklist.filter((item) => item.required && !item.ok).map((item) => itemLabel(t, "seller", item, individual));
  const blockers = [...sellerBlockers, ...buyerItems.filter((item) => item.required && !item.ok).map((item) => itemLabel(t, "buyer", item, individual))];
  const latestActive = ctx.contracts.find((contract) => contract.status !== "voided") ?? null;

  async function reload(): Promise<ContractContext | null> {
    const response = await fetch(base, { cache: "no-store" });
    if (!response.ok) return null;
    const next = (await response.json()) as ContractContext;
    setCtx(next);
    return next;
  }

  const update = <K extends keyof ContractIssueInput>(key: K, value: ContractIssueInput[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const updateBuyer = (key: keyof ContractBuyerInput, value: string) => setForm((prev) => ({ ...prev, buyer: { ...prev.buyer, [key]: value } }));

  /** Тело запроса: форма + свой текст, если его меняли. */
  const payload = () => JSON.stringify({ ...form, customSections: textDraft ? cleanCustomSections(textDraft) : null });

  async function preview(format: "pdf" | "docx") {
    setBusy(format === "pdf" ? "preview" : "previewDocx");
    try {
      const response = await fetch(`${base}/preview?format=${format}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload() });
      if (!response.ok) {
        toast.error(await errorText(response, t("errors.generic")));
        return;
      }
      await downloadResponse(response, `contract-draft.${format}`);
    } catch {
      toast.error(t("errors.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function issue() {
    setBusy("issue");
    try {
      const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload() });
      if (!response.ok) {
        toast.error(await errorText(response, t("errors.generic")));
        return;
      }
      const data = (await response.json()) as { contract: { number: string } };
      toast.success(t("form.issued", { number: data.contract.number }));
      await reload();
    } catch {
      toast.error(t("errors.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function refreshRegistry() {
    setBusy("refresh");
    try {
      const response = await fetch(`${base}/legal-refresh`, { method: "POST" });
      if (!response.ok) {
        toast.error(await errorText(response, t("errors.generic")));
        return;
      }
      toast.success(t("buyer.refreshed"));
      const next = await reload();
      if (next) {
        // Что человек уже вписал сам — не трогаем; пустые поля берут свежие данные ЕГРЮЛ.
        setForm((prev) => ({
          ...prev,
          signerName: prev.signerName || next.defaults.signerName,
          signerPost: prev.signerPost || next.defaults.signerPost,
          signerBasis: prev.signerBasis || next.defaults.signerBasis,
          buyerEmail: prev.buyerEmail || next.defaults.buyerEmail,
          buyer: Object.fromEntries(
            Object.entries(prev.buyer).map(([key, value]) => [key, value || next.defaults.buyer[key as keyof ContractBuyerInput]]),
          ) as ContractBuyerInput,
        }));
      }
    } catch {
      toast.error(t("errors.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function confirmVoid() {
    if (!voidTarget) return;
    setVoiding(true);
    try {
      const response = await fetch(`${base}/${voidTarget.id}/void`, { method: "POST" });
      if (!response.ok) {
        toast.error(await errorText(response, t("errors.generic")));
        return;
      }
      toast.success(t("void.done", { number: voidTarget.number }));
      setVoidTarget(null);
      await reload();
    } finally {
      setVoiding(false);
    }
  }

  return (
    <section data-testid="client-contract-card" className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <FileSignature className="size-5" />
          </span>
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("title")}</h2>
            <p className="mt-1 max-w-[620px] text-[13.5px] leading-[1.55] text-[#6f7282]">{t("subtitle")}</p>
          </div>
        </div>
        <span className="rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] text-[#3848c7]" title={t("lawyerNote")}>
          {t("version", { version: ctx.templateVersion })}
        </span>
      </header>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3" data-testid="contract-blank">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-[#0b1024]">{t("blank.title")}</div>
          <p className="mt-0.5 text-[12.5px] text-[#6f7282]">{t("blank.hint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <a href={`${base}/blank?format=pdf`} className={SMALL} data-testid="contract-blank-pdf">
            <Download className="size-3.5 text-[#5566f6]" />
            {t("blank.pdf")}
          </a>
          <a href={`${base}/blank?format=docx`} className={SMALL} data-testid="contract-blank-docx">
            <Download className="size-3.5 text-[#5566f6]" />
            {t("blank.docx")}
          </a>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <ReadinessBox
          title={t("seller.title")}
          ready={ctx.seller.ready}
          statusLabel={ctx.seller.ready ? t("seller.ready") : t("seller.missing")}
          items={ctx.seller.checklist.map((item) => ({ ...item, label: itemLabel(t, "seller", item, individual) }))}
          footer={
            <Link href="/root/requisites" className="text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#0b1024]">
              {t("seller.edit")} →
            </Link>
          }
        />
        <ReadinessBox
          title={t("buyer.title")}
          badge={individual ? t("buyer.individual") : t("buyer.legal")}
          ready={innOk}
          statusLabel={formBuyer.inn ?? "—"}
          items={buyerItems.map((item) => ({ ...item, label: itemLabel(t, "buyer", item, individual) }))}
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-[#6f7282]">
                {ctx.buyer.profileUpdatedAt ? t("buyer.updated", { date: formatDate(ctx.buyer.profileUpdatedAt) }) : t("buyer.noProfile")}
              </span>
              {ctx.buyer.canRefreshRegistry ? (
                <button type="button" onClick={refreshRegistry} disabled={busy !== null} className={SMALL}>
                  <RefreshCw className={`size-3.5 text-[#5566f6] ${busy === "refresh" ? "animate-spin" : ""}`} />
                  {busy === "refresh" ? t("buyer.refreshing") : t("buyer.refresh")}
                </button>
              ) : null}
            </div>
          }
        />
      </div>
      <p className="mt-2 text-[12px] text-[#9b9fb3]">{t("buyer.optionalHint")}</p>

      <div className="mt-6 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-5">
        <div className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{t("form.title")}</div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("form.date")}>
            <input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} className={INPUT} data-testid="contract-date" />
          </Field>
          <Field label={t("form.city")}>
            <input value={form.city} onChange={(event) => update("city", event.target.value)} placeholder={t("form.cityPlaceholder")} className={INPUT} />
          </Field>
          <Field label={individual ? t("form.signerNameIndividual") : t("form.signerName")}>
            <input value={form.signerName ?? ""} onChange={(event) => update("signerName", event.target.value)} className={INPUT} data-testid="contract-signer-name" />
          </Field>
          {individual ? null : (
            <Field label={t("form.signerPost")}>
              <input value={form.signerPost ?? ""} onChange={(event) => update("signerPost", event.target.value)} placeholder={t("form.signerPostPlaceholder")} className={INPUT} />
            </Field>
          )}
          <Field label={individual ? t("form.signerBasisIndividual") : t("form.signerBasis")} hint={individual ? t("form.basisHintIndividual") : t("form.basisHint")}>
            <input value={form.signerBasis ?? ""} onChange={(event) => update("signerBasis", event.target.value)} className={INPUT} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SIGNER_BASIS_PRESETS.filter((preset) => !individual || preset !== SIGNER_BASIS_PRESETS[0]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => update("signerBasis", preset)}
                  className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors duration-150 ${
                    form.signerBasis === preset ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]" : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t("form.buyerEmail")} hint={t("form.buyerEmailHint")}>
            <input
              type="email"
              value={form.buyerEmail ?? ""}
              onChange={(event) => update("buyerEmail", event.target.value)}
              list="client-contract-emails"
              className={INPUT}
            />
            <datalist id="client-contract-emails">
              {ctx.recipients.map((recipient) => (
                <option key={recipient.email} value={recipient.email} />
              ))}
            </datalist>
          </Field>
        </div>

        <PricingEditor
          t={t}
          value={form.pricing}
          rates={ctx.planRates}
          onChange={(next) => setForm((prev) => ({ ...prev, pricing: { ...prev.pricing, ...next } }))}
        />

        <BuyerRequisitesEditor
          t={t}
          value={form.buyer}
          individual={individual}
          onChange={updateBuyer}
          onReset={() => setForm((prev) => ({ ...prev, buyer: ctx.defaults.buyer }))}
        />

        <ContractTextEditor
          t={t}
          version={ctx.templateVersion}
          draft={textDraft}
          onChange={setTextDraft}
          onStart={() => setTextDraft(toDraft(ctx.templateSections))}
        />

        <label className={`mt-4 flex items-start gap-3 rounded-2xl border border-[#ececf4] bg-white p-3.5 ${ctx.seller.hasFacsimile ? "cursor-pointer" : "opacity-70"}`}>
          <input
            type="checkbox"
            checked={form.useFacsimile && ctx.seller.hasFacsimile}
            disabled={!ctx.seller.hasFacsimile}
            onChange={(event) => update("useFacsimile", event.target.checked)}
            className="mt-0.5 size-4 accent-[#5566f6]"
          />
          <span>
            <span className="block text-[14px] font-medium text-[#0b1024]">{t("form.facsimile")}</span>
            <span className="block text-[12.5px] text-[#6f7282]">{ctx.seller.hasFacsimile ? t("form.facsimileHint") : t("form.facsimileMissing")}</span>
          </span>
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button type="button" onClick={issue} disabled={busy !== null || blockers.length > 0} className={PRIMARY} data-testid="contract-issue">
            {busy === "issue" ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
            {busy === "issue" ? t("form.issuing") : t("form.issue")}
          </button>
          <button type="button" onClick={() => preview("pdf")} disabled={busy !== null || sellerBlockers.length > 0} className={OUTLINE} data-testid="contract-preview-pdf">
            {busy === "preview" ? <Loader2 className="size-4 animate-spin text-[#5566f6]" /> : <Eye className="size-4 text-[#5566f6]" />}
            {busy === "preview" ? t("form.previewing") : t("form.preview")}
          </button>
          <button type="button" onClick={() => preview("docx")} disabled={busy !== null || sellerBlockers.length > 0} className={OUTLINE} data-testid="contract-preview-docx">
            {busy === "previewDocx" ? <Loader2 className="size-4 animate-spin text-[#5566f6]" /> : <Download className="size-4 text-[#5566f6]" />}
            {busy === "previewDocx" ? t("form.previewing") : t("form.previewDocx")}
          </button>
        </div>
        <p className={`mt-2.5 text-[12.5px] ${blockers.length ? "text-[#a13a32]" : "text-[#6f7282]"}`}>
          {blockers.length ? t("form.blocked", { items: blockers.join(", ") }) : t("form.whatNext")}
        </p>
        {innOk ? null : <p className="mt-1 text-[12px] text-[#9b9fb3]">{t("form.previewHint")}</p>}
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="text-[15px] font-semibold text-[#0b1024]">{t("history.title")}</span>
          <span className="text-[13px] text-[#9b9fb3]">{t("history.count", { count: ctx.contracts.length })}</span>
        </div>
        {ctx.contracts.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-8 text-center">
            <div className="text-[14px] font-medium text-[#0b1024]">{t("history.empty")}</div>
            <p className="mx-auto mt-1 max-w-[360px] text-[13px] text-[#6f7282]">{t("history.emptyHint")}</p>
          </div>
        ) : (
          <ul className="space-y-2" data-testid="contract-history">
            {ctx.contracts.map((contract) => {
              const current = contract.id === latestActive?.id;
              const voided = contract.status === "voided";
              return (
                <li
                  key={contract.id}
                  data-testid="contract-row"
                  data-contract-number={contract.number}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3.5 transition-colors duration-150 ${
                    current ? "border-[#5566f6]/30 bg-[#f5f6ff]" : "border-[#ececf4] bg-white"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className={`size-4 ${voided ? "text-[#9b9fb3]" : "text-[#5566f6]"}`} />
                      <span className={`text-[14px] font-semibold tabular-nums ${voided ? "text-[#9b9fb3] line-through" : "text-[#0b1024]"}`}>№ {contract.number}</span>
                      <span className="text-[13px] text-[#6f7282]">{formatDate(contract.date)}</span>
                      <StatusPill status={contract.status} label={t(`history.status.${contract.status}`)} />
                      {current ? <span className="rounded-full bg-white px-2 py-0.5 text-[11.5px] font-medium text-[#3848c7]">{t("history.current")}</span> : null}
                    </div>
                    <div className="mt-1 text-[12.5px] text-[#6f7282]">
                      {contract.voidedAt
                        ? t("history.voided", { date: formatDate(contract.voidedAt) })
                        : contract.sentAt
                          ? contract.sentByName
                            ? t("history.sentToBy", { date: formatDate(contract.sentAt), emails: contract.sentTo.join(", "), name: contract.sentByName })
                            : t("history.sentTo", { date: formatDate(contract.sentAt), emails: contract.sentTo.join(", ") })
                          : contract.createdByName
                            ? t("history.issuedBy", { date: formatDate(contract.createdAt), name: contract.createdByName })
                            : t("history.issuedAt", { date: formatDate(contract.createdAt) })}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <a href={`${base}/${contract.id}/pdf`} className={SMALL} data-testid="contract-pdf">
                      <Download className="size-3.5 text-[#5566f6]" />
                      {t("history.pdf")}
                    </a>
                    <a href={`${base}/${contract.id}/pdf?plain=1`} className={SMALL} data-testid="contract-pdf-plain">
                      <Download className="size-3.5 text-[#5566f6]" />
                      {t("history.pdfPlain")}
                    </a>
                    <a href={`${base}/${contract.id}/docx`} className={SMALL}>
                      <Download className="size-3.5 text-[#5566f6]" />
                      {t("history.docx")}
                    </a>
                    {voided ? null : (
                      <>
                        <button
                          type="button"
                          onClick={() => setSendTarget(contract)}
                          className={current ? "inline-flex h-8 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3 text-[12.5px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0]" : SMALL}
                          data-testid="contract-send"
                        >
                          <Send className={`size-3.5 ${current ? "" : "text-[#5566f6]"}`} />
                          {t("history.send")}
                        </button>
                        {edo ? <EdoSendButton organizationId={initial.organizationId} kind="contract" sourceId={contract.id} quiet /> : null}
                        <button
                          type="button"
                          onClick={() => setVoidTarget(contract)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[#fff4f2] px-2.5 text-[12.5px] font-medium text-[#a13a32] shadow-[0_6px_16px_-10px_rgba(161,58,50,0.45)] transition-colors duration-150 hover:bg-[#ffe7e3]"
                        >
                          <Ban className="size-3.5" />
                          {t("history.void")}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {sendTarget ? (
        <SendContractDialog
          key={sendTarget.id}
          t={t}
          base={base}
          contract={sendTarget}
          context={ctx}
          onClose={() => setSendTarget(null)}
          onSent={async () => {
            setSendTarget(null);
            await reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={voidTarget !== null}
        onClose={() => setVoidTarget(null)}
        onConfirm={confirmVoid}
        variant="danger"
        title={t("void.title", { number: voidTarget?.number ?? "" })}
        description={t("void.description")}
        bullets={[{ label: t("void.bulletNumber"), tone: "warn" }, { label: t("void.bulletSend"), tone: "warn" }, { label: t("void.bulletPdf") }]}
        cancelLabel={t("cancel")}
        confirmLabel={t("void.confirm")}
        confirmDisabled={voiding}
      />
    </section>
  );
}

type RequisiteLabel = `requisites.${keyof ContractBuyerInput | "nameFullIndividual" | "ogrnIndividual" | "legalAddressIndividual"}`;

const BUYER_FIELDS: Array<{ key: keyof ContractBuyerInput; label: (individual: boolean) => RequisiteLabel; legalOnly?: boolean; wide?: boolean; numeric?: boolean }> = [
  { key: "nameFull", label: (individual) => (individual ? "requisites.nameFullIndividual" : "requisites.nameFull"), wide: true },
  { key: "nameShort", label: () => "requisites.nameShort" },
  { key: "inn", label: () => "requisites.inn", numeric: true },
  { key: "kpp", label: () => "requisites.kpp", legalOnly: true, numeric: true },
  { key: "ogrn", label: (individual) => (individual ? "requisites.ogrnIndividual" : "requisites.ogrn"), numeric: true },
  { key: "legalAddress", label: (individual) => (individual ? "requisites.legalAddressIndividual" : "requisites.legalAddress"), wide: true },
  { key: "actualAddress", label: () => "requisites.actualAddress", wide: true },
  { key: "phone", label: () => "requisites.phone" },
  { key: "bankName", label: () => "requisites.bankName" },
  { key: "bankBik", label: () => "requisites.bankBik", numeric: true },
  { key: "bankAccount", label: () => "requisites.bankAccount", numeric: true },
  { key: "bankCorrAccount", label: () => "requisites.bankCorrAccount", numeric: true },
];

/** Согласованный тариф → Приложение № 1. По умолчанию «Премиум» на 1 месяц. */
function PricingEditor({
  t,
  value,
  rates,
  onChange,
}: {
  t: Translator;
  value: ContractPricingInput;
  rates: ContractContext["planRates"];
  onChange: (next: Partial<ContractPricingInput>) => void;
}) {
  const line = contractPricingLine({ ...value, points: Number(value.points) || 1, discountPercent: Number(value.discountPercent) || 0, rates });
  const select = `${INPUT} h-10 appearance-auto`;
  return (
    <div className="mt-5 rounded-2xl border border-[#ececf4] bg-white p-4" data-testid="contract-pricing">
      <div className="text-[14px] font-semibold text-[#0b1024]">{t("pricing.title")}</div>
      <p className="mt-0.5 text-[12.5px] text-[#6f7282]">{t("pricing.hint")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-[#3c4053]">{t("pricing.tier")}</span>
          <select value={value.tier} onChange={(event) => onChange({ tier: event.target.value as ContractPricingInput["tier"] })} className={select} data-testid="contract-pricing-tier">
            {CONTRACT_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {t(`pricing.tiers.${tier}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-[#3c4053]">{t("pricing.cycle")}</span>
          <select value={value.cycle} onChange={(event) => onChange({ cycle: event.target.value as ContractPricingInput["cycle"] })} className={select} data-testid="contract-pricing-cycle">
            {CONTRACT_CYCLES.map((cycle) => (
              <option key={cycle} value={cycle}>
                {t(`pricing.cycles.${cycle}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-[#3c4053]">{t("pricing.points")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            value={value.points}
            onChange={(event) => onChange({ points: Math.max(1, Math.floor(Number(event.target.value) || 1)) })}
            className={`${INPUT} h-10`}
            data-testid="contract-pricing-points"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-[#3c4053]">{t("pricing.discount")}</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="0.5"
            value={value.discountPercent}
            onChange={(event) => onChange({ discountPercent: Math.min(100, Math.max(0, Number(event.target.value) || 0)) })}
            className={`${INPUT} h-10`}
            data-testid="contract-pricing-discount"
          />
          <span className="mt-1 block text-[11.5px] text-[#9b9fb3]">{t("pricing.discountHint")}</span>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl bg-[#f5f6ff] px-3 py-2">
        <span className="text-[14px] font-semibold tabular-nums text-[#0b1024]" data-testid="contract-pricing-total">
          {t("pricing.total", { total: formatAmount(line.totalRub) })}
        </span>
        {line.discountRub > 0 ? (
          <span className="text-[12.5px] tabular-nums text-[#6f7282]">{t("pricing.saving", { discount: formatAmount(line.discountRub), full: formatAmount(line.fullRub) })}</span>
        ) : null}
      </div>
    </div>
  );
}

/** Реквизиты Заказчика для этого договора: заполнены из карточки клиента, правятся тут. */
function BuyerRequisitesEditor({
  t,
  value,
  individual,
  onChange,
  onReset,
}: {
  t: Translator;
  value: ContractBuyerInput;
  individual: boolean;
  onChange: (key: keyof ContractBuyerInput, value: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-[#ececf4] bg-white p-4" data-testid="contract-buyer-requisites">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-[#0b1024]">{t("requisites.title")}</div>
          <p className="mt-0.5 max-w-[640px] text-[12.5px] text-[#6f7282]">{t("requisites.hint")}</p>
        </div>
        <button type="button" onClick={onReset} className={SMALL}>
          <RotateCcw className="size-3.5 text-[#5566f6]" />
          {t("requisites.reset")}
        </button>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {BUYER_FIELDS.filter((field) => !(individual && field.legalOnly)).map((field) => (
          <label key={field.key} className={`block ${field.wide ? "md:col-span-2" : ""}`}>
            <span className="mb-1 block text-[12.5px] font-medium text-[#3c4053]">{t(field.label(individual))}</span>
            <input
              value={value[field.key] ?? ""}
              onChange={(event) => onChange(field.key, event.target.value)}
              inputMode={field.numeric ? "numeric" : undefined}
              className={`${INPUT} h-10`}
              data-testid={`contract-buyer-${field.key}`}
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-[#9b9fb3]">{t("requisites.optionalNote")}</p>
    </div>
  );
}

/**
 * Свой текст договора под клиента: разделы с заголовком и пунктами
 * построчно. Пока не нажали «Изменить» — договор идёт стандартным текстом.
 */
function ContractTextEditor({
  t,
  version,
  draft,
  onChange,
  onStart,
}: {
  t: Translator;
  version: string;
  draft: TextDraft | null;
  onChange: (next: TextDraft | null) => void;
  onStart: () => void;
}) {
  const patch = (id: number, next: Partial<{ title: string; text: string }>) => onChange((draft ?? []).map((section) => (section.id === id ? { ...section, ...next } : section)));
  return (
    <div className="mt-4 rounded-2xl border border-[#ececf4] bg-white p-4" data-testid="contract-text">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-[#0b1024]">{t("text.title")}</span>
            {draft ? <span className="rounded-full bg-[#fff8eb] px-2 py-0.5 text-[11.5px] text-[#8a5a00]">{t("text.edited")}</span> : null}
          </div>
          <p className="mt-0.5 text-[12.5px] text-[#6f7282]">{draft ? t("text.custom") : t("text.standard", { version })}</p>
        </div>
        {draft ? (
          <button type="button" onClick={() => onChange(null)} className={SMALL} data-testid="contract-text-reset">
            <RotateCcw className="size-3.5 text-[#5566f6]" />
            {t("text.reset")}
          </button>
        ) : (
          <button type="button" onClick={onStart} className={SMALL} data-testid="contract-text-edit">
            <PencilLine className="size-3.5 text-[#5566f6]" />
            {t("text.edit")}
          </button>
        )}
      </div>
      {draft ? (
        <div className="mt-3 space-y-3">
          <p className="text-[12px] leading-[1.5] text-[#9b9fb3]">{t("text.hint")}</p>
          {draft.map((section, index) => (
            <div key={section.id} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3" data-testid="contract-text-section">
              <div className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-center text-[14px] font-semibold tabular-nums text-[#5566f6]">{index + 1}</span>
                <input
                  value={section.title}
                  onChange={(event) => patch(section.id, { title: event.target.value })}
                  aria-label={t("text.sectionTitle")}
                  placeholder={t("text.sectionTitle")}
                  className={`${INPUT} h-9 font-medium`}
                />
                <button
                  type="button"
                  onClick={() => onChange(draft.filter((item) => item.id !== section.id))}
                  title={t("text.removeSection")}
                  aria-label={t("text.removeSection")}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2]"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <textarea
                value={section.text}
                onChange={(event) => patch(section.id, { text: event.target.value })}
                rows={Math.min(14, Math.max(3, section.text.split("\n").length + 1))}
                className="mt-2 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[13px] leading-[1.55] text-[#0b1024] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onChange([...draft, { id: ++draftSeq, title: t("text.newSection"), text: "" }])}
              className={SMALL}
              data-testid="contract-text-add"
            >
              <Plus className="size-3.5 text-[#5566f6]" />
              {t("text.addSection")}
            </button>
            <span className="text-[12px] text-[#9b9fb3]">{t("text.requisitesNote")}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[12px] text-[#9b9fb3]">{hint}</span> : null}
    </label>
  );
}

function StatusPill({ status, label }: { status: ContractListItem["status"]; label: string }) {
  const tone =
    status === "sent" ? "bg-[#ecfdf5] text-[#116b2a]" : status === "voided" ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#eef1ff] text-[#3848c7]";
  return <span className={`rounded-full px-2.5 py-0.5 text-[12px] ${tone}`}>{label}</span>;
}

function ReadinessBox({
  title,
  badge,
  ready,
  statusLabel,
  items,
  footer,
}: {
  title: string;
  badge?: string;
  ready: boolean;
  statusLabel: string;
  items: ContractChecklistItem[];
  footer: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-[#ececf4] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-[#0b1024]">{title}</span>
          {badge ? <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11.5px] text-[#3848c7]">{badge}</span> : null}
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[12px] tabular-nums ${ready ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#fff4f2] text-[#a13a32]"}`}>{statusLabel}</span>
      </div>
      <ul className="mt-3 flex-1 space-y-1.5">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-[13px]">
            {item.ok ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-[#116b2a]" />
            ) : (
              <CircleAlert className={`mt-0.5 size-3.5 shrink-0 ${item.required ? "text-[#a13a32]" : "text-[#c9a227]"}`} />
            )}
            <span className={item.ok ? "text-[#3c4053]" : item.required ? "font-medium text-[#a13a32]" : "text-[#6f7282]"}>{item.label}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-[#eef0f6] pt-3">{footer}</div>
    </div>
  );
}

const SOURCE_KEYS: Record<ContractRecipientSource, `send.sources.${ContractRecipientSource}`> = {
  owner: "send.sources.owner",
  ownerContact: "send.sources.ownerContact",
  accountant: "send.sources.accountant",
  registry: "send.sources.registry",
  manual: "send.sources.manual",
};

function SendContractDialog({
  t,
  base,
  contract,
  context,
  onClose,
  onSent,
}: {
  t: Translator;
  base: string;
  contract: ContractListItem;
  context: ContractContext;
  onClose: () => void;
  onSent: () => Promise<void>;
}) {
  // Предлагаемые адреса: владелец, бухгалтер — отмечены сразу; почты из
  // ЕГРЮЛ (часто общий ящик) — только если других нет.
  const initialRecipients = context.recipients.map((recipient) => ({ ...recipient }));
  const preselected = initialRecipients.filter((recipient) => recipient.source !== "registry").map((recipient) => recipient.email);
  const [recipients, setRecipients] = useState(initialRecipients);
  const [selected, setSelected] = useState<string[]>(preselected.length ? preselected : initialRecipients.slice(0, 1).map((recipient) => recipient.email));
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [subject, setSubject] = useState(defaultContractSubject(contract.number));
  const [message, setMessage] = useState(
    defaultContractMessage({ buyerName: contract.buyerName, number: contract.number, date: contract.date, sellerEmail: context.seller.email }),
  );
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function toggle(email: string) {
    setSelected((prev) => (prev.includes(email) ? prev.filter((item) => item !== email) : [...prev, email]));
  }

  function addDraft() {
    const email = normalizeEmail(draft);
    if (!email || !isDeliverableEmail(email)) {
      setDraftError(t("send.invalidEmail"));
      return;
    }
    if (!recipients.some((recipient) => recipient.email === email)) setRecipients((prev) => [...prev, { email, source: "manual" }]);
    setSelected((prev) => (prev.includes(email) ? prev : [...prev, email]));
    setDraft("");
    setDraftError(null);
    inputRef.current?.focus();
  }

  function onDraftKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (draft.trim()) addDraft();
    }
  }

  async function send() {
    // Адрес, вписанный, но не добавленный кнопкой, тоже считается.
    const pending = normalizeEmail(draft);
    const to = pending && isDeliverableEmail(pending) && !selected.includes(pending) ? [...selected, pending] : selected;
    setSending(true);
    try {
      const response = await fetch(`${base}/${contract.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, message }),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; code?: string; error?: string; sentTo?: string[]; via?: "personal" | "system"; from?: string | null; fallbackReason?: string | null }
        | null;
      if (response.ok && data?.ok) {
        toast.success(t("send.sent", { emails: (data.sentTo ?? to).join(", ") }), {
          description:
            data.via === "personal"
              ? t("send.viaPersonal", { from: data.from ?? "" })
              : data.fallbackReason
                ? t("send.viaSystemFallback", { reason: data.fallbackReason })
                : t("send.viaSystem"),
        });
        await onSent();
        return;
      }
      toast.error(data?.error || (data?.code === "not_configured" ? t("send.notConfigured") : t("send.failed")));
    } catch {
      toast.error(t("send.failed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={send}
      variant="info"
      icon={Send}
      title={t("send.title", { number: contract.number })}
      description={t("send.description")}
      cancelLabel={t("cancel")}
      confirmLabel={sending ? t("send.sending") : t("send.confirm")}
      confirmDisabled={sending || (selected.length === 0 && !normalizeEmail(draft))}
    >
      <div className="space-y-4" data-testid="contract-send-dialog">
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-[#3c4053]">{t("send.recipients")}</div>
          {recipients.length === 0 ? <p className="mb-2 text-[12.5px] text-[#a16d32]">{t("send.noSuggestions")}</p> : null}
          <div className="flex flex-wrap gap-1.5">
            {recipients.map((recipient) => {
              const active = selected.includes(recipient.email);
              return (
                <span
                  key={recipient.email}
                  className={`inline-flex items-center gap-1 rounded-full border py-1 pl-2.5 pr-1.5 text-[12.5px] transition-colors duration-150 ${
                    active ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]" : "border-[#dcdfed] bg-white text-[#3c4053]"
                  }`}
                >
                  <button type="button" onClick={() => toggle(recipient.email)} className="inline-flex items-center gap-1.5" aria-pressed={active}>
                    {active ? <Check className="size-3.5" /> : <Plus className="size-3.5 text-[#9b9fb3]" />}
                    <span className="font-medium">{recipient.email}</span>
                    <span className="text-[11px] text-[#9b9fb3]">{t(SOURCE_KEYS[recipient.source])}</span>
                  </button>
                  {recipient.source === "manual" ? (
                    <button
                      type="button"
                      aria-label={recipient.email}
                      onClick={() => {
                        setRecipients((prev) => prev.filter((item) => item.email !== recipient.email));
                        setSelected((prev) => prev.filter((item) => item !== recipient.email));
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
              ref={inputRef}
              type="email"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setDraftError(null);
              }}
              onKeyDown={onDraftKey}
              placeholder={t("send.addPlaceholder")}
              className={`${INPUT} h-10`}
              data-testid="contract-send-add"
            />
            <button type="button" onClick={addDraft} disabled={!draft.trim()} className={OUTLINE}>
              <Plus className="size-4 text-[#5566f6]" />
              {t("send.add")}
            </button>
          </div>
          {draftError ? <p className="mt-1.5 text-[12px] text-[#a13a32]">{draftError}</p> : null}
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("send.subject")}</span>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} className={`${INPUT} h-10`} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("send.message")}</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={6}
            className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[13.5px] leading-[1.55] text-[#0b1024] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </label>
      </div>
    </ConfirmDialog>
  );
}
