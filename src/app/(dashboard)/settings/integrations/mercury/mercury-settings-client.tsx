"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, CloudDownload, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Enterprise = {
  id: string;
  enterpriseGuid: string;
  activityLocationGuid: string | null;
  name: string;
  address: string | null;
  enabled: boolean;
  buildingId: string | null;
};

type Integration = {
  environment: string;
  issuerGuid: string;
  initiatorLogin: string;
  enabled: boolean;
  autoProcessMode: string;
  autoSupplierInns: string[];
  notifyUserId: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  label: string | null;
  enterprises: Enterprise[];
  documentsCount: number;
  queueCount: number;
};

export function MercurySettingsClient({
  available,
  mode,
  orgName,
  orgInn,
  integration,
  buildings,
  users,
}: {
  available: boolean;
  mode: "mock" | "live";
  orgName: string;
  orgInn: string | null;
  integration: Integration | null;
  buildings: Array<{ id: string; name: string; address: string | null }>;
  users: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("settingsUi.mercurySettingsClient");
  const locale = useLocale();
  const dateLocale = locale === "en" ? "en-GB" : locale === "uz" ? "uz-UZ" : "ru-RU";
  const MODES: Array<{ value: string; title: string; body: string }> = [
    { value: "off", title: t("modeOffTitle"), body: t("modeOffBody") },
    { value: "assisted", title: t("modeAssistedTitle"), body: t("modeAssistedBody") },
    {
      value: "auto_after_journal",
      title: t("modeAutoTitle"),
      body: t("modeAutoBody"),
    },
  ];
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [issuerGuid, setIssuerGuid] = useState(integration?.issuerGuid ?? "");
  const [initiatorLogin, setInitiatorLogin] = useState(
    integration?.initiatorLogin ?? "",
  );
  const [environment, setEnvironment] = useState(integration?.environment ?? "test");
  const [autoMode, setAutoMode] = useState(integration?.autoProcessMode ?? "assisted");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ enterpriseGuid: "", activityLocationGuid: "", name: "", address: "", buildingId: "" });
  const [deleting, setDeleting] = useState<Enterprise | null>(null);

  async function enterpriseRequest(url: string, method: string, payload?: Record<string, unknown>) {
    const res = await fetch(url, {
      method,
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || t("saveFailed"));
    return body as Record<string, unknown>;
  }

  async function runEnterprise(action: () => Promise<string>) {
    setSaving(true);
    try {
      toast.success(await action());
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setSaving(false);
    }
  }

  const updateEnterprise = (enterprise: Enterprise, payload: Record<string, unknown>) =>
    runEnterprise(async () => {
      const body = await enterpriseRequest(`/api/integrations/mercury/enterprises/${enterprise.id}`, "PATCH", payload);
      const moved = Number(body.repointed ?? 0);
      return moved > 0 ? t("enterpriseRepointed", { count: moved }) : t("enterpriseSaved");
    });

  const loadEnterprises = () =>
    runEnterprise(async () => {
      const body = await enterpriseRequest("/api/integrations/mercury/enterprises/load", "POST");
      return body.alreadyQueued ? t("loadAlreadyQueued") : t("loadQueued");
    });

  const addEnterprise = () =>
    runEnterprise(async () => {
      await enterpriseRequest("/api/integrations/mercury/enterprises", "POST", {
        enterpriseGuid: draft.enterpriseGuid,
        activityLocationGuid: draft.activityLocationGuid || null,
        name: draft.name,
        address: draft.address || null,
        buildingId: draft.buildingId || null,
      });
      setAdding(false);
      setDraft({ enterpriseGuid: "", activityLocationGuid: "", name: "", address: "", buildingId: "" });
      return t("enterpriseAdded");
    });

  async function connect() {
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/mercury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issuerGuid, initiatorLogin, environment }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("saveFailed"));
      toast.success(t("credentialsSaved"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setSaving(false);
    }
  }

  async function patch(payload: Record<string, unknown>, okText: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/mercury", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("saveFailed"));
      toast.success(okText);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setSaving(false);
    }
  }

  if (!available) {
    return (
      <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
        <div className="text-[15px] font-medium text-[#0b1024]">
          {t("unavailableTitle")}
        </div>
        <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-[1.6] text-[#6f7282]">
          {t("unavailableBody")}
        </p>
        <a
          href="/settings/subscription#tariffs"
          className="mt-4 inline-flex h-10 items-center justify-center rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
        >
          {t("unavailableCta")}
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Демо-режим обязан быть заметен: принять выдуманные ВСД за
          настоящие — худшее, что может случиться с этой интеграцией. */}
      {mode === "mock" ? (
        <div className="flex items-start gap-3 rounded-2xl border border-[#f0c674] bg-[#fff8e6] p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#a1740a]" />
          <div className="text-[13px] leading-[1.6] text-[#7a5a08]">
            <div className="font-semibold">{t("demoTitle")}</div>
            {t("demoBody")}
          </div>
        </div>
      ) : null}

      {/* Статус информационной системы */}
      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          {t("connection")}
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          {mode === "live" ? (
            <>
              <ShieldCheck className="size-4 text-[#116b2a]" />
              <span className="text-[#116b2a]">
                {t("systemRegistered")}
              </span>
            </>
          ) : (
            <span className="text-[#6f7282]">
              {t("systemDemo")}
            </span>
          )}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="issuerGuid" className="text-[13px]">
              {t("issuerGuidLabel")}
            </Label>
            <Input
              id="issuerGuid"
              value={issuerGuid}
              onChange={(e) => setIssuerGuid(e.target.value)}
              placeholder={t("issuerGuidPlaceholder")}
              className="mt-1.5 h-11 rounded-2xl border-[#dcdfed] px-3.5 text-[14px]"
            />
            <p className="mt-1 text-[12px] text-[#9b9fb3]">
              {orgName}
              {orgInn ? ` · ${t("inn", { inn: orgInn })}` : ""}
            </p>
          </div>
          <div>
            <Label htmlFor="initiatorLogin" className="text-[13px]">
              {t("initiatorLoginLabel")}
            </Label>
            <Input
              id="initiatorLogin"
              value={initiatorLogin}
              onChange={(e) => setInitiatorLogin(e.target.value)}
              placeholder={t("initiatorLoginPlaceholder")}
              className="mt-1.5 h-11 rounded-2xl border-[#dcdfed] px-3.5 text-[14px]"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            className="h-11 rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px]"
          >
            <option value="test">{t("envTest")}</option>
            <option value="prod">{t("envProd")}</option>
          </select>
          <Button
            onClick={connect}
            disabled={saving || !issuerGuid || !initiatorLogin}
            className="h-11 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0]"
          >
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {t("saveCredentials")}
          </Button>
        </div>
      </section>

      {/* Режим гашения */}
      {integration ? (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("redemptionMode")}
          </div>
          <p className="mb-4 text-[13px] leading-[1.6] text-[#6f7282]">
            {t("redemptionModeHint")}
          </p>
          <div className="space-y-2.5">
            {MODES.map((item) => (
              <label
                key={item.value}
                className={`flex cursor-pointer gap-3 rounded-2xl border p-4 transition-colors duration-150 ${
                  autoMode === item.value
                    ? "border-[#5566f6]/40 bg-[#f5f6ff]"
                    : "border-[#ececf4] hover:bg-[#fafbff]"
                }`}
              >
                <input
                  type="radio"
                  name="autoProcessMode"
                  value={item.value}
                  checked={autoMode === item.value}
                  onChange={() => {
                    setAutoMode(item.value);
                    void patch(
                      { autoProcessMode: item.value },
                      t("modeChanged"),
                    );
                  }}
                  className="mt-1 size-4 accent-[#5566f6]"
                />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-[#0b1024]">
                    {item.title}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-[1.55] text-[#6f7282]">
                    {item.body}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {/* Площадки и диагностика */}
      {integration ? (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {t("enterprisesAndSync")}
            </div>
            <Button
              variant="outline"
              onClick={() =>
                void patch(
                  { enabled: !integration.enabled },
                  integration.enabled ? t("syncDisabled") : t("syncEnabled"),
                )
              }
              disabled={saving || integration.enterprises.length === 0}
              className="h-10 rounded-2xl border-[#dcdfed] px-4 text-[14px]"
            >
              {integration.enabled ? t("disableSync") : t("enableSync")}
            </Button>
          </div>

          <p className="mb-4 text-[13px] leading-[1.6] text-[#6f7282]">{t("enterprisesHint")}</p>

          {integration.enterprises.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-8 text-center">
              <p className="mx-auto max-w-[460px] text-[13px] leading-[1.6] text-[#6f7282]">{t("noEnterprises")}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {integration.enterprises.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ececf4] px-4 py-3 transition-colors duration-150 hover:bg-[#fafbff]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-[#0b1024]">{e.name}</span>
                    {e.address ? <span className="block text-[12px] text-[#6f7282]">{e.address}</span> : null}
                    <span className="block break-all text-[11px] text-[#9b9fb3]">
                      {e.enterpriseGuid}
                      {e.activityLocationGuid ? ` · ${e.activityLocationGuid}` : ""}
                    </span>
                    {!e.buildingId && !e.enabled ? (
                      <span className="mt-1 block text-[12px] text-[#3848c7]">{t("mapHint")}</span>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={t("pointLabel")}
                      value={e.buildingId ?? ""}
                      disabled={saving}
                      onChange={(event) => void updateEnterprise(e, { buildingId: event.target.value || null })}
                      className="h-10 max-w-[240px] rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                    >
                      <option value="">{t("notMapped")}</option>
                      {buildings.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
                      <input
                        type="checkbox"
                        checked={e.enabled}
                        disabled={saving}
                        onChange={(event) => void updateEnterprise(e, { enabled: event.target.checked })}
                        className="size-4 accent-[#5566f6]"
                      />
                      {t("pollLabel")}
                    </label>
                    <button
                      type="button"
                      aria-label={t("deleteEnterprise")}
                      title={t("deleteEnterprise")}
                      disabled={saving}
                      onClick={() => setDeleting(e)}
                      className="inline-flex size-10 items-center justify-center rounded-2xl border border-[#ececf4] text-[#a13a32] transition-colors duration-150 hover:border-[#a13a32]/30 hover:bg-[#fff4f2] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void loadEnterprises()}
              disabled={saving}
              className="h-10 rounded-2xl border-[#dcdfed] px-4 text-[14px] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <CloudDownload className="mr-2 size-4 text-[#5566f6]" />
              {t("loadEnterprises")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setAdding((value) => !value)}
              disabled={saving}
              className="h-10 rounded-2xl border-[#dcdfed] px-4 text-[14px] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <Plus className="mr-2 size-4 text-[#5566f6]" />
              {t("addEnterprise")}
            </Button>
          </div>

          {adding ? (
            <div className="mt-4 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="enterpriseGuid" className="text-[13px]">{t("enterpriseGuidLabel")}</Label>
                  <Input
                    id="enterpriseGuid"
                    value={draft.enterpriseGuid}
                    onChange={(event) => setDraft({ ...draft, enterpriseGuid: event.target.value })}
                    placeholder={t("enterpriseGuidPlaceholder")}
                    className="mt-1.5 h-11 rounded-2xl border-[#dcdfed] bg-white px-3.5 text-[14px]"
                  />
                </div>
                <div>
                  <Label htmlFor="activityLocationGuid" className="text-[13px]">{t("activityLocationGuidLabel")}</Label>
                  <Input
                    id="activityLocationGuid"
                    value={draft.activityLocationGuid}
                    onChange={(event) => setDraft({ ...draft, activityLocationGuid: event.target.value })}
                    className="mt-1.5 h-11 rounded-2xl border-[#dcdfed] bg-white px-3.5 text-[14px]"
                  />
                </div>
                <div>
                  <Label htmlFor="enterpriseName" className="text-[13px]">{t("enterpriseNameLabel")}</Label>
                  <Input
                    id="enterpriseName"
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    className="mt-1.5 h-11 rounded-2xl border-[#dcdfed] bg-white px-3.5 text-[14px]"
                  />
                </div>
                <div>
                  <Label htmlFor="enterpriseAddress" className="text-[13px]">{t("enterpriseAddressLabel")}</Label>
                  <Input
                    id="enterpriseAddress"
                    value={draft.address}
                    onChange={(event) => setDraft({ ...draft, address: event.target.value })}
                    className="mt-1.5 h-11 rounded-2xl border-[#dcdfed] bg-white px-3.5 text-[14px]"
                  />
                </div>
                <div>
                  <Label htmlFor="enterprisePoint" className="text-[13px]">{t("pointLabel")}</Label>
                  <select
                    id="enterprisePoint"
                    value={draft.buildingId}
                    onChange={(event) => setDraft({ ...draft, buildingId: event.target.value })}
                    className="mt-1.5 h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                  >
                    <option value="">{t("notMapped")}</option>
                    {buildings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={() => void addEnterprise()}
                  disabled={saving || draft.enterpriseGuid.trim().length < 8 || !draft.name.trim()}
                  className="h-10 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0]"
                >
                  {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  {t("addConfirm")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setAdding(false)}
                  className="h-10 rounded-2xl border-[#dcdfed] px-4 text-[14px]"
                >
                  {t("cancel")}
                </Button>
              </div>
            </div>
          ) : null}

          <dl className="mt-5 grid gap-3 text-[13px] sm:grid-cols-3">
            <div>
              <dt className="text-[#6f7282]">{t("vsdReceived")}</dt>
              <dd className="tabular-nums text-[#0b1024]">{integration.documentsCount}</dd>
            </div>
            <div>
              <dt className="text-[#6f7282]">{t("queueCount")}</dt>
              <dd className="tabular-nums text-[#0b1024]">{integration.queueCount}</dd>
            </div>
            <div>
              <dt className="text-[#6f7282]">{t("lastSync")}</dt>
              <dd className="text-[#0b1024]">
                {integration.lastSyncAt
                  ? new Date(integration.lastSyncAt).toLocaleString(dateLocale)
                  : t("never")}
              </dd>
            </div>
          </dl>

          {integration.lastSyncError ? (
            <p className="mt-3 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]">
              {integration.lastSyncError}
            </p>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-[13px] text-[#116b2a]">
              <CheckCircle2 className="size-4" /> {t("noErrors")}
            </p>
          )}

          {users.length > 0 ? (
            <div className="mt-5">
              <Label className="text-[13px]">{t("notifyWhom")}</Label>
              <select
                defaultValue={integration.notifyUserId ?? ""}
                onChange={(e) =>
                  void patch(
                    { notifyUserId: e.target.value || null },
                    t("notifyChanged"),
                  )
                }
                className="mt-1.5 h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] sm:w-[320px]"
              >
                <option value="">{t("allManagement")}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </section>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          const target = deleting;
          setDeleting(null);
          if (!target) return;
          await runEnterprise(async () => {
            await enterpriseRequest(`/api/integrations/mercury/enterprises/${target.id}`, "DELETE");
            return t("enterpriseDeleted");
          });
        }}
        title={t("deleteConfirmTitle", { name: deleting?.name ?? "" })}
        description={t("deleteConfirmBody")}
        confirmLabel={t("deleteEnterprise")}
        cancelLabel={t("cancel")}
        variant="danger"
      />
    </div>
  );
}
