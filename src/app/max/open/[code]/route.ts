import { db } from "@/lib/db";
import { maxSession } from "@/lib/max/http";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { userHasPermission } from "@/lib/permissions-server";
import { maxJournalList } from "@/lib/max/service";
import { relativeRedirect } from "@/lib/relative-redirect";
import { hasCapability } from "@/lib/permission-presets";
import { canWriteJournal } from "@/lib/journal-acl";
import { mintQrFillToken } from "@/lib/qr-fill-token";
import { NextResponse } from "next/server";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{code:string}>}) {
  const session=await maxSession().catch(()=>null);
  if(!session) return relativeRedirect("/login?next=%2Fmax%2Fjournals");
  const identity=await db.maxIdentity.findUnique({where:{userId:session.user.id}});
  if(!identity) return relativeRedirect("/max/connect");
  const result=await maxJournalList(identity.id,getActiveOrgId(session)).catch(()=>null);
  const {code}=await params;
  if(!result || !result.journals.some(j=>j.code===code)) return new NextResponse("Нет доступа к журналу",{status:403});
  if(hasCapability(session.user,"journals.view")) return relativeRedirect("/journals/"+encodeURIComponent(code));
  const allowed=await canWriteJournal({id:result.ctx.user.id,role:result.ctx.actor.role,isRoot:result.ctx.user.isRoot},code);
  if(!allowed || !await userHasPermission(session.user.id,"journals.fill")) return new NextResponse("Заполнение этого журнала вам не разрешено. Обратитесь к руководителю.",{status:403});
  const organizationId=result.ctx.organizationId;
  const token=mintQrFillToken("journal",`${organizationId}:${code}`);
  return relativeRedirect(`/journal-fill/${organizationId}/${encodeURIComponent(code)}?token=${encodeURIComponent(token)}&employee=${encodeURIComponent(session.user.id)}`);
}
