import { db } from "@/lib/db";
import { forgetSessionVersions } from "@/lib/session-version";
import { maxApi, maxSend, type MaxButton } from "./client";
import { maxConfig } from "./config";
import { claimMaxLink, createMaxHandoff, MaxError, maxAccount, maxContext, maxJournalList, maxOrganizations } from "./service";
import { type MaxEvent, maxUpdateKey, parseMaxUpdate } from "./protocol";

const cb=(text:string,payload:string):MaxButton=>({type:"callback",text,payload});
async function loginButton(identityId:string,text:string,path:string):Promise<MaxButton> {
  const token=await createMaxHandoff(identityId,path);
  return {type:"link",text,url:maxConfig().siteBase+"/max#ticket="+token};
}
async function menu(event:MaxEvent,identityId:string) {
  const ctx=await maxContext(identityId);
  const buttons:MaxButton[][]=[
    [await loginButton(identityId,"Открыть WeSetup","/max/journals")],
    [cb("Мои журналы","journals:0"),cb("Организации","orgs:0")],
  ];
  if(ctx.policy.settings) buttons.push([await loginButton(identityId,"Настройки журналов","/settings/journals")]);
  if(ctx.policy.staff) buttons.push([await loginButton(identityId,"Сотрудники","/settings/users")]);
  if(ctx.policy.verify) buttons.push([await loginButton(identityId,"Проверка выполнения","/verifications")]);
  if(ctx.policy.root) buttons.push([await loginButton(identityId,"Администрирование платформы","/root")]);
  buttons.push([{type:"link",text:"Моя привязка MAX",url:maxConfig().siteBase+"/max/connect"}]);
  await maxSend(event.chatId,`${ctx.user.name}\n${ctx.organization.name}\n\nВаш кабинет рядом. Выберите журнал или откройте WeSetup — права и настройки уже учтены.\n\nСсылки входа действуют 2 минуты. Новые — по кнопке «Меню» или /menu.`,buttons);
}
async function journals(event:MaxEvent,identityId:string,page:number) {
  const {ctx,journals}=await maxJournalList(identityId);
  const start=Math.min(Math.max(0,page),Math.max(0,Math.ceil(journals.length/6)-1))*6;
  const buttons:MaxButton[][]=await Promise.all(journals.slice(start,start+6).map(async j=>[await loginButton(identityId,j.name.slice(0,80),`/max/open/${j.code}`)]));
  const nav:MaxButton[]=[];
  if(start>0) nav.push(cb("Назад",`journals:${start/6-1}`));
  if(start+6<journals.length) nav.push(cb("Далее",`journals:${start/6+1}`));
  if(nav.length) buttons.push(nav);
  buttons.push([cb("Меню","menu")]);
  await maxSend(event.chatId,`${ctx.organization.name}\n\n${journals.length?`Доступные журналы: ${journals.length}. Выберите нужный.`:"Доступных журналов пока нет. Руководитель может настроить доступ в карточке сотрудника."}`,buttons);
}
async function organizations(event:MaxEvent,identityId:string,page:number) {
  const identity=await db.maxIdentity.findUnique({where:{id:identityId}});
  if(!identity) throw new MaxError("Подключите свой MAX на сайте.",401);
  const user=await maxAccount(identity.userId);
  const orgs=await maxOrganizations(user.id);
  const activeId=identity.activeOrganizationId??user.organizationId;
  const start=Math.min(Math.max(0,page),Math.max(0,Math.ceil(orgs.length/6)-1))*6;
  const buttons:MaxButton[][]=orgs.slice(start,start+6).map(o=>[cb(`${o.id===activeId?"✓ ":""}${o.name}`.slice(0,80),"org:"+o.id)]);
  const nav:MaxButton[]=[];
  if(start>0) nav.push(cb("Назад",`orgs:${start/6-1}`));
  if(start+6<orgs.length) nav.push(cb("Далее",`orgs:${start/6+1}`));
  if(nav.length) buttons.push(nav);
  buttons.push([cb("Меню","menu")]);
  await maxSend(event.chatId,"Выберите организацию. Доступы проверяются при каждом открытии.",buttons);
}
async function handleEvent(event:MaxEvent) {
  // Group chats never receive personal menus or bearer login URLs.
  if(!event.private) {
    const match=/^\/connect\s+([A-Za-z0-9_-]{43})$/.exec(event.payload);
    if(!match || event.kind!=="message") return;
    const [admins,chat]=await Promise.all([
      maxApi<{members:Array<{user_id:number|string}>}>(`/chats/${encodeURIComponent(event.chatId)}/members/admins`),
      maxApi<{type:string;title?:string}>(`/chats/${encodeURIComponent(event.chatId)}`),
    ]);
    if(chat.type!=="chat" || !admins.members?.some(a=>String(a.user_id)===event.userId)) throw new MaxError("Подключить группу может её администратор.",403);
    await claimMaxLink(match[1],{maxUserId:event.userId,chatId:event.chatId,displayName:chat.title??"Группа MAX"},true);
    await maxSend(event.chatId,"Группа найдена. Руководителю осталось подтвердить её в настройках MAX на сайте WeSetup.");
    return;
  }
  const identity=await db.maxIdentity.findUnique({where:{maxUserId:event.userId}});
  if(event.kind==="stop") {
    if(identity) {
      await db.$transaction(async tx=>{
        const removed=await tx.maxIdentity.deleteMany({where:{id:identity.id}});
        if(removed.count) await tx.user.update({where:{id:identity.userId},data:{sessionVersion:{increment:1}}});
      });
      forgetSessionVersions([identity.userId]);
    }
    return;
  }
  if(event.kind==="start" && event.payload.startsWith("link_")) {
    await claimMaxLink(event.payload.slice(5),{maxUserId:event.userId,chatId:event.chatId,displayName:event.name});
    await maxSend(event.chatId,"Остался один шаг: вернитесь в WeSetup и подтвердите, что это ваш аккаунт MAX. После подтверждения нажмите «Готово».",[[cb("Готово — открыть меню","menu")]]);
    return;
  }
  if(!identity) {
    await maxSend(event.chatId,"Свяжите свой аккаунт WeSetup с MAX. Войдите на сайт, нажмите значок MAX и подтвердите привязку — после этого здесь появятся ваши журналы.",[[{type:"link",text:"Подключить аккаунт",url:maxConfig().siteBase+"/max/connect"}]]);
    return;
  }
  if(/^org:[A-Za-z0-9_-]{1,100}$/.test(event.payload)) {
    const requested=event.payload.slice(4);
    const orgs=await maxOrganizations(identity.userId);
    if(!orgs.some(o=>o.id===requested)) throw new MaxError("Нет доступа к этой организации.",403);
    const settings=await db.maxOrganizationIntegration.findUnique({where:{organizationId:requested}});
    if(settings?.enabled===false) throw new MaxError("Эта организация отключила доступ через MAX.",403);
    await db.maxIdentity.update({where:{id:identity.id},data:{activeOrganizationId:requested}});
    await menu(event,identity.id); return;
  }
  if(/^orgs:\d{1,3}$/.test(event.payload) || event.payload==="/organizations") {
    await organizations(event,identity.id,Number(event.payload.split(":")[1]||0)); return;
  }
  if(/^journals:\d{1,3}$/.test(event.payload) || event.payload==="/journals") {
    await journals(event,identity.id,Number(event.payload.split(":")[1]||0)); return;
  }
  await menu(event,identity.id);
}

