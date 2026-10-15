"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Mail, Printer, QrCode, Send, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { getNativeBridge, printHtml } from "@/lib/native-bridge";

type Status = { active: boolean; createdAt: string | null; lastUsedAt: string | null; hasPin: boolean; canTelegram: boolean; email: string | null };

/**
 * «Личный QR-вход» в карточке сотрудника (2026-09-22): выпустить QR,
 * распечатать карточку, отправить в Telegram или на почту, отключить.
 * Встроено в окно сотрудника (второе окно поверх Radix-диалога не
 * получает кликов), подтверждение перевыпуска — здесь же.
 */
export function PersonalQrCard({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const t = useTranslations("staffManagement.personalQr");
  const locale = useLocale();
  const [status, setStatus] = useState<Status | null>(null);
  const [issued, setIssued] = useState<{ url: string; svg: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReissue, setConfirmReissue] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/staff/${employeeId}/personal-qr`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Status | null) => alive && setStatus(data))
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [employeeId]);

  async function issue(send?: "telegram" | "email") {
    setBusy(send ?? "issue");
    try {
      const res = await fetch(`/api/staff/${employeeId}/personal-qr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(send ? { send } : {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(t("issueFailed"));
      setIssued({ url: data.url, svg: data.svg });
      setStatus((prev) => (prev ? { ...prev, active: true, createdAt: new Date().toISOString(), lastUsedAt: null } : prev));
      setConfirmReissue(false);
      toast.success(send === "telegram" ? t("sentTelegram") : send === "email" ? t("sentEmail") : t("issued"));
    } catch {
      toast.error(t("issueFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    setBusy("revoke");
    try {
      const res = await fetch(`/api/staff/${employeeId}/personal-qr`, { method: "DELETE" });
      if (!res.ok) throw new Error(t("revokeFailed"));
      setIssued(null);
      setStatus((prev) => (prev ? { ...prev, active: false } : prev));
      toast.success(t("revoked"));
    } catch {
      toast.error(t("revokeFailed"));
    } finally {
      setBusy(null);
    }
  }

  function print() {
    if (!issued) return;
    const safeName = employeeName.replace(/[<>&]/g, "");
    const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${t("printTitle")} — ${safeName}</title><style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;display:flex;justify-content:center}.card{width:105mm;padding:8mm;border:1px dashed #9b9fb3;border-radius:6mm;margin:10mm;text-align:center}h1{font-size:18px;margin:0 0 2mm}p{font-size:12px;color:#3c4053;margin:2mm 0}svg{display:block;margin:2mm auto;width:70mm;height:auto}</style></head><body><div class="card"><h1>${safeName}</h1><p>${t("printHeading")}</p>${issued.svg}<p>${t("printScan")}</p><p style="color:#9b9fb3">${t("printKeepSafe")}</p></div><script>window.onload=function(){window.print()}</script></body></html>`;
    // В приложении WeSetup новых окон нет — печатаем карточку системной печатью.
    if (getNativeBridge()) {
      void printHtml(html);
      return;
    }
    const w = window.open("", "_blank", "width=520,height=720");
    if (!w) return;
    w.document.write(html);
    w.document.close();
  }

  const disabled = busy !== null;
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-white p-4" data-testid="personal-qr-card">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
          <QrCode className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-[#0b1024]">{t("heading")}</div>
          <p className="mt-0.5 text-[12px] leading-snug text-[#6f7282]">
            {t("description")}{status && !status.hasPin ? ` ${t("pinRequired")}` : ""}
          </p>
          {status?.active && !issued ? (
            <p className="mt-1 text-[12px] text-[#116b2a]">
              {t("activeSince", { date: status.createdAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(status.createdAt)) : "—" })}
              {status.lastUsedAt ? ` · ${t("lastUsed", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(status.lastUsedAt)) })}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {issued ? (
        <div className="mt-3 flex flex-col items-center gap-2 rounded-2xl bg-[#fafbff] p-3">
          <div className="w-[180px] [&_svg]:block [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: issued.svg }} />
          <div className="break-all text-center text-[11px] text-[#9b9fb3]">{issued.url}</div>
        </div>
      ) : null}

      {confirmReissue ? (
        <div className="mt-3 rounded-2xl border border-[#ffe9b0] bg-[#fff8eb] p-3 text-[13px] text-[#7a4a00]">
          {t("reissueConfirm")}
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={disabled} onClick={() => void issue()} className="rounded-xl bg-[#5566f6] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#4a5bf0]">
              {t("yesIssue")}
            </button>
            <button type="button" onClick={() => setConfirmReissue(false)} className="rounded-xl border border-[#dcdfed] bg-white px-3 py-1.5 text-[13px]">
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {issued ? (
          <button type="button" onClick={print} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:bg-[#f5f6ff]">
            <Printer className="size-4 text-[#5566f6]" />
            {t("print")}
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => (status?.active ? setConfirmReissue(true) : void issue())}
            data-testid="personal-qr-issue"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-60"
          >
            {busy === "issue" ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
            {status?.active ? t("issueNew") : t("issue")}
          </button>
        )}
        {status?.canTelegram ? (
          <button type="button" disabled={disabled} onClick={() => void issue("telegram")} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:bg-[#f5f6ff] disabled:opacity-60">
            {busy === "telegram" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4 text-[#5566f6]" />}
            {t("telegram")}
          </button>
        ) : null}
        {status?.email ? (
          <button type="button" disabled={disabled} onClick={() => void issue("email")} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:bg-[#f5f6ff] disabled:opacity-60">
            {busy === "email" ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4 text-[#5566f6]" />}
            {t("email")}
          </button>
        ) : null}
        {status?.active ? (
          <button type="button" disabled={disabled} onClick={() => void revoke()} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2] disabled:opacity-60">
            <ShieldOff className="size-4" />
            {t("revoke")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
