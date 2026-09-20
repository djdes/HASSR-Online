"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { QrCode } from "lucide-react";
import { toast } from "sonner";
import { getTelegramWebApp, isInsideTelegram } from "./telegram-web-app";
import { QrCameraSheet } from "./qr-camera-sheet";

/**
 * Расшифровка содержимого QR-кода → путь внутри Mini App.
 *
 * Поддерживает несколько форматов наклеек:
 *  - Полный URL `https://wesetup.ru/mini/...` — вырезаем pathname+search.
 *  - Короткий URL `https://wesetup.ru/qr/<slug>` — парсим slug:
 *      • `cold-<n>`        → температурный журнал, query ?cold=<n>;
 *      • `eq-<uuid|num>`   → /mini/equipment?q=<uuid|num>;
 *      • `journal-<code>`  → /mini/journals/<code>;
 *      • остальное         → /mini/journals?qr=<slug> (let caller deal).
 *  - Просто journal-код (`general_cleaning`) — открыть журнал.
 *  - UUID / число (вероятно equipment ID) — открыть карточку оборудования.
 */
function resolveQrDestination(text: string): string | null {
  const trimmed = text.trim();

  // QR-наклейка холодильника и A4-плакат склада: публичные страницы
  // замера с подписанным токеном. Открываем их как есть — форма работает
  // и внутри Telegram, вход не нужен.
  const fillMatch = trimmed.match(
    /(?:https?:\/\/[^/]+)?(\/(?:room-fill|equipment-fill|journal-fill)\/[^?\s#]+(?:\?[^\s#]*)?)/i
  );
  if (fillMatch?.[1]) {
    return fillMatch[1];
  }

  // Direct Mini App URL
  if (trimmed.includes("/mini/")) {
    try {
      const url = new URL(trimmed);
      if (url.pathname.startsWith("/mini/")) {
        return url.pathname + url.search;
      }
    } catch {
      const idx = trimmed.indexOf("/mini/");
      if (idx >= 0) return trimmed.slice(idx);
    }
  }

  // Wesetup short QR link: https://wesetup.ru/qr/<slug>
  // Хост/протокол необязательны — парсим даже если на наклейке без https.
  const qrMatch = trimmed.match(/(?:https?:\/\/[^/]+)?\/qr\/([^?\s]+)/i);
  if (qrMatch?.[1]) {
    const slug = qrMatch[1];
    if (/^cold-\d+$/i.test(slug)) {
      const num = slug.split("-")[1];
      return `/mini/journals/cold_equipment_control?cold=${encodeURIComponent(num)}`;
    }
    if (/^eq-[0-9a-f-]+$/i.test(slug)) {
      return `/mini/equipment?q=${encodeURIComponent(slug.slice(3))}`;
    }
    if (/^journal-[a-z_]+$/i.test(slug)) {
      return `/mini/journals/${slug.slice(8)}`;
    }
    // Generic fallback — кидаем slug в /mini/journals как ?qr=, пусть
    // дальше journal-список сам решит что показать (или сделает empty
    // state). Без этого QR с неизвестным slug просто молча игнорируется,
    // что хуже чем зайти на список.
    return `/mini/journals?qr=${encodeURIComponent(slug)}`;
  }

  // Journal code (e.g. "general_cleaning", "hygiene")
  if (/^[a-z_]+$/.test(trimmed)) {
    return `/mini/journals/${trimmed}`;
  }

  // Equipment ID (UUID or numeric)
  if (/^[0-9a-f-]{36}$/i.test(trimmed) || /^\d+$/.test(trimmed)) {
    return `/mini/equipment?q=${encodeURIComponent(trimmed)}`;
  }

  return null;
}

/** Exposed for unit tests — pure function, без DOM. */
export const __resolveQrDestinationForTests = resolveQrDestination;

export function QrScannerButton() {
  const router = useRouter();
  const [cameraOpen, setCameraOpen] = useState(false);

  // Разбор кода общий для обоих сканеров. Возвращает true, когда код
  // разобран, — по этому признаку сканер закрывается.
  const consume = useCallback(
    (text: string) => {
      const dest = resolveQrDestination(text);
      if (!dest) return false;
      router.push(dest);
      return true;
    },
    [router],
  );

  const handleScan = useCallback(() => {
    const tg = isInsideTelegram() ? getTelegramWebApp() : null;
    if (!tg) {
      // Вне Telegram раньше была только надпись «сканер доступен только
      // внутри Telegram». В установленном на телефон приложении это
      // тупик: Telegram там ни при чём, а наклейку сканировать надо.
      setCameraOpen(true);
      return;
    }

    try {
      tg.showScanQrPopup(
        { text: "Наведите камеру на QR-код журнала или оборудования" },
        (text: string) => {
          const dest = resolveQrDestination(text);
          if (dest) {
            tg.closeScanQrPopup?.();
            try {
              tg.HapticFeedback?.impactOccurred("medium");
            } catch {}
            router.push(dest);
            return true as unknown as void; // stop scanning
          }
          // Unknown format — keep scanning
          return undefined;
        }
      );
    } catch {
      toast.error("Не удалось открыть сканер QR. Обновите Telegram.");
    }
  }, [router]);

  return (
    <>
      <button
        onClick={handleScan}
        className="mini-press inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-[13px] font-medium"
        style={{
          background: "var(--mini-surface-1)",
          borderColor: "var(--mini-divider-strong)",
          color: "var(--mini-text)",
        }}
        aria-label="Сканировать QR"
      >
        <QrCode className="size-4" style={{ color: "var(--mini-lime)" }} />
        Сканировать QR
      </button>
      <QrCameraSheet
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onResult={consume}
      />
    </>
  );
}
