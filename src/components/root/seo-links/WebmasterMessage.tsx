"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SEO_BTN_PRIMARY_CLASS, SEO_BTN_SM_CLASS } from "./types";

type MessageStatus = "sent" | "unavailable" | "duplicate" | "unconfirmed" | "invalid" | "changed" | "error";

export function WebmasterMessage({ slotId, siteId, domain }: { slotId: string; siteId: number; domain: string }) {
  const t = useTranslations("rootGglFirstMessage");
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<MessageStatus | null>(null);

  async function sendMessage() {
    if (sending || !body.trim()) return;
    setSending(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/root/gogetlinks/slots/${encodeURIComponent(slotId)}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, body }),
      });
      const payload: { status?: string } | null = await response.json().catch(() => null);
      switch (payload?.status) {
        case "sent":
          setBody("");
          setStatus("sent");
          break;
        case "unavailable":
        case "duplicate":
        case "unconfirmed":
        case "invalid":
        case "changed":
          setStatus(payload.status);
          break;
        default:
          setStatus("error");
      }
    } catch {
      setStatus("unconfirmed");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={value => { if (!sending) setOpen(value); }}>
      <DialogTrigger asChild>
        <button type="button" className={SEO_BTN_SM_CLASS}>
          <MessageSquare className="size-3.5" aria-hidden />
          {t("open")}
        </button>
      </DialogTrigger>
      <DialogContent showCloseButton={!sending}>
        <DialogTitle>{t("title", { domain })}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void sendMessage(); }}>
          <Textarea
            aria-label={t("body")}
            placeholder={t("body")}
            value={body}
            onChange={event => { setBody(event.target.value); setStatus(null); }}
            maxLength={8000}
            rows={5}
            disabled={sending}
            className="rounded-2xl border-[#dcdfed]"
          />
          {status ? <p role="status" className="text-sm text-[#6f7282] dark:text-slate-300">{t(status)}</p> : null}
          <DialogFooter>
            <Button type="submit" className={SEO_BTN_PRIMARY_CLASS} disabled={sending || !body.trim() || status === "unconfirmed" || status === "duplicate"}>
              {t(sending ? "sending" : "send")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
