"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { useSubmitLock } from "@/lib/use-submit-lock";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { productEditorUnit, parseProductUnitInput, productErrorKey, type ProductErrorKey } from "@/lib/settings-products-presentation";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ProductData {
  id: string;
  name: string;
  supplier: string | null;
  barcode: string | null;
  unit: string;
  category: string | null;
  storageTemp: string | null;
  shelfLifeDays: number | null;
}

interface ProductDialogProps {
  product?: ProductData;
}

export function ProductDialog({ product }: ProductDialogProps) {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations("settingsProducts");
  const common = useTranslations("common");
  const isEdit = !!product;
  const [open, setOpen] = useState(false);
  // Двойной тап по кнопке успевал отправить два одинаковых запроса:
  // setState применяется только к следующему рендеру. Замок синхронный.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState<ProductErrorKey | "errors.generic" | null>(null);
  const [name, setName] = useState(product?.name ?? "");
  const [supplier, setSupplier] = useState(product?.supplier ?? "");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [unit, setUnit] = useState(product?.unit ?? "kg");
  const [unitDraft, setUnitDraft] = useState<string | null>(null);
  const [category, setCategory] = useState(product?.category ?? "");
  const [storageTemp, setStorageTemp] = useState(product?.storageTemp ?? "");
  const [shelfLifeDays, setShelfLifeDays] = useState(product?.shelfLifeDays?.toString() ?? "");

  function resetForm() {
    setName(product?.name ?? "");
    setSupplier(product?.supplier ?? "");
    setBarcode(product?.barcode ?? "");
    setUnit(product?.unit ?? "kg");
    setUnitDraft(null);
    setCategory(product?.category ?? "");
    setStorageTemp(product?.storageTemp ?? "");
    setShelfLifeDays(product?.shelfLifeDays?.toString() ?? "");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!acquire()) return;
    setError(null);

    try {
      const body = {
        ...(isEdit && { id: product.id }),
        name,
        supplier: supplier || null,
        barcode: barcode || null,
        unit,
        category: category || null,
        storageTemp: storageTemp || null,
        shelfLifeDays: shelfLifeDays ? Number(shelfLifeDays) : null,
      };

      const response = await fetch("/api/products", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const result = await response.json();
        setError(productErrorKey(result, isEdit ? "PUT" : "POST", response.status) ?? "errors.generic");
        return;
      }

      setUnitDraft(null);
      if (!isEdit) resetForm();
      setOpen(false);
      router.refresh();
    } catch {
      setError("errors.generic");
    } finally {
      release();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); setUnitDraft(null); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="sm" aria-label={common("edit")}><Pencil className="size-4" /></Button>
        ) : (
          <Button variant="outline"><Plus className="size-4" />{t("form.add")}</Button>
        )}
      </DialogTrigger>
      <DialogContent closeLabel={common("close")}>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("form.editTitle") : t("form.add")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{t(error)}</div>
          )}
          <div className="space-y-2">
            <Label htmlFor="prod-name">{t("fields.name")} <span className="text-destructive">*</span></Label>
            <Input id="prod-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("examples.name")} required />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="space-y-2">
              <Label htmlFor="prod-supplier">{t("fields.supplier")}</Label>
              <Input id="prod-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder={t("examples.supplier")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-barcode">{t("fields.barcode")}</Label>
              <Input id="prod-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="4600000000000" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <div className="space-y-2">
              <Label htmlFor="prod-unit">{t("fields.unit")}</Label>
              {/* В базе единица хранится кодом («kg»), на экране — «кг». */}
              <Input
                id="prod-unit"
                value={unitDraft ?? productEditorUnit(unit, t)}
                onChange={(e) => { const value = e.target.value; setUnitDraft(value); setUnit(parseProductUnitInput(value, locale)); }}
                onBlur={() => setUnitDraft(null)}
                placeholder={t("units.kg")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-category">{t("fields.category")}</Label>
              <Input id="prod-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t("examples.category")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-shelf">{t("fields.shelf")}</Label>
              <Input id="prod-shelf" type="number" value={shelfLifeDays} onChange={(e) => setShelfLifeDays(e.target.value)} placeholder="30" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="prod-temp">{t("fields.temp")}</Label>
            <Input id="prod-temp" value={storageTemp} onChange={(e) => setStorageTemp(e.target.value)} placeholder="+2...+6°C" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setOpen(false); setUnitDraft(null); }} disabled={isSubmitting}>{common("cancel")}</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? t("form.saving") : isEdit ? common("save") : t("form.create")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
