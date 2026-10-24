import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { forgetSessionVersions } from "@/lib/session-version";
import { createRateLimiter } from "@/lib/rate-limit";
import { maxConfig } from "@/lib/max/config";
import { maxFailure,maxJson,maxSession } from "@/lib/max/http";
import { canManageMaxOrganization,createMaxLink,confirmMaxLink,MaxError } from "@/lib/max/service";

export const dynamic="force-dynamic";
export const runtime="nodejs";
const limiter=createRateLimiter({tokensPerInterval:10,intervalMs:60_000});
const input=z.discriminatedUnion("action",[
  z.object({action:z.literal("create"),scope:z.enum(["personal","organization"]).default("personal")}),
  z.object({action:z.literal("confirm"),requestId:z.string().min(1).max(100)}),
]);
export async function GET(request:Request) {
  try {
    const session=await maxSession(); const organizationId=getActiveOrgId(session);
    const cfg=maxConfig();
    const identity=await db.maxIdentity.findUnique({where:{userId:session.user.id},select:{displayName:true,createdAt:true}});
    const canManageOrganization=await canManageMaxOrganization(session.user.id,organizationId);
    const integration=canManageOrganization?await db.maxOrganizationIntegration.findUnique({where:{organizationId},select:{enabled:true,chatTitle:true,linkedAt:true}}):null;
    const requestId=new URL(request.url).searchParams.get("requestId");
    const pending=await db.maxLinkRequest.findFirst({where:{...(requestId?{id:requestId}:{usedAt:null,expiresAt:{gt:new Date()}}),userId:session.user.id,OR:[{organizationId:null},{organizationId}]},orderBy:{createdAt:"desc"},select:{id:true,organizationId:true,expiresAt:true,usedAt:true,claimedDisplayName:true,claimedMaxUserId:true}});
    return NextResponse.json({configured:cfg.configured,botUrl:cfg.configured?`https://max.ru/${cfg.username}`:null,identity,canManageOrganization,integration:integration??{enabled:true,chatTitle:null,linkedAt:null},pending:pending?{requestId:pending.id,scope:pending.organizationId?"organization":"personal",name:pending.claimedDisplayName,status:pending.usedAt?"used":pending.expiresAt<=new Date()?"expired":pending.claimedMaxUserId?"confirm":"waiting",expiresAt:pending.expiresAt}:null},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return maxFailure(error);}
}
export async function POST(request:Request) {
  try {
    const session=await maxSession();
    if(!limiter.consume(session.user.id)) throw new MaxError("Слишком много запросов. Подождите минуту.",429);
    const parsed=input.safeParse(await maxJson(request));
    if(!parsed.success) throw new MaxError("Проверьте параметры привязки.");
    if(parsed.data.action==="confirm") return NextResponse.json(await confirmMaxLink(session.user.id,parsed.data.requestId,getActiveOrgId(session)));
    const cfg=maxConfig();
    if(!cfg.configured) throw new MaxError("Подключение MAX ещё настраивается. Попробуйте позже.",503);
    const result=await createMaxLink(session.user.id,parsed.data.scope==="organization"?getActiveOrgId(session):null);
    return NextResponse.json({requestId:result.requestId,expiresAt:result.expiresAt,...(parsed.data.scope==="organization"?{command:"/connect "+result.token}:{url:`https://max.ru/${cfg.username}?start=link_${result.token}`})},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return maxFailure(error);}
}
export async function DELETE(request:Request) {
  try {
    await maxJson(request); const session=await maxSession();
    await db.$transaction([
      db.maxIdentity.deleteMany({where:{userId:session.user.id}}),
      db.maxLinkRequest.updateMany({where:{userId:session.user.id,usedAt:null},data:{usedAt:new Date()}}),
      db.user.update({where:{id:session.user.id},data:{sessionVersion:{increment:1}}}),
    ]);
    forgetSessionVersions([session.user.id]);
    return NextResponse.json({ok:true,signInRequired:true});
  }catch(error){return maxFailure(error);}
}
