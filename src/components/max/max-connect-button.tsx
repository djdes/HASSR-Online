"use client";
import { usePathname } from "next/navigation";
import { MaxIcon } from "./max-icon";

export function MaxConnectButton({dark=false}:{dark?:boolean}) {
  const pathname=usePathname();
  return <a href={`/max/connect?next=${encodeURIComponent(pathname)}`} aria-label="Подключить MAX" title="Мои журналы в MAX" className={`inline-flex size-10 shrink-0 items-center justify-center rounded-2xl transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/30 ${dark?"bg-white/10 hover:bg-white/20":"hover:bg-[#eef1ff]"}`}><MaxIcon className="size-7" /></a>;
}
