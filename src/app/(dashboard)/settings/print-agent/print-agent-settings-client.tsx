"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Download, Loader2, MapPin, Unplug } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";

/**
 * Список подключённых машин и кнопка скачивания программы.
 *
 * Отключение — через `ConfirmDialog`, а не нативное окно: правило проекта,
 * и повод объяснить последствие. Отключённая машина перестаёт печатать
 * сразу, но история печати с неё остаётся — иначе при проверке нечем
 * будет доказать, что бланк печатали.
 */

type Agent = {
  id: string;
  name: string;
  printerName: string | null;
  agentVersion: string | null;
  lastSeenAt: string | null;
  online: boolean;
  /** Точка принтера (2026-11-01); null — вся организация. */
  buildingId?: string | null;
  buildingName?: string | null;
};

type Point = { id: string; name: string };

/** Значение «Вся организация» в выборе точки. */
const ORGANIZATION_OPTION = "";

export function PrintAgentSettingsClient({
  agents,
  points = [],
  canChooseOrganization = true,
}: {
  agents: Agent[];
  /** Точки, на которые можно поставить принтер; пусто — журналы не по точкам, выбора нет. */
  points?: Point[];
  /** Руководство компании может оставить принтер общим на всю организацию. */
  canChooseOrganization?: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("printAgent.settings");
  const locale = useLocale() as Locale;
  const currentTranslations = useRef(t);
  useEffect(() => { currentTranslations.current = t; }, [t]);
  const [revoking, setRevoking] = useState<Agent | null>(null);
  const [busy, setBusy] = useState(false);
  // Смена точки — без своего состояния: запрос, тост и обновление страницы.
  const savingPoint = useRef<string | null>(null);

  async function changePoint(agent: Agent, value: string) {
    if (savingPoint.current) return;
    savingPoint.current = agent.id;
    const buildingId = value === ORGANIZATION_OPTION ? null : value;
    try {
      const res = await fetch(`/api/print/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingId }),
      });
      if (!res.ok) {
        toast.error(currentTranslations.current(res.status === 403 ? "errors.forbidden" : res.status === 404 ? "errors.notFound" : "errors.failed"));
        return;
      }
      const point = points.find((item) => item.id === buildingId)?.name ?? currentTranslations.current("devices.allPoints");
      toast.success(currentTranslations.current("devices.pointChanged", { name: agent.name, point }));
      router.refresh();
    } catch {
      toast.error(currentTranslations.current("errors.failed"));
    } finally {
      savingPoint.current = null;
    }
  }

  async function revoke(agent: Agent) {
    setBusy(true);
    try {
      const res = await fetch(`/api/print/agents/${agent.id}/revoke`, {
        method: "POST",
      });
      if (!res.ok) {
        toast.error(currentTranslations.current(res.status === 403 ? "errors.forbidden" : res.status === 404 ? "errors.notFound" : "errors.failed"));
        return;
      }
      toast.success(currentTranslations.current("devices.disconnected", { name: agent.name }));
      router.refresh();
    } catch {
      toast.error(currentTranslations.current("errors.failed"));
    } finally {
      setBusy(false);
      setRevoking(null);
    }
  }

  return (
    <>
      <section className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef0f6] px-6 py-4">
          <div>
            <div className="text-[16px] font-semibold text-[#0b1024]">
              {t("devices.heading")}
            </div>
            <p className="mt-0.5 text-[13px] text-[#6f7282]">
              {t("devices.description")}
            </p>
          </div>
          <a
            href="/api/print/agent/download"
            className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
          >
            <Download className="size-4" />
            {t("devices.download")}
          </a>
        </div>

        {points.length > 0 ? (
          <p className="border-b border-[#eef0f6] px-6 py-3 text-[12.5px] leading-snug text-[#6f7282]">
            {t("devices.pointHint")}
          </p>
        ) : null}

        {agents.length === 0 ? (
          <div className="px-6 py-12 text-center text-[14px] text-[#6f7282]">
            {t("devices.empty")}
          </div>
        ) : (
          <ul className="divide-y divide-[#eef0f6]">
            {agents.map((agent) => (
              <li
                key={agent.id}
                className="flex flex-wrap items-center gap-3 px-6 py-4"
              >
                <span
                  aria-hidden
                  className={`size-2 shrink-0 rounded-full ${
                    agent.online ? "bg-[#116b2a]" : "bg-[#c6c9d8]"
                  }`}
                />
                <span className="sr-only">{t(agent.online ? "devices.online" : "devices.offline")}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-[#0b1024]">
                    {agent.name}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[#6f7282]">
                    {agent.lastSeenAt
                      ? t("devices.lastSeen", { printer: agent.printerName ?? t("devices.noPrinter"), when: new Date(agent.lastSeenAt).toLocaleString(FORMAT_LOCALES[locale]) })
                      : t("devices.neverSeen", { printer: agent.printerName ?? t("devices.noPrinter") })}
                  </div>
                  {points.length > 0 ? (
                    <label className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-[#6f7282]">
                      <MapPin className="size-3.5 text-[#5566f6]" aria-hidden />
                      {t("devices.point")}
                      <select
                        value={agent.buildingId ?? ORGANIZATION_OPTION}
                        onChange={(event) => void changePoint(agent, event.target.value)}
                        aria-label={t("devices.pointAria", { name: agent.name })}
                        title={t("devices.pointHint")}
                        className="h-8 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[13px] text-[#0b1024] transition-colors hover:border-[#5566f6]/40 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                      >
                        {canChooseOrganization || !agent.buildingId ? (
                          <option value={ORGANIZATION_OPTION}>{t("devices.allPoints")}</option>
                        ) : null}
                        {points.map((point) => (
                          <option key={point.id} value={point.id}>
                            {point.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : agent.buildingName ? (
                    <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] text-[#3848c7]">
                      <MapPin className="size-3" aria-hidden />
                      {agent.buildingName}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setRevoking(agent)}
                  aria-label={t("devices.disconnectAria", { name: agent.name })}
                  className="inline-flex h-9 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#6f7282] transition-colors hover:border-[#ff8d7d] hover:bg-[#fff4f2] hover:text-[#a13a32]"
                >
                  <Unplug className="size-4" />
                  {t("devices.disconnect")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(revoking)}
        onClose={() => !busy && setRevoking(null)}
        onConfirm={async () => {
          if (revoking) await revoke(revoking);
        }}
        variant="warn"
        title={t("confirm.title", { name: revoking?.name ?? "" })}
        description={t("confirm.description")}
        bullets={[
          { label: t("confirm.queue") },
          { label: t("confirm.history") },
        ]}
        confirmLabel={t("devices.disconnect")}
      />

      {busy ? (
        <div className="flex items-center gap-2 text-[13px] text-[#6f7282]">
          <Loader2 className="size-4 animate-spin" />
          {t("devices.disconnecting")}
        </div>
      ) : null}
    </>
  );
}
