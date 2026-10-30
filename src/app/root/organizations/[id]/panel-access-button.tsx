"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { PlatformAccessDialog } from "@/components/root/platform-access-dialog";
import { matchPlatformPreset, type PlatformSectionKey } from "@/lib/platform-access";
import { cn } from "@/lib/utils";

/** «Доступ к панели» for one employee in the client card (owner only). */
export function PanelAccessButton({ user, sections }: { user: { id: string; name: string }; sections: PlatformSectionKey[] }) {
  const t = useTranslations("rootPanel");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(sections);
  const preset = matchPlatformPreset(current);
  const label = current.length ? t("access.buttonHas", { role: preset ? t(`presets.${preset}.title`) : t("presets.custom.title") }) : t("access.button");
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-panel-access={user.id}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-[12.5px] font-medium transition-colors duration-150",
          current.length
            ? "bg-[#eef1ff] text-[#3848c7] hover:bg-[#e2e7ff]"
            : "border border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
        )}
      >
        <ShieldCheck className="size-3.5" />
        {label}
      </button>
      {open ? (
        <PlatformAccessDialog
          open
          onClose={() => setOpen(false)}
          user={user}
          initialSections={current}
          onSaved={(next) => {
            setCurrent(next);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
