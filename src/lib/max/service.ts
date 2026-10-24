import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { listAccessibleOrganizations, assertOrgMembership } from "@/lib/organization-access";
import { userHasPermission } from "@/lib/permissions-server";
import { getAllowedJournalCodes } from "@/lib/journal-acl";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { canConfirmMaxRequest, maxMenuPolicy, visibleMaxJournals } from "./policy";
import { hashMaxToken, maxToken, MAX_HANDOFF_TTL_MS, MAX_LINK_TTL_MS, safeMaxReturnPath } from "./security";

export class MaxError extends Error {
  constructor(message:string,public status=400) {super(message);}
}
export async function maxAccount(userId:string) {
  const user=await db.user.findUnique({where:{id:userId}});
  if (!user || !user.isActive || user.archivedAt) throw new MaxError("Аккаунт недоступен. Обратитесь к руководителю.",403);
  return user;
}
export async function canManageMaxOrganization(userId:string,organizationId:string) {
  const user=await maxAccount(userId);
  if(user.isRoot) return true;
  if(!await assertOrgMembership(userId,organizationId)) return false;
  if(user.canManageSettings) return true;
  const membership=await db.organizationMember.findUnique({where:{userId_organizationId:{userId,organizationId}}});
  return (membership?.role==="owner" || membership?.role==="manager" || maxMenuPolicy(user).settings) && await userHasPermission(userId,"integrations.manage");
}
export async function requireMaxOrganizationManager(userId:string,organizationId:string) {
  if(!await canManageMaxOrganization(userId,organizationId)) throw new MaxError("Настройки MAX доступны руководителю организации.",403);
}

export async function createMaxLink(userId:string,organizationId:string|null=null) {
  await maxAccount(userId);
  if(organizationId) {
    await requireMaxOrganizationManager(userId,organizationId);
    if(!await db.maxIdentity.findUnique({where:{userId}})) throw new MaxError("Сначала привяжите личный аккаунт MAX.");
  }
  const token=maxToken(); const now=new Date();
  const request=await db.$transaction(async tx=>{
    await tx.maxLinkRequest.updateMany({where:{userId,organizationId,usedAt:null},data:{usedAt:now}});
    return tx.maxLinkRequest.create({data:{userId,organizationId,tokenHash:hashMaxToken(token),expiresAt:new Date(now.getTime()+MAX_LINK_TTL_MS)}});
  });
  return {requestId:request.id,token,expiresAt:request.expiresAt};
}

// A forwarded deep link can only nominate an identity; the signed-in site
// account must explicitly confirm it. CAS keeps the first nomination stable.
export async function claimMaxLink(token:string,claim:{maxUserId:string;chatId:string;displayName:string},organization=false) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new MaxError("Ссылка привязки недействительна. Получите новую на сайте.");
  const request=await db.maxLinkRequest.findUnique({where:{tokenHash:hashMaxToken(token)}});
  if(!request || request.usedAt || request.expiresAt<=new Date() || !!request.organizationId!==organization) throw new MaxError("Ссылка привязки истекла. Получите новую на сайте.");
  await maxAccount(request.userId);
  if(request.organizationId) {
    await requireMaxOrganizationManager(request.userId,request.organizationId);
    const identity=await db.maxIdentity.findUnique({where:{userId:request.userId}});
    if(identity?.maxUserId!==claim.maxUserId) throw new MaxError("Команду должен отправить руководитель, создавший код.",403);
  }
  const result=await db.maxLinkRequest.updateMany({where:{id:request.id,usedAt:null,expiresAt:{gt:new Date()},claimedMaxUserId:null},data:{claimedMaxUserId:claim.maxUserId,claimedChatId:claim.chatId,claimedDisplayName:claim.displayName.slice(0,180)}});
  if(!result.count && (request.claimedMaxUserId!==claim.maxUserId || request.claimedChatId!==claim.chatId)) throw new MaxError("Ссылка уже открыта другим аккаунтом. Создайте новую на сайте.",409);
  return request.id;
}

