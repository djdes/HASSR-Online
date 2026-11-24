import {
  formatOrderStatusBadge,
  formatSlotStatusBadge,
  type StatusBadgeMeta,
} from "@/lib/seo/gogetlinks-ui-format";
import type {
  GglMessageDto,
  GglOrderDto,
  GglPlannedSlotDto,
  GglThreadDto,
} from "./types";
import { extractThreadDonorIdentity } from "./webmaster-placement-lookup";

export interface ChatSystemNotification {
  id: string;
  kind: "order" | "slot";
  title: string;
  statusBadge: StatusBadgeMeta;
  priceRub: number;
  targetUrl: string | null;
  anchor: string | null;
  actorName: string | null;
  publishedUrl: string | null;
  timestamp: string;
}

export type ChatTimelineItem =
  | { type: "message"; timestamp: string; message: GglMessageDto }
  | {
      type: "system";
      timestamp: string;
      notification: ChatSystemNotification;
    };

function normalizeDomain(domain: string | null | undefined): string | null {
  const trimmed = domain?.trim().toLowerCase().replace(/^www\./, "") ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function findThreadMatchingOrders(params: {
  thread: GglThreadDto;
  orders: readonly GglOrderDto[];
  slots?: readonly GglPlannedSlotDto[];
}): GglOrderDto[] {
  const { thread, orders, slots = [] } = params;
  if (orders.length === 0) return [];

  const identity = extractThreadDonorIdentity(thread, slots);
  const normDomain = normalizeDomain(identity.donorDomain);

  const matched = orders.filter((o) => {
    if (thread.orderId && o.id === thread.orderId) return true;
    if (identity.donorSiteId && o.donorSiteId === identity.donorSiteId) {
      return true;
    }
    if (normDomain && normalizeDomain(o.donorDomain) === normDomain) {
      return true;
    }
    return false;
  });

  return [...matched].sort((a, b) => {
    const aTime = a.approvedAt ?? a.createdAt ?? "";
    const bTime = b.approvedAt ?? b.createdAt ?? "";
    return aTime.localeCompare(bTime);
  });
}

function orderNotificationTitle(status: string): string {
  switch (status) {
    case "sending":
      return "Заявка отправляется вебмастеру в GoGetLinks";
    case "pending_webmaster":
    case "in_progress":
      return "Заявка отправлена вебмастеру в GoGetLinks";
    case "on_check":
      return "Вебмастер разместил ссылку — заявка на проверке";
    case "paid":
      return "Заявка выполнена и оплачена в GoGetLinks";
    case "needs_replacement":
      return "По заявке требуется замена или доработка";
    case "rejected":
      return "Заявка отклонена или отменена";
    case "failed":
      return "Ошибка отправки заявки в GoGetLinks";
    default:
      return "Заявка в GoGetLinks обновлена";
  }
}

export function buildChatSystemNotifications(params: {
  thread: GglThreadDto;
  orders: readonly GglOrderDto[];
  slots?: readonly GglPlannedSlotDto[];
}): ChatSystemNotification[] {
  const { thread, orders, slots = [] } = params;
  const matchedOrders = findThreadMatchingOrders({ thread, orders, slots });
  const notifications: ChatSystemNotification[] = [];
  const coveredSlotIds = new Set<string>();

  for (const order of matchedOrders) {
    if (order.plannedSlotId) {
      coveredSlotIds.add(order.plannedSlotId);
    }
    const timestamp =
      order.paidAt ??
      order.approvedAt ??
      order.updatedAt ??
      order.createdAt ??
      new Date(0).toISOString();

    notifications.push({
      id: `sys-order-${order.id}`,
      kind: "order",
      title: orderNotificationTitle(order.status),
      statusBadge: formatOrderStatusBadge(order.status),
      priceRub: order.priceRub,
      targetUrl: order.targetUrl,
      anchor: order.anchor,
      actorName: order.approvedByName ?? order.initiatedByName ?? null,
      publishedUrl: order.publishedUrl,
      timestamp,
    });
  }

  // Fallback if thread.order is populated on thread DTO but not yet in orders array
  if (
    thread.order &&
    !matchedOrders.some((o) => o.id === thread.order?.id)
  ) {
    const o = thread.order;
    notifications.push({
      id: `sys-order-${o.id}`,
      kind: "order",
      title: orderNotificationTitle(o.status),
      statusBadge: formatOrderStatusBadge(o.status),
      priceRub: o.priceRub,
      targetUrl: o.targetUrl,
      anchor: o.anchor,
      actorName: null,
      publishedUrl: o.publishedUrl,
      timestamp:
        thread.updatedAt ?? thread.lastMessageAt ?? new Date(0).toISOString(),
    });
  }

  // Also include any planned slots for this donor that haven't been converted to an order in `matchedOrders`
  const identity = extractThreadDonorIdentity(thread, slots);
  const normDomain = normalizeDomain(identity.donorDomain);
  const matchedSlots = slots.filter((s) => {
    if (coveredSlotIds.has(s.id)) return false;
    if (s.status === "skipped" || s.status === "planned") return false;
    if (identity.donorSiteId && s.donorSiteId === identity.donorSiteId) {
      return true;
    }
    if (normDomain && normalizeDomain(s.donorDomain) === normDomain) {
      return true;
    }
    return false;
  });

  for (const slot of matchedSlots) {
    // If we already have a sent order for this donor and the slot is still pending_approval, still show it;
    // if the slot is ordered/approved_sending and no order row matched yet, show it as sent.
    const isSentSlot =
      slot.status === "ordered" || slot.status === "approved_sending";
    if (!isSentSlot && notifications.some((n) => n.kind === "order")) {
      continue;
    }
    const timestamp =
      slot.approvedAt ??
      slot.updatedAt ??
      slot.createdAt ??
      `${slot.scheduledDate}T09:00:00.000Z`;

    notifications.push({
      id: `sys-slot-${slot.id}`,
      kind: "slot",
      title: isSentSlot
        ? "Заявка по слоту отправлена вебмастеру в GoGetLinks"
        : `Подготовлен слот на ${slot.scheduledDate} (ожидает отправки заявки)`,
      statusBadge: formatSlotStatusBadge(slot.status),
      priceRub: slot.estimatedPriceRub ?? slot.maxPriceRub,
      targetUrl: slot.targetUrl,
      anchor: slot.anchor,
      actorName: slot.approvedByName ?? null,
      publishedUrl: null,
      timestamp,
    });
  }

  return notifications.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function buildChatTimeline(params: {
  messages: readonly GglMessageDto[];
  notifications: readonly ChatSystemNotification[];
}): ChatTimelineItem[] {
  const items: ChatTimelineItem[] = [
    ...params.messages.map(
      (message): ChatTimelineItem => ({
        type: "message",
        timestamp: message.sentAt || message.createdAt,
        message,
      }),
    ),
    ...params.notifications.map(
      (notification): ChatTimelineItem => ({
        type: "system",
        timestamp: notification.timestamp,
        notification,
      }),
    ),
  ];

  return items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
