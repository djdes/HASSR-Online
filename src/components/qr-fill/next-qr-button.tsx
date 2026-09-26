"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ScanLine } from "lucide-react";

import { QrCameraSheet } from "@/app/mini/_components/qr-camera-sheet";
import { parseNextQrTarget } from "@/lib/qr-next-scan";

/**
 * «Следующий QR» на экране «Записано» холодильника и склада (2026-09-23):
 * камера прямо здесь, сканируешь наклейку следующего объекта — открывается
 * его форма под той же учёткой, без повторного PIN (пропуск в cookie
 * организации). Никаких ссылок на другие объекты на экране: следующий
 * объект — только его наклейкой перед камерой.
 */
export function NextQrButton({
  withoutPin = false,
  className = "",
}: {
  /** Пропуск лежит в cookie (PIN подтверждён, «Запомнить выбор» включено). */
  withoutPin?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<number | null>(null);

  const onResult = (text: string) => {
    const target = parseNextQrTarget(text, window.location.origin);
    if (target) {
      setHint(null);
      window.location.assign(target);
      return true;
    }
    // Чужой код — продолжаем сканировать, подсказка ненадолго.
    setHint("Это не наклейка холодильника или склада");
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 2500);
    return false;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setHint(null);
          setOpen(true);
        }}
        data-testid="next-qr"
        className={`flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-[#5566f6] px-5 text-[18px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${className}`}
      >
        <ScanLine className="size-6" />
        Следующий QR
      </button>
      <p className="mt-2 text-center text-[14px] leading-snug text-[#6f7282]">
        Наведите камеру на наклейку следующего холодильника или склада
        {withoutPin ? " — PIN вводить не нужно." : "."}
      </p>
      <QrCameraSheet
        open={open}
        onClose={() => setOpen(false)}
        onResult={onResult}
      />
      {open && hint
        ? createPortal(
            <div
              role="alert"
              className="fixed inset-x-4 bottom-[max(1.5rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] z-[110] mx-auto max-w-[360px] rounded-2xl bg-[#fff4f2] px-4 py-3 text-center text-[15px] font-medium text-[#a13a32] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.6)]"
            >
              {hint}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
