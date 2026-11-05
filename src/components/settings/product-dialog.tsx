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
import { Textarea } from "@/components/ui/textarea";
import { ChoicePills } from "@/components/settings/choice-pills";
import {
  PRODUCT_KINDS,
  SERVING_TEMPS,
  productKindOf,
  productShelfLife,
  type ProductKind,
  type ServingTemp,
  type ShelfLifeUnit,
} from "@/lib/product-kinds";
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
  kind: string;
  storageTemp: string | null;
  storageConditions: string | null;
  shelfLifeDays: number | null;
  shelfLifeHours: number | null;
  servingTemp: string | null;
}

interface ProductDialogProps {
  product?: ProductData;
  /** Вид новой позиции — вкладка справочника, с которой открыли диалог. */
  defaultKind?: ProductKind;
}

export function ProductDialog({ product, defaultKind = "raw" }: ProductDialogProps) {
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
  const initialShelf = product ? productShelfLife(product) : null;
  const initialKind = product ? productKindOf(product.kind) : defaultKind;
  const initialUnit: ShelfLifeUnit = initialShelf?.unit ?? (initialKind === "raw" ? "days" : "hours");
  const [kind, setKind] = useState<ProductKind>(initialKind);
  const [storageTemp, setStorageTemp] = useState(product?.storageTemp ?? "");
  const [storageConditions, setStorageConditions] = useState(product?.storageConditions ?? "");
  const [shelfValue, setShelfValue] = useState(initialShelf?.value.toString() ?? "");
  const [shelfUnit, setShelfUnit] = useState<ShelfLifeUnit>(initialUnit);
  const [servingTemp, setServingTemp] = useState<ServingTemp | null>((product?.servingTemp as ServingTemp | null) ?? null);

  function resetForm() {
    setName(product?.name ?? "");
    setSupplier(product?.supplier ?? "");
    setBarcode(product?.barcode ?? "");
    setUnit(product?.unit ?? "kg");
    setUnitDraft(null);
    setCategory(product?.category ?? "");
    setKind(initialKind);
    setStorageTemp(product?.storageTemp ?? "");
    setStorageConditions(product?.storageConditions ?? "");
    setShelfValue(initialShelf?.value.toString() ?? "");
    setShelfUnit(initialUnit);
    setServingTemp((product?.servingTemp as ServingTemp | null) ?? null);
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
        kind,
        storageTemp: storageTemp || null,
        storageConditions: storageConditions || null,
        shelfLifeValue: shelfValue ? Number(shelfValue) : null,
        shelfLifeUnit: shelfUnit,
        servingTemp: kind === "finished" ? servingTemp : null,
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
            <Label>{t("fields.kind")}</Label>
            <ChoicePills
              className="grid grid-cols-1 sm:grid-cols-3"
              label={t("fields.kind")}
              value={kind}
              onChange={(next) => {
                setKind(next);
                // Новая позиция без срока: у блюд и полуфабрикатов срок обычно в часах.
                if (!shelfValue) setShelfUnit(next === "raw" ? "days" : "hours");
              }}
              options={PRODUCT_KINDS.map((value) => ({ value, label: t(`kinds.${value}`), hint: t(`kindHints.${value}`) }))}
            />
          </div>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="prod-shelf">{t("fields.shelf")}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input id="prod-shelf" className="w-28" type="number" min={1} step={1} inputMode="numeric" value={shelfValue} onChange={(e) => setShelfValue(e.target.value)} placeholder={shelfUnit === "hours" ? "12" : "30"} />
              <ChoicePills
                label={t("fields.shelfUnit")}
                value={shelfUnit}
                onChange={setShelfUnit}
                options={[{ value: "hours", label: t("shelfUnits.hours") }, { value: "days", label: t("shelfUnits.days") }]}
              />
            </div>
            <p className="text-[12px] text-[#6f7282]">{t("hints.shelf")}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)] sm:gap-4">
            <div className="space-y-2">
              <Label htmlFor="prod-temp">{t("fields.temp")}</Label>
              <Input id="prod-temp" value={storageTemp} maxLength={100} onChange={(e) => setStorageTemp(e.target.value)} placeholder="+2…+6 °C" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-conditions">{t("fields.conditions")}</Label>
              <Textarea id="prod-conditions" rows={2} value={storageConditions} maxLength={500} onChange={(e) => setStorageConditions(e.target.value)} placeholder={t(`examples.conditions.${kind}`)} />
            </div>
          </div>
          {kind === "finished" ? (
            <div className="space-y-2">
              <Label>{t("fields.serving")}</Label>
              <ChoicePills
                className="grid grid-cols-1 sm:grid-cols-3"
                label={t("fields.serving")}
                value={servingTemp}
                onChange={setServingTemp}
                options={SERVING_TEMPS.map((value) => ({ value, label: t(`serving.${value}`), hint: t(`servingNorms.${value}`) }))}
              />
              <p className="text-[12px] text-[#6f7282]">{t("hints.serving")}</p>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setOpen(false); setUnitDraft(null); }} disabled={isSubmitting}>{common("cancel")}</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? t("form.saving") : isEdit ? common("save") : t("form.create")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
