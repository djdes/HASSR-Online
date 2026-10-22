"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { assistantSaveErrorKey } from "./assistant-presentation";
import { useRouter } from "next/navigation";
import { Loader2, Plug } from "lucide-react";
import { toast } from "sonner";

/**
 * Настройка связи с ProjectsFlow.
 *
 * Токен наружу не отдаётся никогда — только признак «задан или нет».
 * Пустое поле при сохранении означает «оставить как было»: иначе
 * поправить идентификатор проекта было бы нельзя, не вводя токен заново.
 */
export function AssistantIntegrationForm({
  initial,
}: {
  initial: {
    hasToken: boolean;
    projectId: string;
    apiUrl: string;
    baseUrl: string;
    enabled: boolean;
  };
}) {
  const router = useRouter();
  const t = useTranslations("rootAssistant");
  const currentT = useRef(t);
  useEffect(() => { currentT.current = t; }, [t]);
  const [token, setToken] = useState("");
  const [projectId, setProjectId] = useState(initial.projectId);
  const [apiUrl, setApiUrl] = useState(initial.apiUrl);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const response = await fetch("/api/root/assistant-integration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, projectId, apiUrl, baseUrl, enabled }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(currentT.current(assistantSaveErrorKey(data?.error)));
        return;
      }
      toast.success(currentT.current("saved"));
      setToken("");
      router.refresh();
    } catch {
      toast.error(currentT.current("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const field =
    "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <Plug className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold text-[#0b1024]">
            {t("integrationTitle")}
          </div>
          <p className="mt-1 max-w-[640px] text-[13.5px] leading-[1.55] text-[#6f7282]">
            {t("integrationHelp")}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-[#3c4053]">
            {t("token")}
            {initial.hasToken ? (
              <span className="ml-2 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[11px] font-medium text-[#116b2a]">
                {t("tokenSet")}
              </span>
            ) : null}
          </span>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={initial.hasToken ? t("keepToken") : "pfat_…"}
            autoComplete="off"
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-[#3c4053]">
            {t("project")}
          </span>
          <input
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            placeholder={t("projectPlaceholder")}
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-[#3c4053]">
            {t("apiUrl")}
          </span>
          <input
            value={apiUrl}
            onChange={(event) => setApiUrl(event.target.value)}
            placeholder="https://projectsflow.ru/api"
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-[#3c4053]">
            {t("baseUrl")}
          </span>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://wesetup.ru"
            className={field}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2.5 text-[13.5px] text-[#3c4053]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="size-4 accent-[#5566f6]"
          />
          {t("enabled")}
        </label>

        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          aria-busy={busy}
          aria-label={busy ? t("saving") : t("save")}
          className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("save")}
        </button>
      </div>
    </section>
  );
}
