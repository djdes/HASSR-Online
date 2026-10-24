"use client";

import { useState, type ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { brakerageTimeDigits, parseBrakerageTimeDigits } from "@/lib/brakerage-assessment";

export function BrakerageTimeInput({ value, onChange, required = Boolean(value), ...props }: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState({ value, raw: brakerageTimeDigits(value) });
  if (draft.value !== value) setDraft({ value, raw: brakerageTimeDigits(value) });
  return <Input {...props} type="text" value={draft.raw} inputMode="numeric" maxLength={4} pattern="([01][0-9]|2[0-3])[0-5][0-9]" placeholder="1430" data-time-digits required={required}
    onChange={event => {
      const raw = event.target.value.replace(/\D/g, "").slice(0, 4);
      setDraft({ value, raw });
      const parsed = parseBrakerageTimeDigits(raw);
      if (parsed) onChange(parsed);
    }} />;
}

export function BrakerageDateInput({ value, onChange, required = true, ...props }: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & { value: string; onChange: (value: string) => void }) {
  const t = useTranslations("journals.ui.brakerageDate");
  const display = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split("-").reverse().join("-") : "";
  const [draft, setDraft] = useState({ value, raw: display(value) });
  if (draft.value !== value) setDraft({ value, raw: display(value) });
  return <Input {...props} type="text" value={draft.raw} inputMode="numeric" maxLength={10} pattern="[0-9]{2}-[0-9]{2}-[0-9]{4}" placeholder={t("placeholder")} data-brakerage-date required={required}
    onChange={event => {
      const digits = event.target.value.replace(/\D/g, "").slice(0, 8);
      const raw = digits.slice(0, 2) + (digits.length > 2 ? "-" + digits.slice(2, 4) : "") + (digits.length > 4 ? "-" + digits.slice(4) : "");
      setDraft({ value, raw });
      const iso = raw.split("-").reverse().join("-");
      const valid = /^\d{2}-\d{2}-\d{4}$/.test(raw) && !Number.isNaN(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso;
      event.target.setCustomValidity(valid || (!raw && !required) ? "" : t("invalid"));
      if (valid) onChange(iso);
    }} />;
}
