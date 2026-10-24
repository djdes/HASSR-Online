import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { safeMaxReturnPath } from "@/lib/max/security";
import { MaxConnectClient } from "@/components/max/max-connect-client";

export const dynamic="force-dynamic";
export const metadata={title:"Подключить MAX — WeSetup",robots:{index:false,follow:false}};
export default async function MaxConnectPage({searchParams}:{searchParams:Promise<{next?:string}>}) {
  const next=safeMaxReturnPath((await searchParams).next);
  const session=await getServerSession(authOptions);
  if(!session) redirect("/login?next="+encodeURIComponent("/max/connect?next="+encodeURIComponent(next)));
  return <main className="min-h-screen bg-[#fafbff] px-4 py-6 text-[#0b1024] sm:py-10"><div className="mx-auto max-w-5xl"><a href={next} className="text-[20px] font-semibold tracking-[-0.03em]">We<span className="text-[#5566f6]">Setup</span></a><div className="mb-7 mt-8"><h1 className="text-[30px] font-semibold tracking-[-0.02em]">Подключение MAX</h1><p className="mt-2 text-[14px] text-[#6f7282]">Личный мессенджер для вашей работы</p></div><MaxConnectClient name={session.user.name??"ваш аккаунт"} organizationName={session.user.organizationName} next={next}/></div></main>;
}
