/**
 * Цифра на иконке приложения и уведомление «запись ушла».
 *
 * Обе вещи решают одну задачу: на iOS фоновой отправки не существует —
 * Background Sync там не поддерживается. Очередь уходит ровно в тот
 * момент, когда человек открыл приложение, и до этого он не знает,
 * дошла ли его запись. Цифра на иконке отвечает на это, не заставляя
 * заходить, а уведомление — говорит, когда наконец дошло.
 *
 * Работает только у приложения, поставленного на домашний экран
 * (см. `install-prompt.ts`). У обычной вкладки методов просто нет —
 * поэтому каждый вызов защищён и молча ничего не делает.
 */

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Поставить или снять цифру. Ноль — снять, а не нарисовать «0». */
export function updateAppBadge(count: number): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as BadgeNavigator;
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => {});
    else void nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    /* метода нет — значит, не установлено */
  }
}

/**
 * Сказать, что записи ушли, когда человек этого не видит.
 *
 * Пока приложение открыто, об этом говорит полоса вверху экрана —
 * второе сообщение было бы шумом. Уведомление нужно ровно для случая
 * «поймал сеть в метро, приложение свёрнуто».
 */
export async function notifyQueueSent(
  sent: number,
  message: { title: string; body: string },
): Promise<void> {
  if (sent <= 0) return;
  if (typeof document === "undefined") return;
  if (document.visibilityState === "visible") return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return;
  }
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (!registration) return;
    await registration.showNotification(message.title, {
      body: message.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "wesetup-queue-sent",
      data: { url: "/mini" },
    });
  } catch {
    /* уведомления недоступны — полоса в приложении всё равно покажет */
  }
}
