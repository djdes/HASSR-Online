"use client";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DEMO_HISTORY_DAYS } from "@/lib/demo-organization.shared";

/**
 * Модалка «Открыть демо-организацию?».
 *
 * Демо одна на всю платформу и переустанавливается раз в сутки, поэтому
 * здесь человек ничего не создаёт и не настраивает — только подтверждает
 * вход и узнаёт, что данные там общие и временные.
 */
export function CreateDemoDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("layoutUi.createDemoDialog");
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const response = await fetch("/api/organizations/demo", { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? t("createFailed"));
      toast.success(t("ready"));
      onClose();
      router.push("/dashboard?welcome-demo=1");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
      setCreating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[#0b1024]/40 p-4 backdrop-blur-sm"
      onClick={creating ? undefined : onClose}
    >
      <BodyScrollLock />
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        data-testid="create-demo-dialog"
        className="w-full max-w-[440px] rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_30px_80px_-30px_rgba(11,16,36,0.5)]"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <FlaskConical className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold text-[#0b1024]">
              {t("title")}
            </h2>
            <p className="mt-1 text-[13px] leading-[1.55] text-[#6f7282]">
              {t("description", { days: DEMO_HISTORY_DAYS })}
            </p>
          </div>
        </div>

        <ul className="mt-4 space-y-1 rounded-2xl bg-[#f5f6ff] p-3 text-[13px] leading-snug text-[#3c4053]">
          <li>{t("noteUnchanged")}</li>
          <li>{t("noteSwitch")}</li>
          <li>{t("noteDelete")}</li>
        </ul>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="inline-flex h-11 items-center rounded-2xl px-4 text-[15px] text-[#6f7282] transition-colors hover:bg-[#f5f6ff] disabled:opacity-50"
          >
            {t("no")}
          </button>
          <button
            type="submit"
            disabled={creating}
            data-testid="create-demo-confirm"
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-wait disabled:bg-[#c9cef7]"
          >
            {creating ? <Loader2 className="size-4 animate-spin" /> : null}
            {creating ? t("preparing") : t("confirm")}
          </button>
        </div>
      </form>
    </div>
  );
}
