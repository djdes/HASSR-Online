"use client";

import { useEffect, useState } from "react";
import { Share, Smartphone, X } from "lucide-react";

import { isInsideTelegram } from "./telegram-web-app";
import { haptic } from "./use-haptic";
import {
  noteInstallDismissed,
  readEntriesSaved,
  readInstallDismissedAt,
  shouldShowInstallPrompt,
} from "../_lib/install-prompt";
import { readPushEnvironment } from "../_lib/push-support";

/**
 * Предложение поставить приложение на домашний экран.
 *
 * Не про удобство запуска. На iPhone от установки зависят четыре вещи
 * сразу: уведомления, цифра на иконке, долгая жизнь офлайн-очереди и
 * сохранённых фотографий — Safari чистит хранилище вкладки после семи
 * дней без визитов, а установленному приложению не чистит. Запись,
 * сделанная в подвале без связи, у обычной вкладки может пропасть.
 *
 * Внутри Telegram не показываем вовсе: там «домашнего экрана» нет, и
 * предложение было бы про чужой мир.
 *
 * Когда показывать — решает {@link shouldShowInstallPrompt}; здесь
 * только чтение окружения и отрисовка.
 */
export function InstallPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isInsideTelegram()) return;
    const env = readPushEnvironment(false);
    setShow(
      shouldShowInstallPrompt({
        isIos: env.isIos,
        isStandalone: env.isStandalone,
        entriesSaved: readEntriesSaved(),
        dismissedAt: readInstallDismissedAt(),
        now: Date.now(),
      })
    );
  }, []);

  if (!show) return null;

  return (
    <div
      className="mt-3 flex items-start gap-3 rounded-2xl px-4 py-3.5"
      style={{
        background: "var(--mini-ice-soft)",
        border: "1px solid var(--mini-divider-strong)",
      }}
    >
      <span
        className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-2xl"
        style={{ background: "var(--mini-surface-2)", color: "var(--mini-ice)" }}
      >
        <Smartphone className="size-[18px]" />
      </span>

      <div className="min-w-0 flex-1">
        <p
          className="text-[14px] font-semibold"
          style={{ color: "var(--mini-text)" }}
        >
          Поставьте WeSetup на экран «Домой»
        </p>
        <p
          className="mt-1 text-[12.5px] leading-[1.5]"
          style={{ color: "var(--mini-text-muted)" }}
        >
          Так уведомления о незаполненных журналах начнут приходить, а
          записи, сделанные без связи, точно дождутся сети: обычной вкладке
          Safari очищает память через неделю простоя.
        </p>
        <p
          className="mt-2 flex items-center gap-1.5 text-[12.5px]"
          style={{ color: "var(--mini-text)" }}
        >
          <Share className="size-4 shrink-0" style={{ color: "var(--mini-ice)" }} />
          Внизу браузера «Поделиться» → «На экран «Домой»»
        </p>
      </div>

      <button
        type="button"
        aria-label="Скрыть предложение"
        className="mini-press -mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl"
        style={{ color: "var(--mini-text-faint)" }}
        onClick={() => {
          haptic("light");
          noteInstallDismissed();
          setShow(false);
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
