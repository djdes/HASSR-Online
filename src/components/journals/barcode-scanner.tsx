"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ScanBarcode, Camera, CameraOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Html5QrcodeScanner,
  Html5QrcodeScanType,
} from "html5-qrcode";

interface ProductInfo {
  name: string;
  supplier: string | null;
  unit: string;
  shelfLifeDays: number | null;
  storageTemp: string | null;
}

interface BarcodeScannerProps {
  onScan: (barcode: string, product?: ProductInfo) => void;
}

export function BarcodeScanner({ onScan }: BarcodeScannerProps) {
  const t = useTranslations("journals.ui.barcodeScanner");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<{
    barcode: string;
    product?: ProductInfo;
  } | null>(null);

  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const scannerContainerId = "barcode-scanner-container";
  // Prevent duplicate lookups for the same barcode while processing
  const processingRef = useRef<string | null>(null);

  const handleScanSuccess = useCallback(
    async (decodedText: string) => {
      // Avoid processing the same barcode multiple times in quick succession
      if (processingRef.current === decodedText) return;
      processingRef.current = decodedText;

      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/products/lookup?barcode=${encodeURIComponent(decodedText)}`
        );

        if (res.ok) {
          const data = await res.json();
          const product: ProductInfo = {
            name: data.name,
            supplier: data.supplier,
            unit: data.unit,
            shelfLifeDays: data.shelfLifeDays,
            storageTemp: data.storageTemp,
          };
          setLastScan({ barcode: decodedText, product });
          onScan(decodedText, product);
        } else if (res.status === 404) {
          setLastScan({ barcode: decodedText });
          onScan(decodedText);
        } else {
          setLastScan({ barcode: decodedText });
          onScan(decodedText);
        }
      } catch {
        // Network error — still pass the barcode through
        setLastScan({ barcode: decodedText });
        onScan(decodedText);
      } finally {
        setIsLoading(false);
        // Allow re-scanning after a short delay
        setTimeout(() => {
          processingRef.current = null;
        }, 3000);
      }
    },
    [onScan]
  );

  useEffect(() => {
    if (!isOpen) return;

    // Small delay to ensure the container DOM element is rendered
    const timeout = setTimeout(() => {
      try {
        const scanner = new Html5QrcodeScanner(
          scannerContainerId,
          {
            fps: 10,
            qrbox: 250,
            supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
          },
          /* verbose= */ false
        );

        scanner.render(
          (decodedText: string) => {
            handleScanSuccess(decodedText);
          },
          (errorMessage: string) => {
            // html5-qrcode fires this continuously while scanning; only
            // surface actual permission / initialization errors.
            if (
              errorMessage.includes("NotAllowedError") ||
              errorMessage.includes("NotFoundError") ||
              errorMessage.includes("NotReadableError")
            ) {
              setError(t("cameraDenied"));
            }
          }
        );

        scannerRef.current = scanner;
      } catch {
        setError(t("initFailed"));
      }
    }, 100);

    return () => {
      clearTimeout(timeout);
      if (scannerRef.current) {
        try {
          scannerRef.current.clear();
        } catch {
          // Scanner may already be cleared
        }
        scannerRef.current = null;
      }
    };
  }, [isOpen, handleScanSuccess, t]);

  function toggleScanner() {
    setIsOpen((prev) => {
      if (prev) {
        // Closing — clean up scanner
        if (scannerRef.current) {
          try {
            scannerRef.current.clear();
          } catch {
            // ignore
          }
          scannerRef.current = null;
        }
        setError(null);
      }
      return !prev;
    });
  }

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        onClick={toggleScanner}
        className="gap-2"
      >
        {isOpen ? (
          <>
            <CameraOff className="size-4" />
            {t("close")}
          </>
        ) : (
          <>
            <Camera className="size-4" />
            <ScanBarcode className="size-4" />
            {t("scan")}
          </>
        )}
      </Button>

      {isOpen && (
        <div className="rounded-lg border overflow-hidden">
          <div id={scannerContainerId} />
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="text-sm text-muted-foreground animate-pulse">
          {t("lookingUp")}
        </div>
      )}

      {lastScan && !isLoading && (
        <div className="flex items-center gap-2 rounded-md border p-3 text-sm">
          <ScanBarcode className="size-4 shrink-0 text-muted-foreground" />
          {lastScan.product ? (
            <span>
              {t("found")}{" "}
              <span className="font-medium">{lastScan.product.name}</span>
              {lastScan.product.supplier && (
                <span className="text-muted-foreground">
                  {" "}
                  ({lastScan.product.supplier})
                </span>
              )}
              <Badge variant="secondary" className="ml-2">
                {lastScan.barcode}
              </Badge>
            </span>
          ) : (
            <span>
              {t("barcode")}{" "}
              <span className="font-medium">{lastScan.barcode}</span>
              <Badge variant="outline" className="ml-2">
                {t("notFound")}
              </Badge>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
