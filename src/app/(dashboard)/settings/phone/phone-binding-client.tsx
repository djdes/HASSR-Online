"use client";
import { RU_PHONE_PLACEHOLDER, phoneInputProps } from "@/lib/phone-input";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pencil,
  Send,
  Trash2,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Props = {
  initialPhone: string | null;
  initialDisplay: string;
  hasIntegration: boolean;
  hasLink: boolean;
  linkSource: string | null;
  userName: string;
  telegramLinked: boolean;
};

type AutolinkResult = { reasonCode?: string; reasonParams?: { status?: unknown } } & (
  | { ok: true; linked: boolean; reason?: string }
  | { ok: false; reason: string });

type PutResponse = {
  phone?: string;
  display?: string;
  autolink?: AutolinkResult;
  error?: string;
  errorCode?: string;
  errorParams?: { name?: unknown };
};

type PhoneTranslator = ReturnType<typeof useTranslations<"phoneBinding">>;

export function phoneAutolinkReason(result: AutolinkResult, t: PhoneTranslator): string {
  const reason = result.reasonCode ?? result.reason;
  switch (reason) {
    case "no-integration": return t("autolink.noIntegration");
    case "no-tf-user-with-phone": return t("autolink.noEmployee");
    case "commission-member": return t("autolink.commissionMember");
    case "already-linked": return t("autolink.alreadyLinked");
    case "invalid-phone": return t("autolink.invalidPhone");
    case "crypto-error": return t("autolink.cryptoError");
    case undefined: return t("autolink.unknownReason");
  }
  const legacyStatus = /^tasksflow-(create-)?([1-5]\d{2})$/.exec(reason);
  const status = result.reasonParams?.status ?? (legacyStatus ? Number(legacyStatus[2]) : undefined);
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
    if (reason === "tasksflow-create-status" || legacyStatus?.[1]) return t("autolink.tasksflowCreateStatus", { status: String(status) });
    if (reason === "tasksflow-status" || legacyStatus) return t("autolink.tasksflowStatus", { status: String(status) });
  }
  return t("autolink.unavailable");
}

export function phoneResponseError(data: PutResponse | null, t: PhoneTranslator): string {
  switch (data?.errorCode) {
    case "PHONE_UNAUTHORIZED": return t("errors.unauthorized");
    case "PHONE_INVALID_REQUEST": return t("errors.invalidRequest");
    case "PHONE_INVALID_FORMAT": return t("errors.invalidPhone");
    case "PHONE_DUPLICATE":
      if (typeof data.errorParams?.name === "string") return t("errors.duplicatePhone", { name: data.errorParams.name });
  }
  return t("toast.saveFailed");
}

