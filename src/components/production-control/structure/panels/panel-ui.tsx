import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Общие куски панелей пунктов структуры ППК. Поверхности различаются заливкой
 * (правило «без рамок-коробок», 2026-11-22): мягкий блок — `--app-veil`.
 */

/** Подзаголовок части панели с действиями справа. */
export function PanelSection({
  title,
  hint,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15.5px] font-semibold tracking-[-0.01em] text-[#0b1024]">{title}</h3>
          {hint ? <p className="mt-0.5 max-w-[640px] text-[13px] text-[#6f7282]">{hint}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Тихая ссылка «Изменить в …» / «Открыть …» на источник данных. */
export function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-lg text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
    >
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden />
    </Link>
  );
}

/** Мягкая плашка-пояснение (без рамки). */
export function PanelNote({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div
      className={cn(
        "rounded-2xl px-4 py-3 text-[13.5px] leading-[1.5]",
        tone === "warn" ? "bg-[#fff7e6] text-[#8a5a00]" : "bg-[var(--app-veil)] text-[#3c4053]",
      )}
    >
      {children}
    </div>
  );
}

/** Пустой источник: что сделать и куда перейти. */
export function PanelEmpty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-[var(--app-veil)] px-5 py-8 text-center">
      <div className="text-[15px] font-medium text-[#0b1024]">{title}</div>
      {hint ? <p className="mx-auto mt-1 max-w-[420px] text-[13px] text-[#6f7282]">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Простая таблица панели: на телефоне прокручивается сама, страница — нет. */
export function PanelTable({ heads, rows, empty }: { heads: string[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[520px] border-collapse text-[13.5px]">
        <thead>
          <tr className="text-left text-[12.5px] text-[#6f7282]">
            {heads.map((head) => (
              <th key={head} className="border-b border-[#ececf4] px-2 py-2 font-medium">
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty ? (
            <tr>
              <td colSpan={heads.length} className="px-2 py-4 text-[#6f7282]">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((cells, index) => (
              <tr key={index} className="align-top">
                {cells.map((cell, cellIndex) => (
                  <td key={cellIndex} className="border-b border-[#ececf4] px-2 py-2 text-[#0b1024] [overflow-wrap:anywhere]">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
