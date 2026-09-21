"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { WhoRow } from "@/components/qr-fill/who-row";

export type PickerEmployee = { id: string; name: string; position?: string | null; hasPin?: boolean };

/**
 * Выбор сотрудника на QR-странице: строка «Кто снимает показания» и шторка
 * снизу со списком и поиском по ФИО — во всю ширину, крупно. Всё в той же
 * странице: введённые показания никуда не деваются.
 */
export function EmployeePicker({
  employees,
  value,
  onChange,
  fixedName = null,
  label = "Кто снимает показания",
  hint = null,
}: {
  employees: PickerEmployee[];
  value: string;
  onChange: (id: string) => void;
  /** Режим «вход по аккаунту»: имя фиксировано, менять нельзя. */
  fixedName?: string | null;
  label?: string;
  hint?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = employees.find((employee) => employee.id === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((employee) => employee.name.toLowerCase().includes(q) || (employee.position ?? "").toLowerCase().includes(q));
  }, [employees, query]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 60);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  if (fixedName) {
    return <WhoRow label={label} value={fixedName} />;
  }

  return (
    <>
      <WhoRow label={label} value={selected?.name ?? null} placeholder="Выберите своё имя" onAction={() => setOpen(true)}>
        {hint && selected ? <p className="mt-1.5 text-[14px] text-[#9b9fb3]">{hint}</p> : null}
      </WhoRow>
      {open ? (
        <div className="fixed inset-0 z-[120] flex items-end bg-[#0b1024]/45" role="dialog" aria-modal="true" aria-label={label} onClick={() => setOpen(false)}>
          <div
            className="flex max-h-[88dvh] w-full flex-col rounded-t-[22px] bg-[#fafbff] shadow-[0_-20px_60px_-30px_rgba(11,16,36,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
              <span className="text-[19px] font-semibold text-[#0b1024]">{label}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть" className="flex size-10 items-center justify-center rounded-full bg-white text-[#6f7282] shadow-[0_0_0_1px_#ececf4]">
                <X className="size-5" />
              </button>
            </div>
            <div className="px-4 pb-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#9b9fb3]" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Найти по фамилии"
                  aria-label="Поиск сотрудника"
                  autoComplete="off"
                  className="h-14 w-full rounded-[14px] border border-[#dcdfed] bg-white pl-12 pr-4 text-[18px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),16px)]">
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-[16px] text-[#9b9fb3]">Никого не нашли. Попробуйте по-другому написать фамилию.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {filtered.map((employee) => {
                    const active = employee.id === value;
                    return (
                      <li key={employee.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onChange(employee.id);
                            setOpen(false);
                            setQuery("");
                          }}
                          className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-[14px] border px-4 py-3 text-left transition-colors duration-150 ${
                            active ? "border-[#5566f6] bg-[#eef1ff]" : "border-[#dcdfed] bg-white active:bg-[#f5f6ff]"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block text-[18px] font-medium leading-[1.3] text-[#0b1024]">{employee.name}</span>
                            {employee.position ? <span className="mt-0.5 block text-[15px] text-[#6f7282]">{employee.position}</span> : null}
                          </span>
                          {active ? <Check className="size-6 shrink-0 text-[#3848c7]" /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
