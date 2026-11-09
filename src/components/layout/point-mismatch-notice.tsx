"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, MapPin, Store } from "lucide-react";
import { toast } from "sonner";
import type { PointMismatch } from "@/lib/document-point-access";
import { useContentTransition } from "@/components/layout/content-transition";

/** Что открыто — от этого зависят заголовок и текст. */
export type PointMismatchKind = "document" | "entry" | "batch" | "capa" | "supply";

/**
 * Открыт объект одной точки (документ журнала, запись, партия…), а в шапке
 * выбрана другая (владелец, 2026-11-09: «открыл журнал, переключил точку —
 * журнал остался тем же; должна быть ошибка»). Вместо содержимого — ошибка,
 * «Назад», переход на точку объекта (страница откроется на месте) и список
 * выбранной точки. Вид — как у `PointModeUnavailable`.
 */
export function PointMismatchNotice({
  kind,
  mismatch,
  listHref,
}: {
  kind: PointMismatchKind;
  mismatch: PointMismatch;
  /** Список раздела для выбранной точки; туда же ведёт «Назад» без истории. */
  listHref: string;
}) {
  const t = useTranslations("navigation.shell.pointMismatch");
  const router = useRouter();
  // Тот же переход, что у переключателя в шапке: скелет, пока страница точки собирается.
  const { refreshAfter, isPending: busy } = useContentTransition();
  const pointName = mismatch.pointName;
  const canSwitch = mismatch.canSwitch && pointName !== null;

  function goBack() {
    // Пришли по прямой ссылке — назад некуда: ведём в список.
    if (window.history.length > 1) router.back();
    else router.push(listHref);
  }

  function switchPoint() {
    if (busy) return;
    refreshAfter(mismatch.pointId, async () => {
      try {
        const response = await fetch("/api/me/active-building", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ buildingId: mismatch.pointId }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error ?? t("failed"));
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("failed"));
        return false;
      }
    });
  }

  return (
    <div
      className="mx-auto max-w-[560px] rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center"
      data-point-mismatch={kind}
    >
      <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
        <Store className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t(`title.${kind}`)}</h1>
      <p className="mx-auto mt-2 max-w-[440px] text-[14px] leading-[1.6] text-[#6f7282]">
        {pointName !== null
          ? t(`body.${kind}`, { point: pointName, selected: mismatch.selectedName })
          : t("bodyUnknown", { selected: mismatch.selectedName })}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          data-point-mismatch-back
        >
          <ArrowLeft className="size-4 text-[#5566f6]" aria-hidden />
          {t("back")}
        </button>
        {canSwitch ? (
          <button
            type="button"
            onClick={switchPoint}
            disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-70"
            data-point-mismatch-switch
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MapPin className="size-4" aria-hidden />}
            {t("switchTo", { point: pointName })}
          </button>
        ) : null}
      </div>
      <Link
        href={listHref}
        className="mt-4 inline-flex text-[13px] font-medium text-[#5566f6] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        data-point-mismatch-list
      >
        {t("toList", { selected: mismatch.selectedName })}
      </Link>
      <p className="mx-auto mt-3 max-w-[440px] text-[12.5px] leading-[1.55] text-[#9b9fb3]">
        {canSwitch ? t("hintSwitch", { point: pointName }) : t("hintNoSwitch")}
      </p>
    </div>
  );
}
