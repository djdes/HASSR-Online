import type { ReactNode } from "react";

/**
 * Оболочка калькулятора, встроенного на чужой сайт (/embed/*, спека
 * seo-speed-pack-2026-11, п. 18): без шапки и подвала сайта, внизу — ссылка
 * на полную версию у WeSetup (обратная ссылка для сайта-хозяина).
 */
export function EmbedShell({ children, title, href, linkLabel }: { children: ReactNode; title: string; href: string; linkLabel: string }) {
  return (
    <div className="min-h-screen bg-white px-3 py-4 text-[#0b1024] sm:px-5">
      <div className="text-[18px] font-semibold tracking-[-0.01em]">{title}</div>
      {children}
      <p className="mt-6 border-t border-[#ececf4] pt-3 text-[12px] text-[#6f7282]">
        <a href={href} target="_blank" rel="noopener" className="font-medium text-[#3848c7] hover:underline">
          {linkLabel}
        </a>
      </p>
    </div>
  );
}
