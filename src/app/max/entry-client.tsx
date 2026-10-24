"use client";
import Script from "next/script";

import { useCallback,useEffect,useRef,useState } from "react";
import { ArrowRight,Loader2,RefreshCw } from "lucide-react";
import { MaxIcon } from "@/components/max/max-icon";

export function MaxEntryClient() {
  const started=useRef(false);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(true);
  const [externalUrl,setExternalUrl]=useState("");
  const login=useCallback(async()=>{
    if(started.current) return;
    const ticket=new URLSearchParams(location.hash.slice(1)).get("ticket");
    const bridge=(window as Window&{WebApp?:{initData?:string;ready?:()=>void}}).WebApp;
    const initData=bridge?.initData;
    if(!ticket&&!initData) {setBusy(false);return;}
    started.current=true;
    history.replaceState(null,"",location.pathname);
    setBusy(true);setError("");
    try {
      bridge?.ready?.();
      const response=await fetch("/api/max/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({... (ticket?{ticket}:{initData}),embedded:window.self!==window.top}),signal:AbortSignal.timeout(20_000)});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||"Не удалось войти. Откройте новую ссылку из бота.");
      if(data.externalUrl) {setExternalUrl(data.externalUrl);setBusy(false);return;}
      location.replace(data.next);
    }catch(e){setError(e instanceof Error?e.message:"Не удалось войти. Откройте новую ссылку из бота.");setBusy(false);}
  },[]);
  useEffect(()=>{if(new URLSearchParams(location.hash.slice(1)).has("ticket")) void login();},[login]);
  return <main className="flex min-h-screen items-center justify-center bg-[#fafbff] px-4 py-10 text-[#0b1024]">
    <Script src="https://st.max.ru/js/max-web-app.js" strategy="afterInteractive" onReady={()=>void login()} onError={()=>{if(!started.current){setBusy(false);setError("Не удалось загрузить MAX. Откройте новую ссылку из бота или войдите на сайт.");}}}/>
    <section className="w-full max-w-md rounded-3xl border border-[#ececf4] bg-white p-7 sm:p-9"><MaxIcon className="size-16"/><h1 className="mt-6 text-[28px] font-semibold tracking-[-0.02em]">WeSetup в MAX</h1><p className="mt-3 text-[15px] leading-relaxed text-[#6f7282]">Ваши организации и журналы — с привычными правами доступа.</p>
      {busy?<p role="status" className="mt-7 flex items-center gap-2 text-[14px] text-[#3848c7]"><Loader2 className="size-5 animate-spin motion-reduce:animate-none"/>Проверяем вход…</p>:externalUrl?<div className="mt-6 space-y-4"><p className="text-[14px] leading-relaxed text-[#6f7282]">Вход подтверждён. В браузерном MAX кабинет откроется в отдельной вкладке — с вашими журналами и правами.</p><a href={externalUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors hover:bg-[#4a5bf0]">Открыть WeSetup<ArrowRight className="size-4"/></a></div>:<div className="mt-6 space-y-4">{error?<p role="alert" className="rounded-2xl bg-[#fff4f2] p-4 text-[14px] leading-relaxed text-[#a13a32]">{error}</p>:<p className="text-[14px] leading-relaxed text-[#6f7282]">Откройте этот кабинет из бота MAX. Если аккаунты ещё не связаны, подключите свой MAX на сайте.</p>}<a href="/max/connect" target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors hover:bg-[#4a5bf0]">Моя привязка MAX<ArrowRight className="size-4"/></a><a href="/login?next=%2Fmax%2Fjournals" target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-center gap-2 text-[14px] font-medium text-[#3848c7]">Войти через WeSetup</a><button onClick={()=>location.reload()} className="flex min-h-11 w-full items-center justify-center gap-2 text-[13px] text-[#6f7282]"><RefreshCw className="size-4"/>Проверить ещё раз</button></div>}
    </section>
  </main>;
}
