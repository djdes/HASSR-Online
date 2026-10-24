"use client";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ORG_SPHERES } from "@/lib/org-profile";
import { DEMO_ORG_TTL_DAYS, demoOrgName } from "@/lib/demo-organization.shared";

/**
 * Модалка «Создать демо-организацию?».
 *
 * Отдельная от CreateOrganizationDialog: там человек придумывает название
 * и решает, что копировать, здесь — только подтверждает и при желании
 * меняет сферу. Сфера по умолчанию — как у текущей точки, чтобы песочница
 * была похожа на своё заведение, но кафе может захотеть глянуть, как
 * выглядит производство.
 */
export function CreateDemoDialog({
  currentSphere,
  onClose,
}: {
  currentSphere: string;
  onClose: () => void;
}) {
  const t = useTranslations("layoutUi.createDemoDialog");
  const router = useRouter();
  const [sphere, setSphere] = useState(currentSphere);
  const [creating, setCreating] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const response = await fetch("/api/organizations/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sphere }),
      });
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
              {t("description", { name: demoOrgName(sphere), days: DEMO_ORG_TTL_DAYS })}
            </p>
          </div>
        </div>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
            {t("sphereLabel")}
          </span>
          <select
            value={sphere}
            onChange={(event) => setSphere(event.target.value)}
            disabled={creating}
            className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          >
            {ORG_SPHERES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="mt-1.5 block text-[12px] text-[#9b9fb3]">
            {sphere === currentSphere
              ? t("sameSphere")
              : t("otherSphere")}
          </span>
        </label>

        <ul className="mt-3 space-y-1 rounded-2xl bg-[#f5f6ff] p-3 text-[13px] leading-snug text-[#3c4053]">
          <li>{t("noteUnchanged")}</li>
          <li>{t("noteSwitch")}</li>
          <li>{t("noteDelete", { days: DEMO_ORG_TTL_DAYS })}</li>
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
