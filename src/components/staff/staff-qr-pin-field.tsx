"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * PIN сотрудника для QR-форм (режим «имя + PIN» в «Настройки →
 * Соответствие»). Сохраняется отдельно от остальной карточки — PIN не
 * показываем и не храним в форме, только ставим или снимаем.
 *
 * `endpoint`: карточка сотрудника — `PATCH /api/staff/<id>` с `{ qrPin }`;
 * свой профиль в Mini App — `POST /api/mini/me/qr-pin` с `{ pin }`.
 */
export function StaffQrPinField(props: {
  hasPin: boolean;
  onSave: (pin: string | null) => Promise<void>;
  compact?: boolean;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasPin, setHasPin] = useState(props.hasPin);

  async function submit(next: string | null) {
    setBusy(true);
    try {
      await props.onSave(next);
      setHasPin(next !== null);
      setPin("");
      toast.success(next === null ? "PIN снят" : "PIN сохранён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить PIN");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">
        <KeyRound className="size-3.5" />
        PIN для QR-плакатов
        {hasPin ? <span className="ml-1 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[10px] normal-case tracking-normal text-[#116b2a]">задан</span> : null}
      </div>
      <div className="flex gap-2">
        <Input
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder={hasPin ? "Новый PIN" : "4–6 цифр"}
          aria-label="PIN для QR"
          className="h-11 rounded-xl border-[#dcdfed] bg-white text-[16px] tracking-[0.3em] placeholder:tracking-normal"
        />
        <Button type="button" variant="outline" disabled={busy || pin.length < 4} onClick={() => void submit(pin)} className="h-11 rounded-xl border-[#dcdfed] text-[#3848c7] hover:bg-[#f5f6ff]">
          {hasPin ? "Сменить" : "Задать"}
        </Button>
        {hasPin ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void submit(null)} className="h-11 rounded-xl border-[#dcdfed] text-[#6f7282] hover:bg-[#fafbff]">
            Снять
          </Button>
        ) : null}
      </div>
      {!props.compact ? (
        <p className="text-[11px] leading-snug text-[#6f7282]">
          Нужен, если в «Настройки → Соответствие» выбран режим «Имя + PIN»: сотрудник вводит его после выбора имени на QR-форме.
        </p>
      ) : null}
    </div>
  );
}
