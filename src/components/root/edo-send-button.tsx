"use client";

import { Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { EdoKind } from "@/lib/edo/registry";
import type { EdoDocumentView, EdoRecipientCheckView } from "@/lib/edo/send-core";
import { cn } from "@/lib/utils";

import { EdoRecipientNote, EdoSignLink } from "./edo-status";

/**
 * «Отправить в ЭДО» одним кликом для документа из WeSetup (счёт, УПД, договор): документ
 * записывается в Saby черновиком от ООО «БФС», получатель определяется по ИНН организации, а
 * кнопка превращается в ссылку «Подписать в Saby» — подписывает КЭП и отправляет человек в Saby.
 * Без подключённого кабинета кнопка неактивна и объясняет, где его подключить.
 *
 * Страница, где стоит кнопка, должна отдавать клиенту сообщения `rootEdo`
 * (`<DomainMessagesBoundary namespaces={["rootEdo"]}>`). Только для ROOT: API — /api/root/edo/**.
 */
export interface EdoSendButtonProps {
  organizationId: string;
  kind: EdoKind;
  sourceId: string;
  label?: string;
  /** Dense lists: no explanation under a disabled button, only its tooltip. */
  quiet?: boolean;
  className?: string;
}

type CabinetState = { ready: boolean; reason: string | null };

/** Состояние кабинета — один запрос на страницу, сколько бы кнопок на ней ни было. */
let cabinetPromise: Promise<CabinetState> | null = null;

function loadCabinetState(): Promise<CabinetState> {
  if (!cabinetPromise) {
    cabinetPromise = fetch("/api/root/edo/cabinet", { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { cabinet?: { ready?: boolean } | null } | null;
        if (!res.ok) return { ready: false, reason: "error" };
        if (!data?.cabinet) return { ready: false, reason: "not_connected" };
        return { ready: !!data.cabinet.ready, reason: data.cabinet.ready ? null : "not_ready" };
      })
      .catch(() => ({ ready: false, reason: "error" }));
    // Сбой не запоминаем: следующая кнопка спросит снова.
    void cabinetPromise.then((s) => {
      if (s.reason === "error") cabinetPromise = null;
    });
  }
  return cabinetPromise;
}

export function EdoSendButton({ organizationId, kind, sourceId, label, quiet = false, className }: EdoSendButtonProps) {
  const t = useTranslations("rootEdo");
  const [cabinet, setCabinet] = useState<CabinetState | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ document: EdoDocumentView; recipient: EdoRecipientCheckView | null } | null>(null);

  useEffect(() => {
    let alive = true;
    void loadCabinetState().then((s) => {
      if (alive) setCabinet(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function send() {
    setBusy(true);
    try {
      const res = await fetch("/api/root/edo/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, kind, sourceId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { document?: EdoDocumentView; recipient?: EdoRecipientCheckView | null; rewritten?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.document) {
        toast.error(data?.error ?? t("errors.generic"));
        return;
      }
      setSent({ document: data.document, recipient: data.recipient ?? null });
      const signUrl = data.document.signUrl;
      toast.success(data.rewritten ? t("send.rewritten") : t("send.done"), {
        description: t("send.nextStep"),
        ...(signUrl ? { action: { label: t("sign.open"), onClick: () => window.open(signUrl, "_blank", "noopener") } } : {}),
      });
    } catch {
      toast.error(t("errors.network"));
    } finally {
      setBusy(false);
    }
  }

  if (sent?.document.signUrl) {
    return (
      <div className={cn("inline-flex flex-col gap-2", className)}>
        <EdoSignLink href={sent.document.signUrl} compact />
        {sent.recipient ? <EdoRecipientNote check={sent.recipient} className="max-w-[360px]" /> : null}
      </div>
    );
  }

  const disabled = busy || !cabinet?.ready;
  const hint = !cabinet ? undefined : cabinet.ready ? t("button.hint") : t(`button.disabled.${cabinet.reason === "not_connected" ? "notConnected" : cabinet.reason === "not_ready" ? "notReady" : "error"}`);
  return (
    <span className={cn("inline-flex flex-col gap-1", className)}>
      <button
        type="button"
        onClick={() => void send()}
        disabled={disabled}
        title={hint}
        data-testid="edo-send-button"
        className="inline-flex h-9 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy || !cabinet ? <Loader2 className="size-4 animate-spin text-[#5566f6]" /> : <Send className="size-4 text-[#5566f6]" />}
        {label ?? t("button.label")}
      </button>
      {cabinet && !cabinet.ready && !quiet ? (
        <span className="max-w-[320px] text-[12px] leading-snug text-[#6f7282]">
          {hint}{" "}
          <a href="/root/edo" className="font-medium text-[#3848c7] hover:underline">
            {t("button.openSettings")}
          </a>
        </span>
      ) : null}
    </span>
  );
}
