import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Нумерованный блок страницы точки (скан 82, лист 5: ⇒ название и адрес,
 * ⇒ цеха и помещения, ⇒ оборудование, ⇒ УФ-лампы): номер, заголовок, одна
 * строка «зачем», справа действие, ниже содержимое. Без хуков — его рисуют и
 * серверные блоки, и клиентские.
 */
export function PointBlock({
  number,
  title,
  hint,
  action,
  children,
  testId,
  className,
}: {
  number: number;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <section
      data-point-block={testId}
      className={cn(
        "min-w-0 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[14px] font-semibold tabular-nums text-[#3848c7]">
            {number}
          </span>
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]">{title}</h2>
            {hint ? <p className="mt-1 text-[13.5px] leading-[1.5] text-[#6f7282]">{hint}</p> : null}
          </div>
        </div>
        {action ? <div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{action}</div> : null}
      </div>
      {children ? <div className="mt-4 min-w-0">{children}</div> : null}
    </section>
  );
}

/** Пустое состояние внутри блока: что сделать, чтобы здесь появилось содержимое. */
export function PointBlockEmpty({ title, body, children }: { title: ReactNode; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-5 py-6 text-center">
      <div className="text-[14.5px] font-medium text-[#0b1024]">{title}</div>
      {body ? <p className="mx-auto mt-1 max-w-[440px] text-[13px] leading-[1.5] text-[#6f7282]">{body}</p> : null}
      {children ? <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{children}</div> : null}
    </div>
  );
}
