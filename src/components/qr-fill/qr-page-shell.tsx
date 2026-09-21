import type { ReactNode } from "react";
import { QrCode } from "lucide-react";

/**
 * Каркас QR-страницы — такой же, как у HTML-формы журналов: узкая тёмная
 * шапка в две строки (организация, название журнала) и колонка контента
 * во всю ширину телефона.
 */
export function QrPageShell({ orgName, title, children }: { orgName: string; title: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#fafbff] text-[18px] leading-[1.5] text-[#0b1024]">
      <header
        className="text-white"
        style={{
          background:
            "radial-gradient(circle at 8% 0%, rgba(85,102,246,.55), transparent 55%), radial-gradient(circle at 100% 100%, rgba(122,92,255,.4), transparent 55%), #0b1024",
        }}
      >
        <div className="mx-auto flex max-w-[36rem] items-center gap-2.5 px-4 py-3.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,.2)]">
            <QrCode className="size-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11.5px] font-semibold uppercase tracking-[0.12em] text-white/65" title={orgName}>
              {orgName}
            </div>
            <h1 className="mt-px line-clamp-2 text-[19px] font-semibold leading-[1.25] tracking-[-0.01em]">{title}</h1>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[36rem] px-4 pb-6 pt-3.5">{children}</div>
    </main>
  );
}
