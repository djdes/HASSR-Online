"use client";
import { usePathname } from "next/navigation";
import { MaxIcon } from "./max-icon";

export function MaxConnectButton({dark=false}:{dark?:boolean}) {
  const pathname=usePathname();
  return <a href={`/max/connect?next=${encodeURIComponent(pathname)}`} aria-label="MAX" title="MAX" onClick={(event)=>{event.currentTarget.href=`/max/connect?next=${encodeURIComponent(window.location.pathname+window.location.search)}`;}} className={`inline-flex size-10 shrink-0 items-center justify-center rounded-2xl transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/30 ${dark?"bg-white/10 hover:bg-white/20":"hover:bg-[#eef1ff] newd:rounded-[10px] newd:border newd:border-[#e7e7ec] newd:bg-white newd:hover:bg-[#f1f1f4]"}`}><MaxIcon className={dark?"size-7":"size-7 newd:size-[22px]"} /></a>;
}
