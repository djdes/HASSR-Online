"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SuggestInput } from "@/components/journals/suggest-input";
import {
  JOURNAL_DIALOG_BODY_CLASS,
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_FOOTER_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
} from "@/components/journals/journal-responsive";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

/**
 * «Применить ко всем выделенным»: одно окно с полями и галочками «менять
 * это поле». Меняются только отмеченные поля у всех выделенных строк —
 * типичный кейс «поправить время снятия у восьми блюд» за одно окно.
 */
export type ApplyToSelectedField = {
  key: string;
  label: string;
  type: "text" | "time" | "date" | "select";
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** Для `text`: подсказки (недавние наименования, сотрудники). */
  suggestions?: readonly string[];
  placeholder?: string;
};

export function ApplyToSelectedDialog({
  open,
  onOpenChange,
  count,
  fields,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  fields: readonly ApplyToSelectedField[];
  onApply: (patch: Record<string, string>) => Promise<void> | void;
}) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Сброс при каждом открытии — прошлые галочки не должны «выстрелить» снова.
  useEffect(() => {
    if (open) {
      setEnabled({});
      setValues({});
      setBusy(false);
    }
  }, [open]);

  const activeKeys = fields.filter((field) => enabled[field.key]).map((field) => field.key);

  async function apply() {
    const patch: Record<string, string> = {};
    for (const key of activeKeys) patch[key] = values[key] ?? "";
    if (Object.keys(patch).length === 0) return;
    setBusy(true);
    try {
      await onApply(patch);
      onOpenChange(false);
    } catch (error) {
      toast.error(humanizeFetchError(error, "Не удалось применить изменения"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS} data-testid="apply-to-selected">
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>Применить ко всем выделенным · {count}</DialogTitle>
        </DialogHeader>
        <div className={`${JOURNAL_DIALOG_BODY_CLASS} space-y-3`}>
          <p className="text-[13px] leading-snug text-[#6f7282]">
            Отметьте поля, которые нужно заменить у всех выделенных строк. Остальные поля останутся как были.
          </p>
          {fields.map((field) => {
            const on = enabled[field.key] === true;
            const value = values[field.key] ?? "";
            const setValue = (next: string) => {
              setValues((prev) => ({ ...prev, [field.key]: next }));
              if (!on) setEnabled((prev) => ({ ...prev, [field.key]: true }));
            };
            const inputClass = "h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]";
            return (
              <label
                key={field.key}
                className={`flex items-start gap-3 rounded-2xl border px-3.5 py-3 transition-colors duration-150 ${
                  on ? "border-[#5566f6]/40 bg-[#f5f6ff]" : "border-[#ececf4] bg-white"
                }`}
              >
                <Checkbox
                  checked={on}
                  onCheckedChange={(next) => setEnabled((prev) => ({ ...prev, [field.key]: next === true }))}
                  aria-label={`Менять: ${field.label}`}
                  className="mt-2.5"
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="text-[13px] font-medium text-[#3c4053]">{field.label}</div>
                  {field.type === "select" ? (
                    <Select value={value} onValueChange={setValue}>
                      <SelectTrigger className={inputClass} aria-label={field.label}>
                        <SelectValue placeholder={field.placeholder ?? "Выберите"} />
                      </SelectTrigger>
                      <SelectContent>
                        {(field.options ?? []).map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : field.type === "text" && field.suggestions ? (
                    <SuggestInput ariaLabel={field.label} value={value} options={field.suggestions} placeholder={field.placeholder} onChange={setValue} />
                  ) : (
                    <Input
                      type={field.type === "text" ? "text" : field.type}
                      value={value}
                      placeholder={field.placeholder}
                      aria-label={field.label}
                      onChange={(e) => setValue(e.target.value)}
                      className={inputClass}
                    />
                  )}
                </div>
              </label>
            );
          })}
        </div>
        <div className={JOURNAL_DIALOG_FOOTER_CLASS}>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy} className="h-9 rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff]">
            Отмена
          </Button>
          <Button
            type="button"
            onClick={() => void apply()}
            disabled={busy || activeKeys.length === 0}
            title={activeKeys.length === 0 ? "Отметьте хотя бы одно поле" : undefined}
            className="h-9 rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]"
          >
            {busy ? "Применяем…" : `Применить к ${count}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
