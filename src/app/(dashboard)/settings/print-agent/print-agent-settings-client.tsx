"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Download, Loader2, Unplug } from "lucide-react";
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
};

export function PrintAgentSettingsClient({ agents }: { agents: Agent[] }) {
  const router = useRouter();
  const t = useTranslations("printAgent.settings");
  const locale = useLocale() as Locale;
  const currentTranslations = useRef(t);
  useEffect(() => { currentTranslations.current = t; }, [t]);
  const [revoking, setRevoking] = useState<Agent | null>(null);
  const [busy, setBusy] = useState(false);

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
