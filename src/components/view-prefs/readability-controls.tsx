"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { TextSizeGroup, type TextSizeGroupSize } from "./text-size";
import { useViewPrefs } from "./view-prefs-provider";

/**
 * «Удобство чтения» целиком: размер текста и три переключателя — высокий
 * контраст, без анимации, пояснения на страницах. Одни и те же контролы в
 * «Настройки → Оформление», в окне из меню профиля (его видит любой
 * сотрудник) и в профиле мини-приложения. Всё — настройка этого устройства.
 */
export function ReadabilityControls({
  size = "comfortable",
  className,
}: {
  size?: TextSizeGroupSize;
  className?: string;
}) {
  const t = useTranslations("common.viewPrefs");
  const { prefs, update } = useViewPrefs();
  return (
    <div className={cn("space-y-4", className)} data-testid="readability-controls">
      <div>
        <div className="mb-2 text-[13px] font-semibold text-[var(--app-text,#0b1024)]">{t("textSize")}</div>
        <TextSizeGroup size={size} />
      </div>
      <div className="divide-y divide-[var(--app-border,#ececf4)] rounded-2xl border border-[var(--app-border,#ececf4)]">
        <ToggleRow
          testId="view-contrast"
          title={t("contrast")}
          hint={t("contrastHint")}
          checked={prefs.contrast === "high"}
          onChange={(on) => update({ contrast: on ? "high" : "auto" })}
        />
        <ToggleRow
          testId="view-motion"
          title={t("motion")}
          hint={t("motionHint")}
          checked={prefs.motion === "reduce"}
          onChange={(on) => update({ motion: on ? "reduce" : "auto" })}
        />
        <ToggleRow
          testId="view-hints"
          title={t("hints")}
          hint={t("hintsHint")}
          checked={prefs.hints === "on"}
          onChange={(on) => update({ hints: on ? "on" : "off" })}
        />
      </div>
    </div>
  );
}

function ToggleRow({
  title,
  hint,
  checked,
  onChange,
  testId,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  testId: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-[14px] font-medium text-[var(--app-text,#0b1024)]">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-[#6f7282]">{hint}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </div>
  );
}
