"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("staffManagement.qrPin");
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
      toast.success(next === null ? t("removed") : t("saved"));
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    setBusy("generate");
    try {
      const response = await fetch(`/api/staff/${props.employeeId}/qr-pin`, { method: "POST" });
      const data = (await response.json().catch(() => null)) as { pin?: string; error?: string } | null;
      if (!response.ok || !data?.pin) throw new Error(t("generateFailed"));
      setHasPin(true);
      setShown(data.pin);
      toast.success(t("generated"));
    } catch {
      toast.error(t("generateFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function reveal() {
    setBusy("reveal");
    try {
      const response = await fetch(`/api/staff/${props.employeeId}/qr-pin`);
      const data = (await response.json().catch(() => null)) as { pin?: string | null; error?: string } | null;
      if (!response.ok) throw new Error(t("revealFailed"));
      if (!data?.pin) {
        toast.info(t("legacyNotRevealable"));
        return;
      }
      setShown(data.pin);
    } catch {
      toast.error(t("revealFailed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">
        <KeyRound className="size-3.5" />
        {t("heading")}
        {hasPin ? (
          <span className="ml-1 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[10px] normal-case tracking-normal text-[#116b2a]">{t("set")}</span>
        ) : (
          <span className="ml-1 rounded-full bg-[#fff8eb] px-2 py-0.5 text-[10px] normal-case tracking-normal text-[#b25f00]">{t("notSet")}</span>
        )}
      </div>
      {shown ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#d6dcff] bg-[#eef1ff] px-4 py-3">
          <span className="text-[12px] text-[#3848c7]">{t("employeePin")}</span>
          <span className="font-mono text-[28px] font-semibold tracking-[0.4em] text-[#0b1024]" data-testid="qr-pin-shown">
            {shown}
          </span>
          <button type="button" onClick={() => setShown(null)} className="text-[12px] font-medium text-[#3848c7] underline">
            {t("hide")}
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {hasPin ? (
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void reveal()} className="h-11 rounded-xl border-[#dcdfed] text-[#3848c7] hover:bg-[#f5f6ff]">
            <Eye className="size-4" /> {t("show")}
          </Button>
        ) : null}
        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void generate()} className="h-11 rounded-xl border-[#dcdfed] text-[#3848c7] hover:bg-[#f5f6ff]">
          <RefreshCw className={`size-4 ${busy === "generate" ? "animate-spin" : ""}`} /> {hasPin ? t("generateNew") : t("generate")}
        </Button>
        {hasPin ? (
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void submit(null)} className="h-11 rounded-xl border-[#dcdfed] text-[#6f7282] hover:bg-[#fafbff]">
            {t("remove")}
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
          placeholder={hasPin ? t("newPinPlaceholder") : t("pinPlaceholder")}
          aria-label={t("heading")}
          className="h-11 rounded-xl border-[#dcdfed] bg-white text-[16px] tracking-[0.3em] placeholder:tracking-normal"
        />
        <Button type="button" variant="outline" disabled={busy !== null || pin.length < 4} onClick={() => void submit(pin)} className="h-11 rounded-xl border-[#dcdfed] text-[#3848c7] hover:bg-[#f5f6ff]">
          {hasPin ? t("change") : t("setAction")}
        </Button>
      </div>
      {!props.compact ? (
        <p className="text-[11px] leading-snug text-[#6f7282]">
          {t("help")}
        </p>
      ) : null}
    </div>
  );
}
