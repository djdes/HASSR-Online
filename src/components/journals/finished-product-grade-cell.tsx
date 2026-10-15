"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { getFinishedProductOrganolepticOptions, type FinishedProductDocumentConfig } from "@/lib/finished-product-document";
import { finishedGrade } from "./finished-product-presentation";
import { JournalCellInput } from "./journal-cell-input";

/** Option labels are presentation only. Selected values and freely entered
 * assessments retain their canonical/original spelling. */
export function FinishedProductGradeCell({ value, config, onChange, onBlur, disabled }: {
  value: string;
  config: FinishedProductDocumentConfig;
  onChange: (value: string) => void;
  onBlur: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations("finishedProduct");
  const [custom, setCustom] = useState(false);
  const options = getFinishedProductOrganolepticOptions(config);
  const customValue = custom || (value !== "" && !options.includes(value));
  if (disabled) return <div className="px-1.5 py-1 text-[12.5px] leading-snug">{finishedGrade(value, config, t)}</div>;
  return <div>
    <select
      className="w-full min-w-0 rounded-md border-0 bg-transparent px-1 py-1 text-[12.5px]"
      value={customValue ? "__custom__" : value}
      aria-label={t("fields.organoleptic")}
      onChange={event => {
        const next = event.target.value;
        setCustom(next === "__custom__");
        if (next !== "__custom__") { onChange(next); }
      }}
      onBlur={onBlur}
    >
      <option value="">{t("fields.chooseGrade")}</option>
      {options.map(option => <option key={option} value={option}>{finishedGrade(option, config, t)}</option>)}
      <option value="__custom__">{t("fields.customGrade")}</option>
    </select>
    {customValue ? <JournalCellInput value={value} onChange={event => onChange(event.target.value)} onBlur={onBlur} aria-label={t("fields.customGradeLabel")} /> : null}
  </div>;
}
