import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen,ChevronRight,Settings,ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { maxSession } from "@/lib/max/http";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { maxJournalList } from "@/lib/max/service";
import { MaxIcon } from "@/components/max/max-icon";
import { MaxConnectButton } from "@/components/max/max-connect-button";

export const dynamic="force-dynamic";
export const metadata={title:"Мои журналы в MAX — WeSetup",robots:{index:false,follow:false}};
export default async function MaxJournalsPage() {
  const session=await maxSession().catch(()=>null);
  if(!session) redirect("/login?next=%2Fmax%2Fjournals");
  const identity=await db.maxIdentity.findUnique({where:{userId:session.user.id}});
  if(!identity) redirect("/max/connect");
  const result=await maxJournalList(identity.id,getActiveOrgId(session)).catch(()=>null);
  if(!result) return <main className="mx-auto max-w-lg space-y-4 px-5 py-12"><h1 className="text-[24px] font-semibold">Доступ через MAX приостановлен</h1><p>Обратитесь к руководителю организации или откройте WeSetup обычным способом.</p><Link className="text-[#3848c7] underline" href="/journals">Открыть WeSetup</Link></main>;
  const {ctx,journals}=result;
  return <main className="min-h-screen bg-[#fafbff] px-4 py-6 text-[#0b1024]"><div className="mx-auto max-w-2xl"><header className="flex items-center gap-3"><MaxIcon className="size-10"/><div className="min-w-0 flex-1"><p className="text-[13px] text-[#6f7282]">WeSetup в MAX</p><p className="truncate text-[16px] font-semibold">{ctx.organization.name}</p></div><MaxConnectButton/></header><h1 className="mt-8 text-[28px] font-semibold tracking-[-0.02em]">Мои журналы</h1><p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">{ctx.user.name}, здесь журналы, доступные вам в этой организации. Организацию можно сменить в меню бота.</p><div className="mt-6 overflow-hidden rounded-3xl border border-[#ececf4] bg-white">{journals.length?journals.map(j=><Link key={j.code} href={`/max/open/${j.code}`} className="flex min-h-20 items-center gap-4 border-b border-[#ececf4] px-5 py-4 transition-colors last:border-b-0 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#5566f6]/20"><BookOpen className="size-5 shrink-0 text-[#5566f6]"/><span className="min-w-0 flex-1 text-[15px] font-medium leading-snug">{j.name}</span><ChevronRight className="size-4 shrink-0 text-[#6f7282]"/></Link>):<div className="p-7"><h2 className="font-semibold">Журналы пока не назначены</h2><p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">Попросите руководителя проверить доступ к журналам в вашей карточке сотрудника.</p></div>}</div><nav className="mt-6 flex flex-wrap gap-3">{ctx.policy.settings?<Link href="/settings/integrations/max" className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#3848c7]"><Settings className="size-4"/>Настройки организации</Link>:null}{ctx.policy.root?<Link href="/root" className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#3848c7]"><ShieldCheck className="size-4"/>Панель ROOT</Link>:null}<Link href="/max/connect" className="inline-flex min-h-11 items-center px-2 text-[14px] text-[#3848c7]">Моя привязка</Link></nav></div></main>;
}
