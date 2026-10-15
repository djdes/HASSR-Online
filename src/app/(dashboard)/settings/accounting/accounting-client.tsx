"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Props = {
  initialEmail: string | null;
};

export function AccountingClient({ initialEmail }: Props) {
  const t = useTranslations("settingsManagement.accounting");
  const [email, setEmail] = useState(initialEmail ?? "");
  const [saved, setSaved] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

  async function save() {
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error(t("emailRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/accountant-email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!res.ok) throw new Error(t("saveFailed"));
      toast.success(t("saved", { email: trimmed }));
      setSaved(trimmed);
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/accountant-email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: null }),
      });
      if (!res.ok) throw new Error(t("disconnectFailed"));
      toast.success(t("disconnected"));
      setSaved(null);
      setEmail("");
    } catch {
      toast.error(t("disconnectFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#f5f6ff] text-[#3848c7]">
          <Mail className="size-5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-[#0b1024]">
            {t("emailTitle")}
          </div>
          {saved ? (
            <p className="mt-1 text-[13px] text-[#6f7282]">
              {t("connected")}:{" "}
              <span className="font-mono text-[#3848c7]">{saved}</span>{" "}
              · {t("reportSchedule")}
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-[#6f7282]">
              {t("emailHint")}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="accountant@yourcompany.ru"
          className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />
        <button
          type="button"
          onClick={save}
          disabled={busy || !email.trim() || email.trim() === saved}
          className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {saved ? t("save") : t("connect")}
        </button>
        {saved ? (
          <button
            type="button"
            onClick={() => setConfirmDisconnectOpen(true)}
            disabled={busy}
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#a13a32] hover:bg-[#fff4f2] disabled:opacity-50"
          >
            <Trash2 className="size-4" />
            {t("disconnect")}
          </button>
        ) : null}
      </div>

      <div className="mt-5 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[12px] leading-relaxed text-[#6f7282]">
        <span className="font-medium text-[#0b1024]">{t("emailContentsTitle")}</span>{" "}
        {t("emailContents")}
      </div>

      {/* Нативный confirm() в приложении Telegram может не показаться —
          кнопка тогда молча не срабатывает (CLAUDE.md §6). */}
      <ConfirmDialog
        open={confirmDisconnectOpen}
        onClose={() => setConfirmDisconnectOpen(false)}
        onConfirm={async () => {
          setConfirmDisconnectOpen(false);
          await disconnect();
        }}
        title={t("confirmTitle")}
        description={t("confirmDescription", { email: saved ?? "" })}
        bullets={[
          { label: t("confirmBulletSchedule"), tone: "warn" },
          { label: t("confirmBulletData"), tone: "default" },
          { label: t("confirmBulletReconnect"), tone: "info" },
        ]}
        confirmLabel={t("disconnect")}
        cancelLabel={t("cancel")}
        variant="warn"
      />
    </section>
  );
}
