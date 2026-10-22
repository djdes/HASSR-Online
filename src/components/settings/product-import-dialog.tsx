"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { getProductImportFeedback, type ProductImportFeedback } from "@/lib/product-import-feedback";
import { Upload, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ProductImportDialog() {
  const router = useRouter();
  const t = useTranslations("settingsProductImport");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    /// Строки, продукт с таким названием уже был в справочнике.
    duplicates?: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<ProductImportFeedback | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setIsUploading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/products/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(getProductImportFeedback(data));
        return;
      }

      setResult(data);
      router.refresh();
    } catch {
      setError(getProductImportFeedback(null));
    } finally {
      setIsUploading(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleClose() {
    setOpen(false);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
      <DialogTrigger asChild>
        <Button>
          <Upload className="size-4" />
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle className="max-sm:pr-8">{t("title")}</DialogTitle>
          <DialogDescription>
            {t.rich("description", { excel: () => <span data-product-import-raw="excel">Excel</span>, extensions: () => <span data-product-import-raw="extensions">.xlsx, .xls</span>, csv: () => <span data-product-import-raw="csv">CSV</span>, iiko: () => <span data-product-import-raw="iiko">iiko</span>, oneC: () => <span data-product-import-raw="oneC">1С</span> })}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleInputChange}
          className="hidden"
        />

        <div className="space-y-4">
          {!result && (
            <Button
              variant="outline"
              className="w-full h-24 border-dashed border-2 flex flex-col gap-2"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className="size-6 animate-spin" />
                  <span>{t("uploading")}</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="size-6" />
                  <span>{t("chooseFile")}</span>
                </>
              )}
            </Button>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error.key === "errors.tooLarge" ? t(error.key, { limitMB: String(error.values.limitMB) }) : error.key === "errors.tooManyRows" ? t(error.key, { count: String(error.values.count), limit: String(error.values.limit) }) : error.key === "errors.nameColumnRequired" ? t.rich(error.key, { aliases: () => <span data-product-import-raw="error-aliases">"Наименование", "Название", "Товар", "Номенклатура"</span>, last: () => <span data-product-import-raw="error-last">"Продукт"</span> }) : t(error.key)}
            </div>
          )}

          {result && (
            <div className="rounded-md bg-green-50 border border-green-200 p-4 space-y-2">
              <p className="font-medium text-green-800">{t("success")}</p>
              <div className="text-sm text-green-700 space-y-1">
                <p>{t.rich("imported", { count: result.imported == null ? "" : String(result.imported), strong: (chunks) => <strong>{chunks}</strong> })}</p>
                {result.skipped > 0 && (
                  <p>{t("skipped", { count: String(result.skipped) })}</p>
                )}
                {result.duplicates ? (
                  <p>{t("duplicates", { count: String(result.duplicates) })}</p>
                ) : null}
                <p className="text-xs text-green-600">
                  {t("total", { count: result.total == null ? "" : String(result.total) })}
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={handleClose}>
                  {t("done")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setResult(null);
                    fileInputRef.current?.click();
                  }}
                >
                  {t("uploadMore")}
                </Button>
              </div>
            </div>
          )}

          <div className="text-xs text-muted-foreground space-y-1">
            <p>{t.rich("requiredColumns", { primary: () => <strong data-product-import-raw="primary">Наименование</strong>, alternates: () => <span data-product-import-raw="alternates">Название, Товар, Номенклатура</span> })}</p>
            <p>{t.rich("optionalColumns", { aliases: () => <span data-product-import-raw="optional">Поставщик, Штрих-код, Единица, Категория, Температура хранения, Срок годности</span> })}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