export async function handleMaxUpdate(input:unknown) {
  const event=parseMaxUpdate(input); if(!event) return;
  const id=maxUpdateKey(input); const now=new Date();
  // A lease permits retry after a crash, while CAS prevents concurrent delivery.
  await db.maxWebhookReceipt.upsert({where:{id},create:{id,leaseUntil:now},update:{}});
  const leased=await db.maxWebhookReceipt.updateMany({where:{id,completedAt:null,leaseUntil:{lte:now}},data:{leaseUntil:new Date(now.getTime()+60_000)}});
  if(!leased.count) {
    const receipt=await db.maxWebhookReceipt.findUnique({where:{id}});
    if(!receipt?.completedAt) throw new MaxError("Update is processing",503);
    return;
  }
  try {
    if(event.callbackId) await maxApi("/answers?callback_id="+encodeURIComponent(event.callbackId),{method:"POST",body:{notification:"Открываем…"}}).catch(()=>undefined);
    try {await handleEvent(event);} catch(error) {
      if(!(error instanceof MaxError)) throw error;
      await maxSend(event.chatId,error.message);
    }
    await db.maxWebhookReceipt.update({where:{id},data:{completedAt:new Date()}});
  } catch(error) {
    await db.maxWebhookReceipt.updateMany({where:{id,completedAt:null},data:{leaseUntil:new Date(0)}});
    throw error;
  }
}
