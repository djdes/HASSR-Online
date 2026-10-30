"use client";

import { CheckCircle2, CircleDashed, Clock3, ExternalLink, Globe2, MailQuestion, PenLine, Repeat2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { edoStatusKind, edoStatusTone, type EdoStatusKind, type EdoStatusTone } from "@/lib/edo/saby/status";
import type { EdoRecipientCheckView } from "@/lib/edo/send-core";
import { cn } from "@/lib/utils";

/**
 * Общие куски интерфейса ЭДО: чип статуса документа, ссылка «Подписать в Saby» и итог проверки
 * получателя по ИНН. Ими пользуются страница /root/edo и кнопка EdoSendButton — обе под
 * пространством сообщений `rootEdo` (DomainMessagesBoundary).
 */

const TONE_CLASS: Record<EdoStatusTone, string> = {
  neutral: "bg-[#f5f6ff] text-[#3848c7]",
  wait: "bg-[#fff8eb] text-[#8a5a12]",
  ok: "bg-[#ecfdf5] text-[#116b2a]",
  bad: "bg-[#fff4f2] text-[#a13a32]",
};

function StatusIcon({ kind }: { kind: EdoStatusKind }) {
  const cls = "size-3.5 shrink-0";
  if (kind === "draft") return <PenLine className={cls} />;
  if (kind === "done") return <CheckCircle2 className={cls} />;
  if (kind === "rejected" || kind === "error" || kind === "not_written") return <XCircle className={cls} />;
  if (kind === "writing" || kind === "processing") return <CircleDashed className={cls} />;
  return <Clock3 className={cls} />;
}

export function EdoStatusChip({
  stateCode,
  deletedAt,
  error,
  stateName,
}: {
  stateCode: number | null;
  deletedAt: string | null;
  error: string | null;
  stateName?: string | null;
}) {
  const t = useTranslations("rootEdo");
  const kind = edoStatusKind({ stateCode, deletedAt, error });
  const label = kind === "unknown" ? stateName || t("status.unknown", { code: String(stateCode ?? "—") }) : t(`status.${kind}`);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium", TONE_CLASS[edoStatusTone(kind)])}
      title={stateName || undefined}
      data-testid="edo-status-chip"
      data-kind={kind}
    >
      <StatusIcon kind={kind} />
      {label}
    </span>
  );
}

/** Ссылка на карточку документа в Saby — там КЭП и «Подписать и отправить». */
export function EdoSignLink({ href, className, compact = false }: { href: string; className?: string; compact?: boolean }) {
  const t = useTranslations("rootEdo");
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      data-testid="edo-sign-link"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-2xl bg-[#5566f6] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
        compact ? "h-8 px-3 text-[12.5px]" : "h-10 px-4 text-[14px]",
        className,
      )}
    >
      <PenLine className="size-4" />
      {t("sign.open")}
      <ExternalLink className="size-3.5 opacity-80" />
    </a>
  );
}

const RECIPIENT_TONE: Record<EdoRecipientCheckView["kind"], string> = {
  saby: "border-[#cdeedd] bg-[#ecfdf5] text-[#116b2a]",
  roaming: "border-[#d9defc] bg-[#f5f6ff] text-[#3848c7]",
  invited: "border-[#f6e1bd] bg-[#fff8eb] text-[#8a5a12]",
  none: "border-[#f6e1bd] bg-[#fff8eb] text-[#8a5a12]",
};

/** Итог «определения по ИНН»: куда Saby доставит документ. */
export function EdoRecipientNote({ check, className }: { check: EdoRecipientCheckView; className?: string }) {
  const t = useTranslations("rootEdo");
  const Icon = check.kind === "saby" ? CheckCircle2 : check.kind === "roaming" ? Repeat2 : check.kind === "invited" ? MailQuestion : Globe2;
  return (
    <div className={cn("flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-[13.5px] leading-snug", RECIPIENT_TONE[check.kind], className)} data-testid="edo-recipient-note" data-kind={check.kind}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{t(`recipient.${check.kind}.title`, { operator: check.operator || "—" })}</div>
        <div className="mt-0.5 text-[12.5px] opacity-90">{t(`recipient.${check.kind}.hint`)}</div>
        {check.participantId || check.statusText ? (
          <div className="mt-1 break-all text-[12px] opacity-75">
            {[check.participantId && t("recipient.participantId", { id: check.participantId }), check.statusText].filter(Boolean).join(" · ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
