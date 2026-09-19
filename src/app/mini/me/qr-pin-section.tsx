"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";

import { StaffQrPinField } from "@/components/staff/staff-qr-pin-field";

/**
 * Свой PIN для QR-плакатов в профиле Mini App. Раздел виден только когда
 * организация включила режим «Имя + PIN» (иначе PIN не нужен и только
 * путает). Сам PIN не показываем — только «задан / не задан».
 */
export function MiniQrPinSection() {
  const [state, setState] = useState<{ mode: string; hasPin: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mini/me/qr-pin", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setState({ mode: String(data.mode ?? "public"), hasPin: Boolean(data.hasPin) });
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state || state.mode !== "pin") return null;

  return (
    <section className="mini-card p-4">
      <div className="mb-2 flex items-center gap-2 text-[14px] font-medium">
        <KeyRound className="size-4 text-[#5566f6]" />
        PIN для QR-плакатов
      </div>
      <p className="mb-3 text-[12px] leading-snug text-[#6f7282]">
        В вашей организации запись по QR подтверждается PIN-кодом: выберите себя на форме и введите его. Никому не сообщайте.
      </p>
      <StaffQrPinField
        compact
        hasPin={state.hasPin}
        onSave={async (pin) => {
          const response = await fetch("/api/mini/me/qr-pin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin }),
          });
          const data = await response.json().catch(() => null);
          if (!response.ok) throw new Error(data?.error ?? "Не удалось сохранить PIN");
        }}
      />
    </section>
  );
}
