"use client";

import { useState, useRef } from "react";
import { Camera, Loader2, X, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downscaleImageFile } from "@/lib/ai-vision/downscale";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

export interface OcrResult {
  productName: string | null;
  supplier: string | null;
  manufactureDate: string | null;
  expiryDate: string | null;
  quantity: number | null;
  unit: string | null;
  barcode: string | null;
  batchNumber: string | null;
  storageTemp: string | null;
  composition: string | null;
  confidence: "high" | "medium" | "low";
}

interface PhotoCaptureProps {
  onResult: (result: OcrResult) => void;
}

export function PhotoCapture({ onResult }: PhotoCaptureProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<OcrResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    // Show preview
    const url = URL.createObjectURL(file);
    setPreview(url);
    setError(null);
    setResult(null);
    setIsProcessing(true);

    try {
      // Снимок телефона (4–8 МБ) ужимаем до ~1600 px JPEG: быстрее по
      // мобильной связи и не упирается в лимит 5 МБ. Не открылся (HEIC на
      // компьютере) — отправляем как есть, сервер скажет, что не так.
      const upload = await downscaleImageFile(file).catch(() => file);
      const formData = new FormData();
      formData.append("photo", upload, upload === file ? file.name : "label.jpg");

      const res = await fetch("/api/ocr/label", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Ошибка распознавания");
      }

      setResult(data.result);
    } catch (err) {
      setError(humanizeFetchError(err, "Ошибка распознавания"));
    } finally {
      setIsProcessing(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function applyResult() {
    if (result) {
      onResult(result);
      reset();
    }
  }

  function reset() {
    setPreview(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  const confidenceLabel = {
    high: "Высокая точность",
    medium: "Средняя точность",
    low: "Низкая точность — проверьте данные",
  };

  const confidenceColor = {
    high: "text-green-700 bg-green-50 border-green-200",
    medium: "text-yellow-700 bg-yellow-50 border-yellow-200",
    low: "text-red-700 bg-red-50 border-red-200",
  };

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleInputChange}
        className="hidden"
      />

      {!preview && (
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          className="w-full border-dashed border-2 h-20 flex flex-col gap-1"
        >
          <Camera className="size-6" />
          <span className="text-sm">Сфотографировать этикетку</span>
        </Button>
      )}

      {preview && (
        <div className="space-y-3">
          <div className="relative rounded-lg overflow-hidden border">
            <img
              src={preview}
              alt="Фото этикетки"
              className="w-full max-h-48 object-contain bg-muted"
            />
            {isProcessing && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <div className="flex items-center gap-2 text-white bg-black/70 rounded-full px-4 py-2">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm">Распознаю этикетку… обычно 10–40 секунд</span>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-center justify-between">
              <span>{error}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <RotateCcw className="size-3 mr-1" />
                Ещё раз
              </Button>
            </div>
          )}

          {result && (
            <div
              className={`rounded-md border p-3 space-y-2 ${confidenceColor[result.confidence]}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium">
                  {confidenceLabel[result.confidence]}
                </span>
              </div>
              <div className="space-y-1 text-sm">
                {result.productName && (
                  <p>
                    <span className="font-medium">Продукт:</span>{" "}
                    {result.productName}
                  </p>
                )}
                {result.supplier && (
                  <p>
                    <span className="font-medium">Производитель:</span>{" "}
                    {result.supplier}
                  </p>
                )}
                {result.manufactureDate && (
                  <p>
                    <span className="font-medium">Дата изготовления:</span>{" "}
                    {result.manufactureDate}
                  </p>
                )}
                {result.expiryDate && (
                  <p>
                    <span className="font-medium">Срок годности:</span>{" "}
                    {result.expiryDate}
                  </p>
                )}
                {result.batchNumber && (
                  <p>
                    <span className="font-medium">Партия:</span>{" "}
                    {result.batchNumber}
                  </p>
                )}
                {result.storageTemp && (
                  <p>
                    <span className="font-medium">Хранение:</span>{" "}
                    {result.storageTemp}
                  </p>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={applyResult}
                  className="flex-1"
                >
                  <Check className="size-3 mr-1" />
                  Заполнить форму
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <RotateCcw className="size-3 mr-1" />
                  Другое фото
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={reset}
                >
                  <X className="size-3" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
