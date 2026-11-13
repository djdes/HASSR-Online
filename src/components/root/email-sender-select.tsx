"use client";

import { useId } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EmailSenderOption } from "@/lib/email-sender-access";

export function EmailSenderSelect({ options, value, onChange, disabled, label, unavailable }: {
  options: EmailSenderOption[]; value: string; onChange: (value: string) => void;
  disabled?: boolean; label: string; unavailable: string;
}) {
  const id = useId();
  return <div className="min-w-0 space-y-1.5" data-email-sender-select>
    <label htmlFor={id} className="block text-[13px] font-medium text-[#3c4053]">{label}</label>
    <Select value={value} onValueChange={onChange} disabled={disabled || options.length === 0}>
      <SelectTrigger id={id} className="min-h-11 w-full bg-white"><SelectValue /></SelectTrigger>
      <SelectContent position="popper" align="start" sideOffset={6}>
        {options.map(option => <SelectItem key={option.userId} value={option.userId}>
          {option.fromEmail}{option.ready ? "" : ` · ${unavailable}`}
        </SelectItem>)}
      </SelectContent>
    </Select>
  </div>;
}
