"use client";
import { usePathname } from "next/navigation";
import { MaxIcon } from "./max-icon";

export function MaxConnectButton({dark=false}:{dark?:boolean}) {
  const pathname=usePathname();
  return <a href={`/max/connect?next=${encodeURIComponent(pathname)}`} aria-label="MAX" title="MAX" onClick={(event)=>{event.currentTarget.href=`/max/connect?next=${encodeURIComponent(window.location.pathname+window.location.search)}`;}} className={`group inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#111114]/10 ${dark?"bg-white/10 hover:bg-white/20":"border border-[#e7e7ec] bg-white hover:bg-[#f1f1f4]"}`}><MaxIcon className={dark?"size-7":"size-[22px] opacity-60 grayscale transition-[filter,opacity] duration-150 group-hover:opacity-100 group-hover:grayscale-0"} /></a>;
}
