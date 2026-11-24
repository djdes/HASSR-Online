"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BookDown, Loader2 } from "lucide-react";
import { PPK_BUTTON_OUTLINE_CLASS } from "@/components/production-control/ppk-ui";

/**
 * «Загрузить из справочника»: сервер добавляет готовую продукцию и
 * полуфабрикаты справочника, список описания продукции перечитывается.
 * Справочник пуст — ссылка на него вместо кнопки.
 */
export function ProductsImportButton({ available }: { available: number }) {
  const t = useTranslations("productionControl.structure.products");
  const [busy, setBusy] = useState(false);

  if (available === 0) {
    return (
      <Link href="/settings/products" className="text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6]">
        {t("emptyDirectory")}
      </Link>
    );
  }

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/production-control/products/import", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { added?: number; error?: string } | null;
      if (!response.ok || typeof body?.added !== "number") {
        toast.error(body?.error || t("importFailed"));
        return;
      }
      if (body.added === 0) {
        toast.info(t("importNothing"));
        return;
      }
      toast.success(t("imported", { count: String(body.added) }));
      window.dispatchEvent(new CustomEvent("ppk:reload", { detail: { block: "products" } }));
      window.dispatchEvent(new Event("ppk:changed"));
    } catch {
      toast.error(t("importFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={() => void run()} disabled={busy} className={PPK_BUTTON_OUTLINE_CLASS}>
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <BookDown className="size-4 text-[#5566f6]" aria-hidden />}
      {t("importFromDirectory", { count: String(available) })}
    </button>
  );
}