export function PhoneBindingClient(props: Props) {
  const t = useTranslations("phoneBinding");
  const copy = useRef(t);
  copy.current = t;
  const router = useRouter();
  const [phone, setPhone] = useState(props.initialPhone ?? "");
  const [editing, setEditing] = useState(props.initialPhone === null);
  const [display, setDisplay] = useState(props.initialDisplay);
  const [savedPhone, setSavedPhone] = useState(props.initialPhone);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [linkState, setLinkState] = useState<{
    hasLink: boolean;
    reason: string | null;
  }>({
    hasLink: props.hasLink,
    reason: null,
  });

  async function save() {
    if (busy) return;
    if (phone.trim().length < 10) {
      toast.error(t("input.tooShort"));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/users/me/phone", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = (await response.json().catch(() => null)) as PutResponse | null;
      if (!response.ok || !data?.phone) {
        toast.error(phoneResponseError(data, copy.current));
        return;
      }
      setSavedPhone(data.phone);
      setDisplay(data.display ?? data.phone);
      setPhone(data.phone);
      setEditing(false);

      const autolink = data.autolink;
      if (!autolink) {
        toast.success(copy.current("toast.saved"));
      } else if (autolink.ok && autolink.linked) {
        toast.success(
          copy.current("toast.savedLinked")
        );
        setLinkState({ hasLink: true, reason: null });
      } else if (autolink.ok && !autolink.linked) {
        const why = phoneAutolinkReason(autolink, copy.current);
        toast.success(copy.current("toast.savedUnlinked", { reason: why }));
        setLinkState({ hasLink: false, reason: why });
      } else {
        toast.success(
          copy.current("toast.savedUnavailable", { reason: phoneAutolinkReason(autolink, copy.current) })
        );
        setLinkState({ hasLink: false, reason: autolink.reason ?? null });
      }
      router.refresh();
    } catch {
      toast.error(copy.current("toast.networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    setDeleteOpen(false);
    setBusy(true);
    try {
      const response = await fetch("/api/users/me/phone", { method: "DELETE" });
      if (!response.ok) {
        toast.error(copy.current("toast.deleteFailed"));
        return;
      }
      setSavedPhone(null);
      setDisplay("");
      setPhone("");
      setEditing(true);
      setLinkState({ hasLink: false, reason: null });
      toast.success(copy.current("toast.deleted"));
      router.refresh();
    } catch {
      toast.error(copy.current("toast.networkError"));
    } finally {
      setBusy(false);
    }
  }

  const statusTone = savedPhone
    ? linkState.hasLink
      ? "success"
      : "warn"
    : "muted";

  const statusCopy =
    savedPhone === null
      ? t("status.empty")
      : linkState.hasLink
        ? t("status.linked")
        : t("status.savedUnlinked");

  const toneCls =
    statusTone === "success"
      ? "border-[#c8f0d5] bg-[#effaf1] text-[#136b2a]"
      : statusTone === "warn"
        ? "border-[#ffe5c2] bg-[#fff8eb] text-[#b25f00]"
        : "border-[#ececf4] bg-[#fafbff] text-[#6f7282]";

  return (
    <>
    <ConfirmDialog
      open={deleteOpen}
      onClose={() => setDeleteOpen(false)}
      onConfirm={() => void clear()}
      title={t("confirmation.title")}
      description={t("confirmation.description")}
      bullets={[
        { label: t("confirmation.tasksPaused"), tone: "warn" },
        { label: t("confirmation.linkRemoved"), tone: "warn" },
        { label: t("confirmation.canReenter"), tone: "info" },
      ]}
      confirmLabel={t("confirmation.confirm")}
      cancelLabel={t("confirmation.cancel")}
      variant="danger"
    />
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      {/* LEFT — the form */}
      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
        <div
          className={`mb-5 flex items-center gap-3 rounded-2xl border px-4 py-3 ${toneCls}`}
        >
          {statusTone === "success" ? (
            <CheckCircle2 className="size-5 shrink-0" />
          ) : statusTone === "warn" ? (
            <Unlink className="size-5 shrink-0" />
          ) : (
            <Pencil className="size-5 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-[14px] font-medium">{statusCopy}</div>
            {savedPhone ? (
              <div className="mt-0.5 text-[13px] opacity-80 tabular-nums">
                {display || savedPhone}
              </div>
            ) : null}
          </div>
        </div>

        {editing ? (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="phone-input"
                className="block text-[13px] font-medium text-[#0b1024]"
              >
                {t("input.label")}
              </label>
              <Input
                id="phone-input"
                type="tel"
                {...phoneInputProps(phone, setPhone)}
                placeholder={RU_PHONE_PLACEHOLDER}
                className="mt-1.5 h-12 rounded-2xl border-[#dcdfed] text-[15px]"
              />
              <p className="mt-1.5 text-[12px] text-[#6f7282]">
                {t.rich("input.help", { format: chunks => <span className="tabular-nums">{chunks}</span> })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={save}
                disabled={busy || phone.trim().length < 10}
                className="h-11 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0]"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {savedPhone ? t("actions.saveNew") : t("actions.save")}
              </Button>
              {savedPhone ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPhone(savedPhone);
                    setEditing(false);
                  }}
                  disabled={busy}
                  className="h-11 rounded-2xl border-[#dcdfed] px-5 text-[14px] text-[#3c4053]"
                >
                  {t("actions.cancel")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="h-10 rounded-lg border-0 bg-[#5566f6]/[0.04] px-5 text-[14px] font-semibold text-[#5566f6]"
            >
              <Pencil className="size-4" />
              {t("actions.edit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(true)}
              disabled={busy}
              className="h-11 rounded-2xl border-[#ffd2cd] px-5 text-[14px] text-[#a13a32] hover:bg-[#fff4f2]"
            >
              <Trash2 className="size-4" />
              {t("actions.delete")}
            </Button>
          </div>
        )}
      </section>

      {/* RIGHT — explanatory sidebar */}
      <aside className="space-y-4">
        <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("sidebar.purposeTitle")}
          </div>
          <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-[#3c4053]">
            <li className="flex gap-2">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
              <span>
                {t.rich("sidebar.tasksflow", { b: chunks => <b>{chunks}</b> })}
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
              <span>
                {t.rich("sidebar.qr", { b: chunks => <b>{chunks}</b> })}
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
              <span>
                {t.rich("sidebar.notifications", { b: chunks => <b>{chunks}</b> })}
              </span>
            </li>
          </ul>
        </div>

        <div className="rounded-3xl border border-[#ececf4] bg-white p-5">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("sidebar.quickNavigation")}
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {props.hasIntegration ? (
              <Link
                href="/settings/integrations/tasksflow"
                className="inline-flex items-center gap-2 rounded-lg border-0 bg-[#5566f6]/[0.04] px-3 py-2 text-[14px] font-semibold text-[#5566f6] hover:bg-[#5566f6]/[0.09]"
              >
                <ExternalLink className="size-4" />
                {t("sidebar.tasksflowSettings")}
              </Link>
            ) : (
              <Link
                href="/settings/integrations/tasksflow"
                className="inline-flex items-center gap-2 rounded-xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-3 py-2 text-[13px] font-medium text-[#6f7282] hover:bg-[#f5f6ff]"
              >
                <ExternalLink className="size-4" />
                {t("sidebar.connectTasksflow")}
              </Link>
            )}
            <Link
              href="/settings/notifications"
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium ${
                props.telegramLinked
                  ? "border-[#c8f0d5] bg-[#effaf1] text-[#136b2a]"
                  : "border-0 bg-[#5566f6]/[0.04] text-[#5566f6] hover:bg-[#5566f6]/[0.09]"
              }`}
            >
              <ExternalLink className="size-4" />
              {props.telegramLinked ? t("sidebar.telegramLinked") : t("sidebar.linkTelegram")}
            </Link>
          </div>
        </div>
      </aside>
    </div>
    </>
  );
}
