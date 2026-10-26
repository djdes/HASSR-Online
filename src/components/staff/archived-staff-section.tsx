"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Archive, ChevronDown, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { isBillingLimitError, useBillingError } from "@/lib/billing-limit-toast";
import { contactSupport as openSupport } from "@/lib/support-chat-bus";
import { cn } from "@/lib/utils";

/**
 * «Архив» на странице сотрудников: кто ушёл в архив (в том числе при
 * переходе на бесплатный тариф) и кнопка «Вернуть». Возврат занимает место
 * в тарифе — на бесплатном после конца бесплатного периода сервер ответит
 * «оплатите подписку», и toast покажет кнопку «Оплатить».
 *
 * Уволенных по графику здесь нет: их возвращают снятием увольнения во
 * вкладке «Увольнения».
 */
export type ArchivedEmployee = {
  id: string;
  name: string;
  position: string | null;
  archivedAt: string;
};

export function ArchivedStaffSection({
  employees,
  seatsNote,
  payHref,
  payLabel,
  contactSupport: withContact = false,
}: {
  employees: ArchivedEmployee[];
  /** Подсказка про места тарифа (null — мест хватает или лимита нет). */
  seatsNote: string | null;
  /** Ссылка на оплату рядом с подсказкой; null — не звать (приложение). */
  payHref: string | null;
  /** Подпись ссылки — следующий тариф («Подключить «Стандарт»»); нет — «Сменить тариф». */
  payLabel?: string;
  /** У «Премиума» больше мест — по согласованию: кнопка «Связаться». */
  contactSupport?: boolean;
}) {
  const { toastApiError } = useBillingError();
  const t = useTranslations("staffManagement.archive");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (employees.length === 0) return null;

  async function restore(ids: string[]) {
    let restored = 0;
    for (const id of ids) {
      setBusyId(id);
      try {
        const res = await fetch(`/api/staff/${id}/archive`, { method: "DELETE" });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          toastApiError(data, t("restoreFailed"));
          // Упёрлись в лимит — дальше по списку то же самое.
          if (isBillingLimitError(data)) break;
          continue;
        }
        restored += 1;
      } catch {
        toast.error(t("networkUnavailable"));
        break;
      }
    }
    setBusyId(null);
    if (restored > 0) {
      toast.success(restored === 1 ? t("restoredOne") : t("restoredMany", { count: restored }));
      router.refresh();
    }
  }

  return (
    <section
      data-testid="archived-staff"
      className="mt-6 rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left md:px-6"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <Archive className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold text-[#0b1024]">
            {t("title", { count: employees.length })}
          </span>
          <span className="block text-[13px] text-[#6f7282]">
            {t("description")}
          </span>
        </span>
        <ChevronDown
          className={cn("size-5 shrink-0 text-[#5566f6] transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="border-t border-[#ececf4] px-5 pb-5 pt-3 md:px-6">
          {seatsNote ? (
            <p className="mb-3 rounded-2xl bg-[#fffaf0] px-4 py-3 text-[13px] leading-[1.5] text-[#7a4a00]">
              {seatsNote}{" "}
              {payHref ? (
                <Link href={payHref} className="font-medium text-[#3848c7] underline underline-offset-2">
                  {payLabel ?? t("paySubscription")}
                </Link>
              ) : withContact ? (
                <button
                  type="button"
                  onClick={() => openSupport(t("contactSubject"))}
                  className="font-medium text-[#3848c7] underline underline-offset-2"
                >
                  {t("contact")}
                </button>
              ) : null}
            </p>
          ) : null}
          <ul className="divide-y divide-[#f2f3f8]">
            {employees.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-medium text-[#0b1024]">{e.name}</div>
                  <div className="truncate text-[12.5px] text-[#6f7282]">
                    {[e.position, t("archivedSince", { date: new Date(e.archivedAt).toLocaleDateString(locale) })]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void restore([e.id])}
                  disabled={busyId !== null}
                  data-testid={`restore-${e.id}`}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
                >
                  {busyId === e.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4 text-[#5566f6]" />
                  )}
                  {t("restore")}
                </button>
              </li>
            ))}
          </ul>
          {employees.length > 1 ? (
            <button
              type="button"
              onClick={() => void restore(employees.map((e) => e.id))}
              disabled={busyId !== null}
              className="mt-3 inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
            >
              <RotateCcw className="size-4 text-[#5566f6]" />
              {t("restoreAll")}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
