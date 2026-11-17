"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Hourglass, Loader2, MailCheck, MessageSquareHeart, Send } from "lucide-react";
import { toast } from "sonner";

/**
 * «Служебные письма» в карточке клиента (спека trial-emails-rename-2026-11):
 * приветственное, «пробный заканчивается» и «удалось оценить журналы?» —
 * владельцу организации, вручную, тем же шаблоном, что у автоматики.
 */

const KINDS = [
  { kind: "welcome", icon: MailCheck },
  { kind: "trial_reminder", icon: Hourglass },
  { kind: "trial_feedback", icon: MessageSquareHeart },
] as const;

type Kind = (typeof KINDS)[number]["kind"];

export function ServiceEmailsCard({ organizationId, ownerEmail }: { organizationId: string; ownerEmail: string | null }) {
  const t = useTranslations("rootOrganizationManagement.serviceEmails");
  const [busy, setBusy] = useState<Kind | null>(null);

  async function send(kind: Kind) {
    if (!window.confirm(t("confirm", { title: t(`${kind}.title`), email: ownerEmail ?? "—" }))) return;
    setBusy(kind);
    try {
      const res = await fetch(`/api/root/organizations/${encodeURIComponent(organizationId)}/service-emails`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const data = (await res.json().catch(() => ({}))) as { to?: string; error?: string };
      if (res.ok) toast.success(t("sent", { email: data.to ?? ownerEmail ?? "" }));
      else toast.error(data.error ?? t("failed"));
    } catch {
      toast.error(t("failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6" data-testid="service-emails">
      <div className="text-[16px] font-semibold text-[#0b1024]">{t("title")}</div>
      <p className="mt-1 text-[13px] leading-[1.5] text-[#6f7282]">
        {ownerEmail ? t("description", { email: ownerEmail }) : t("noEmail")}
      </p>
      <ul className="mt-4 divide-y divide-[#ececf4]">
        {KINDS.map(({ kind, icon: Icon }) => (
          <li key={kind} className="flex items-center gap-3 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f5f6ff] text-[#3848c7]">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium text-[#0b1024]">{t(`${kind}.title`)}</span>
              <span className="block text-[12.5px] leading-[1.45] text-[#6f7282]">{t(`${kind}.hint`)}</span>
            </span>
            <button
              type="button"
              disabled={!ownerEmail || busy !== null}
              onClick={() => send(kind)}
              data-testid={`service-email-${kind}`}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-[#dcdfed] px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:bg-[#f4f4f6] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === kind ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {t("send")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
