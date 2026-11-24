import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { ppkPageScope } from "@/lib/ppk/access.server";
import { ppkStructureItem } from "@/lib/ppk/structure";
import { ppkItemChrome } from "@/components/production-control/structure/item-chrome";
import { PpkItemPanel } from "@/components/production-control/structure/item-panel";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const item = ppkStructureItem((await params).id);
  if (!item) return {};
  const chrome = await ppkItemChrome(item);
  return { title: `${chrome.number} ${chrome.title}` };
}

/**
 * Пункт структуры ППК отдельной страницей: прямая ссылка, новая вкладка,
 * обновление страницы с открытым окном. С обзора тот же адрес открывается
 * окном (`@modal/(.)item/[id]`).
 */
export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = ppkStructureItem(id);
  if (!item) notFound();
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const scope = await ppkPageScope(session);
  const [chrome, t] = await Promise.all([ppkItemChrome(item), getTranslations("productionControl.structure")]);

  return (
    <div className="space-y-5" data-ppk-item-page={item.id}>
      <Link
        href="/production-control"
        className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("backToProgram")}
      </Link>
      <header className="space-y-1.5">
        <h1 className="flex items-baseline gap-3 text-[24px] leading-tight font-semibold tracking-[-0.02em] text-[#0b1024] md:text-[26px]">
          <span className="shrink-0 tabular-nums text-[#5566f6]">{chrome.number}</span>
          <span className="min-w-0">{chrome.title}</span>
        </h1>
        <p className="max-w-[720px] text-[14px] text-[#6f7282]">{chrome.source}</p>
        {chrome.sectionHref ? (
          <Link
            href={chrome.sectionHref}
            className="inline-flex items-center gap-1 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6]"
          >
            {chrome.sectionLabel}
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        ) : null}
      </header>
      <PpkItemPanel item={item} scope={scope} session={session} />
    </div>
  );
}
