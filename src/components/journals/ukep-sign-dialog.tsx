"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download, FileSignature, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
} from "@/components/journals/journal-responsive";
import {
  certificateLabel,
  CRYPTOPRO_CSP_PAGE,
  CRYPTOPRO_PLUGIN_PAGE,
  GOSUSLUGI_VERIFY_URL,
  listCertificates,
  loadCadesPlugin,
  signDetached,
  UkepPluginError,
  type CadesPlugin,
  type UkepCertificate,
} from "@/lib/ukep-plugin";

type SignatureRow = {
  id: string;
  fileName: string;
  digestChecked: boolean;
  signerName: string;
  signerOrg: string | null;
  signerTitle: string | null;
  issuerName: string | null;
  createdAt: string;
};

type Step = "idle" | "plugin" | "choose" | "signing";

const BUTTON =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60";
const LINK = "inline-flex items-center gap-1 text-[13px] font-medium text-[#3848c7] hover:underline";

/**
 * «Подпись УКЭП» документа журнала (спека journal-ukep-signing-2026-11-21):
 * список подписей с PDF и `.sig`, подпись выбранным сертификатом через
 * КриптоПро ЭЦП Browser plug-in. Нет плагина — что поставить.
 */
export function UkepSignDialog({
  documentId,
  open,
  onOpenChange,
}: {
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("journalControls.ukep");
  const locale = useLocale();
  const [rows, setRows] = useState<SignatureRow[] | null>(null);
  const [canSign, setCanSign] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [certificates, setCertificates] = useState<UkepCertificate[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<{ message: string; noPlugin: boolean } | null>(null);
  const plugin = useRef<CadesPlugin | null>(null);
  const base = `/api/journal-documents/${encodeURIComponent(documentId)}/ukep`;

  const refresh = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { canSign?: boolean; signatures?: SignatureRow[]; error?: string } | null;
    if (!res?.ok || !body?.signatures) {
      setRows([]);
      setError({ message: body?.error ?? t("errors.load"), noPlugin: false });
      return;
    }
    setRows(body.signatures);
    setCanSign(body.canSign === true);
  }, [base, t]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setStep("idle");
    void refresh();
  }, [open, refresh]);

  async function start() {
    setError(null);
    setStep("plugin");
    try {
      plugin.current = await loadCadesPlugin(window);
      const found = await listCertificates(plugin.current);
      setCertificates(found);
      setSelected(found[0]?.thumbprint ?? "");
      setStep("choose");
    } catch (failure) {
      setError({
        message: failure instanceof UkepPluginError ? failure.message : t("errors.plugin"),
        noPlugin: failure instanceof UkepPluginError && failure.code === "no_plugin",
      });
      setStep("idle");
    }
  }

  async function sign() {
    const certificate = certificates.find((item) => item.thumbprint === selected);
    if (!certificate || !plugin.current) return;
    setError(null);
    setStep("signing");
    try {
      const prepared = await fetch(`${base}/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      const draft = (await prepared.json().catch(() => null)) as { pdf?: string; token?: string; fileName?: string; error?: string } | null;
      if (!prepared.ok || !draft?.pdf || !draft.token) throw new Error(draft?.error ?? t("errors.failed"));
      const signature = await signDetached(plugin.current, certificate, draft.pdf);
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf: draft.pdf, signature, token: draft.token, fileName: draft.fileName }),
      });
      const body = (await res.json().catch(() => null)) as { signature?: SignatureRow; error?: string } | null;
      if (!res.ok || !body?.signature) throw new Error(body?.error ?? t("errors.failed"));
      toast.success(t("signed", { name: body.signature.signerName }));
      setStep("idle");
      await refresh();
    } catch (failure) {
      setError({ message: failure instanceof Error && failure.message ? failure.message : t("errors.failed"), noPlugin: false });
      setStep("choose");
    }
  }

  const when = (value: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  const day = (value: string) => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS} data-ukep-dialog>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6 py-5 text-[14px] leading-relaxed text-[#3c4053]">
          <p>{t("intro")}</p>

          {rows === null ? (
            <div className="flex items-center gap-2 text-[#6f7282]">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("loading")}
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[#6f7282]">{t("empty")}</div>
          ) : (
            <ul className="space-y-2.5" data-ukep-signatures>
              {rows.map((row) => (
                <li key={row.id} className="rounded-2xl border border-[#ececf4] bg-white px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#ecfdf5] text-[#136c3e]">
                      <ShieldCheck className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[#0b1024] [overflow-wrap:anywhere]">{row.signerName}</div>
                      <div className="text-[13px] text-[#6f7282] [overflow-wrap:anywhere]">
                        {[row.signerTitle, row.signerOrg].filter(Boolean).join(" · ")}
                      </div>
                      <div className="text-[12.5px] text-[#6f7282]">
                        {t("signedAt", { when: when(row.createdAt) })}
                        {row.issuerName ? ` · ${t("issuer", { name: row.issuerName })}` : ""}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                        <a className={LINK} href={`${base}/${row.id}?file=pdf`}>
                          <Download className="size-3.5" aria-hidden />
                          {t("downloadPdf")}
                        </a>
                        <a className={LINK} href={`${base}/${row.id}?file=sig`}>
                          <Download className="size-3.5" aria-hidden />
                          {t("downloadSig")}
                        </a>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="text-[13px] text-[#6f7282]">
            {t("verifyHint")}{" "}
            <a className={LINK} href={GOSUSLUGI_VERIFY_URL} target="_blank" rel="noopener noreferrer">
              {t("verifyLink")}
            </a>
          </p>

          {error ? (
            <div className="rounded-2xl border border-[#ffd7d3] bg-[#fff4f2] px-4 py-3 text-[13.5px] text-[#a13a32]" role="alert">
              {error.message}
              {error.noPlugin ? (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  <a className={LINK} href={CRYPTOPRO_CSP_PAGE} target="_blank" rel="noopener noreferrer">{t("installCsp")}</a>
                  <a className={LINK} href={CRYPTOPRO_PLUGIN_PAGE} target="_blank" rel="noopener noreferrer">{t("installPlugin")}</a>
                </div>
              ) : null}
            </div>
          ) : null}

          {rows !== null && !canSign ? <p className="text-[13px] text-[#6f7282]">{t("onlyManagers")}</p> : null}

          {canSign && (step === "idle" || step === "plugin") ? (
            <button type="button" className={BUTTON} onClick={() => void start()} disabled={step === "plugin"} data-ukep-start>
              {step === "plugin" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileSignature className="size-4" aria-hidden />}
              {step === "plugin" ? t("searching") : t("start")}
            </button>
          ) : null}

          {canSign && (step === "choose" || step === "signing") ? (
            <div className="space-y-3">
              <label className="block text-[13px] font-medium text-[#3c4053]">
                {t("certificate")}
                <select
                  value={selected}
                  onChange={(event) => setSelected(event.target.value)}
                  disabled={step === "signing"}
                  className="mt-1 h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] outline-none focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
                >
                  {certificates.map((certificate) => (
                    <option key={certificate.thumbprint} value={certificate.thumbprint}>
                      {t("certificateOption", { name: certificateLabel(certificate.subjectName), until: day(certificate.validTo) })}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className={BUTTON} onClick={() => void sign()} disabled={step === "signing" || !selected} data-ukep-sign>
                {step === "signing" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileSignature className="size-4" aria-hidden />}
                {step === "signing" ? t("signing") : t("sign")}
              </button>
              {step === "signing" ? <p className="text-[13px] text-[#6f7282]">{t("pinHint")}</p> : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
