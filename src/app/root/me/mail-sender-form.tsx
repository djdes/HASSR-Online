"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, CircleAlert, CircleDashed, Loader2, Mail, PenLine, Server } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SMTP_PROVIDER_PRESETS } from "@/lib/platform-mail";
import type { MailSenderView } from "@/lib/platform-mail.server";
import { cn } from "@/lib/utils";

type Form = {
  fromName: string;
  fromEmail: string;
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  replyTo: string;
  position: string;
  phone: string;
  signature: string;
};

const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#0b1024] outline-none transition-colors placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15";

export function MailSenderForm({
  initial,
  defaults,
}: {
  initial: MailSenderView | null;
  defaults: { fromName: string; fromEmail: string; phone: string; position: string };
}) {
  const t = useTranslations("rootPanel.me");
  const locale = useLocale();
  const [sender, setSender] = useState(initial);
  const [form, setForm] = useState<Form>({
    fromName: initial?.fromName ?? defaults.fromName,
    fromEmail: initial?.fromEmail ?? defaults.fromEmail,
    host: initial?.host ?? "",
    port: String(initial?.port ?? 465),
    secure: initial?.secure ?? true,
    username: initial?.username ?? defaults.fromEmail,
    password: "",
    replyTo: initial?.replyTo ?? "",
    position: initial?.position ?? defaults.position,
    phone: initial?.phone ?? defaults.phone,
    signature: initial?.signature ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "verify" | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };

  async function verify() {
    setBusy("verify");
    try {
      const response = await fetch("/api/root/me/mail/test", { method: "POST" });
      const data = (await response.json()) as { ok?: boolean; error?: string; sender?: MailSenderView };
      if (data.sender) setSender(data.sender);
      if (data.ok) toast.success(t("verified", { email: data.sender?.fromEmail ?? form.fromEmail }));
      else toast.error(t("failed"), { description: data.error });
    } finally {
      setBusy(null);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy("save");
    try {
      const response = await fetch("/api/root/me/mail", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, port: Number(form.port) }),
      });
      const data = (await response.json()) as { error?: string; fieldErrors?: Record<string, string>; sender?: MailSenderView };
      if (!response.ok) {
        setErrors(data.fieldErrors ?? {});
        toast.error(data.error ?? t("errorGeneric"));
        return;
      }
      if (data.sender) setSender(data.sender);
      set("password", "");
    } finally {
      setBusy(null);
    }
    await verify();
  }

  async function disable() {
    const response = await fetch("/api/root/me/mail", { method: "DELETE" });
    const data = (await response.json()) as { sender?: MailSenderView };
    if (data.sender) setSender(data.sender);
    toast.success(t("disabled"));
  }

  const status = sender?.status ?? "none";
  const StatusIcon = status === "verified" ? CheckCircle2 : status === "error" ? CircleAlert : CircleDashed;
  const statusText =
    status === "verified" && sender?.verifiedAt
      ? t("status.verified", { date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(sender.verifiedAt)) })
      : status === "error"
        ? t("status.error", { error: sender?.lastError ?? "" })
        : status === "none"
          ? t("status.none")
          : status === "unverified"
            ? t("status.unverified")
            : t("status.disabled");

  const field = (key: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{label}</span>
      <input
        value={String(form[key])}
        onChange={(event) => set(key, event.target.value as never)}
        className={cn(INPUT, errors[key] && "border-[#e2574c] focus:border-[#e2574c] focus:ring-[#e2574c]/15")}
        name={key}
        {...props}
      />
      {errors[key] ? <span className="mt-1 block text-[12px] text-[#a13a32]">{errors[key]}</span> : null}
    </label>
  );

  return (
    <form onSubmit={save} className="space-y-5" data-mail-sender-form>
      <div
        className={cn(
          "flex items-start gap-3 rounded-2xl border px-4 py-3 text-[14px]",
          status === "verified" ? "border-[#bfe8cf] bg-[#ecfdf5] text-[#116b2a]" : status === "error" ? "border-[#f3c7c2] bg-[#fff4f2] text-[#a13a32]" : "border-[#ececf4] bg-[#fafbff] text-[#3c4053]",
        )}
        data-mail-status={status}
      >
        <StatusIcon className="mt-0.5 size-4 shrink-0" />
        <div>
          <div className="font-medium">{statusText}</div>
          {status !== "verified" ? <div className="mt-0.5 text-[13px] opacity-80">{t("fallback")}</div> : null}
        </div>
      </div>

      <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6">
        <div className="flex items-center gap-2 text-[16px] font-semibold text-[#0b1024]">
          <Server className="size-4 text-[#5566f6]" />
          {t("connectionTitle")}
        </div>
        <div className="mt-4">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("presets")}</div>
          <div className="flex flex-wrap gap-2">
            {SMTP_PROVIDER_PRESETS.map((preset) => {
              const active = form.host === preset.host;
              return (
                <button
                  key={preset.key}
                  type="button"
                  title={preset.hint}
                  data-smtp-preset={preset.key}
                  onClick={() => setForm((current) => ({ ...current, host: preset.host, port: String(preset.port), secure: preset.secure }))}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors duration-150",
                    active ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]" : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
                  )}
                >
                  {preset.title}
                </button>
              );
            })}
          </div>
          {SMTP_PROVIDER_PRESETS.find((preset) => preset.host === form.host) ? (
            <p className="mt-2 text-[12.5px] text-[#6f7282]">{SMTP_PROVIDER_PRESETS.find((preset) => preset.host === form.host)?.hint}</p>
          ) : null}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {field("fromName", t("fields.fromName"), { placeholder: t("placeholders.fromName"), autoComplete: "name" })}
          {field("fromEmail", t("fields.fromEmail"), { placeholder: t("placeholders.fromEmail"), type: "email", autoComplete: "email" })}
          {field("host", t("fields.host"), { placeholder: t("placeholders.host") })}
          <div className="grid grid-cols-[110px_minmax(0,1fr)] items-end gap-3">
            {field("port", t("fields.port"), { inputMode: "numeric" })}
            <label className="flex h-11 cursor-pointer items-center gap-2 rounded-2xl border border-[#dcdfed] px-3 text-[13px] text-[#3c4053]">
              <input type="checkbox" checked={form.secure} onChange={(event) => set("secure", event.target.checked)} className="size-4 accent-[#5566f6]" />
              {t("fields.secure")}
            </label>
          </div>
          {field("username", t("fields.username"), { placeholder: t("placeholders.username"), autoComplete: "username" })}
          {field("password", t("fields.password"), {
            type: "password",
            autoComplete: "new-password",
            placeholder: sender?.hasPassword ? t("fields.passwordKeep") : "",
          })}
          <div className="sm:col-span-2">{field("replyTo", t("fields.replyTo"), { placeholder: t("placeholders.replyTo"), type: "email" })}</div>
        </div>
      </section>

      <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6">
        <div className="flex items-center gap-2 text-[16px] font-semibold text-[#0b1024]">
          <PenLine className="size-4 text-[#5566f6]" />
          {t("signatureTitle")}
        </div>
        <p className="mt-1 text-[13px] text-[#6f7282]">{t("signatureHint")}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {field("position", t("fields.position"), { placeholder: t("placeholders.position") })}
          {field("phone", t("fields.phone"), { placeholder: t("placeholders.phone"), type: "tel" })}
          <div className="sm:col-span-2">{field("signature", t("fields.signature"), { placeholder: t("placeholders.signature") })}</div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy !== null}
          className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
          {busy === "save" ? t("saving") : busy === "verify" ? t("verifying") : t("save")}
        </button>
        {sender ? (
          <button
            type="button"
            onClick={verify}
            disabled={busy !== null}
            className="inline-flex h-12 items-center rounded-2xl border border-[#dcdfed] bg-white px-5 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
          >
            {t("test")}
          </button>
        ) : null}
        {sender?.enabled ? (
          <button type="button" onClick={() => setDisableOpen(true)} className="text-[13px] font-medium text-[#a13a32] hover:text-[#7f2b25]">
            {t("disable")}
          </button>
        ) : null}
      </div>

      <ConfirmDialog
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        onConfirm={async () => {
          await disable();
          setDisableOpen(false);
        }}
        variant="warn"
        title={t("disableTitle")}
        description={t("disableBody")}
        confirmLabel={t("disable")}
      />
    </form>
  );
}
