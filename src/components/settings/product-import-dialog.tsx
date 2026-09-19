"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
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
  const [open, setOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    /// Строки, продукт с таким названием уже был в справочнике.
    duplicates?: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
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
        throw new Error(data.error || "Ошибка импорта");
      }

      setResult(data);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка импорта");
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
          Импорт из Excel
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Импорт справочника продуктов</DialogTitle>
          <DialogDescription>
            Загрузите Excel-файл (.xlsx, .xls) или CSV с товарами. Поддерживаются
            форматы экспорта из iiko и 1С.
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
                  <span>Импортируем...</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="size-6" />
                  <span>Выберите файл Excel или CSV</span>
                </>
              )}
            </Button>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {result && (
            <div className="rounded-md bg-green-50 border border-green-200 p-4 space-y-2">
              <p className="font-medium text-green-800">Импорт завершён</p>
              <div className="text-sm text-green-700 space-y-1">
                <p>Импортировано: <strong>{result.imported}</strong> продуктов</p>
                {result.skipped > 0 && (
                  <p>Пропущено (без названия): {result.skipped}</p>
                )}
                {result.duplicates ? (
                  <p>Уже были в справочнике: {result.duplicates}</p>
                ) : null}
                <p className="text-xs text-green-600">
                  Всего строк в файле: {result.total}
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={handleClose}>
                  Готово
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setResult(null);
                    fileInputRef.current?.click();
                  }}
                >
                  Загрузить ещё
                </Button>
              </div>
            </div>
          )}

          <div className="text-xs text-muted-foreground space-y-1">
            <p>Обязательный столбец: <strong>Наименование</strong> (или Название, Товар, Номенклатура)</p>
            <p>Необязательные: Поставщик, Штрих-код, Единица, Категория, Температура хранения, Срок годности</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
