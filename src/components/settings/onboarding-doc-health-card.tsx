"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type Props = {
  /** Total active documents in the org. */
  totalActive: number;
  /** Active docs missing verifierUserId — двухступенчатая проверка не сработает. */
  missingVerifier: number;
  /** Active docs missing responsibleUserId — TasksFlow filler-задача не уйдёт. */
  missingResponsible: number;
};

export function OnboardingDocHealthCard({
  totalActive,
  missingVerifier,
  missingResponsible,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (totalActive === 0) return null;

  const allGood = missingVerifier === 0 && missingResponsible === 0;

  async function backfill() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        "/api/settings/journal-responsibles/backfill-verifiers",
        { method: "POST" }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Не удалось применить");
        return;
      }
      toast.success(
        `Готово: исправлено ${data?.fixed ?? 0} документов (было без verifier: ${data?.verifiersBefore}, стало: ${data?.verifiersAfter}).`
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setBusy(false);
    }
  }

  if (allGood) {
    return (
      <div className="rounded-2xl border border-[#c8f0d5] bg-[#ecfdf5] p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-[#d9f4e1] text-[#136b2a]">
            <CheckCircle2 className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-[#0b1024]">
              Все {totalActive} документов готовы к TasksFlow
            </div>
            <div className="mt-0.5 text-[12px] text-[#136b2a]">
              Каждый документ имеет ответственного и проверяющего —
              двухступенчатая проверка сработает корректно.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#ffe9b0] bg-[#fff8eb] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-white text-[#a13a32]">
            <AlertTriangle className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-[#0b1024]">
              Документы есть, но не все готовы к TasksFlow
            </div>
            <ul className="mt-1.5 space-y-1 text-[12px] text-[#a13a32]">
              {missingResponsible > 0 ? (
                <li className="flex items-start gap-1.5">
                  <span className="mt-1 inline-flex size-1.5 shrink-0 rounded-full bg-[#a13a32]" />
                  {missingResponsible} без ответственного — задача-исполнителю
                  не уйдёт
                </li>
              ) : null}
              {missingVerifier > 0 ? (
                <li className="flex items-start gap-1.5">
                  <span className="mt-1 inline-flex size-1.5 shrink-0 rounded-full bg-[#a13a32]" />
                  {missingVerifier} без проверяющего — заведующий производством не получит
                  «проверь когда заполнят»
                </li>
              ) : null}
            </ul>
            <p className="mt-2 text-[11px] text-[#6f7282]">
              Один клик ниже — пройдём каскадом по всем активным документам и
              запишем сохранённых в /settings/journal-responsibles слот-юзеров
              в каждый документ.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={backfill}
          disabled={busy}
          className="inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-2xl bg-[#5566f6] px-4 text-[13px] font-semibold text-white shadow-[0_8px_22px_-10px_rgba(85,102,246,0.6)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ShieldCheck className="size-4" />
          )}
          {busy ? "Применяем…" : "Применить ответственных"}
        </button>
      </div>
    </div>
  );
}
