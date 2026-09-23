import type { ReactNode } from "react";

/**
 * Оформление публичного портала проверяющего — «официальный бумажный»:
 * серый стол, белые листы с тонкой рамкой и мягкой тенью, строгий
 * антиквенный шрифт заголовков, синие «чернила» для отметок. Не SaaS-
 * дашборд: никаких градиентов, иконок-плиток и пилюль.
 */
export const INK = "#141821";
export const INK_MUTED = "#5b6170";
export const INK_FAINT = "#8a8f9c";
export const RULE = "#d5d8de";
export const STAMP_BLUE = "#1f3a8a";
export const DESK = "#e7e9ee";

export const SERIF = "font-['PT_Serif','PT_Serif_Caption',Georgia,'Times_New_Roman',serif]";

export function Desk({ children }: { children: ReactNode }) {
  return (
    <main
      className="min-h-screen overflow-x-hidden bg-[#e7e9ee] px-3 py-5 text-[#141821] sm:px-6 sm:py-10 print:bg-white print:p-0"
      style={{
        backgroundImage:
          "radial-gradient(rgba(20,24,33,0.035) 1px, transparent 1px)",
        backgroundSize: "18px 18px",
      }}
    >
      {children}
    </main>
  );
}

export function Sheet({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`relative mx-auto w-full max-w-[880px] border border-[#d5d8de] bg-white shadow-[0_1px_0_rgba(20,24,33,0.04),0_18px_40px_-26px_rgba(20,24,33,0.45)] ${className}`}
    >
      {children}
    </section>
  );
}

export function StatusSheet({ title, message }: { title: string; message: string }) {
  return (
    <Desk>
      <Sheet className="mt-[12vh] max-w-[560px] px-6 py-10 text-center sm:px-10">
        <div className="mx-auto mb-5 h-px w-16 bg-[#141821]" />
        <h1 className={`${SERIF} text-[26px] leading-tight`}>{title}</h1>
        <p className="mx-auto mt-3 max-w-[400px] text-[15px] leading-relaxed text-[#5b6170]">{message}</p>
        <div className="mx-auto mt-6 h-px w-16 bg-[#141821]" />
      </Sheet>
    </Desk>
  );
}
