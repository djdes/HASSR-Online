"use client";

import { AlertTriangle, Building2, CheckCircle2, KeyRound, Loader2, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { EdoBaseUrlOption, EdoCabinetView } from "@/lib/edo/cabinet.server";
import { cn } from "@/lib/utils";

import { BTN_OUTLINE, BTN_PRIMARY, CARD, EYEBROW, INPUT } from "./edo-ui";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function EdoCabinetCard({
  cabinet,
  baseUrls,
  onCabinet,
}: {
  cabinet: EdoCabinetView | null;
  baseUrls: EdoBaseUrlOption[];
  onCabinet: (cabinet: EdoCabinetView | null) => void;
}) {
  const t = useTranslations("rootEdo");
  const [editing, setEditing] = useState(!cabinet);
  const [clientId, setClientId] = useState(cabinet?.clientId ?? "");
  const [appSecret, setAppSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState(cabinet?.baseUrl ?? baseUrls[0]?.value ?? "");
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/root/edo/cabinet", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, appSecret, baseUrl }),
      });
      const data = (await res.json().catch(() => null)) as { cabinet?: EdoCabinetView; error?: string } | null;
      if (!res.ok || !data?.cabinet) {
        toast.error(data?.error ?? t("errors.generic"));
        return;
      }
      // Защищённый ключ на экране не храним: он уже зашифрован на сервере.
      setAppSecret("");
      setEditing(false);
      onCabinet(data.cabinet);
      if (data.cabinet.status === "ok") toast.success(t("cabinet.toast.connected"));
      else toast.error(data.cabinet.lastError ?? t("cabinet.toast.checkFailed"));
    } catch {
      toast.error(t("errors.network"));
    } finally {
      setSaving(false);
    }
  }

  async function recheck() {
    setChecking(true);
    try {
      const res = await fetch("/api/root/edo/cabinet/check", { method: "POST" });
      const data = (await res.json().catch(() => null)) as { cabinet?: EdoCabinetView; error?: string } | null;
      if (!res.ok || !data?.cabinet) {
        toast.error(data?.error ?? t("errors.generic"));
        return;
      }
      onCabinet(data.cabinet);
      if (data.cabinet.status === "ok") toast.success(t("cabinet.toast.checked"));
      else toast.error(data.cabinet.lastError ?? t("cabinet.toast.checkFailed"));
    } catch {
      toast.error(t("errors.network"));
    } finally {
      setChecking(false);
    }
  }

  async function disconnect() {
    const res = await fetch("/api/root/edo/cabinet", { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(data?.error ?? t("errors.generic"));
      return;
    }
    onCabinet(null);
    setClientId("");
    setEditing(true);
    toast.success(t("cabinet.toast.disconnected"));
  }

  const baseUrlLabel = (value: string) => {
    const option = baseUrls.find((o) => o.value === value);
    return option ? t(`cabinet.baseUrl.${option.kind}`, { url: value }) : value;
  };

  return (
    <section className={CARD} data-testid="edo-cabinet-card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className={cn(EYEBROW, "mb-0")}>{t("cabinet.title")}</div>
        {cabinet ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium",
              cabinet.ready ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#fff4f2] text-[#a13a32]",
            )}
            data-testid="edo-cabinet-status"
          >
            {cabinet.ready ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            {cabinet.ready ? t("cabinet.ready") : t("cabinet.notReady")}
          </span>
        ) : null}
      </div>

      {cabinet && !editing ? (
        <div className="space-y-4">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13.5px]">
            <dt className="text-[#6f7282]">{t("cabinet.clientId")}</dt>
            <dd className="break-all font-medium text-[#0b1024]">{cabinet.clientId}</dd>
            <dt className="text-[#6f7282]">{t("cabinet.contour")}</dt>
            <dd className="text-[#0b1024]">{baseUrlLabel(cabinet.baseUrl)}</dd>
            <dt className="text-[#6f7282]">{t("cabinet.checkedAt")}</dt>
            <dd className="text-[#0b1024]">{formatDateTime(cabinet.checkedAt)}</dd>
          </dl>

          {cabinet.lastError ? (
            <div className="rounded-2xl border border-[#f5d0cb] bg-[#fff4f2] px-3.5 py-3 text-[13px] text-[#a13a32]">{cabinet.lastError}</div>
          ) : null}

          <SenderMatch cabinet={cabinet} />

          <div>
            <div className="mb-2 text-[13px] font-medium text-[#3c4053]">{t("cabinet.orgs.title")}</div>
            {cabinet.orgs.length === 0 ? (
              <p className="text-[13px] text-[#6f7282]">{t("cabinet.orgs.empty")}</p>
            ) : (
              <ul className="space-y-1.5" data-testid="edo-our-orgs">
                {cabinet.orgs.map((org) => {
                  const isSender = cabinet.senderMatch.kind === "ready" && cabinet.senderMatch.org.inn === org.inn && cabinet.senderMatch.org.kpp === org.kpp;
                  return (
                    <li
                      key={`${org.inn}-${org.kpp}`}
                      className={cn(
                        "flex items-start gap-2.5 rounded-2xl border px-3 py-2.5",
                        isSender ? "border-[#5566f6]/40 bg-[#f5f6ff]" : "border-[#ececf4] bg-[#fafbff]",
                      )}
                      data-sender={isSender ? "true" : undefined}
                    >
                      <Building2 className={cn("mt-0.5 size-4 shrink-0", isSender ? "text-[#5566f6]" : "text-[#9b9fb3]")} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium text-[#0b1024]">{org.name || org.inn}</div>
                        <div className="text-[12px] text-[#6f7282]">
                          {t("cabinet.orgs.requisites", { inn: org.inn, kpp: org.kpp || "—" })}
                          {isSender ? ` · ${t("cabinet.orgs.sender")}` : ""}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium",
                          org.edoEnabled ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#f1f2f7] text-[#6f7282]",
                        )}
                      >
                        {org.edoEnabled ? t("cabinet.orgs.edoOn") : t("cabinet.orgs.edoOff")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void recheck()} disabled={checking} className={BTN_OUTLINE} data-testid="edo-cabinet-recheck">
              {checking ? <Loader2 className="size-4 animate-spin text-[#5566f6]" /> : <RefreshCw className="size-4 text-[#5566f6]" />}
              {t("cabinet.recheck")}
            </button>
            <button type="button" onClick={() => setEditing(true)} className={BTN_OUTLINE}>
              <KeyRound className="size-4 text-[#5566f6]" />
              {t("cabinet.replaceKeys")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmOff(true)}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#f5d0cb] bg-white px-4 text-[14px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a13a32]/15"
            >
              <Unplug className="size-4" />
              {t("cabinet.disconnect")}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p className="text-[13px] leading-relaxed text-[#6f7282]">{t("cabinet.form.intro")}</p>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("cabinet.form.clientId")}</span>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
              className={INPUT}
              name="edo-client-id"
              placeholder={t("cabinet.form.clientIdPlaceholder")}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("cabinet.form.appSecret")}</span>
            <input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              maxLength={500}
              className={INPUT}
              name="edo-app-secret"
              placeholder={t("cabinet.form.appSecretPlaceholder")}
            />
            <span className="mt-1 block text-[12px] text-[#9b9fb3]">{t("cabinet.form.appSecretHint")}</span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("cabinet.form.contour")}</span>
            <select value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={INPUT} name="edo-base-url">
              {baseUrls.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(`cabinet.baseUrl.${o.kind}`, { url: o.value })}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#3c4053]">
            <div className="mb-1 font-medium text-[#0b1024]">{t("cabinet.form.whereTitle")}</div>
            <ol className="list-decimal space-y-0.5 pl-4">
              <li>{t("cabinet.form.where1")}</li>
              <li>{t("cabinet.form.where2")}</li>
              <li>{t("cabinet.form.where3")}</li>
            </ol>
            <p className="mt-1.5 text-[#6f7282]">{t("cabinet.form.tariff")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving || !clientId.trim() || !appSecret.trim()} className={BTN_PRIMARY} data-testid="edo-cabinet-save">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
              {t("cabinet.form.save")}
            </button>
            {cabinet ? (
              <button type="button" onClick={() => setEditing(false)} className={BTN_OUTLINE}>
                {t("cabinet.form.cancel")}
              </button>
            ) : null}
          </div>
        </form>
      )}

      <ConfirmDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        onConfirm={async () => {
          await disconnect();
          setConfirmOff(false);
        }}
        variant="danger"
        title={t("cabinet.disconnectDialog.title")}
        description={t("cabinet.disconnectDialog.description")}
        bullets={[
          { label: t("cabinet.disconnectDialog.bulletKeys"), tone: "warn" },
          { label: t("cabinet.disconnectDialog.bulletHistory") },
          { label: t("cabinet.disconnectDialog.bulletDrafts"), tone: "info" },
        ]}
        confirmLabel={t("cabinet.disconnect")}
      />
    </section>
  );
}

/** Где ООО «БФС» среди организаций кабинета — и что делать, если не там. */
function SenderMatch({ cabinet }: { cabinet: EdoCabinetView }) {
  const t = useTranslations("rootEdo");
  const m = cabinet.senderMatch;
  if (m.kind === "ready") return null;
  const text =
    m.kind === "missing"
      ? t("cabinet.sender.missing", { inn: cabinet.sender.inn || "—", name: cabinet.sender.name || "ООО «БФС»" })
      : m.kind === "edo_off"
        ? t("cabinet.sender.edoOff", { name: m.org.name })
        : t("cabinet.sender.ambiguous", { inn: cabinet.sender.inn });
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-[#f6e1bd] bg-[#fff8eb] px-3.5 py-3 text-[13px] leading-snug text-[#8a5a12]" data-testid="edo-sender-warning">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}
