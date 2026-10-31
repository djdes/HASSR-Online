"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Loader2, Users, X } from "lucide-react";
import { toast } from "sonner";

import { formatDate, isLocale } from "@/i18n/locales";

type Initial = {
  connected: boolean;
  odataUrl: string;
  login: string;
  hasPassword: boolean;
  defaultPositionId: string;
  autoApply: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  lastResult: { hire: number; dismiss: number; update: number; link: number } | null;
};

type RunResult = {
  mode: "preview" | "apply";
  summary: { hire: number; link: number; update: number; dismiss: number; problems: number; unchanged: number };
  actions: Array<{ kind: "hire" | "link" | "update" | "dismiss"; fullName: string; detail: string | null }>;
  problems: Array<{ fullName: string; reason: "no_position" | "dismissed_in_wesetup" | "ambiguous_name" }>;
  errors: string[];
};

const INPUT =
  "mt-1 h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] outline-none transition-colors focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15";
const CARD = "rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6";
const DATE_TIME: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };
const KINDS = ["hire", "dismiss", "update", "link"] as const;
const KIND_TONE: Record<(typeof KINDS)[number], string> = {
  hire: "bg-[#ecfdf5] text-[#136c3e]",
  dismiss: "bg-[#fff4f2] text-[#a13a32]",
  update: "bg-[#eef1ff] text-[#3848c7]",
  link: "bg-[#f4f4f7] text-[#3c4053]",
};

const API_EXAMPLE = `{
  "apply": true,
  "employees": [
    { "id": "000123", "fullName": "Иванова Мария Петровна", "position": "Повар",
      "hiredAt": "2025-03-01", "dismissedAt": null, "phone": "+79851234567" }
  ]
}`;

/**
 * Настройка «1С: кадры» и прогон: «Проверить» — план без изменений,
 * «Применить» — те же действия по-настоящему. Список — по видам действий.
 */
