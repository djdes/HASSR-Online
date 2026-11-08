"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UserCheck } from "lucide-react";
import { toast } from "sonner";

import type { AccountManagerOption } from "@/lib/account-manager.server";

/** «Ответственный менеджер» в шапке карточки клиента: менять может тот, кто видит всех клиентов. */
export function AccountManagerControl({
  organizationId,
  current,
  options,
  canAssign,
}: {
  organizationId: string;
  current: { id: string; name: string } | null;
  options: AccountManagerOption[];
  canAssign: boolean;
}) {
  const t = useTranslations("rootPanel");
  const router = useRouter();
  const [value, setValue] = useState(current?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function save(next: string) {
    setValue(next);
    setBusy(true);
    try {
      const response = await fetch(`/api/root/organizations/${encodeURIComponent(organizationId)}/manager`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managerId: next || null }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string; movedLeads?: number } | null;
      if (!response.ok) throw new Error(data?.error ?? t("accountManager.failed"));
      toast.success(next ? t("accountManager.saved") : t("accountManager.cleared"), {
        description: data?.movedLeads ? t("accountManager.movedLeads", { count: String(data.movedLeads) }) : undefined,
      });
      router.refresh();
    } catch (error) {
      setValue(current?.id ?? "");
      toast.error(error instanceof Error ? error.message : t("accountManager.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[13.5px]" data-account-manager>
      <UserCheck className="size-4 text-[#5566f6]" />
      <span className="text-[#6f7282]">{t("accountManager.label")}:</span>
      {canAssign ? (
        <select
          value={value}
          disabled={busy}
          onChange={(event) => void save(event.target.value)}
          className="h-9 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[13.5px] text-[#0b1024] outline-none focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          aria-label={t("accountManager.label")}
          data-account-manager-select
        >
          <option value="">{t("accountManager.none")}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.roleTitle ? `${option.name} · ${option.roleTitle}` : option.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="font-medium text-[#0b1024]">{current?.name ?? t("accountManager.none")}</span>
      )}
    </div>
  );
}