export async function confirmMaxLink(userId:string,requestId:string,activeOrgId:string) {
  await maxAccount(userId);
  const request=await db.maxLinkRequest.findUnique({where:{id:requestId}});
  if(!request || !canConfirmMaxRequest(request,userId) || !request.claimedChatId) throw new MaxError("Привязка не готова или ссылка истекла. Создайте новую ссылку.",409);
  if(request.organizationId) {
    if(request.organizationId!==activeOrgId) throw new MaxError("Вернитесь в организацию, для которой создавали код.",403);
    await requireMaxOrganizationManager(userId,activeOrgId);
  }
  try {
    return await db.$transaction(async tx=>{
      const consumed=await tx.maxLinkRequest.updateMany({where:{id:requestId,userId,usedAt:null,expiresAt:{gt:new Date()}},data:{usedAt:new Date()}});
      if(consumed.count!==1) throw new MaxError("Эта ссылка уже использована.",409);
      if(request.organizationId) {
        const identity=await tx.maxIdentity.findUnique({where:{userId}});
        if(identity?.maxUserId!==request.claimedMaxUserId) throw new MaxError("Личная привязка изменилась. Создайте новый код.",409);
        await tx.maxOrganizationIntegration.upsert({where:{organizationId:activeOrgId},create:{organizationId:activeOrgId,chatId:request.claimedChatId,chatTitle:request.claimedDisplayName,linkedByUserId:userId,linkedAt:new Date()},update:{chatId:request.claimedChatId,chatTitle:request.claimedDisplayName,linkedByUserId:userId,linkedAt:new Date()}});
      } else {
        const identity=await tx.maxIdentity.findUnique({where:{userId}});
        if(identity && identity.maxUserId!==request.claimedMaxUserId) throw new MaxError("Сначала отключите текущий аккаунт MAX.",409);
        await tx.maxIdentity.upsert({where:{userId},create:{userId,maxUserId:request.claimedMaxUserId!,privateChatId:request.claimedChatId!,displayName:request.claimedDisplayName ?? "MAX"},update:{privateChatId:request.claimedChatId!,displayName:request.claimedDisplayName ?? "MAX"}});
      }
      return {ok:true};
    });
  } catch(error) {
    if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==="P2002") throw new MaxError("Этот аккаунт MAX или чат уже связан с другим кабинетом. Сначала отключите прежнюю привязку.",409);
    throw error;
  }
}

export async function maxOrganizations(userId:string) {
  const user=await maxAccount(userId);
  if(user.isRoot) return db.organization.findMany({select:{id:true,name:true},orderBy:{name:"asc"},take:200});
  return listAccessibleOrganizations(userId);
}
export async function maxContext(identityId:string,organizationOverride?:string) {
  const identity=await db.maxIdentity.findUnique({where:{id:identityId}});
  if(!identity) throw new MaxError("Привязка MAX отключена. Подключите аккаунт на сайте.",401);
  const user=await maxAccount(identity.userId);
  let organizationId=organizationOverride ?? identity.activeOrganizationId ?? user.organizationId;
  if(!user.isRoot && !await assertOrgMembership(user.id,organizationId)) organizationId=user.organizationId;
  const organization=await db.organization.findUnique({where:{id:organizationId},select:{id:true,name:true,disabledJournalCodes:true,presetCapabilitiesJson:true}});
  if(!organization) throw new MaxError("Организация недоступна.",403);
  const settings=await db.maxOrganizationIntegration.findUnique({where:{organizationId}});
  if(settings?.enabled===false) throw new MaxError("Организация отключила доступ через MAX. Используйте сайт или обратитесь к руководителю.",403);
  const member=organizationId===user.organizationId?null:await db.organizationMember.findUnique({where:{userId_organizationId:{userId:user.id,organizationId}}});
  const orgPresetOverrides=organization.presetCapabilitiesJson && typeof organization.presetCapabilitiesJson==="object" && !Array.isArray(organization.presetCapabilitiesJson)?organization.presetCapabilitiesJson as Record<string,string[]>:null;
  const actor={...user,orgPresetOverrides,...(member?{role:member.role,permissionPreset:"admin"}:{})};
  return {identity,user,actor,organization,organizationId,policy:maxMenuPolicy(actor)};
}
export async function maxJournalList(identityId:string,organizationOverride?:string) {
  const ctx=await maxContext(identityId,organizationOverride);
  const [allowed,templates,canView]=await Promise.all([
    getAllowedJournalCodes({id:ctx.user.id,role:ctx.actor.role,isRoot:ctx.user.isRoot}),
    db.journalTemplate.findMany({where:{isActive:true},select:{code:true,name:true},orderBy:{sortOrder:"asc"}}),
    userHasPermission(ctx.user.id,"journals.view"),
  ]);
  return {ctx,journals:canView ? visibleMaxJournals(templates,allowed,parseDisabledCodes(ctx.organization.disabledJournalCodes)):[]};
}

export async function createMaxHandoff(identityId:string,returnPath:string) {
  const ctx=await maxContext(identityId); const token=maxToken();
  await db.maxSessionHandoff.create({data:{tokenHash:hashMaxToken(token),identityId,organizationId:ctx.organizationId,returnPath:safeMaxReturnPath(returnPath),expiresAt:new Date(Date.now()+MAX_HANDOFF_TTL_MS)}});
  return token;
}
export async function consumeMaxHandoff(token:string) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new MaxError("Ссылка входа недействительна. Откройте новую из бота.",401);
  const handoff=await db.maxSessionHandoff.findUnique({where:{tokenHash:hashMaxToken(token)}});
  if(!handoff || handoff.usedAt || handoff.expiresAt<=new Date()) throw new MaxError("Ссылка входа истекла или уже использована. Откройте новую из бота.",401);
  const ctx=await maxContext(handoff.identityId);
  if(ctx.organizationId!==handoff.organizationId) throw new MaxError("Вы сменили организацию. Откройте новую ссылку из бота.",409);
  const result=await db.maxSessionHandoff.updateMany({where:{id:handoff.id,usedAt:null,expiresAt:{gt:new Date()}},data:{usedAt:new Date()}});
  if(result.count!==1) throw new MaxError("Ссылка входа уже использована.",401);
  return {ctx,returnPath:safeMaxReturnPath(handoff.returnPath)};
}
