"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useLiveEvents } from "@/lib/use-live-events";
import { SUPPORT_ALERT_EVENT_KIND, parseSupportStaffAlert, type SupportStaffAlert } from "@/lib/support-staff-alerts";

/**
 * Всплывашка команде поддержки (владелец, 2026-11-23): новое обращение или
 * сообщение в чате — тост в углу, где бы человек ни был на сайте (кабинет,
 * админка). «Открыть» — обращение или ветка в /root/feedback, «Клиент» —
 * карточка клиента. Монтируется только сотрудникам платформы с доступом к
 * обращениям; та же запись остаётся в колокольчике.
 */
export function SupportStaffAlerts() {
  const t = useTranslations("notifications.supportAlerts");
  const router = useRouter();
  // Один тост на событие: повторная доставка (две вкладки, переподключение) не дублирует.
  const shown = useRef(new Set<string>());
  // Уже на странице обращений — только меняем якорь: страница сама раскроет
  // ветку и прокрутит к обращению (`FeedbackHashFocus`).
  const go = (href: string) => {
    const [path, hash] = href.split("#");
    if (hash && window.location.pathname === path) window.location.hash = hash;
    else router.push(href);
  };

  useLiveEvents((event) => {
    if (event.type !== "support" || event.kind !== SUPPORT_ALERT_EVENT_KIND) return;
    const alert = parseSupportStaffAlert(event.data);
    if (!alert) return;
    const key = `${alert.kind}:${alert.id}:${alert.preview}`;
    if (shown.current.has(key)) return;
    shown.current.add(key);
    toast(titleFor(alert, t), {
      id: `support-alert:${alert.kind}:${alert.id}`,
      description: [alert.who, alert.preview].filter(Boolean).join(" — "),
      duration: 15_000,
      action: { label: t("open"), onClick: () => go(alert.href) },
      ...(alert.clientHref
        ? { cancel: { label: t("client"), onClick: () => go(alert.clientHref as string) } }
        : {}),
    });
  });

  return null;
}

function titleFor(alert: SupportStaffAlert, t: ReturnType<typeof useTranslations<"notifications.supportAlerts">>): string {
  if (alert.kind === "chat") return t("chat");
  switch (alert.reportType) {
    case "bug":
      return t("reportBug");
    case "suggestion":
      return t("reportSuggestion");
    case "partnership":
      return t("reportPartnership");
    default:
      return t("report");
  }
}
