import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { issueSession } from "@/lib/issue-session";
import { createRateLimiter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { MINI_SHELL_COOKIE, MINI_SHELL_VALUE } from "@/lib/mini-shell-cookie";
import { twoFactorRequired } from "@/lib/two-factor";
import { maxConfig } from "@/lib/max/config";
import { maxFailure,maxJson } from "@/lib/max/http";
import { consumeMaxHandoff,createMaxHandoff,MaxError,maxContext } from "@/lib/max/service";
import { maxBrowserHandoffUrl } from "@/lib/max/browser";
import { safeMaxReturnPath,verifyMaxInitData } from "@/lib/max/security";

export const runtime="nodejs";
const limiter=createRateLimiter({tokensPerInterval:20,intervalMs:60_000});
const schema=z.object({ticket:z.string().max(100).optional(),initData:z.string().max(16_384).optional(),next:z.string().max(2048).optional(),embedded:z.boolean().optional()});
export async function POST(request:Request) {
  try {
    if(!limiter.consume(clientIp(request)??"unknown")) throw new MaxError("Слишком много попыток. Подождите минуту.",429);
    const parsed=schema.safeParse(await maxJson(request));
    if(!parsed.success) throw new MaxError("Не удалось прочитать данные MAX.");
    let ctx:Awaited<ReturnType<typeof maxContext>>; let next:string;
    if(parsed.data.ticket) {
      const handoff=await consumeMaxHandoff(parsed.data.ticket);ctx=handoff.ctx;next=handoff.returnPath;
    } else {
      const verified=verifyMaxInitData(parsed.data.initData??"",maxConfig().token);
      if(!verified.ok) throw new MaxError("Данные входа устарели. Закройте окно и откройте WeSetup из MAX заново.",401);
      const identity=await db.maxIdentity.findUnique({where:{maxUserId:verified.userId}});
      if(!identity) throw new MaxError("Аккаунт MAX ещё не привязан. Войдите на сайт и подключите MAX в своём кабинете.",401);
      ctx=await maxContext(identity.id);next=safeMaxReturnPath(parsed.data.next??"/max/journals");
    }
    // A second factor explicitly enabled by the account owner remains mandatory.
    if(twoFactorRequired(ctx.user)) throw new MaxError("Для этого аккаунта включено подтверждение входа. Войдите через форму WeSetup с кодом из Telegram.",403);
    if(parsed.data.embedded) {
      const ticket=await createMaxHandoff(ctx.identity.id,next);
      return NextResponse.json({externalUrl:maxBrowserHandoffUrl(maxConfig().siteBase,ticket)},{headers:{"Cache-Control":"no-store"}});
    }
    const homeOrg=await db.organization.findUnique({where:{id:ctx.user.organizationId},select:{name:true}});
    const response=NextResponse.json({ok:true,next},{headers:{"Cache-Control":"no-store"}});
    await issueSession(response,{...ctx.user,role:ctx.actor.role,permissionPreset:ctx.actor.permissionPreset},homeOrg?.name??ctx.organization.name,ctx.user.isRoot?{actingAsOrganizationId:ctx.organizationId===ctx.user.organizationId?null:ctx.organizationId}:{activeOrganizationId:ctx.organizationId});
    response.cookies.set(MINI_SHELL_COOKIE,MINI_SHELL_VALUE,{path:"/",sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:86400*365});
    await db.auditLog.create({data:{organizationId:ctx.organizationId,userId:ctx.user.id,userName:ctx.user.name,action:"max.login",entity:"User",entityId:ctx.user.id}});
    return response;
  }catch(error){return maxFailure(error);}
}
