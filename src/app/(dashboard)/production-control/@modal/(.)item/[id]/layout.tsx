import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ppkStructureItem } from "@/lib/ppk/structure";
import { ppkItemChrome } from "@/components/production-control/structure/item-chrome";
import { PpkItemDialog } from "@/components/production-control/structure/item-dialog";

/**
 * Окно пункта поверх обзора. Шапка (номер, название, откуда данные) не ждёт
 * базу — окно открывается сразу, а содержимое пункта (`page.tsx`) подгружается
 * внутри него со скелетом (`loading.tsx`).
 */
export default async function ItemModalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = ppkStructureItem(id);
  if (!item) return null;
  const chrome = await ppkItemChrome(item);
  return (
    <PpkItemDialog
      key={item.id}
      number={chrome.number}
      title={chrome.title}
      description={chrome.source}
      aside={
        chrome.sectionHref ? (
          <Link
            href={chrome.sectionHref}
            className="inline-flex items-center gap-1 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            {chrome.sectionLabel}
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        ) : null
      }
    >
      {children}
    </PpkItemDialog>
  );
}
