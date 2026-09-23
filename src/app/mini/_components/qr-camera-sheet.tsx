"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { haptic } from "./use-haptic";

/**
 * Сканер QR камерой браузера — для тех, кто открыл кабинет вне Telegram
 * (вкладка или установленное приложение). Внутри Telegram работает
 * родной `showScanQrPopup`, и сюда мы не попадаем.
 *
 * Библиотека грузится динамически: `html5-qrcode` весит прилично, а
 * сканером пользуется меньшинство и не на каждом заходе.
 *
 * Камера требует `camera=(self)` в Permissions-Policy — на /mini она
 * открыта (см. next.config.ts). Со старым `camera=()` `getUserMedia`
 * падал бы без внятной причины.
 */
export function QrCameraSheet({
  open,
  onClose,
  onResult,
}: {
  open: boolean;
  onClose: () => void;
  /** Вернуть true, если код разобран и сканирование пора прекратить. */
  onResult: (text: string) => boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const containerId = useRef(`mini-qr-${Math.random().toString(36).slice(2)}`);

  // Колбэки держим в ref'ах, а эффект зависит только от `open`. Иначе
  // родительский `onClose={() => ...}` — новая функция на каждый рендер —
  // перезапускал бы камеру: чёрный кадр и мигание вместо сканера.
  const onCloseRef = useRef(onClose);
  const onResultRef = useRef(onResult);
  onCloseRef.current = onClose;
  onResultRef.current = onResult;

  useEffect(() => {
    if (!open) return;

    let stopped = false;
    // Тип берём из самой библиотеки, но только как тип: значение
    // подтягивается динамическим импортом ниже.
    let instance: import("html5-qrcode").Html5Qrcode | null = null;

    setError(null);
    setStarting(true);

    void (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (stopped) return;
        instance = new Html5Qrcode(containerId.current, { verbose: false });
        await instance.start(
          { facingMode: "environment" },
          {
            fps: 10,
            // Рамка от ширины кадра, а не фиксированные 240px:
            // на узком экране жёсткий размер больше видео, и
            // html5-qrcode падает вместо того, чтобы сканировать.
            qrbox: (width, height) => {
              const side = Math.floor(Math.min(width, height) * 0.7);
              return { width: side, height: side };
            },
          },
          (text) => {
            // Колбэк срабатывает по многу раз в секунду, пока код в
            // кадре. Останавливаемся только когда вызывающий сказал,
            // что код ему подошёл, — иначе неизвестный QR закрывал бы
            // сканер, и человек не мог бы навести на нужный.
            if (onResultRef.current(text)) {
              haptic("success");
              onCloseRef.current();
            }
          },
          () => {
            /* кадр без кода — это норма, молчим */
          },
        );
        if (stopped) {
          await instance.stop().catch(() => {});
          return;
        }
        setStarting(false);
      } catch (e) {
        if (stopped) return;
        setStarting(false);
        // html5-qrcode отклоняет промис то объектом ошибки, то просто
        // строкой, поэтому смотрим и на `name`, и на текст.
        const name = (e as { name?: string })?.name ?? "";
        const text = `${name} ${String((e as { message?: string })?.message ?? e)}`;
        setError(
          /NotAllowedError|Permission|denied/i.test(text)
            ? "Доступ к камере запрещён. Разрешите его в настройках браузера и откройте сканер снова."
            : /NotFoundError|no camera|not found/i.test(text)
              ? "Камера не найдена."
              : "Не удалось включить камеру.",
        );
      }
    })();

    return () => {
      stopped = true;
      // stop() отвергается, если старт не успел завершиться, — глушим:
      // отдельного сообщения человеку это не стоит.
      instance?.stop().catch(() => {});
    };
  }, [open]);

  if (!open) return null;

  // Портал в body — обязательно. `.mini-theme.css` ставит
  // `.mini-root > * { position: relative; z-index: 1 }`, из-за чего
  // `<main>` заводит собственный контекст наложения: сканер внутри него
  // остался бы ПОД нижней навигацией и тостами, какой бы z-index мы ему
  // ни написали.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ background: "rgba(6,7,10,0.96)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Сканирование QR-кода"
    >
      <div className="flex items-center justify-between px-4 pb-3 pt-[max(1rem,var(--mini-safe-t,0px))]">
        <span className="text-[15px] font-medium text-white">
          Наведите на QR-код
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть сканер"
          className="flex size-11 items-center justify-center rounded-2xl text-white/80"
        >
          <X className="size-6" />
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 pb-10">
        <div className="w-full max-w-[360px]">
          <div
            id={containerId.current}
            className="overflow-hidden rounded-3xl"
            style={{ background: "#000" }}
          />
          {starting ? (
            <p className="mt-4 text-center text-[14px] text-white/60">
              Включаем камеру…
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-4 text-center text-[14px] text-[#ff8f85]">
              {error}
            </p>
          ) : null}
          {!starting && !error ? (
            <p className="mt-4 text-center text-[13px] text-white/50">
              Код на наклейке журнала или оборудования
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
