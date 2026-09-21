"use client";

import { useState } from "react";
import { Eye, KeyRound, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * PIN сотрудника для быстрой QR-авторизации — один и тот же код на
 * QR-формах журналов, страницах холодильников/помещений и на общем
 * планшете. Хранится отдельно от карточки: ставится, генерируется,
 * показывается руководителю по запросу и снимается.
 *
 * Показ: `GET /api/staff/<id>/qr-pin` (руководитель), генерация:
 * `POST /api/staff/<id>/qr-pin`, свой код: `PATCH /api/staff/<id>` `{ qrPin }`.
 */
export function StaffQrPinField(props: {
  employeeId: string;
  hasPin: boolean;
  onSave: (pin: string | null) => Promise<void>;
  compact?: boolean;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [hasPin, setHasPin] = useState(props.hasPin);
  const [shown, setShown] = useState<string | null>(null);

  async function submit(next: string | null) {
    setBusy("save");
    try {
      await props.onSave(next);
      setHasPin(next !== null);
      setShown(next);
      setPin("");
      toast.success(next === null ? "PIN снят" : "PIN сохранён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить PIN");
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    setBusy("generate");
    try {
      const response = await fetch(`/api/staff/${props.employeeId}/qr-pin`, { method: "POST" });
      const data = (await response.json().catch(() => null)) as { pin?: string; error?: string } | null;
      if (!response.ok || !data?.pin) throw new Error(data?.error ?? "Не удалось сгенерировать PIN");
      setHasPin(true);
      setShown(data.pin);
      toast.success("Новый PIN сгенерирован");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сгенерировать PIN");
    } finally {
      setBusy(null);
    }
  }

  async function reveal() {
    setBusy("reveal");
    try {
      const response = await fetch(`/api/staff/${props.employeeId}/qr-pin`);
      const data = (await response.json().catch(() => null)) as { pin?: string | null; error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Не удалось показать PIN");
      if (!data?.pin) {
        toast.info("Этот PIN задан раньше и не сохранён для показа — сгенерируйте или задайте новый.");
        return;
      }
      setShown(data.pin);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось показать PIN");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">
        <KeyRound className="size-3.5" />
        PIN для быстрой QR-авторизации
        {hasPin ? (
          <span className="ml-1 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[10px] normal-case tracking-normal text-[#116b2a]">задан</span>
        ) : (
          <span className="ml-1 rounded-full bg-[#fff8eb] px-2 py-0.5 text-[10px] normal-case tracking-normal text-[#b25f00]">не задан</span>
        )}
      </div>
      {shown ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#d6dcff] bg-[#eef1ff] px-4 py-3">
          <span className="text-[12px] text-[#3848c7]">PIN сотрудника</span>
          <span className="font-mono text-[28px] font-semibold tracking-[0.4em] text-[#0b1024]" data-testid="qr-pin-shown">
            {shown}
          </span>
          <button type="button" onClick={() => setShown(null)} className="text-[12px] font-medium text-[#3848c7] underline">
            Скрыть
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {hasPin ? (
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void reveal()} className="h-11 rounded-xl border-[#dcdfed] text-[#3848c7] hover:bg-[#f5f6ff]">
            <Eye className="size-4" /> Показать
          </Button>
        ) : null}
        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void generate()} className="h-11 rounded-xl border-[#dcdfed] text-[#3848c7] hover:bg-[#f5f6ff]">
          <RefreshCw className={`size-4 ${busy === "generate" ? "animate-spin" : ""}`} /> {hasPin ? "Сгенерировать новый" : "Сгенерировать"}
        </Button>
        {hasPin ? (
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void submit(null)} className="h-11 rounded-xl border-[#dcdfed] text-[#6f7282] hover:bg-[#fafbff]">
            Снять
          </Button>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Input
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder={hasPin ? "Свой новый PIN" : "Свой PIN, 4–6 цифр"}
          aria-label="PIN для быстрой QR-авторизации"
          className="h-11 rounded-xl border-[#dcdfed] bg-white text-[16px] tracking-[0.3em] placeholder:tracking-normal"
        />
        <Button type="button" variant="outline" disabled={busy !== null || pin.length < 4} onClick={() => void submit(pin)} className="h-11 rounded-xl border-[#dcdfed] text-[#3848c7] hover:bg-[#f5f6ff]">
          {hasPin ? "Сменить" : "Задать"}
        </Button>
      </div>
      {!props.compact ? (
        <p className="text-[11px] leading-snug text-[#6f7282]">
          Один код везде: QR-формы журналов, холодильники и помещения, общий планшет. Если PIN задан, сотрудник вводит его при каждой записи.
        </p>
      ) : null}
    </div>
  );
}
