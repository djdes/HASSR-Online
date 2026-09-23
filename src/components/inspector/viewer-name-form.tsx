"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * «Кто смотрит (ФИО, должность)» — необязательная отметка о просмотре.
 * Имя уходит в журнал визитов организации; данные журналов не меняются.
 */
export function ViewerNameForm({ token, initialName }: { token: string; initialName: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(initialName ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(initialName ? "saved" : "idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (value.length < 2) {
      setState("error");
      setError("Укажите фамилию и должность");
      return;
    }
    setState("saving");
    setError(null);
    try {
      const res = await fetch(`/api/inspector/${encodeURIComponent(token)}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspectorName: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Не удалось сохранить");
      }
      setState("saved");
      router.refresh();
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" data-viewer-form>
      <label htmlFor="wsi-viewer" className="text-[13px] text-[#5b6170]">
        Кто смотрит (ФИО, должность) — необязательно
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="wsi-viewer"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (state === "saved") setState("idle");
          }}
          maxLength={160}
          autoComplete="name"
          placeholder="Иванова А. П., специалист-эксперт"
          className="h-11 min-w-0 flex-1 rounded-[4px] border border-[#c9cdd5] bg-white px-3 text-[15px] text-[#141821] placeholder:text-[#a3a8b3] transition-[border-color,box-shadow] duration-150 focus:border-[#1f3a8a] focus:outline-none focus:ring-2 focus:ring-[#1f3a8a]/15"
        />
        <button
          type="submit"
          disabled={state === "saving"}
          className="h-11 shrink-0 rounded-[4px] border border-[#141821] bg-[#141821] px-4 text-[14px] font-medium text-white transition-colors duration-150 hover:bg-[#2a3040] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f3a8a]/40"
        >
          {state === "saving" ? "Сохраняем…" : "Отметить просмотр"}
        </button>
      </div>
      <p className={`text-[12.5px] ${state === "error" ? "text-[#a13a32]" : "text-[#8a8f9c]"}`} aria-live="polite">
        {state === "saved"
          ? "Отмечено. Ваши просмотры попадут в журнал визитов организации под этим именем."
          : state === "error"
            ? error
            : "Имя попадёт в журнал визитов организации вместе со временем просмотра."}
      </p>
    </form>
  );
}
