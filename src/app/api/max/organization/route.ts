import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { maxFailure,maxJson,maxSession } from "@/lib/max/http";
import { MaxError,requireMaxOrganizationManager } from "@/lib/max/service";

export const runtime="nodejs";
const schema=z.object({enabled:z.boolean().optional(),disconnectChat:z.boolean().optional()}).refine(v=>v.enabled!==undefined || v.disconnectChat===true);
export async function PATCH(request:Request) {
  try {
    const session=await maxSession(); const organizationId=getActiveOrgId(session);
    await requireMaxOrganizationManager(session.user.id,organizationId);
    const parsed=schema.safeParse(await maxJson(request));
    if(!parsed.success) throw new MaxError("Проверьте настройки MAX.");
    const data={...(parsed.data.enabled===undefined?{}:{enabled:parsed.data.enabled}),...(parsed.data.disconnectChat?{chatId:null,chatTitle:null,linkedAt:null,linkedByUserId:null}:{})};
    await db.$transaction(async tx=>{
      await tx.maxOrganizationIntegration.upsert({where:{organizationId},create:{organizationId,...data},update:data});
      if(parsed.data.disconnectChat) await tx.maxLinkRequest.updateMany({where:{organizationId,usedAt:null},data:{usedAt:new Date()}});
      if(parsed.data.enabled===false) await tx.maxSessionHandoff.updateMany({where:{organizationId,usedAt:null},data:{usedAt:new Date()}});
      await tx.auditLog.create({data:{organizationId,userId:session.user.id,userName:session.user.name??"",action:"max.settings",entity:"MaxOrganizationIntegration",entityId:organizationId,details:{enabled:parsed.data.enabled,disconnected:parsed.data.disconnectChat===true}}});
    });
    return NextResponse.json({ok:true});
  }catch(error){return maxFailure(error);}
}
