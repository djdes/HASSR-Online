"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Loader2, Plug } from "lucide-react";
import { toast } from "sonner";

import { formatDate, isLocale } from "@/i18n/locales";
import type { SupplyConnectionView } from "@/lib/supply/connections";

type Provider = "diadoc" | "saby";
type Box = { boxId: string; title: string; orgName: string; inn: string | null };

const INPUT =
  "mt-1 h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] outline-none transition-colors focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15";
const DATE_TIME: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };

type FieldLabel = "apiClientId" | "login" | "password" | "clientId" | "appSecret";

const FIELDS: Record<Provider, Array<{ key: string; label: FieldLabel; secret?: boolean }>> = {
  diadoc: [
    { key: "apiClientId", label: "apiClientId", secret: true },
    { key: "login", label: "login" },
    { key: "password", label: "password", secret: true },
  ],
  saby: [
    { key: "clientId", label: "clientId" },
    { key: "appSecret", label: "appSecret", secret: true },
  ],
};

function ConnectionCard({ provider, view, timeZone }: { provider: Provider; view: SupplyConnectionView | null; timeZone: string }) {
  const t = useTranslations("supplyEdo.settings");
  const rawLocale = useLocale();
  const locale = isLocale(rawLocale) ? rawLocale : "ru";
  const router = useRouter();
  const [editing, setEditing] = useState(view === null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [boxId, setBoxId] = useState("");
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);

  async function connect() {
    setBusy("connect");
    try {
      const res = await fetch(`/api/settings/supply/${provider}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, ...(boxId ? { boxId } : {}) }),
      });
      const body = (await res.json().catch(() => null)) as { connected?: boolean; needBox?: boolean; boxes?: Box[]; error?: string } | null;
      if (!res.ok) {
        toast.error(body?.error ?? t("errors.failed"));
        return;
      }
      if (body?.needBox && body.boxes) {
        setBoxes(body.boxes);
        setBoxId(body.boxes[0]?.boxId ?? "");
        toast.message(t("chooseBox"));
        return;
      }
      toast.success(t("connected"));
      setEditing(false);
      setValues({});
      setBoxes(null);
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
      const res = await fetch(`/api/settings/supply/${provider}`, { method: "DELETE" });
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

  const title = provider === "diadoc" ? t("diadocTitle") : t("sabyTitle");
  const hint = provider === "diadoc" ? t("diadocHint") : t("sabyHint");

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6" data-supply-connection={provider}>
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <Plug className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{title}</h2>
            {view ? (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${
                  view.status === "error" ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#ecfdf5] text-[#136c3e]"
                }`}
              >
                {t(`status.${view.status}`)}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[14px] leading-relaxed text-[#6f7282]">{hint}</p>

          {view ? (
            <div className="mt-3 space-y-0.5 text-[14px] text-[#3c4053]">
              <div>{t("account", { account: view.account })}</div>
              {view.boxTitle ? <div>{t("boxValue", { box: view.boxTitle })}</div> : null}
              <div className="text-[13px] text-[#6f7282]">
                {view.lastSyncAt ? t("lastSync", { when: formatDate(locale, new Date(view.lastSyncAt), timeZone, DATE_TIME) }) : t("never")}
              </div>
              {view.lastError ? <div className="text-[13px] text-[#a13a32]">{view.lastError}</div> : null}
            </div>
          ) : null}

          {editing ? (
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {FIELDS[provider].map((field) => (
                  <label key={field.key} className="block text-[13px] text-[#3c4053]">
                    {t(field.label)}
                    <input
                      type={field.secret ? "password" : "text"}
                      autoComplete={field.secret ? "new-password" : "off"}
                      value={values[field.key] ?? ""}
                      onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                      className={INPUT}
                      required
                    />
                  </label>
                ))}
              </div>
              {boxes ? (
                <label className="block text-[13px] text-[#3c4053]">
                  {t("box")}
                  <select value={boxId} onChange={(event) => setBoxId(event.target.value)} className={INPUT}>
                    {boxes.map((box) => (
                      <option key={box.boxId} value={box.boxId}>
                        {box.inn ? `${box.title} (ИНН ${box.inn})` : box.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
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

export function EdoSettingsClient({
  diadoc,
  saby,
  timeZone,
}: {
  diadoc: SupplyConnectionView | null;
  saby: SupplyConnectionView | null;
  timeZone: string;
}) {
  return (
    <div className="space-y-4">
      <ConnectionCard provider="diadoc" view={diadoc} timeZone={timeZone} />
      <ConnectionCard provider="saby" view={saby} timeZone={timeZone} />
    </div>
  );
}
