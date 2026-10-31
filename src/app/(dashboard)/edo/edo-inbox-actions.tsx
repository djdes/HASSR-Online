"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";

type Connection = { provider: "diadoc" | "saby" | "iiko"; ok: boolean; lastError: string | null; lastSyncAt: string | null };

/** Проверка при открытии — не чаще раза в 15 минут на подключение (как и на сервере). */
const STALE_MS = 15 * 60 * 1000;

/**
 * Действия «Входящих накладных»: загрузить УПД файлом и проверить новые в
 * подключённых Диадоке и СБИС. При открытии страницы давно не проверенные
 * подключения проверяются сами — без кнопки.
 */
export function EdoInboxActions({ connections }: { connections: Connection[] }) {
  const t = useTranslations("supplyEdo.page");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const autoSynced = useRef(false);

  async function sync(ifStale: boolean) {
    setSyncing(true);
    try {
      const res = await fetch(`/api/edo/sync${ifStale ? "?ifStale=1" : ""}`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { created: number; results: Array<{ provider: string; ok: boolean; error: string | null }> }
        | null;
      if (!res.ok || !body) throw new Error("sync");
      for (const result of body.results) {
        if (!result.ok && result.error) {
          const provider = result.provider === "saby" || result.provider === "iiko" ? result.provider : "diadoc";
          toast.error(t("syncFailed", { provider: t(`source.${provider}`), error: result.error }));
        }
      }
      if (!ifStale || body.created > 0) toast.success(t("synced", { count: body.created }));
      if (body.created > 0 || body.results.length > 0) router.refresh();
    } catch {
      if (!ifStale) toast.error(t("errors.failed"));
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (autoSynced.current || connections.length === 0) return;
    autoSynced.current = true;
    const stale = connections.some((c) => !c.lastSyncAt || Date.now() - new Date(c.lastSyncAt).getTime() > STALE_MS);
    if (stale) void sync(true);
    // Один раз при открытии страницы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/edo/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as { id?: string; duplicate?: boolean; number?: string; error?: string } | null;
      if (!res.ok || !body?.id) {
        toast.error(body?.error ?? t("errors.failed"));
        return;
      }
      toast.success(body.duplicate ? t("duplicate", { number: body.number ?? "" }) : t("uploaded", { number: body.number ?? "" }));
      router.push(`/edo/${body.id}`);
    } catch {
      toast.error(t("errors.failed"));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  const providers = connections.map((c) => t(`source.${c.provider}`)).join(", ");
  const failing = connections.filter((c) => !c.ok && c.lastError);

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6" data-edo-actions>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-[14px] leading-relaxed text-[#3c4053]">
          {connections.length > 0 ? t("connectedVia", { providers }) : t("notConnected")}
          {failing.map((c) => (
            <p key={c.provider} className="mt-1 text-[13px] text-[#a13a32]">
              {t("syncFailed", { provider: t(`source.${c.provider}`), error: c.lastError ?? "" })}
            </p>
          ))}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {connections.length > 0 ? (
            <button
              type="button"
              onClick={() => void sync(false)}
              disabled={syncing}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
            >
              {syncing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
              {syncing ? t("syncing") : t("sync")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={uploading}
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
            data-edo-upload
          >
            {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            {uploading ? t("uploading") : t("upload")}
          </button>
          <input
            ref={input}
            type="file"
            accept=".xml,text/xml,application/xml"
            className="hidden"
            aria-label={t("uploadHint")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </div>
      </div>
    </section>
  );
}
