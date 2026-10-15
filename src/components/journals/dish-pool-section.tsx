"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Link2 } from "lucide-react";
import { toast } from "sonner";

type Info = { ownCode: string; linkedCode: string | null; linkedOrganizationName: string | null; poolSize: number };

/** Journal settings expose the object's own code; connections are managed in the master cabinet. */
export function DishPoolSection({ hideTitle = false }: { hideTitle?: boolean } = {}) {
  const t = useTranslations("journalControls");
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/settings/dish-pool", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then((body: Info | null) => { if (!cancelled && body) setInfo(body); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  if (!info) return null;
  return <div className="space-y-2">
    {!hideTitle ? <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{t("dishPool.title")}</div> : null}
    <p className="text-[12.5px] leading-[1.45] text-[#6f7282]">{t("dishPool.description")}</p>
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3 py-2 text-[13.5px]">
      <span className="text-[#6f7282]">{t("dishPool.code")}</span>
      <span className="font-mono font-semibold tracking-wider text-[#0b1024]" data-testid="own-service-code">{info.ownCode}</span>
      <button type="button" aria-label={t("dishPool.copy")} className="rounded-xl p-2 text-[#3848c7] hover:bg-white" onClick={() => { void navigator.clipboard?.writeText(info.ownCode).then(() => toast.success(t("dishPool.copied")), () => toast.error(t("dishPool.copyFailed"))); }}><Copy className="size-4" /></button>
    </div>
    {info.linkedCode ? <p className="flex items-center gap-2 rounded-2xl bg-[#f3fdf7] p-3 text-[13px] text-[#116b2a]"><Link2 className="size-4 shrink-0" />{t("dishPool.connected", { name: info.linkedOrganizationName ?? info.linkedCode, count: info.poolSize })}</p> : null}
  </div>;
}
