import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Строка базы знаний → React: `**жирный**`, `[текст](ссылка)` и голые
 * адреса статей `/baza-znaniy/<адрес>` (их пишет ассистент в ответах).
 */
const TOKEN = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(\/baza-znaniy\/[a-z0-9-]+)/g;

export function kbInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    if (match[1] !== undefined) {
      out.push(<strong key={key++} className="font-semibold text-[#0b1024]">{match[1]}</strong>);
    } else {
      const label = match[2] ?? match[4];
      const href = match[3] ?? match[4];
      out.push(kbLink(href, label, key++));
    }
    last = index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LINK_CLASS = "font-medium text-[#3848c7] underline decoration-[#3848c7]/30 underline-offset-[3px] transition-colors hover:decoration-[#3848c7]";

function kbLink(href: string, label: string, key: number): ReactNode {
  if (/^(https?:|mailto:|tel:)/.test(href)) {
    const external = href.startsWith("http");
    return (
      <a key={key} href={href} className={LINK_CLASS} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {label}
      </a>
    );
  }
  if (!href.startsWith("/")) return label;
  return (
    <Link key={key} href={href} className={LINK_CLASS}>
      {label}
    </Link>
  );
}
