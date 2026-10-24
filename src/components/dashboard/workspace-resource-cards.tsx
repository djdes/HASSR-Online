import Link from "next/link";
import { BookOpen, ClipboardCheck, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

export function WorkspaceResourceCards({ knowledge = true, checklists = true }: { knowledge?: boolean; checklists?: boolean }) {
  const t = useTranslations("dashboardUi.workspaceResourceCards");
  return <div className="grid gap-4 md:grid-cols-2">
    {knowledge ? <Link href="/knowledge" className="group flex items-center gap-4 rounded-3xl border border-[#ececf4] bg-white p-5 transition-colors hover:bg-[#f5f6ff]"><span className="rounded-2xl bg-[#eef1ff] p-3 text-[#5566f6]"><BookOpen className="size-6" /></span><div className="min-w-0 flex-1"><h2 className="text-[16px] font-semibold text-[#0b1024]">{t("knowledgeTitle")}</h2><p className="mt-1 text-[13px] text-[#6f7282]">{t("knowledgeHint")}</p></div><ArrowRight className="size-4 shrink-0 text-[#5566f6]" /></Link> : null}
    {checklists ? <Link href="/checklists" className="group flex items-center gap-4 rounded-3xl border border-[#ececf4] bg-white p-5 transition-colors hover:bg-[#f5f6ff]"><span className="rounded-2xl bg-[#eef1ff] p-3 text-[#5566f6]"><ClipboardCheck className="size-6" /></span><div className="min-w-0 flex-1"><h2 className="text-[16px] font-semibold text-[#0b1024]">{t("checklistsTitle")}</h2><p className="mt-1 text-[13px] text-[#6f7282]">{t("checklistsHint")}</p></div><ArrowRight className="size-4 shrink-0 text-[#5566f6]" /></Link> : null}
  </div>;
}
