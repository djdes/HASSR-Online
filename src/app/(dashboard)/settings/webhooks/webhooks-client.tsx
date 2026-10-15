"use client";

import { Copy, Plus, RefreshCw, Send, Trash2, Webhook } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FORMAT_LOCALES, isLocale } from "@/i18n/locales";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { WebhookDto } from "@/lib/webhooks/serialize";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhooks/events";

type Delivery = { id: string; webhookId: string; event: string; status: string; attempts: number; lastStatus: number | null; lastError: string | null; createdAt: string; sentAt: string | null; nextAttemptAt: string | null };

const CARD = "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";
const PRIMARY = "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60";
const SECONDARY = "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60";
const INPUT = "h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const SUBSCRIBABLE = WEBHOOK_EVENTS.filter((e) => e !== "ping");

const STATUS_TONE: Record<string, string> = { sent: "bg-[#ecfdf5] text-[#116b2a]", queued: "bg-[#fff8eb] text-[#b25f00]", failed: "bg-[#fff4f2] text-[#a13a32]" };
const EVENT_KEYS = { "journal.entry": "entry", "journal.deviation": "deviation", "capa.created": "capa", "payment.paid": "payment", "idea.status": "idea", ping: "ping" } as const;

export function WebhooksClient() {
  const t = useTranslations("webhooksSettings");
  const selectedLocale = useLocale();
  const locale = isLocale(selectedLocale) ? selectedLocale : "ru";
  const feedback = useRef(t);
  useEffect(() => { feedback.current = t; }, [t]);
  const eventLabel = (event: string) => Object.hasOwn(EVENT_KEYS, event) ? t(`events.${EVENT_KEYS[event as WebhookEvent]}`) : event;
  const statusLabel = (status: string) => status === "sent" || status === "queued" || status === "failed" ? t(`status.${status}`) : status;
  const dateLabel = (date: string) => new Date(date).toLocaleString(FORMAT_LOCALES[locale]);
  const [webhooks, setWebhooks] = useState<WebhookDto[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(["journal.entry", "journal.deviation", "capa.created"]);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<WebhookDto | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/webhooks/subscriptions");
      if (!response.ok) { toast.error(feedback.current("loadError")); return; }
      const data = (await response.json()) as { webhooks: WebhookDto[]; deliveries: Delivery[] };
      setWebhooks(data.webhooks ?? []);
      setDeliveries(data.deliveries ?? []);
    } catch {
      toast.error(feedback.current("loadError"));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function responseError(response: Response, fallback: "createError" | "saveError" | "testError" | "deleteError") {
    const data = await response.json().catch(() => null) as { errorCode?: string; errorParams?: { limit?: unknown } } | null;
    const copy = feedback.current;
    switch (data?.errorCode) {
      case "WEBHOOK_FORBIDDEN": return copy("forbidden");
      case "WEBHOOK_NOT_FOUND": return copy("notFound");
      case "WEBHOOK_INVALID_URL": return copy("invalidUrl");
      case "WEBHOOK_MISSING_EVENTS": return copy("missingEvents");
      case "WEBHOOK_LIMIT": return typeof data.errorParams?.limit === "number" ? copy("limit", { limit: data.errorParams.limit }) : copy(fallback);
      default: return copy(fallback);
    }
  }

  async function create() {
    setBusy("create");
    try {
      const response = await fetch("/api/settings/webhooks/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, events }) });
      if (!response.ok) { toast.error(await responseError(response, "createError")); return; }
      toast.success(feedback.current("created"));
      setUrl("");
      await load();
    } catch {
      toast.error(feedback.current("createError"));
    } finally {
      setBusy(null);
    }
  }

  async function patch(id: string, body: Record<string, unknown>, successKey: "enabledSuccess" | "disabledSuccess" | "rotated") {
    setBusy(id);
    try {
      const response = await fetch(`/api/settings/webhooks/subscriptions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { toast.error(await responseError(response, "saveError")); return; }
      toast.success(feedback.current(successKey));
      await load();
    } catch {
      toast.error(feedback.current("saveError"));
    } finally {
      setBusy(null);
    }
  }

  async function test(id: string) {
    setBusy(`test-${id}`);
    try {
      const response = await fetch(`/api/settings/webhooks/subscriptions/${id}`, { method: "POST" });
      if (!response.ok) { toast.error(await responseError(response, "testError")); return; }
      const data = (await response.json().catch(() => null)) as { outcome?: { ok: boolean; status: number | null; error: string | null } } | null;
      if (!data?.outcome) { toast.error(feedback.current("testError")); return; }
      if (data.outcome.ok) toast.success(feedback.current("testSuccess", { status: String(data.outcome.status ?? "") }));
      else toast.error(feedback.current("testFailed", { error: data.outcome.error ?? feedback.current("unknownError") }));
      await load();
    } catch {
      toast.error(feedback.current("testError"));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!deleting) return;
    const id = deleting.id;
    setDeleting(null);
    setBusy(id);
    try {
      const response = await fetch(`/api/settings/webhooks/subscriptions/${id}`, { method: "DELETE" });
      if (!response.ok) { toast.error(await responseError(response, "deleteError")); return; }
      toast.success(feedback.current("deleted"));
      await load();
    } catch {
      toast.error(feedback.current("deleteError"));
    } finally { setBusy(null); }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(feedback.current("copied"));
    } catch {
      toast.error(feedback.current("copyError"));
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-6">
        <section className={CARD}>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
            <Plus className="size-4 text-[#5566f6]" />
            {t("newSubscription")}
          </div>
          <div className="mt-4 space-y-3">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("urlPlaceholder")} inputMode="url" aria-label={t("url")} className={INPUT} data-testid="webhook-url" />
            <div className="flex flex-wrap gap-2">
              {SUBSCRIBABLE.map((e) => {
                const on = events.includes(e);
                return (
                  <button key={e} type="button" aria-pressed={on} onClick={() => setEvents((prev) => (on ? prev.filter((x) => x !== e) : [...prev, e]))} className={`inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors ${on ? "border-[#5566f6] bg-[#5566f6] text-white" : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"}`}>
                    {eventLabel(e)}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => void create()} disabled={busy === "create" || !url.trim() || events.length === 0} className={PRIMARY} data-testid="webhook-create">
              <Webhook className="size-4" />
              {busy === "create" ? t("adding") : t("add")}
            </button>
          </div>
        </section>

        {loading ? (
          <div className="text-[14px] text-[#6f7282]">{t("loading")}</div>
        ) : webhooks.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center">
            <div className="text-[15px] font-medium text-[#0b1024]">{t("emptyTitle")}</div>
            <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] text-[#6f7282]">{t("emptyDescription")}</p>
          </div>
        ) : (
          webhooks.map((w) => (
            <section key={w.id} className={CARD} data-testid="webhook-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="break-all text-[14px] font-semibold text-[#0b1024]">{w.url}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {w.events.map((e) => (
                      <span key={e} className="rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[12px] text-[#3848c7]">{eventLabel(e)}</span>
                    ))}
                  </div>
                  <div className="mt-2 text-[12px] text-[#6f7282]">
                    {w.enabled ? t("enabled") : t("disabled")}
                    {w.lastSuccessAt ? ` · ${t("lastSuccess", { date: dateLabel(w.lastSuccessAt) })}` : ""}
                    {w.lastError ? <span className="text-[#a13a32]"> · {t("lastError", { error: w.lastError })}</span> : null}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-2xl bg-[#fafbff] px-3.5 py-2.5">
                <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-[#0b1024]" data-testid="webhook-secret">{w.secret}</code>
                <button type="button" onClick={() => void copy(w.secret)} className="text-[#3848c7]" aria-label={t("copySecret")}>
                  <Copy className="size-4" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void test(w.id)} disabled={busy === `test-${w.id}`} className={SECONDARY} data-testid="webhook-test">
                  <Send className="size-4 text-[#5566f6]" />
                  {busy === `test-${w.id}` ? t("sending") : t("sendTest")}
                </button>
                <button type="button" onClick={() => void patch(w.id, { enabled: !w.enabled }, w.enabled ? "disabledSuccess" : "enabledSuccess")} disabled={busy === w.id} className={SECONDARY}>
                  {w.enabled ? t("disable") : t("enable")}
                </button>
                <button type="button" onClick={() => void patch(w.id, { rotateSecret: true }, "rotated")} disabled={busy === w.id} className={SECONDARY}>
                  <RefreshCw className="size-4 text-[#5566f6]" />
                  {t("rotate")}
                </button>
                <button type="button" onClick={() => setDeleting(w)} className={`${SECONDARY} text-[#a13a32]`}>
                  <Trash2 className="size-4" />
                  {t("remove")}
                </button>
              </div>
            </section>
          ))
        )}
      </div>

      <aside className="space-y-6">
        <section className={CARD}>
          <div className="text-[15px] font-semibold text-[#0b1024]">{t("signatureTitle")}</div>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
            {t.rich("signatureHelp", { code: chunks => <code className="rounded bg-[#f5f6ff] px-1 py-0.5 text-[12px]">{chunks}</code> })}
          </p>
        </section>
        <section className={CARD}>
          <div className="text-[15px] font-semibold text-[#0b1024]">{t("deliveries")}</div>
          {deliveries.length === 0 ? (
            <p className="mt-2 text-[13px] text-[#9b9fb3]">{t("noDeliveries")}</p>
          ) : (
            <ul className="mt-3 space-y-2" data-testid="deliveries">
              {deliveries.map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-3 rounded-2xl border border-[#ececf4] px-3.5 py-2.5 text-[13px]">
                  <div className="min-w-0">
                    <div className="font-medium text-[#0b1024]">{eventLabel(d.event)}</div>
                    <div className="text-[12px] text-[#6f7282]">
                      {t("deliveryDetails", { date: dateLabel(d.createdAt), attempts: d.attempts })}
                      {d.lastStatus ? ` · HTTP ${d.lastStatus}` : ""}
                      {d.lastError ? ` · ${d.lastError}` : ""}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] ${STATUS_TONE[d.status] ?? ""}`}>{statusLabel(d.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        variant="danger"
        title={t("confirmTitle")}
        description={deleting ? t("confirmDescription", { url: deleting.url }) : ""}
        bullets={[{ label: t("confirmHistory") }]}
        confirmLabel={t("remove")}
        onConfirm={remove}
      />
    </div>
  );
}