export function Hr1cSettingsClient({
  initial,
  positions,
  apiUrl,
  timeZone,
}: {
  initial: Initial;
  positions: Array<{ id: string; name: string }>;
  apiUrl: string;
  timeZone: string;
}) {
  const t = useTranslations("hr1c");
  const rawLocale = useLocale();
  const locale = isLocale(rawLocale) ? rawLocale : "ru";
  const router = useRouter();
  const [odataUrl, setOdataUrl] = useState(initial.odataUrl);
  const [login, setLogin] = useState(initial.login);
  const [password, setPassword] = useState("");
  const [defaultPositionId, setDefaultPositionId] = useState(initial.defaultPositionId);
  const [autoApply, setAutoApply] = useState(initial.autoApply);
  const [busy, setBusy] = useState<"save" | "disconnect" | "preview" | "apply" | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  async function save() {
    setBusy("save");
    try {
      const res = await fetch("/api/settings/hr1c", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          odataUrl: odataUrl.trim() || undefined,
          login: login.trim() || undefined,
          password: password || undefined,
          defaultPositionId: defaultPositionId || null,
          autoApply,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast.error(body?.error ?? t("errors.failed"));
        return;
      }
      toast.success(t("saved"));
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
      const res = await fetch("/api/settings/hr1c", { method: "DELETE" });
      if (!res.ok) throw new Error("disconnect");
      toast.success(t("disconnected"));
      setResult(null);
      router.refresh();
    } catch {
      toast.error(t("errors.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function run(mode: "preview" | "apply") {
    setBusy(mode);
    try {
      const res = await fetch("/api/settings/hr1c/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const body = (await res.json().catch(() => null)) as (RunResult & { error?: string }) | null;
      if (!res.ok || !body?.summary) {
        toast.error(body?.error ?? t("errors.failed"));
        return;
      }
      setResult(body);
      if (mode === "apply") {
        toast.success(t("applied"));
        router.refresh();
      }
    } catch {
      toast.error(t("errors.failed"));
    } finally {
      setBusy(null);
    }
  }

  const canRun = initial.connected && Boolean(initial.odataUrl);

  return (
    <div className="space-y-4">
      <section className={CARD} data-hr1c-settings>
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <Users className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("odataTitle")}</h2>
            <p className="mt-1 text-[14px] leading-relaxed text-[#6f7282]">{t("odataHint")}</p>
            {initial.connected ? (
              <div className="mt-2 text-[13px] text-[#6f7282]">
                {initial.lastSyncAt ? t("lastSync", { when: formatDate(locale, new Date(initial.lastSyncAt), timeZone, DATE_TIME) }) : t("never")}
                {initial.lastResult ? ` · ${t("lastResult", {
                  hire: String(initial.lastResult.hire),
                  dismiss: String(initial.lastResult.dismiss),
                  update: String(initial.lastResult.update),
                  link: String(initial.lastResult.link),
                })}` : null}
                {initial.lastError ? <div className="mt-1 text-[#a13a32]">{initial.lastError}</div> : null}
              </div>
            ) : null}
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <label className="block text-[13px] text-[#3c4053]">
                {t("odataUrl")}
                <input value={odataUrl} onChange={(e) => setOdataUrl(e.target.value)} placeholder="https://1c.company.ru/zup" className={INPUT} inputMode="url" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[13px] text-[#3c4053]">
                  {t("login")}
                  <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" className={INPUT} />
                </label>
                <label className="block text-[13px] text-[#3c4053]">
                  {t("password")}
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder={initial.hasPassword ? t("passwordKeep") : undefined}
                    className={INPUT}
                  />
                </label>
              </div>
              <label className="block text-[13px] text-[#3c4053]">
                {t("defaultPosition")}
                <select value={defaultPositionId} onChange={(e) => setDefaultPositionId(e.target.value)} className={INPUT}>
                  <option value="">{t("noDefault")}</option>
                  {positions.map((position) => (
                    <option key={position.id} value={position.id}>{position.name}</option>
                  ))}
                </select>
                <span className="mt-1 block text-[12.5px] text-[#6f7282]">{t("defaultPositionHint")}</span>
              </label>
              <button
                type="button"
                role="switch"
                aria-checked={autoApply}
                onClick={() => setAutoApply((value) => !value)}
                className={`inline-flex min-h-10 items-center gap-2 rounded-2xl border px-3 text-[13.5px] font-medium transition-colors ${
                  autoApply ? "border-[#bfe6cf] bg-[#ecfdf5] text-[#136c3e]" : "border-[#dcdfed] bg-white text-[#6f7282]"
                }`}
              >
                {autoApply ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
                {t("autoApply")}
              </button>
              <p className="text-[12.5px] text-[#6f7282]">{t("autoApplyHint")}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={busy !== null}
                  className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
                >
                  {busy === "save" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                  {busy === "save" ? t("saving") : t("save")}
                </button>
                {initial.connected ? (
                  <button
                    type="button"
                    onClick={() => void disconnect()}
                    disabled={busy !== null}
                    className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#f3c9c4] bg-white px-4 text-[14px] font-medium text-[#a13a32] transition-colors hover:bg-[#fff4f2] disabled:opacity-60"
                  >
                    {t("disconnect")}
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      </section>

      {canRun ? (
        <section className={CARD} data-hr1c-run>
          <div className="flex flex-wrap gap-2">
            {(["preview", "apply"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => void run(mode)}
                disabled={busy !== null}
                className={`inline-flex h-11 items-center gap-2 rounded-2xl px-4 text-[14px] font-medium transition-colors disabled:opacity-60 ${
                  mode === "apply"
                    ? "bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
                    : "border border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                }`}
                data-hr1c-mode={mode}
              >
                {busy === mode ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {busy === mode ? t(mode === "apply" ? "applying" : "previewing") : t(mode)}
              </button>
            ))}
          </div>
          {result ? (
            <div className="mt-4 space-y-3" data-hr1c-result>
              <h3 className="text-[16px] font-semibold text-[#0b1024]">{t(result.mode === "apply" ? "result.appliedTitle" : "result.title")}</h3>
              {result.actions.length === 0 && result.problems.length === 0 ? (
                <p className="text-[14px] text-[#6f7282]">{t("result.nothing")}</p>
              ) : null}
              {KINDS.map((kind) => {
                const items = result.actions.filter((action) => action.kind === kind);
                if (items.length === 0) return null;
                return (
                  <div key={kind}>
                    <div className="text-[13px] font-medium text-[#3c4053]">
                      {t(`result.${kind}`)} · {items.length}
                    </div>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {items.map((item, index) => (
                        <li key={`${item.fullName}-${index}`} className={`rounded-full px-3 py-1 text-[13px] ${KIND_TONE[kind]}`}>
                          {item.fullName}
                          {item.detail ? <span className="opacity-75"> · {item.detail}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {result.problems.length > 0 ? (
                <div>
                  <div className="text-[13px] font-medium text-[#7a4a00]">{t("result.problems")} · {result.problems.length}</div>
                  <ul className="mt-1.5 space-y-1 text-[13px] text-[#3c4053]">
                    {result.problems.map((problem, index) => (
                      <li key={`${problem.fullName}-${index}`}>
                        <b className="font-medium">{problem.fullName}</b> — {t(`problem.${problem.reason}`)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {result.errors.length > 0 ? (
                <div>
                  <div className="text-[13px] font-medium text-[#a13a32]">{t("result.errors")} · {result.errors.length}</div>
                  <ul className="mt-1.5 space-y-1 text-[13px] text-[#3c4053]">
                    {result.errors.map((error, index) => <li key={index}>{error}</li>)}
                  </ul>
                </div>
              ) : null}
              <p className="text-[12.5px] text-[#6f7282]">{t("result.unchanged", { count: String(result.summary.unchanged) })}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={CARD}>
        <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("apiTitle")}</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-[#6f7282]">{t("apiHint")}</p>
        <div className="mt-3 break-all rounded-2xl bg-[#f5f6ff] px-4 py-2.5 font-mono text-[13px] text-[#0b1024]">POST {apiUrl}</div>
        <pre className="mt-2 overflow-x-auto rounded-2xl bg-[#0b1024] p-4 text-[12.5px] leading-relaxed text-white/90">{API_EXAMPLE}</pre>
        <Link href="/settings/api" className="mt-3 inline-flex text-[14px] font-medium text-[#3848c7] hover:text-[#5566f6]">
          {t("apiToken")} →
        </Link>
      </section>
    </div>
  );
}
