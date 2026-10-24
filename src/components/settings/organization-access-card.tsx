"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

/**
 * Доступ руководителя к другим точкам аккаунта.
 *
 * Показывается только владельцу и только для тех, кто и так руководит:
 * линейному сотруднику вторая точка не нужна — он работает в одной.
 * Домашняя организация в списке помечена и не выключается: она задана
 * самим сотрудником, а не членством.
 */

export type OrganizationAccessRow = {
  id: string;
  name: string;
  isHome: boolean;
  enabled: boolean;
};

export function OrganizationAccessCard({
  userId,
  userName,
  organizations,
}: {
  userId: string;
  userName: string;
  organizations: OrganizationAccessRow[];
}) {
  const t = useTranslations("settingsUi.organizationAccessCard");
  const router = useRouter();
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(organizations.map((row) => [row.id, row.enabled])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);

  if (organizations.length < 2) return null;

  async function toggle(row: OrganizationAccessRow) {
    if (row.isHome) return;
    const next = !state[row.id];
    setSavingId(row.id);
    setState((prev) => ({ ...prev, [row.id]: next }));
    try {
      const response = await fetch("/api/organizations/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, organizationId: row.id, enabled: next }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? t("saveFailed"));
      toast.success(
        next
          ? t("nowVisible", { userName, name: row.name })
          : t("accessClosed", { name: row.name }),
      );
      router.refresh();
    } catch (error) {
      setState((prev) => ({ ...prev, [row.id]: !next }));
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-[#ececf4] bg-white p-5">
      <h2 className="text-[16px] font-semibold text-[#0b1024]">
        {t("title")}
      </h2>
      <p className="mt-1 text-[13px] text-[#6f7282]">
        {t("description")}
      </p>
      <div className="mt-4 space-y-1">
        {organizations.map((row) => (
          <div
            key={row.id}
            className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-[#fafbff]"
          >
            <Building2 className="size-4 shrink-0 text-[#9b9fb3]" />
            <span className="min-w-0 flex-1 truncate text-[14px] text-[#0b1024]">
              {row.name}
              {row.isHome ? (
                <span className="ml-2 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-medium text-[#5566f6]">
                  {t("home")}
                </span>
              ) : null}
            </span>
            {savingId === row.id ? (
              <Loader2 className="size-4 animate-spin text-[#5566f6]" />
            ) : (
              <Switch
                checked={row.isHome || state[row.id]}
                disabled={row.isHome}
                onCheckedChange={() => toggle(row)}
                aria-label={t("accessTo", { name: row.name })}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
