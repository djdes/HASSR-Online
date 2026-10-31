"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plug, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { formatDate, isLocale } from "@/i18n/locales";
import type { IikoOptions, SupplyConnectionView } from "@/lib/supply/connections";

const INPUT =
  "mt-1 h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] outline-none transition-colors focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15";
const DATE_TIME: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };
const OPTION_KEYS = ["invoices", "writeoffs", "products"] as const;

/**
 * Подключение iiko: адрес сервера, логин, пароль и что забирать. Вход
 * проверяется сразу (и сразу выход); «Забрать сейчас» — загрузка с сервера.
 */
export function IikoSettingsClient({
  view,
  options: initialOptions,
  timeZone,
}: {
  view: SupplyConnectionView | null;
  options: IikoOptions;
  timeZone: string;
}) {
  const t = useTranslations("supplyEdo.iiko");
  const rawLocale = useLocale();
  const locale = isLocale(rawLocale) ? rawLocale : "ru";
  const router = useRouter();
  const [editing, setEditing] = useState(view === null);
  const [serverUrl, setServerUrl] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [options, setOptions] = useState<IikoOptions>(initialOptions);
  const [busy, setBusy] = useState<"connect" | "disconnect" | "sync" | null>(null);

  async function connect() {
    setBusy("connect");
    try {
      const res = await fetch("/api/settings/supply/iiko", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverUrl, login, password, options }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast.error(body?.error ?? t("errors.failed"));
        return;
      }
      toast.success(t("connected"));
      setEditing(false);
      setPassword("");
      router.refresh();
    } catch {
      toast.error(t("errors.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    try {
      const res = await fetch("/api/settings/supply/iiko", { method: "DELETE" });
      if (!res.ok) throw new Error("disconnect");
      toast.success(t("disconnected"));
      setEditing(true);
      router.refresh();
    } catch {
      toast.error(t("errors.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setBusy("sync");
    try {
      const res = await fetch("/api/edo/sync", { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { results?: Array<{ provider: string; ok: boolean; error: string | null; created: number; losses?: number; products?: number }> }
        | null;
      const result = body?.results?.find((item) => item.provider === "iiko");
      if (!res.ok || !result) throw new Error("sync");
      if (!result.ok) toast.error(result.error ?? t("errors.failed"));
      else toast.success(t("synced", { invoices: String(result.created), losses: String(result.losses ?? 0), products: String(result.products ?? 0) }));
      router.refresh();
    } catch {
      toast.error(t("errors.failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6" data-supply-connection="iiko">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <Plug className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("title")}</h2>
            {view ? (
              <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${view.status === "error" ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#ecfdf5] text-[#136c3e]"}`}>
                {t(`status.${view.status}`)}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[14px] leading-relaxed text-[#6f7282]">{t("hint")}</p>

          {view ? (
            <div className="mt-3 space-y-0.5 text-[14px] text-[#3c4053]">
              <div className="[overflow-wrap:anywhere]">{t("account", { account: view.account })}</div>
              <div className="text-[13px] text-[#6f7282]">
                {view.lastSyncAt ? t("lastSync", { when: formatDate(locale, new Date(view.lastSyncAt), timeZone, DATE_TIME) }) : t("never")}
              </div>
              {view.lastError ? <div className="text-[13px] text-[#a13a32]">{view.lastError}</div> : null}
            </div>
          ) : null}

          <div className="mt-4">
            <div className="text-[13px] font-medium text-[#3c4053]">{t("options.title")}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {OPTION_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="checkbox"
                  aria-checked={options[key]}
                  disabled={!editing}
                  onClick={() => setOptions((current) => ({ ...current, [key]: !current[key] }))}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-2xl border px-3 text-[13.5px] font-medium transition-colors disabled:cursor-default ${
                    options[key] ? "border-[#bfe6cf] bg-[#ecfdf5] text-[#136c3e]" : "border-[#dcdfed] bg-white text-[#6f7282]"
                  }`}
                >
                  {options[key] ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
                  {t(`options.${key}`)}
                </button>
              ))}
            </div>
          </div>

          {editing ? (
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              <label className="block text-[13px] text-[#3c4053]">
                {t("serverUrl")}
                <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder={t("serverHint")} className={INPUT} required inputMode="url" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[13px] text-[#3c4053]">
                  {t("login")}
                  <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" className={INPUT} required />
                </label>
                <label className="block text-[13px] text-[#3c4053]">
                  {t("password")}
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={INPUT} required />
                </label>
              </div>
              <button
                type="submit"
                disabled={busy !== null}
                className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
              >
                {busy === "connect" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {busy === "connect" ? t("connecting") : t("connect")}
              </button>
            </form>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void sync()}
                disabled={busy !== null}
                className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
                data-iiko-sync
              >
                {busy === "sync" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
                {busy === "sync" ? t("syncing") : t("sync")}
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex h-10 items-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                {t("reconnect")}
              </button>
              <button
                type="button"
                onClick={() => void disconnect()}
                disabled={busy !== null}
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#f3c9c4] bg-white px-4 text-[14px] font-medium text-[#a13a32] transition-colors hover:bg-[#fff4f2] disabled:opacity-60"
              >
                {busy === "disconnect" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {t("disconnect")}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
