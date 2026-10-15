"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { brandQrHeightFor } from "@/lib/brand-qr-shared";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  StaffEmployee,
  StaffTelegramInvitePayload,
} from "@/components/staff/staff-types";

type Close = { onClose: () => void; open: boolean };

function shell(title: string, body: React.ReactNode, footer?: React.ReactNode) {
  return (
    <>
      <DialogHeader className="shrink-0 border-b px-4 py-5 sm:pl-6 pr-14">
        <DialogTitle className="text-[18px] font-semibold text-[#0b1024]">
          {title}
        </DialogTitle>
        <DialogDescription className="sr-only">{title}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6">{body}</div>
      {footer ? (
        <DialogFooter className="shrink-0 bg-white flex-row justify-end gap-2 border-t px-4 py-4 sm:px-6">
          {footer}
        </DialogFooter>
      ) : null}
    </>
  );
}

export function StaffTelegramInviteDialog(props: {
  employee: StaffEmployee;
  mode: "invite" | "rebind";
  botUrl: string | null;
  pending: boolean;
  error: string | null;
  invite: StaffTelegramInvitePayload | null;
} & Close) {
  const t = useTranslations("staffManagement.telegram");
  const { employee, mode, botUrl, onClose, open, pending, error, invite } = props;
  const [copied, setCopied] = useState(false);

  async function copyInviteUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  const title =
    mode === "rebind"
      ? t("rebindTitle", { name: employee.name })
      : t("inviteTitle", { name: employee.name });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        {shell(
          title,
          pending ? (
            <div className="py-8 text-center text-[14px] text-[#6f7282]">
              {t("preparing")}
            </div>
          ) : error ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[13px] text-[#d2453d]">
                {error}
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={onClose} className="h-11 rounded-xl">
                  {t("close")}
                </Button>
              </div>
            </div>
          ) : invite ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#eef0fb] bg-[#f8f9ff] p-3 text-[13px] leading-5 text-[#5464ff]">
                {mode === "rebind"
                  ? t("rebindReady")
                  : t("inviteReady")}
              </div>
              <div className="flex justify-center">
                <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5">
                  <Image
                    src={invite.qrPngDataUrl}
                    alt={t("qrAlt")}
                    width={220}
                    height={brandQrHeightFor(220)}
                    className="h-auto"
                    unoptimized
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={invite.inviteUrl}
                  className="h-11 rounded-xl border-[#dcdfed] bg-white text-[13px] text-[#0b1024]"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copyInviteUrl(invite.inviteUrl)}
                  className="h-11 rounded-xl px-3"
                >
                  <Copy className="size-4" />
                  {copied ? t("copied") : t("copy")}
                </Button>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="h-11 rounded-xl"
                >
                  {t("done")}
                </Button>
                <Button
                  type="button"
                  asChild
                  className="h-11 rounded-xl bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
                >
                  <a href={invite.inviteUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1.5 size-4" />
                    {t("openTelegram")}
                  </a>
                </Button>
                {employee.telegramLinked && botUrl ? (
                  <Button type="button" variant="outline" asChild className="h-11 rounded-xl">
                    <a href={botUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1.5 size-4" />
                      {t("openBotChat")}
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null
        )}
      </DialogContent>
    </Dialog>
  );
}

export function StaffUnlinkTelegramDialog(props: {
  employee: StaffEmployee;
  pending?: boolean;
  onConfirm: () => void;
} & Close) {
  const t = useTranslations("staffManagement.telegram");
  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]">
        {shell(
          t("unlinkTitle", { name: props.employee.name }),
          <div className="space-y-3 text-[13px] leading-5 text-[#3c4053]">
            <p>
              {t("unlinkDescription")}
            </p>
            <p className="text-[#6f7282]">
              {t("unlinkNextStep")}
            </p>
          </div>,
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={props.onClose}
              disabled={props.pending}
              className="h-11 rounded-xl"
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              onClick={props.onConfirm}
              disabled={props.pending}
              className="h-11 rounded-xl bg-[#d2453d] text-white hover:bg-[#bd392f]"
            >
              {props.pending ? "..." : t("unlink")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
