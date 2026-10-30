"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small copy-to-clipboard icon next to a phone, e-mail or requisites. */
export function CopyButton({ value, label, className }: { value: string; label?: string; className?: string }) {
  const t = useTranslations("rootOrganizationManagement.contacts");
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={done ? t("copied") : t("copy")}
      aria-label={label ?? t("copy")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-[#9b9fb3] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#3848c7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]/40",
        className,
      )}
    >
      {done ? <Check className="size-3.5 text-[#116b2a]" /> : <Copy className="size-3.5" />}
    </button>
  );
}
