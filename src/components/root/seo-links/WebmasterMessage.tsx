"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SEO_BTN_PRIMARY_CLASS, SEO_BTN_SM_CLASS } from "./types";

type MessageStatus = "sent" | "unavailable" | "duplicate" | "unconfirmed" | "invalid" | "changed" | "error" | "draftError";

export function WebmasterMessage({ slotId, siteId, domain }: { slotId: string; siteId: number; domain: string }) {
  const t = useTranslations("rootGglFirstMessage");
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<MessageStatus | null>(null);
  const draftRequest = useRef<AbortController | null>(null);
  const messageUrl = `/api/root/gogetlinks/slots/${encodeURIComponent(slotId)}/message`;

  useEffect(() => () => draftRequest.current?.abort(), []);

  async function generateDraft() {
    if (sending || draftRequest.current) return;
    const operation = new AbortController();
    draftRequest.current = operation;
    const { signal } = operation;
    setGenerating(true);
    setStatus(null);
    try {
      const draftUrl = `${messageUrl}/draft`;
      const queued = await fetch(draftUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId }),
        signal,
      });
      const job = await queued.json();
      if (job.status === "changed") { setStatus("changed"); return; }
      if (!queued.ok || typeof job.ticket !== "string") throw new Error("Draft submission failed");
      const query = new URLSearchParams({ siteId: String(siteId), ticket: job.ticket });
      const deadline = Date.now() + 4 * 60_000;
      while (!signal.aborted && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const response = await fetch(`${draftUrl}?${query}`, { signal, cache: "no-store" });
        const result = await response.json();
        if (result.status === "waiting") continue;
        if (result.status === "changed") { setStatus("changed"); return; }
        if (result.status === "ready" && typeof result.body === "string") {
          setBody(result.body);
          return;
        }
        break;
      }
      if (!signal.aborted) setStatus("draftError");
    } catch {
      if (!signal.aborted) setStatus("draftError");
    } finally {
      draftRequest.current = null;
      if (!signal.aborted) setGenerating(false);
    }
  }

  async function sendMessage() {
    if (sending || draftRequest.current || !body.trim()) return;
    setSending(true);
    setStatus(null);
    try {
      const response = await fetch(messageUrl, {
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
            disabled={sending || generating}
            className="rounded-2xl border-[#dcdfed]"
          />
          {status ? <p role="status" className="text-sm text-[#6f7282] dark:text-slate-300">{t(status)}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={sending || generating} onClick={() => void generateDraft()}>
              <Sparkles className="size-4" aria-hidden />
              {t(generating ? "generating" : body.trim() ? "replaceDraft" : "generate")}
            </Button>
            <Button type="submit" className={SEO_BTN_PRIMARY_CLASS} disabled={sending || generating || !body.trim() || status === "unconfirmed" || status === "duplicate"}>
              {t(sending ? "sending" : "send")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
