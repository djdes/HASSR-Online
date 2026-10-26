"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback,useEffect,useState } from "react";
import { ArrowLeft,ArrowUpRight,Building2,Check,CheckCircle2,Copy,ExternalLink,Link2,Loader2,RefreshCw,ShieldCheck,Unlink,Users } from "lucide-react";
import { MaxIcon } from "./max-icon";

type State={configured:boolean;botUrl:string|null;identity:{displayName:string;createdAt:string}|null;canManageOrganization:boolean;integration:{enabled:boolean;chatTitle:string|null};pending:{requestId:string;scope:string;name:string|null;status:"waiting"|"confirm"|"expired"|"used";expiresAt:string}|null};
type LinkRequest={requestId:string;url?:string;command?:string;expiresAt:string};
const primary="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/30 disabled:cursor-wait disabled:opacity-60";
const secondary="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 py-2.5 text-[14px] font-medium text-[#3c4053] transition-colors hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/20 disabled:opacity-60";

export function MaxConnectClient({name,organizationName,next,organizationOnly=false}:{name:string;organizationName:string;next:string;organizationOnly?:boolean}) {
  const [state,setState]=useState<State|null>(null);
  const [request,setRequest]=useState<LinkRequest|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [qr,setQr]=useState("");
  const [confirmDisconnect,setConfirmDisconnect]=useState(false);
  const [now,setNow]=useState(Date.now());
  const api=useCallback(async(url:string,method="GET",body?:unknown)=>{
    const response=await fetch(url,{method,headers:body===undefined?{}:{"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:"no-store",signal:AbortSignal.timeout(15_000)});
    const data=await response.json();if(!response.ok) throw new Error(data.error||"Не удалось выполнить действие. Повторите через минуту.");return data;
  },[]);
  const refresh=useCallback(async()=>{
    const data=await api("/api/max/link"+(request?"?requestId="+encodeURIComponent(request.requestId):""));setState(data);
    if(!request && data.pending?.status==="confirm") setRequest({requestId:data.pending.requestId,expiresAt:data.pending.expiresAt,...(data.pending.scope==="organization"?{command:"pending"}:{})});
  },[api,request]);
  useEffect(()=>{void refresh().catch(e=>setError(e instanceof Error?e.message:"Не удалось проверить подключение."));},[refresh]);
  useEffect(()=>{
    if(!request) return;
    const timer=setInterval(()=>{setNow(Date.now());if(document.visibilityState==="visible") void refresh().catch(()=>undefined);},2500);
    const visible=()=>{if(document.visibilityState==="visible") void refresh().catch(()=>undefined);};
    document.addEventListener("visibilitychange",visible);
    return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
  },[request,refresh]);
  useEffect(()=>{
    if(!request?.url) {setQr("");return;}
    let live=true;
    void import("qrcode").then(m=>m.toDataURL(request.url!,{width:208,margin:1,color:{dark:"#0b1024",light:"#ffffff"}})).then(url=>{if(live)setQr(url);}).catch(()=>undefined);
    return()=>{live=false;};
  },[request]);
  async function action(work:()=>Promise<void>) {setBusy(true);setError("");setNotice("");try{await work();}catch(e){setError(e instanceof Error?e.message:"Не удалось выполнить действие.");}finally{setBusy(false);}}
  const create=(scope:"personal"|"organization")=>action(async()=>{const data=await api("/api/max/link","POST",{action:"create",scope});setRequest(data);setNow(Date.now());});
  const confirm=()=>action(async()=>{await api("/api/max/link","POST",{action:"confirm",requestId:request!.requestId});setRequest(null);setState(await api("/api/max/link"));setNotice("Готово. Привязка подтверждена — в MAX нажмите «Готово» или отправьте /menu.");});
  const organization=(body:unknown)=>action(async()=>{await api("/api/max/organization","PATCH",body);await refresh();setNotice("Настройки организации сохранены.");});
  const expired=!!request && new Date(request.expiresAt).getTime()<=now;
  const pending=state?.pending;
  const waiting=!!request && !expired && pending?.status!=="used";
  return <div className="space-y-6">
    {error?<div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#f0d6cf] bg-[#fff4f2] p-4 text-[14px] text-[#a13a32]"><p>{error}</p><button onClick={()=>void action(refresh)} disabled={busy} className={secondary}><RefreshCw className="size-4"/>Повторить</button></div>:null}
    {notice?<p role="status" className="flex items-start gap-2 rounded-2xl bg-[#ecfdf5] p-4 text-[14px] text-[#116b2a]"><CheckCircle2 className="mt-0.5 size-5 shrink-0"/>{notice}</p>:null}
    <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="min-w-0 rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4"><MaxIcon className="size-14"/><span className={`rounded-full px-3 py-1.5 text-[12px] font-medium ${state?.identity?"bg-[#ecfdf5] text-[#116b2a]":"bg-[#f5f6ff] text-[#3848c7]"}`}>{state?.identity?"Подключён":state?"Личный аккаунт":"Проверяем…"}</span></div>
        <h2 className="mt-5 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">{state?.identity?"Ваш MAX уже рядом":"Ваши журналы — прямо в MAX"}</h2>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#6f7282]">{state?.identity?`${state.identity.displayName} связан с аккаунтом ${name}. Откройте бота — журналы, сводка дня и напоминания работают прямо в чате, кнопками.`:"Один раз свяжите аккаунты. Дальше всё в чате с ботом: журналы заполняются кнопками, без сайта и ссылок."}</p>
        {!state&&!error?<div className="mt-7 flex items-center gap-2 text-[14px] text-[#6f7282]"><Loader2 className="size-4 animate-spin motion-reduce:animate-none"/>Проверяем подключение</div>:null}
        {state&&!state.configured?<p className="mt-5 rounded-2xl bg-[#f5f6ff] p-4 text-[14px] text-[#3848c7]">Подключение MAX ещё настраивается. Личные привязки появятся, как только администратор завершит настройку бота.</p>:null}
        {waiting?<div className="mt-6 space-y-4 border-t border-[#ececf4] pt-5">
          {pending?.status==="confirm"?<>
            <p className="text-[16px] font-semibold text-[#0b1024]">{pending.scope==="organization"?"Подключить эту группу?":"Это ваш аккаунт MAX?"}</p>
            <div className="flex items-center gap-3 rounded-2xl bg-[#f5f6ff] p-4"><ShieldCheck className="size-6 shrink-0 text-[#5566f6]"/><div className="min-w-0"><p className="break-words font-semibold text-[#0b1024]">{pending.name}</p><p className="mt-1 text-[13px] text-[#6f7282]">Подтверждайте только свою привязку.</p></div></div>
            <button className={primary+" w-full sm:w-auto"} disabled={busy} onClick={()=>void confirm()}>{busy?<Loader2 className="size-4 animate-spin"/>:<Check className="size-4"/>}Да, подтвердить</button>
            <button className={secondary+" sm:ml-2"} disabled={busy} onClick={()=>void create(pending.scope==="organization"?"organization":"personal")}>Это не я — новая ссылка</button>
          </>:<>
            <p className="text-[16px] font-semibold text-[#0b1024]">{request.command?"Отправьте команду в группу MAX":"Откройте бота и нажмите «Начать»"}</p>
            {request.command?<><p className="text-[14px] leading-relaxed text-[#6f7282]">Добавьте бота в группу и назначьте администратором. Отправьте команду из вашего привязанного MAX; у вас тоже должны быть права администратора группы.</p><button onClick={()=>void action(async()=>{await navigator.clipboard.writeText(request.command!);setNotice("Команда скопирована. Отправьте её в группу MAX.");})} className={secondary+" w-full"}><Copy className="size-4"/>Скопировать команду</button></>:<div className="flex flex-wrap items-center gap-5">{qr?<div className="hidden rounded-2xl border border-[#ececf4] p-2 md:block"><Image unoptimized src={qr} alt="QR-код для привязки личного MAX" width={160} height={160}/></div>:null}<div className="space-y-3"><a href={request.url} target="_blank" rel="noopener noreferrer" className={primary}>Открыть MAX<ArrowUpRight className="size-4"/></a><p className="max-w-64 text-[13px] leading-relaxed text-[#6f7282]">После запуска бота вернитесь сюда и подтвердите аккаунт.</p></div></div>}
            <p role="status" className="flex items-center gap-2 text-[13px] text-[#6f7282]"><Loader2 className="size-4 animate-spin motion-reduce:animate-none"/>Ожидаем MAX · ещё {Math.max(0,Math.ceil((new Date(request.expiresAt).getTime()-now)/60000))} мин.</p>
          </>}
          <button onClick={()=>setRequest(null)} className="text-[14px] font-medium text-[#6f7282] underline underline-offset-4">Закрыть этот шаг</button>
        </div>:null}
        {expired?<div role="status" className="mt-6 space-y-3"><p className="text-[14px] text-[#6f7282]">Срок ссылки закончился. Создайте новую — ваши данные сохранены.</p><button className={primary} disabled={busy} onClick={()=>void create(request.command?"organization":"personal")}><RefreshCw className="size-4"/>Новая ссылка</button></div>:null}
        {state?.configured&&!waiting&&!expired&&!state.identity?<button disabled={busy} onClick={()=>void create("personal")} className={primary+" mt-7 w-full sm:w-auto"}>{busy?<Loader2 className="size-4 animate-spin"/>:<Link2 className="size-4"/>}Связать мой MAX</button>:null}
        {state?.identity&&!waiting&&!expired?<div className="mt-7 flex flex-wrap items-center gap-3">{state.botUrl?<a href={state.botUrl} target="_blank" rel="noopener noreferrer" className={primary}>Открыть моего бота<ExternalLink className="size-4"/></a>:null}<button className="inline-flex min-h-11 items-center gap-2 px-2 text-[13px] font-medium text-[#6f7282] hover:text-[#a13a32]" onClick={()=>setConfirmDisconnect(true)}><Unlink className="size-4"/>Отключить</button></div>:null}
        {confirmDisconnect?<div className="mt-4 space-y-3 rounded-2xl bg-[#fff4f2] p-4"><p className="text-[14px] text-[#a13a32]">Отключить MAX? Для безопасности все сеансы WeSetup завершатся. После этого войдите на сайт заново.</p><div className="flex flex-wrap gap-2"><button className={secondary} disabled={busy} onClick={()=>void action(async()=>{await api("/api/max/link","DELETE",{});window.location.assign("/login?next=%2Fmax%2Fconnect");})}>Отключить MAX</button><button className={secondary} onClick={()=>setConfirmDisconnect(false)}>Отмена</button></div></div>:null}
      </section>
      <aside className="py-2 lg:py-5"><h3 className="text-[16px] font-semibold text-[#0b1024]">Один аккаунт. Ваши права.</h3><div className="mt-6 space-y-6">{[
        {icon:ShieldCheck,title:"Личный доступ",text:"Вы видите только то, что разрешено в WeSetup. MAX не меняет вашу роль."},
        {icon:Building2,title:"Свои организации",text:"Переключайтесь между организациями, к которым у вас есть доступ."},
        {icon:Users,title:"Управление для руководителя",text:"Сводка за сегодня, напоминания не заполнившим и подключение сотрудников — в боте по кнопкам."},
      ].map(item=><div key={item.title} className="flex gap-3"><item.icon className="mt-0.5 size-5 shrink-0 text-[#5566f6]"/><div><h4 className="text-[14px] font-semibold text-[#0b1024]">{item.title}</h4><p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">{item.text}</p></div></div>)}</div></aside>
    </div>
    {state?.canManageOrganization?<section className="rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">MAX для организации</h2><p className="mt-2 text-[14px] text-[#6f7282]">{organizationName}. Сотрудников подключайте из бота: «Подключить сотрудника» → личная ссылка, которую нужно переслать сотруднику.</p></div><label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px] font-medium text-[#3c4053]"><input type="checkbox" checked={state.integration.enabled} disabled={busy} onChange={e=>void organization({enabled:e.target.checked})} className="size-5 accent-[#5566f6]"/>Доступ через MAX</label></div><div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[#ececf4] pt-5"><div><p className="text-[15px] font-semibold text-[#0b1024]">{state.integration.chatTitle||"Групповой чат организации"}</p><p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[#6f7282]">{state.integration.chatTitle?"Группа подтверждена. Личные ссылки входа и журналы сотрудников остаются в переписке с ботом.":"Свяжите рабочую группу с организацией. Код подтверждает руководитель и администратор группы."}</p></div>{state.integration.chatTitle?<button className={secondary} disabled={busy} onClick={()=>void organization({disconnectChat:true})}>Отключить группу</button>:<button className={secondary} disabled={busy||!state.identity||!state.configured||!state.integration.enabled} onClick={()=>void create("organization")}><Users className="size-4"/>Подключить группу</button>}</div>{!state.identity?<p className="mt-3 text-[13px] text-[#6f7282]">Сначала подключите свой личный MAX выше.</p>:null}</section>:organizationOnly&&state?<p role="alert" className="text-[14px] text-[#a13a32]">Настройки организации доступны руководителю.</p>:null}
    <Link href={next} className="inline-flex min-h-11 items-center gap-2 text-[14px] font-medium text-[#3848c7]"><ArrowLeft className="size-4"/>Вернуться в WeSetup</Link>
  </div>;
}
