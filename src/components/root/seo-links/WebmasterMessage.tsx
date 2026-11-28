"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Lock, MessageSquare, Sparkles, Unlock } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SEO_BTN_OUTLINE_CLASS, SEO_BTN_PRIMARY_CLASS, SEO_BTN_SM_CLASS } from "./types";
import { clearSentWebmasterMessageDraft, saveWebmasterMessageDraft, webmasterMessageDraftKey } from "./webmaster-message-storage";

type MessageStatus = "sent" | "unavailable" | "duplicate" | "unconfirmed" | "invalid" | "changed" | "error" | "draftError";

export function WebmasterMessage({
  slotId,
  siteId,
  domain,
  gglCampaignId = null,
  initialPmOpen = null,
  userId,
  onSent,
}: {
  slotId: string;
  siteId: number;
  domain: string;
  gglCampaignId?: number | null;
  initialPmOpen?: boolean | null;
  userId: string;
  onSent?: () => void;
}) {
  const t = useTranslations("rootGglFirstMessage");
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<MessageStatus | null>(null);
  const [pmOpen, setPmOpen] = useState<boolean | null>(initialPmOpen);
  const [checkingPm, setCheckingPm] = useState(false);
  const [resolvedCampaignId, setResolvedCampaignId] = useState<number | null>(gglCampaignId);
  const [copiedAndOpened, setCopiedAndOpened] = useState(false);
  const draftRequest = useRef<AbortController | null>(null);
  const storageUnavailable = useRef(false);
  const messageUrl = `/api/root/gogetlinks/slots/${encodeURIComponent(slotId)}/message`;
  const storageKey = webmasterMessageDraftKey(userId, slotId, siteId);

  useEffect(() => {
    setPmOpen(initialPmOpen);
  }, [initialPmOpen]);

  useEffect(() => {
    if (gglCampaignId) setResolvedCampaignId(gglCampaignId);
  }, [gglCampaignId]);

  useEffect(() => () => draftRequest.current?.abort(), []);

  // Automatically check PM availability on mount if unknown
  useEffect(() => {
    if (pmOpen !== null) return;
    let cancelled = false;
    setCheckingPm(true);
    fetch(`${messageUrl}?siteId=${encodeURIComponent(String(siteId))}`, { cache: "no-store" })
      .then(res => res.json().catch(() => null))
      .then((data: { pmOpen?: boolean | null; gglCampaignId?: number } | null) => {
        if (cancelled || !data) return;
        if (typeof data.pmOpen === "boolean") {
          setPmOpen(data.pmOpen);
        }
        if (typeof data.gglCampaignId === "number") {
          setResolvedCampaignId(data.gglCampaignId);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCheckingPm(false);
      });
    return () => {
      cancelled = true;
    };
  }, [messageUrl, siteId, pmOpen]);

  const directPersonalUrl = resolvedCampaignId
    ? `https://gogetlinks.net/privateMessage/personal/comp_id/${resolvedCampaignId}/site_id/${siteId}`
    : `https://gogetlinks.net/searchSites?in_site_name=${encodeURIComponent(domain)}`;
  const directCatalogUrl = `https://gogetlinks.net/searchSites?in_site_name=${encodeURIComponent(domain)}`;

  function changeOpen(value: boolean) {
    if (sending) return;
    if (value && !storageUnavailable.current) {
      try {
        const saved = window.localStorage.getItem(storageKey) ?? "";
        if (saved !== body) setStatus(null);
        setBody(saved);
      } catch {
        storageUnavailable.current = true;
      }
    }
    setOpen(value);
  }

  function updateDraft(text: string) {
    setBody(text);
    setCopiedAndOpened(false);
    try {
      saveWebmasterMessageDraft(window.localStorage, storageKey, text);
      storageUnavailable.current = false;
    } catch {
      storageUnavailable.current = true;
    }
  }

  async function handleCopyAndOpenGgl(targetHref: string) {
    const textToCopy = body.trim();
    if (textToCopy) {
      try {
        await navigator.clipboard.writeText(textToCopy);
        setCopiedAndOpened(true);
        toast.success("Текст сообщения скопирован в буфер — вставьте его в открывшейся вкладке GoGetLinks (Ctrl+V)");
      } catch {
        toast.error("Не удалось скопировать текст в буфер обмена");
      }
    }
    window.open(targetHref, "_blank", "noopener,noreferrer");
  }

  async function handleCopyOnly() {
    const textToCopy = body.trim();
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedAndOpened(true);
      toast.success("Текст сообщения скопирован в буфер обмена");
    } catch {
      toast.error("Не удалось скопировать текст");
    }
  }

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
          if (!signal.aborted) updateDraft(result.body);
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
      const payload: {
        status?: string;
        pmOpen?: boolean;
        gglCampaignId?: number;
      } | null = await response.json().catch(() => null);
      if (typeof payload?.pmOpen === "boolean") {
        setPmOpen(payload.pmOpen);
      }
      if (typeof payload?.gglCampaignId === "number") {
        setResolvedCampaignId(payload.gglCampaignId);
      }
      switch (payload?.status) {
        case "sent":
          try {
            clearSentWebmasterMessageDraft(window.localStorage, storageKey, body);
          } catch {
            storageUnavailable.current = true;
          }
          setBody("");
          setStatus("sent");
          setPmOpen(true);
          onSent?.();
          break;
        case "duplicate":
          setStatus(payload.status);
          setPmOpen(true);
          onSent?.();
          break;
        case "unavailable":
          setStatus("unavailable");
          setPmOpen(false);
          break;
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
    <Dialog open={open} onOpenChange={changeOpen}>
      <div className="flex flex-wrap items-center gap-1.5">
        <DialogTrigger asChild>
          <button type="button" className={SEO_BTN_SM_CLASS}>
            <MessageSquare className="size-3.5" aria-hidden />
            {t("open")}
          </button>
        </DialogTrigger>

        {/* Live PM availability badge right in the slot row */}
        {checkingPm ? (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-[#dcdfed] bg-[#fafbff] px-2 py-0.5 text-[10.5px] font-medium text-[#6f7282]"
            title="Проверяем, открыта ли форма личных сообщений у этой площадки в GoGetLinks"
          >
            <Loader2 className="size-2.5 animate-spin text-[#5566f6]" />
            Личка…
          </span>
        ) : pmOpen === true ? (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-[#bbf7d0] bg-[#ecfdf5] px-2 py-0.5 text-[10.5px] font-semibold text-[#116b2a]"
            title="Личные сообщения до сделки у этой площадки в GoGetLinks открыты"
          >
            <Unlock className="size-2.5" />
            Личка открыта
          </span>
        ) : pmOpen === false ? (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-[#fde68a] bg-[#fffbeb] px-2 py-0.5 text-[10.5px] font-semibold text-[#b45309]"
            title="У этой площадки в GoGetLinks закрыта личка до отправки заявки — используйте кнопку прямого перехода со скопированным текстом"
          >
            <Lock className="size-2.5" />
            Личка в GGL закрыта
          </span>
        ) : null}
      </div>

      <DialogContent showCloseButton={!sending}>
        <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
          <DialogTitle>{t("title", { domain })}</DialogTitle>
          {pmOpen === true ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#bbf7d0] bg-[#ecfdf5] px-2.5 py-0.5 text-[11px] font-semibold text-[#116b2a]">
              <Unlock className="size-3" />
              Личка в GGL открыта
            </span>
          ) : pmOpen === false ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#fde68a] bg-[#fffbeb] px-2.5 py-0.5 text-[11px] font-semibold text-[#b45309]">
              <Lock className="size-3" />
              Форма лички до сделки закрыта в GGL
            </span>
          ) : null}
        </div>
        <DialogDescription>{t("description")}</DialogDescription>

        <form className="space-y-3.5" onSubmit={event => { event.preventDefault(); void sendMessage(); }}>
          <Textarea
            aria-label={t("body")}
            placeholder={t("body")}
            value={body}
            onChange={event => { updateDraft(event.target.value); setStatus(null); }}
            maxLength={8000}
            rows={6}
            disabled={sending || generating}
            className="rounded-2xl border-[#dcdfed]"
          />

          {/* Direct GGL link with auto-copied message to clipboard */}
          <div className="rounded-2xl border border-[#d8deff] bg-[#eef1ff]/65 p-3 text-[12px] text-[#0b1024]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium text-[#3848c7]">
                {pmOpen === false
                  ? "Вебмастер закрыл форму личных сообщений до отправки заявки в GoGetLinks:"
                  : "Быстрый ручной переход в GoGetLinks со скопированным сообщением:"}
              </div>
              {body.trim() ? (
                <button
                  type="button"
                  onClick={() => void handleCopyOnly()}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#dcdfed] bg-white px-2 py-1 text-[11px] font-medium text-[#0b1024] hover:border-[#5566f6]/40"
                >
                  {copiedAndOpened ? (
                    <Check className="size-3 text-[#116b2a]" />
                  ) : (
                    <Copy className="size-3 text-[#5566f6]" />
                  )}
                  Скопировать текст
                </button>
              ) : null}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyAndOpenGgl(directPersonalUrl)}
                className={`${SEO_BTN_OUTLINE_CLASS} !h-8 !rounded-xl !px-3 !text-[12px]`}
              >
                <Copy className="size-3.5 text-[#5566f6]" />
                <span>Скопировать и открыть диалог в GGL</span>
                <ExternalLink className="size-3 text-[#6f7282]" />
              </button>

              <button
                type="button"
                onClick={() => void handleCopyAndOpenGgl(directCatalogUrl)}
                className={`${SEO_BTN_OUTLINE_CLASS} !h-8 !rounded-xl !px-3 !text-[12px]`}
              >
                <span>Карточка {domain} в каталоге GGL</span>
                <ExternalLink className="size-3 text-[#6f7282]" />
              </button>
            </div>
          </div>

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
