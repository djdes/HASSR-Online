"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2, Users, X } from "lucide-react";

import { CabinetAccessBlock, type AccessData } from "@/components/settings/master-cabinet-access-card";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

const MASTER_ACCESS_ENDPOINT = "/api/master/access";

/**
 * «Доступ» в шапке мастер-кабинета (только владелец аккаунта; владелец,
 * 2026-09-30: «из МК можно будет направлять приглашение») — те же люди и
 * действия, что в «Настройки → Права доступа → Мастер-кабинеты», для
 * открытого кабинета. Портал в `document.body`, как у остальных окон.
 */
export function MasterAccessDialog({ cabinetId, onClose }: { cabinetId: string; onClose: () => void }) {
  const t = useTranslations("masterUi.masterAccessDialog");
  const [access, setAccess] = useState<AccessData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(MASTER_ACCESS_ENDPOINT, { cache: "no-store" })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as (AccessData & { error?: string }) | null;
        if (!response.ok || !json?.cabinets) throw new Error(json?.error ?? t("loadFailed"));
        return json;
      })
      .then((data) => {
        if (!cancelled) setAccess(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cabinet = access?.cabinets.find((item) => item.id === cabinetId) ?? null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      // z-55: выше шапки кабинета (30), но ниже ConfirmDialog (60) — «Убрать доступ» открывается поверх.
      className="fixed inset-0 z-[55] flex items-center justify-center bg-[#0b1024]/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <BodyScrollLock />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="master-access-title"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_30px_80px_-30px_rgba(11,16,36,0.5)]"
        data-testid="master-access-dialog"
      >
        <div className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <Users className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="master-access-title" className="text-[18px] font-semibold leading-snug text-[#0b1024]">
              {t("title")}
            </h2>
            <p className="mt-1 text-[13px] leading-[1.5] text-[#6f7282]">
              {t("description")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="-mr-1 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#0b1024] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {error ? (
            <p className="rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]" role="alert">
              {error}
            </p>
          ) : !access ? (
            <div className="flex items-center gap-2 rounded-2xl border border-[#ececf4] px-4 py-3 text-[13px] text-[#6f7282]">
              <Loader2 className="size-4 animate-spin text-[#5566f6]" />
              {t("loading")}
            </div>
          ) : cabinet ? (
            <CabinetAccessBlock
              endpoint={MASTER_ACCESS_ENDPOINT}
              cabinet={cabinet}
              candidates={access.candidates}
              onChange={setAccess}
            />
          ) : (
            <p className="rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]" role="alert">
              {t("notFound")}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
