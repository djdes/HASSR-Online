"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Crown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { PlatformMember } from "@/lib/platform-team.server";
import { cn } from "@/lib/utils";

/**
 * Владелец платформы: разделы и роль ему не нужны (открыто всё), но РОП и
 * должность в подписи КП и писем — можно, в том числе себе.
 */
export function OwnerSettingsDialog({
  member,
  onClose,
  onSaved,
}: {
  member: PlatformMember;
  onClose: () => void;
  onSaved: (salesHead: boolean, title: string | null) => void;
}) {
  const t = useTranslations("rootPanel");
  const [salesHead, setSalesHead] = useState(member.salesHead);
  const [title, setTitle] = useState(member.title ?? "");

  async function save() {
    const response = await fetch(`/api/root/team/${encodeURIComponent(member.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections: [], salesHead, title: title.trim() || null }),
    });
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      toast.error(data?.error ?? t("access.failed"));
      return;
    }
    toast.success(t("access.saved", { name: member.name }));
    onSaved(salesHead, title.trim() || null);
    onClose();
  }

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={save}
      title={t("access.ownerSettingsTitle", { name: member.name })}
      description={t("access.ownerSettingsBody")}
      icon={Crown}
      confirmLabel={t("access.update")}
    >
      <div className="space-y-3" data-owner-settings-dialog>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("access.titleLabel")}</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            placeholder={t("access.titlePlaceholder")}
            className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] outline-none transition-colors placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            data-owner-title
          />
        </label>
        <label className={cn("flex cursor-pointer items-start gap-3 rounded-2xl border px-3.5 py-3", salesHead ? "border-[#5566f6] bg-[#f5f6ff]" : "border-[#ececf4]")}>
          <input type="checkbox" checked={salesHead} onChange={() => setSalesHead(!salesHead)} className="mt-0.5 size-4 accent-[#5566f6]" data-owner-sales-head />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[14px] font-medium text-[#0b1024]">
              <TrendingUp className="size-4 text-[#5566f6]" />
              {t("access.salesHeadTitle")}
            </span>
            <span className="mt-0.5 block text-[12px] leading-snug text-[#6f7282]">{t("access.salesHeadHint")}</span>
          </span>
        </label>
      </div>
    </ConfirmDialog>
  );
}
