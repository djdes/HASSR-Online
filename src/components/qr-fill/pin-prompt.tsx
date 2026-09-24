"use client";

/**
 * Запрос PIN перед записью — крупно, как код на телефоне: цифры большие,
 * клавиатура цифровая. Показывается над кнопкой сохранения, когда у
 * выбранного сотрудника задан PIN (или в организации режим «имя + PIN»).
 */
export function PinPrompt({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string | null }) {
  return (
    <div className="rounded-2xl border border-[#d6dcff] bg-[#eef1ff] p-4">
      <p className="mb-3 text-center text-[19px] font-semibold text-[#0b1024]">Введите ваш PIN</p>
      {error ? <p className="mb-3 rounded-xl border border-[#ffd2cd] bg-[#fff4f2] px-3 py-2 text-center text-[15px] text-[#a13a32]">{error}</p> : null}
      <input
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete="one-time-code"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
        placeholder="••••"
        aria-label="PIN для быстрой QR-авторизации"
        className="h-[72px] w-full rounded-2xl border border-[#dcdfed] bg-white pl-[0.5em] text-center text-[36px] font-semibold tracking-[0.5em] text-[#0b1024] placeholder:tracking-[0.3em] placeholder:text-[#c8cbe0] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
      />
      <p className="mt-2 text-center text-[14px] text-[#6f7282]">PIN для подтверждения личности</p>
    </div>
  );
}
