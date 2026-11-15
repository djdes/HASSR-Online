"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

export type RequisiteKey = "inn" | "legalFullName" | "kpp" | "ogrn" | "legalAddress" | "directorPost" | "directorName";

const KEYS: readonly RequisiteKey[] = ["inn", "legalFullName", "kpp", "ogrn", "legalAddress", "directorPost", "directorName"];

/** Те же правила, что на сервере (`organization-profile-patch`): неполное значение не отправляем. */
function localError(key: RequisiteKey, raw: string): "inn" | "kpp" | "ogrn" | null {
  const value = raw.replace(/\s/g, "");
  if (!value) return null;
  if (key === "inn" && !/^\d{10}$|^\d{12}$/.test(value)) return "inn";
  if (key === "kpp" && !/^\d{4}[\dA-Z]{2}\d{3}$/.test(value.toUpperCase())) return "kpp";
  if (key === "ogrn" && !/^\d{13}$|^\d{15}$/.test(value)) return "ogrn";
  return null;
}

type Values = Record<RequisiteKey, string>;
type Status = "idle" | "pending" | "saving" | "saved" | "error";

/**
 * Реквизиты клиента в карточке панели (2026-11-15): правятся прямо здесь и
 * сохраняются сами — через секунду после ввода, при уходе с поля и при
 * закрытии вкладки. Кнопки «Сохранить» нет: забыть нажать нельзя.
 * Пустое поле — значение из ЕГРЮЛ (подсказка в поле).
 */
