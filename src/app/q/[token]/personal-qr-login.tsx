"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { PinPrompt } from "@/components/qr-fill/pin-prompt";
import { WhoRow } from "@/components/qr-fill/who-row";

export function PersonalQrLogin({ token, name, hasPin }: { token: string; name: string; hasPin: boolean }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/q/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pin }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось войти");
      window.location.assign(typeof data?.redirect === "string" ? data.redirect : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти");
      setPin("");
      setBusy(false);
    }
  }

  if (!hasPin) {
    return (
      <>
        <WhoRow label="Вход" value={name} />
        <div className="rounded-2xl border border-[#ffe9b0] bg-[#fff8eb] p-4 text-[16px] leading-relaxed text-[#7a4a00]">
          Чтобы входить по этому QR, нужен личный PIN. Попросите руководителя выдать его в карточке сотрудника.
        </div>
      </>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <WhoRow label="Вход" value={name} />
      <PinPrompt value={pin} onChange={setPin} error={error} />
      <button
        type="submit"
        disabled={busy || pin.length < 4}
        data-testid="personal-qr-submit"
        className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[18px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0]"
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : null}
        Войти в кабинет
      </button>
      <p className="text-center text-[14px] text-[#6f7282]">Не вы? Закройте страницу — без вашего PIN вход невозможен.</p>
    </form>
  );
}
