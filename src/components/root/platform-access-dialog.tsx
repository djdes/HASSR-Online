"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  PLATFORM_PRESETS,
  PLATFORM_SECTIONS,
  matchPlatformPreset,
  platformHomeHref,
  type PlatformSectionKey,
} from "@/lib/platform-access";
import { cn } from "@/lib/utils";

/**
 * Grant / change / revoke platform panel sections for one person
 * (owner only). Used on «Команда и доступы» and in the client card.
 */
export function PlatformAccessDialog({
  open,
  onClose,
  user,
  initialSections,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  user: { id: string; name: string };
  initialSections: readonly PlatformSectionKey[];
  onSaved: (sections: PlatformSectionKey[]) => void;
}) {
  const t = useTranslations("rootPanel");
  const [sections, setSections] = useState<PlatformSectionKey[]>([...initialSections]);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const hadAccess = initialSections.length > 0;
  const preset = matchPlatformPreset(sections);

  function toggle(key: PlatformSectionKey) {
    setSections((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  async function save(next: PlatformSectionKey[]) {
    const response = await fetch(`/api/root/team/${encodeURIComponent(user.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections: next }),
    });
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      toast.error(data?.error ?? t("access.failed"));
      return;
    }
    toast.success(next.length ? t("access.saved", { name: user.name }) : t("access.revoked", { name: user.name }), {
      description: next.length && !hadAccess ? t("access.refreshHint") : undefined,
    });
    onSaved(next);
    onClose();
  }

  const ordered = PLATFORM_SECTIONS.filter((section) => sections.includes(section.key));
  const home = PLATFORM_SECTIONS.find((section) => section.home === platformHomeHref({ superadmin: false, sections }));

  return (
    <>
      <ConfirmDialog
        open={open && !revokeOpen}
        onClose={onClose}
        onConfirm={() => save(sections)}
        title={t("access.title", { name: user.name })}
        description={t("access.description")}
        icon={ShieldCheck}
        confirmLabel={hadAccess ? t("access.update") : t("access.grant")}
        confirmDisabled={sections.length === 0}
        bullets={
          sections.length
            ? [
                { label: t("access.willSee", { sections: ordered.map((section) => t(`sections.${section.key}.title`)).join(", ") }) },
                ...(home ? [{ label: t("access.lands", { section: t(`sections.${home.key}.title`) }), tone: "info" as const }] : []),
                { label: t("access.ownerOnly"), tone: "warn" as const },
              ]
            : [{ label: t("access.nothing"), tone: "warn" as const }]
        }
      >
        <div className="space-y-4" data-platform-access-dialog>
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("access.presetsLabel")}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {PLATFORM_PRESETS.map((item) => {
                const active = preset === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSections([...item.sections])}
                    aria-pressed={active}
                    data-preset={item.key}
                    className={cn(
                      "rounded-2xl border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                      active ? "border-[#5566f6] bg-[#f5f6ff]" : "border-[#ececf4] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-[14px] font-medium text-[#0b1024]">
                      {active ? <Check className="size-4 text-[#5566f6]" /> : null}
                      {t(`presets.${item.key}.title`)}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-[#6f7282]">{t(`presets.${item.key}.hint`)}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("access.sectionsLabel")}</span>
              {!preset && sections.length ? <span className="text-[12px] text-[#3848c7]">{t("presets.custom.title")}</span> : null}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {PLATFORM_SECTIONS.map((section) => {
                const checked = sections.includes(section.key);
                return (
                  <label
                    key={section.key}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 transition-colors duration-150",
                      checked ? "border-[#5566f6]/50 bg-[#f5f6ff]" : "border-[#ececf4] hover:bg-[#fafbff]",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(section.key)}
                      data-section={section.key}
                      className="mt-0.5 size-4 accent-[#5566f6]"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium text-[#0b1024]">{t(`sections.${section.key}.title`)}</span>
                      <span className="block text-[12px] leading-snug text-[#6f7282]">{t(`sections.${section.key}.hint`)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          {hadAccess ? (
            <button
              type="button"
              onClick={() => setRevokeOpen(true)}
              className="text-[13px] font-medium text-[#a13a32] transition-colors hover:text-[#7f2b25]"
            >
              {t("access.revoke")}
            </button>
          ) : null}
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={open && revokeOpen}
        onClose={() => setRevokeOpen(false)}
        onConfirm={() => save([])}
        variant="danger"
        title={t("access.revokeTitle")}
        description={t("access.revokeBody", { name: user.name })}
        confirmLabel={t("access.revoke")}
      />
    </>
  );
}