export function ClientRequisitesCard({
  organizationId,
  initial,
  registry,
  copyText,
  canRefreshRegistry,
}: {
  organizationId: string;
  /** Что сейчас в карточке: правка или, если её нет, значение из ЕГРЮЛ. */
  initial: Values;
  /** Значения из снимка ЕГРЮЛ — подсказки и «правку не сохранять, если совпадает». */
  registry: Partial<Values>;
  copyText: string | null;
  canRefreshRegistry: boolean;
}) {
  const t = useTranslations("rootOrganizationManagement.requisites");
  const router = useRouter();
  const [values, setValues] = useState<Values>(initial);
  const saved = useRef<Values>(initial);
  const latest = useRef<Values>(initial);
  latest.current = values;
  const [status, setStatus] = useState<Status>("idle");
  const [touched, setTouched] = useState<Partial<Record<RequisiteKey, boolean>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const url = `/api/root/organizations/${organizationId}/requisites`;

  /** Поля, которые изменились и прошли локальную проверку, в виде тела запроса. */
  function pendingPayload(current: Values): Record<string, string> | null {
    const payload: Record<string, string> = {};
    for (const key of KEYS) {
      if (current[key] === saved.current[key]) continue;
      if (localError(key, current[key])) continue;
      // Совпало с ЕГРЮЛ — правка не нужна, в документы и так пойдёт снимок.
      const value = current[key].trim();
      payload[key] = key !== "inn" && registry[key] && value === registry[key] ? "" : value;
    }
    return Object.keys(payload).length ? payload : null;
  }

  async function flush() {
    const snapshot = latest.current;
    const payload = pendingPayload(snapshot);
    if (!payload) {
      setStatus((prev) => (prev === "pending" ? "idle" : prev));
      return;
    }
    setStatus("saving");
    try {
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setServerError(data?.error ?? t("autosave.error"));
        setStatus("error");
        return;
      }
      saved.current = { ...saved.current, ...Object.fromEntries(Object.keys(payload).map((key) => [key, snapshot[key as RequisiteKey]])) };
      setServerError(null);
      setStatus(pendingPayload(latest.current) ? "pending" : "saved");
      // Блоки карточки, которые читают реквизиты с сервера (договор, счета), — свежие.
      router.refresh();
    } catch {
      setServerError(t("autosave.network"));
      setStatus("error");
    }
  }

  // Автосохранение: секунда тишины после последнего ввода.
  useEffect(() => {
    if (!pendingPayload(values)) return;
    setStatus("pending");
    const timer = window.setTimeout(() => void flush(), 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  // Закрыли вкладку раньше таймера — дописываем последнее.
  useEffect(() => {
    const onHide = () => {
      const payload = pendingPayload(latest.current);
      if (!payload) return;
      try {
        navigator.sendBeacon(url, new Blob([JSON.stringify(payload)], { type: "application/json" }));
      } catch {
        /* остаётся сохранённое по таймеру */
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  async function refreshRegistry() {
    setRefreshing(true);
    try {
      await flush();
      const response = await fetch(`/api/root/organizations/${organizationId}/contracts/legal-refresh`, { method: "POST" });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        toast.error(data?.error ?? t("registry.failed"));
        return;
      }
      toast.success(t("registry.done"));
      router.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  const innValid = !localError("inn", values.inn) && values.inn.replace(/\D/g, "").length > 0;

  const fields: Array<{ key: RequisiteKey; label: string; wide?: boolean; numeric?: boolean }> = [
    { key: "inn", label: t("inn"), numeric: true },
    { key: "kpp", label: t("kpp") },
    { key: "legalFullName", label: t("fullName"), wide: true },
    { key: "ogrn", label: t("ogrn"), numeric: true },
    { key: "directorPost", label: t("directorPost") },
    { key: "directorName", label: t("directorName"), wide: true },
    { key: "legalAddress", label: t("address"), wide: true },
  ];

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6" data-client-requisites>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("title")}</div>
          <AutosaveStatus status={status} error={serverError} t={t} />
        </div>
        <div className="flex items-center gap-1">
          {(canRefreshRegistry || innValid) ? (
            <button
              type="button"
              onClick={() => void refreshRegistry()}
              disabled={refreshing || !innValid}
              title={t("registry.hint")}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#3c4053] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50"
            >
              {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5 text-[#5566f6]" />}
              {t("registry.button")}
            </button>
          ) : null}
          {copyText ? <CopyButton value={copyText} label={t("copyAll")} /> : null}
        </div>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-[#8a8ea4]">{t("autosave.hint")}</p>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
        {fields.map((field) => {
          const err = touched[field.key] ? localError(field.key, values[field.key]) : null;
          return (
            <label key={field.key} className={cn("block", field.wide && "col-span-2")}>
              <span className="text-[12px] font-medium text-[#6f7282]">{field.label}</span>
              <input
                value={values[field.key]}
                inputMode={field.numeric ? "numeric" : undefined}
                placeholder={registry[field.key] ? t("fromRegistry", { value: registry[field.key]! }) : ""}
                onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
                onBlur={() => {
                  setTouched((prev) => ({ ...prev, [field.key]: true }));
                  void flush();
                }}
                className={cn(
                  "mt-1 h-9 w-full rounded-xl border bg-white px-3 text-[13.5px] text-[#0b1024] outline-none transition-colors duration-150 placeholder:text-[#b4b7c8] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15",
                  err ? "border-[#e8a39b]" : "border-[#dcdfed]",
                )}
                data-requisite={field.key}
              />
              {err ? <span className="mt-0.5 block text-[11.5px] text-[#a13a32]">{t(`invalid.${err}`)}</span> : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function AutosaveStatus({ status, error, t }: { status: Status; error: string | null; t: ReturnType<typeof useTranslations> }) {
  if (status === "idle") return null;
  if (status === "error") {
    return (
      <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium text-[#a13a32]">
        <CloudOff className="size-3.5" />
        {error ?? t("autosave.error")}
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium text-[#116b2a]">
        <Check className="size-3.5" />
        {t("autosave.saved")}
      </span>
    );
  }
  return (
    <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium text-[#6f7282]">
      <Loader2 className="size-3.5 animate-spin" />
      {t("autosave.saving")}
    </span>
  );
}
